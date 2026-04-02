<script lang="ts">
    import { saveAs } from '$lib/utils';

    import { toast } from 'svelte-sonner';

    import panzoom, { type PanZoom } from 'panzoom';
    import DOMPurify from 'dompurify';

    import { copyToClipboard } from '$lib/utils';

    import Tooltip from './Tooltip.svelte';
    import Clipboard from '../icons/Clipboard.svelte';
    import Reset from '../icons/Reset.svelte';
    import Download from '../icons/Download.svelte';

    export let className = '';
    export let svg = '';
    export let content = '';

    let instance: PanZoom;

    let sceneParentElement: HTMLElement;
    let sceneElement: HTMLElement;

    $: if (sceneElement) {
        instance = panzoom(sceneElement, {
            bounds: true,
            boundsPadding: 0.1,

            zoomSpeed: 0.065
        });
    }
    const resetPanZoomViewport = () => {
        instance.moveTo(0, 0);
        instance.zoomAbs(0, 0, 1);
        console.log(instance.getTransform());
    };

    const downloadAsSVG = () => {
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        saveAs(svgBlob, `diagram.svg`);
    };
</script>

<div bind:this={sceneParentElement} class="relative {className}">
    <div bind:this={sceneElement} class="flex h-full max-h-full justify-center items-center">
        {@html DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true }, // allow <svg>, <defs>, <filter>, etc.
            WHOLE_DOCUMENT: false,
            ADD_TAGS: ['style', 'foreignObject'], // include foreignObject if using HTML labels
            ADD_ATTR: [
                'class',
                'style',
                'id',
                'data-*',
                'viewBox',
                'preserveAspectRatio',
                // markers / arrows
                'markerWidth',
                'markerHeight',
                'markerUnits',
                'refX',
                'refY',
                'orient',
                // hrefs (for gradients, markers, etc.)
                'href',
                'xlink:href',
                // text positioning
                'dominant-baseline',
                'text-anchor',
                // pattern / clip / mask units
                'clipPathUnits',
                'filterUnits',
                'patternUnits',
                'patternContentUnits',
                'maskUnits',
                // a11y niceties
                'role',
                'aria-label',
                'aria-labelledby',
                'aria-hidden',
                'tabindex'
            ],
            SANITIZE_DOM: true
        })}
    </div>

    {#if content}
        <div class=" absolute top-2.5 right-2.5">
            <div class="flex gap-1">
                <Tooltip content="Download as SVG">
                    <button
                        class="p-1.5 rounded-lg border border-gray-100 dark:border-none dark:bg-gray-850 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                        on:click={() => {
                            downloadAsSVG();
                        }}
                    >
                        <Download className=" size-4" />
                    </button>
                </Tooltip>

                <Tooltip content="Reset view">
                    <button
                        class="p-1.5 rounded-lg border border-gray-100 dark:border-none dark:bg-gray-850 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                        on:click={() => {
                            resetPanZoomViewport();
                        }}
                    >
                        <Reset className=" size-4" />
                    </button>
                </Tooltip>

                <Tooltip content="Copy to clipboard">
                    <button
                        class="p-1.5 rounded-lg border border-gray-100 dark:border-none dark:bg-gray-850 hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                        on:click={() => {
                            copyToClipboard(content);
                            toast.success('Copied to clipboard');
                        }}
                    >
                        <Clipboard className=" size-4" strokeWidth="1.5" />
                    </button>
                </Tooltip>
            </div>
        </div>
    {/if}
</div>
