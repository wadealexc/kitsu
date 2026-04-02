<script lang="ts">
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import ModelItemMenu from './ModelItemMenu.svelte';
    import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';
    import { type Model } from '$lib/stores';

    export let selectedModelIdx: number = -1;
    export let model: Model;
    export let index: number = -1;

    export let onClick: () => void = () => {};
    export let pinModelHandler: (modelId: string) => void = () => {};

    let showMenu = false;
</script>

<button
    aria-roledescription="model-item"
    aria-label={model.name}
    class="flex group/item w-full text-left font-medium line-clamp-1 select-none items-center rounded-button py-2 pl-3 pr-1.5 text-sm text-gray-700 dark:text-gray-100 outline-hidden transition-all duration-75 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl cursor-pointer data-highlighted:bg-muted {index ===
    selectedModelIdx
        ? 'bg-gray-100 dark:bg-gray-800 group-hover:bg-transparent'
        : ''}"
    data-arrow-selected={index === selectedModelIdx}
    data-value={model.id}
    on:click={() => {
        onClick();
    }}
>
    <div class="flex flex-col flex-1 gap-1.5">
        <div class="flex items-center gap-2">
            <div class="flex items-center">
                <Tooltip content={`${model.name} (${model.id})`} placement="top-start">
                    <div class="line-clamp-1">
                        {model.name}
                    </div>
                </Tooltip>
            </div>
        </div>
    </div>

    <div class="ml-auto pl-2 pr-1 flex items-center gap-1.5 shrink-0">
        <ModelItemMenu bind:show={showMenu} {model} {pinModelHandler}>
            <button
                aria-label={`${'More Options'}`}
                class="flex"
                on:click={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showMenu = !showMenu;
                }}
            >
                <EllipsisHorizontal />
            </button>
        </ModelItemMenu>
    </div>
</button>
