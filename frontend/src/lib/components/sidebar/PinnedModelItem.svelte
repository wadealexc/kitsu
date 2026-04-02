<script lang="ts">
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import PinSlash from '$lib/components/icons/PinSlash.svelte';
    import type { Model } from '$lib/stores';

    export let model: Model | null = null;
    export let shiftKey = false;
    export let onClick = () => {};
    export let onUnpin = () => {};

    let mouseOver = false;
</script>

{#if model}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class=" flex justify-center text-gray-800 dark:text-gray-200 cursor-grab relative group"
        data-id={model?.id}
        on:mouseenter={(e) => {
            mouseOver = true;
        }}
        on:mouseleave={(e) => {
            mouseOver = false;
        }}
    >
        <a
            class="grow flex items-center space-x-2.5 rounded-lg px-2.5 py-[7px] group-hover:bg-gray-100 dark:group-hover:bg-gray-900 transition"
            href="/"
            on:click={onClick}
            draggable="false"
        >
            <div class="flex self-center translate-y-[0.5px]">
                <div class=" self-center text-sm font-primary line-clamp-1">
                    {model?.name ?? model.id}
                </div>
            </div>
        </a>

        {#if mouseOver && shiftKey && onUnpin}
            <div class="absolute right-5 top-2.5">
                <div class=" flex items-center self-center space-x-1.5">
                    <Tooltip content="Unpin" className="flex items-center">
                        <button
                            class=" self-center dark:hover:text-white transition"
                            on:click={() => {
                                onUnpin();
                            }}
                            type="button"
                        >
                            <PinSlash className="size-3.5" strokeWidth="2" />
                        </button>
                    </Tooltip>
                </div>
            </div>
        {/if}
    </div>
{/if}
