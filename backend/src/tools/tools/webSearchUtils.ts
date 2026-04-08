import type { Browser } from '../../browser/browser.js';
import type { LlamaManager } from '../../llama/llamaManager.js';
import type { ToolSession, ToolEmit } from '../types.js';

export type FetchUrlEntry = {
    urlObj: URL;
    /** The search query that produced this URL (used to tag buffered pages) */
    query: string;
};

/**
 * Fetch pages from a list of URLs using a race-style settlement queue.
 *
 * As pages load, each is tokenized and checked against the context budget:
 * - Pages that fit within budget (and under returnCount) are added to results
 * - Pages over budget or over returnCount are buffered in session.bufferedPages
 *
 * When contextBudget is undefined (no context limit configured), pages are
 * returned in arrival order up to returnCount with no budget checking.
 *
 * @returns array of up to returnCount pages that fit within budget
 */
export async function fetchPagesRace(params: {
    urlEntries: FetchUrlEntry[];
    returnCount: number;
    session: ToolSession;
    browser: Browser;
    llama: LlamaManager;
    signal: AbortSignal;
    emit: ToolEmit;
}): Promise<Array<{ url: string; content: string }>> {
    const { urlEntries, returnCount, session, browser, llama, signal, emit } = params;

    if (urlEntries.length === 0) return [];

    // Early bail if context is already exhausted before we even start
    if (session.contextBudget !== undefined && session.contextBudget <= 0) return [];

    /* -------------------- SETTLEMENT QUEUE -------------------- */

    type SettledPage = { url: string; content: string; query: string };

    const settledQueue: Array<SettledPage | null> = [];
    let notifyWaiter: (() => void) | undefined;
    let inFlightCount = urlEntries.length;

    // When consuming = false (after the consumer loop exits), settled pages
    // go directly to session.bufferedPages rather than the queue.
    let consuming = true;

    const signalSettled = (item: SettledPage | null) => {
        if (consuming) {
            settledQueue.push(item);
            inFlightCount--;
            const n = notifyWaiter;
            notifyWaiter = undefined;
            n?.();
        } else if (item !== null) {
            session.bufferedPages.push(item);
        }
    };

    // Launch all fetches. fetchContent is called once per URL to create independent tasks.
    const urlObjs = urlEntries.map(e => e.urlObj);
    const fetchPromises = browser.fetchContent(false, signal, ...urlObjs);

    for (let i = 0; i < urlEntries.length; i++) {
        const entry = urlEntries[i]!;
        const promise = fetchPromises[i]!;
        promise
            .then(doc => signalSettled({ url: entry.urlObj.toString(), content: doc.content, query: entry.query }))
            .catch(() => signalSettled(null));
    }

    /* -------------------- CONSUMER LOOP -------------------- */

    const results: Array<{ url: string; content: string }> = [];

    while (results.length < returnCount) {
        // Wait for at least one settled item if the queue is empty
        if (settledQueue.length === 0) {
            if (inFlightCount === 0) break;
            await new Promise<void>(resolve => { notifyWaiter = resolve; });
        }

        // Drain currently available settled items
        while (settledQueue.length > 0 && results.length < returnCount) {
            const item = settledQueue.shift()!;

            if (item === null) continue;  // Page load failed

            // Check whether the page fits within the remaining context budget
            let fitsInBudget = true;
            if (session.contextBudget !== undefined) {
                if (session.contextBudget <= 0) {
                    fitsInBudget = false;
                } else {
                    const tokenCount = await llama.tokenize(item.content, session.model, signal);
                    if (tokenCount > session.contextBudget) {
                        fitsInBudget = false;
                    } else {
                        session.contextBudget -= tokenCount;
                    }
                }
            }

            const hostname = (() => {
                try { return new URL(item.url).hostname; } catch { return item.url; }
            })();

            if (!fitsInBudget) {
                session.bufferedPages.push(item);
                emit({ type: 'page_loaded', data: { url: item.url, hostname } });
                continue;
            }

            results.push({ url: item.url, content: item.content });
            session.seenUrls.add(item.url);
            emit({ type: 'page_loaded', data: { url: item.url, hostname } });
        }
    }

    // Stop consuming — remaining in-flight pages will push directly to bufferedPages
    consuming = false;

    // Drain any items that settled while the consumer loop was busy
    while (settledQueue.length > 0) {
        const item = settledQueue.shift()!;
        if (item !== null) {
            session.bufferedPages.push(item);
        }
    }

    return results;
}
