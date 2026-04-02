<script lang="ts">
    import { DropdownMenu } from 'bits-ui';
    import { flyAndScale } from '$lib/utils/transitions';

    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import Pin from '$lib/components/icons/Pin.svelte';
    import PinSlash from '$lib/components/icons/PinSlash.svelte';
    import { settings } from '$lib/stores';

    export let show = false;
    export let model;

    export let pinModelHandler: (modelId: string) => void = () => {};

    export let onClose: Function = () => {};
</script>

<DropdownMenu.Root
    bind:open={show}
    closeFocus={false}
    onOpenChange={(state) => {
        if (state === false) {
            onClose();
        }
    }}
    typeahead={false}
>
    <DropdownMenu.Trigger>
        <Tooltip content="More" className="group-hover/item:opacity-100 opacity-0">
            <slot />
        </Tooltip>
    </DropdownMenu.Trigger>

    <DropdownMenu.Content
        strategy="fixed"
        class="w-full max-w-[180px] text-sm rounded-2xl p-1 z-[9999999] bg-white dark:bg-gray-850 dark:text-white shadow-lg border border-gray-100  dark:border-gray-800"
        sideOffset={-2}
        side="bottom"
        align="end"
        transition={flyAndScale}
    >
        <DropdownMenu.Item
            type="button"
            aria-pressed={$settings.pinnedModels.includes(model?.id)}
            class="flex rounded-xl py-1.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800 transition items-center gap-2"
            on:click={(e) => {
                e.stopPropagation();
                e.preventDefault();

                pinModelHandler(model?.id);
                show = false;
            }}
        >
            {#if $settings.pinnedModels.includes(model?.id)}
                <PinSlash />
            {:else}
                <Pin />
            {/if}

            <div class="flex items-center">
                {#if $settings.pinnedModels.includes(model?.id)}
                    {'Hide from Sidebar'}
                {:else}
                    {'Keep in Sidebar'}
                {/if}
            </div>
        </DropdownMenu.Item>
    </DropdownMenu.Content>
</DropdownMenu.Root>
