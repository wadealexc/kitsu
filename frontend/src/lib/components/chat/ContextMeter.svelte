<script lang="ts">
    /** How full the context is, or how fast the model is going while it replies. */
    import { streamContext } from '$lib/stores';
    import Tooltip from '../common/Tooltip.svelte';

    export let generating = false;

    const RADIUS = 5;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

    $: ratio = $streamContext && $streamContext.total > 0 ? Math.min($streamContext.used / $streamContext.total, 1) : 0;
    $: colour = ratio < 0.5 ? 'text-green-600/80 dark:text-green-400/70' : ratio < 0.8 ? 'text-yellow-600/80 dark:text-yellow-400/70' : 'text-red-600/80 dark:text-red-400/70';

    const thousands = (n: number) => `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
    const exact = (n: number) => `${(n / 1000).toFixed(1)}K`;

    $: pps = $streamContext?.promptProcessing?.pps;
    $: tps = $streamContext?.tps ?? 0;
    $: speed = !generating || !$streamContext
        ? ''
        : $streamContext.promptProcessing
          ? pps === undefined
              ? ''
              : pps >= 1000
                ? `${(pps / 1000).toFixed(1)}k pp/s`
                : `${Math.round(pps)} pp/s`
          : tps > 0
            ? `${tps.toFixed(0)} t/s`
            : '';
    $: used = $streamContext?.used ?? 0;
</script>

{#if $streamContext && $streamContext.total > 0 && (speed || used > 0)}
    <Tooltip content={`${exact(used)} of ${exact($streamContext.total)} context used`} placement="top">
        <div class="flex items-center gap-1 text-[11px] font-medium tabular-nums whitespace-nowrap select-none {colour}">
            {#if !speed}
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
            {/if}
            <span>{speed || thousands(used)}</span>
        </div>
    </Tooltip>
{/if}
