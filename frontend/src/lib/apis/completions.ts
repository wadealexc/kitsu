import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { ParsedEvent } from 'eventsource-parser';

import { API_BASE_URL } from '$lib/constants';
import type { ChatCompletionForm } from '@backend/routes/types.js';
import type { SseEvent } from '@backend/routes/sseEvents.js';
import type { ChatMessageUsage } from '@backend/routes/types.js';

export type StreamTimings = {
    predicted_n: number;
    predicted_ms: number;
    predicted_per_second: number;
    prompt_n: number;
    prompt_ms: number;
    prompt_per_second: number;
    cache_n: number;
};

export type PromptProgress = {
    total: number;
    cache: number;
    processed: number;
    time_ms?: number;
};

export type UrlStatus = { url: string; hostname: string; status: 'loading' | 'loaded' | 'failed' };
export type WebSearchProgress = { queries: string[]; urls: UrlStatus[] };

type TextStreamUpdate = {
    done: boolean;
    value: string;
    error?: any;
    usage?: ChatMessageUsage;
    /** reasoning content from choices[0].delta.reasoning_content */
    reasoning?: string;
    /** true when the [DONE] sentinel is seen; token streaming is finished */
    tokensDone?: boolean;
    /** parsed payload from a named 'chat-event' SSE frame */
    backendEvent?: SseEvent;
    /** per-token timings from llama.cpp timings_per_token */
    timings?: StreamTimings;
    /** prompt evaluation progress from llama.cpp return_progress */
    promptProgress?: PromptProgress;
};

/* -------------------- API -------------------- */

export const chatCompletion = async (
    token: string,
    body: ChatCompletionForm
): Promise<[AsyncGenerator<TextStreamUpdate>, AbortController]> => {
    const controller = new AbortController();
    const route = '/chat/custom-completions';

    const res = await fetch(`${API_BASE_URL}${route}`, {
        signal: controller.signal,
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    if (!res.body) {
        throw `No response body: ${route}`;
    }

    const stream = createSSEStream(res.body);
    return [stream, controller];
};

/* -------------------- STREAMING -------------------- */

// createSSEStream takes a responseBody with a SSE response,
// and returns an async generator that emits delta updates
export function createSSEStream(
    responseBody: ReadableStream<Uint8Array>
): AsyncGenerator<TextStreamUpdate> {
    const eventStream = responseBody
        .pipeThrough(new TextDecoderStream() as any)
        .pipeThrough(new EventSourceParserStream())
        .getReader();

    return streamToIterator(eventStream);
}

async function* streamToIterator(
    reader: ReadableStreamDefaultReader<ParsedEvent>
): AsyncGenerator<TextStreamUpdate> {
    while (true) {
        const { value, done } = await reader.read();

        // Physical end of stream (HTTP response body closed)
        if (done) {
            yield { done: true, value: '' };
            break;
        }

        if (!value) {
            continue;
        }

        // Named backend event (e.g. 'chat-event') - route to caller for handling
        if (value.event === 'chat-event') {
            try {
                const parsedData = JSON.parse(value.data);
                yield { done: false, value: '', backendEvent: parsedData };
            } catch (e) {
                console.error('Error parsing chat-event data:', e);
            }
            continue;
        }

        // Standard unnamed SSE message
        const data = value.data;
        if (data.startsWith('[DONE]')) {
            // Token streaming is complete, but don't break yet -
            // the backend may still send a named event frame after [DONE].
            yield { done: false, value: '', tokensDone: true };
            continue;
        }

        try {
            const parsedData = JSON.parse(data);

            if (parsedData.error) {
                yield { done: true, value: '', error: parsedData.error };
                break;
            }

            if (parsedData.usage) {
                yield { done: false, value: '', usage: parsedData.usage };
                continue;
            }

            const reasoning = parsedData.choices?.[0]?.delta?.reasoning_content;
            const content = parsedData.choices?.[0]?.delta?.content ?? '';
            const timings: StreamTimings | undefined = parsedData.timings;
            const promptProgress: PromptProgress | undefined = parsedData.prompt_progress;

            if (promptProgress) {
                console.log(
                    `progress: ${promptProgress.processed}, ${promptProgress.cache}, ${promptProgress.total} (p, c, t)`
                );
            }

            yield {
                done: false,
                value: content,
                ...(reasoning ? { reasoning } : {}),
                ...(timings ? { timings } : {}),
                ...(promptProgress ? { promptProgress } : {})
            };
        } catch (e) {
            console.error('Error extracting delta from SSE event:', e);
        }
    }
}
