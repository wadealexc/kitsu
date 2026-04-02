<script lang="ts">
    import { DropdownMenu } from 'bits-ui';

    import { flyAndScale } from '$lib/utils/transitions';
    import { tick } from 'svelte';
    import { models, mobile, settings, type Model } from '$lib/stores';

    import ChevronDown from '$lib/components/icons/ChevronDown.svelte';

    import ModelItem from './ModelItem.svelte';

    export let id = '';
    export let value = '';
    export let placeholder = 'Select a model';

    export let className = 'w-[32rem]';
    export let triggerClassName = 'text-lg';
    export let pinModelHandler: (modelId: string) => void = () => {};

    let show = false;

    let selectedModelIdx = 0;
    let selectedModel: Model | null = null;
    $: selectedModel = $models.find((model) => model.id === value) ?? null;

    $: filteredModels = $models.filter((model) => model.isActive);

    $: if (show) {
        resetView();
    }

    const resetView = async () => {
        await tick();

        const selectedInFiltered = filteredModels.findIndex((model) => model.id === value);

        if (selectedInFiltered >= 0) {
            selectedModelIdx = selectedInFiltered;
        } else {
            selectedModelIdx = 0;
        }
    };
</script>

<DropdownMenu.Root
    bind:open={show}
    onOpenChange={async () => {
        resetView();
    }}
    closeFocus={false}
>
    <DropdownMenu.Trigger
        class="relative w-full outline-hidden focus:outline-hidden"
        aria-label={placeholder}
        id="model-selector-{id}-button"
    >
        <div
            class="flex w-full text-left px-0.5 bg-transparent truncate {triggerClassName} justify-between placeholder-gray-400"
            role="presentation"
        >
            {#if selectedModel}
                <span class="inline-flex items-center gap-1.5">
                    {selectedModel.name}
                </span>
            {:else}
                {placeholder}
            {/if}
            <ChevronDown className=" self-center ml-2 size-3" strokeWidth="2.5" />
        </div>
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        class=" z-40 {$mobile
            ? `w-full`
            : `${className}`} max-w-[calc(100vw-1rem)] justify-start rounded-2xl  bg-white dark:bg-gray-850 dark:text-white shadow-lg  outline-hidden"
        transition={flyAndScale}
        side="bottom"
        align={$mobile ? 'center' : 'start'}
        sideOffset={2}
        alignOffset={-1}
    >
        <slot>
            <div class="px-2.5 max-h-64 overflow-y-auto group relative mt-2">
                {#each filteredModels as model, index}
                    <ModelItem
                        {selectedModelIdx}
                        {model}
                        {index}
                        {pinModelHandler}
                        onClick={() => {
                            value = model.id;
                            selectedModelIdx = index;

                            show = false;
                        }}
                    />
                {:else}
                    <div class="">
                        <div class="block px-3 py-2 text-sm text-gray-700 dark:text-gray-100">
                            {'No models configured'}
                        </div>
                    </div>
                {/each}
            </div>

            <div class="mb-2.5"></div>

            <div class="hidden w-[42rem]"></div>
            <div class="hidden w-[32rem]"></div>
        </slot>
    </DropdownMenu.Content>
</DropdownMenu.Root>
