<script lang="ts">
    /**
     * Draws a PDF onto canvases, a page at a time as they come into view. Nothing in
     * the file runs: links, forms and scripts are never added to the page.
     */
    import { onDestroy, onMount } from 'svelte';
    import type { PDFDocumentProxy } from 'pdfjs-dist';
    import Spinner from '../common/Spinner.svelte';

    export let blob: Blob;
    /** Which page is on screen: "3 / 12". */
    export let position = '';

    /** Sharper than this costs memory phones don't have. */
    const MAX_SCALE = 2;
    const MAX_PAGES = 300;
    /** A page can ask for any size; browsers fail or run out of memory on huge canvases. */
    const MAX_CANVAS_PIXELS = 16_000_000;
    const MAX_IMAGE_PIXELS = 40_000_000;

    type Page = { number: number; ratio: number };

    let container: HTMLDivElement;
    let doc: PDFDocumentProxy | null = null;
    let pages: Page[] = [];
    let total = 0;
    let failed = false;
    let loading = true;
    let destroyed = false;
    let observer: IntersectionObserver | undefined;

    const onScreen = new Set<number>();
    const drawing = new Map<number, { cancel: () => void }>();

    const draw = async (canvas: HTMLCanvasElement, number: number) => {
        if (!doc || drawing.has(number) || canvas.dataset.drawn) return;
        // Claimed before waiting, so scrolling away and back can't start a second one.
        const slot = { cancel: () => {} };
        drawing.set(number, slot);
        try {
            const page = await doc.getPage(number);
            if (destroyed || !onScreen.has(number)) return;

            const width = canvas.parentElement?.clientWidth || container.clientWidth;
            const natural = page.getViewport({ scale: 1 });
            const wanted = (width / natural.width) * Math.min(window.devicePixelRatio || 1, MAX_SCALE);
            const viewport = page.getViewport({ scale: Math.min(wanted, Math.sqrt(MAX_CANVAS_PIXELS / (natural.width * natural.height))) });
            canvas.width = viewport.width;
            canvas.height = viewport.height;

            const task = page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, annotationMode: 0 });
            slot.cancel = () => task.cancel();
            await task.promise;
            canvas.dataset.drawn = '1';
        } catch {
            // Cancelled because it scrolled away, or the page can't be drawn
        } finally {
            drawing.delete(number);
        }
    };

    /** Far-away pages give their memory back. */
    const clear = (canvas: HTMLCanvasElement, number: number) => {
        drawing.get(number)?.cancel();
        canvas.width = 0;
        canvas.height = 0;
        delete canvas.dataset.drawn;
    };

    const watch = (canvas: HTMLCanvasElement) => {
        observer?.observe(canvas);
        return { destroy: () => observer?.unobserve(canvas) };
    };

    onMount(async () => {
        try {
            const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
            pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

            const loaded = await pdfjs.getDocument({
                data: new Uint8Array(await blob.arrayBuffer()),
                isEvalSupported: false,
                maxImageSize: MAX_IMAGE_PIXELS,
                enableXfa: false
            }).promise;
            if (destroyed) {
                void loaded.destroy();
                return;
            }
            doc = loaded;
            total = loaded.numPages;

            const sizes: Page[] = [];
            for (let number = 1; number <= Math.min(total, MAX_PAGES); number++) {
                const { width, height } = (await loaded.getPage(number)).getViewport({ scale: 1 });
                if (destroyed) return;
                sizes.push({ number, ratio: height / width });
            }

            observer = new IntersectionObserver(
                (entries) => {
                    for (const entry of entries) {
                        const canvas = entry.target as HTMLCanvasElement;
                        const number = Number(canvas.dataset.page);
                        if (entry.isIntersecting) {
                            onScreen.add(number);
                            void draw(canvas, number);
                        } else {
                            onScreen.delete(number);
                            clear(canvas, number);
                        }
                    }
                },
                { root: container.parentElement, rootMargin: '100% 0px' }
            );
            pages = sizes;
            position = `1 / ${total}`;
            container.parentElement?.addEventListener('scroll', onScroll, { passive: true });
        } catch {
            failed = true;
        } finally {
            loading = false;
        }
    });

    let scrollFrame = 0;
    const onScroll = () => {
        scrollFrame ||= requestAnimationFrame(() => {
            scrollFrame = 0;
            const root = container.parentElement;
            if (!root) return;
            const { top, height } = root.getBoundingClientRect();
            const middle = top + height / 2;
            const shown = [...container.children].findIndex((el) => el.getBoundingClientRect().bottom > middle);
            if (shown !== -1) position = `${shown + 1} / ${total}`;
        });
    };

    onDestroy(() => {
        destroyed = true;
        cancelAnimationFrame(scrollFrame);
        container?.parentElement?.removeEventListener('scroll', onScroll);
        observer?.disconnect();
        void doc?.destroy();
    });
</script>

<div bind:this={container} class="flex flex-col gap-2">
    {#if loading}
        <div class="flex justify-center py-8"><Spinner className="size-5" /></div>
    {:else if failed}
        <div class="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">
            This PDF can't be previewed. It may be damaged or password-protected. You can still download it.
        </div>
    {:else}
        {#each pages as page (page.number)}
            <!-- Portrait pages at a readable width; landscape ones can use the whole window. -->
            <div
                class="w-full mx-auto bg-white rounded overflow-hidden"
                style="aspect-ratio: 1 / {page.ratio}; max-width: {page.ratio >= 1 ? '56rem' : 'none'}"
            >
                <canvas use:watch data-page={page.number} aria-label={`Page ${page.number}`} class="w-full h-full block"></canvas>
            </div>
        {/each}
        {#if total > MAX_PAGES}
            <div class="text-xs text-gray-500 dark:text-gray-400 text-center">Only the first {MAX_PAGES} of {total} pages are shown. Download it for the rest.</div>
        {/if}
    {/if}
</div>
