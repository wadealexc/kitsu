<script lang="ts">
    /** How full the context is, or how fast the model is going while it replies. */
    import { streamContext } from '$lib/stores';
    import Tooltip from '../common/Tooltip.svelte';

    export let generating = false;

    const RADIUS = 5;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

    $: ratio = $streamContext && $streamContext.total > 0 ? Math.min($streamContext.used / $streamContext.total, 1) : 0;
    $: colour = ratio < 0.5 ? 'text-green-600/80 dark:text-green-400/70' : ratio < 0.8 ? 'text-yellow-600/80 dark:text-yellow-400/70' : 'text-red-600/80 dark:text-red-400/70';

    const thousands = (n: number) => `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;

    $: pps = $streamContext?.promptProcessing?.pps;
    $: tps = $streamContext?.tps ?? 0;
    $: label = !$streamContext
        ? ''
        : generating && $streamContext.promptProcessing
          ? pps !== undefined
              ? `${Math.round(pps).toLocaleString()} pp/s`
              : 'Reading…'
          : generating && tps > 0
            ? `${tps.toFixed(0)} t/s`
            : `${thousands($streamContext.used)} / ${thousands($streamContext.total)}`;
</script>

{#if $streamContext && $streamContext.total > 0}
    <Tooltip content="Context used" placement="top">
        <div class="flex items-center gap-1.5 text-[11px] font-medium tabular-nums select-none {colour}">
            <svg viewBox="0 0 12 12" class="size-3 -rotate-90" aria-hidden="true">
                <circle cx="6" cy="6" r={RADIUS} fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.25" />
                <circle
                    cx="6"
                    cy="6"
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-dasharray={CIRCUMFERENCE}
                    stroke-dashoffset={CIRCUMFERENCE * (1 - ratio)}
                />
            </svg>
            <span>{label}</span>
        </div>
    </Tooltip>
{/if}
