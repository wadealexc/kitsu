<script lang="ts">
    import { DropdownMenu } from 'bits-ui';
    import { flyAndScale } from '$lib/utils/transitions';
    import Dropdown from '$lib/components/common/Dropdown.svelte';
    import GarbageBin from '$lib/components/icons/GarbageBin.svelte';
    import Pencil from '$lib/components/icons/Pencil.svelte';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import DocumentDuplicate from '$lib/components/icons/DocumentDuplicate.svelte';
    import Pin from '$lib/components/icons/Pin.svelte';
    import PinSlash from '$lib/components/icons/PinSlash.svelte';

    import { settings, type Model } from '$lib/stores';

    export let model: Model;

    export let editHandler: Function;
    export let cloneHandler: Function;
    export let pinModelHandler: Function;
    export let deleteHandler: Function;
    export let onClose: Function;

    let show = false;
</script>

<Dropdown
    bind:show
    on:change={(e) => {
        if (e.detail === false) {
            onClose();
        }
    }}
>
    <Tooltip content="More">
        <button
            on:click={(e) => {
                e.stopPropagation();
                show = !show;
            }}
        >
            <slot />
        </button>
    </Tooltip>

    <div slot="content">
        <DropdownMenu.Content
            class="w-full max-w-[170px] rounded-2xl p-1 border border-gray-100  dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg"
            sideOffset={-2}
            side="bottom"
            align="start"
            transition={flyAndScale}
        >
            <DropdownMenu.Item
                class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    editHandler();
                }}
            >
                <Pencil />
                <div class="flex items-center">{'Edit'}</div>
            </DropdownMenu.Item>

            <DropdownMenu.Item
                class="flex  gap-2  items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    pinModelHandler(model.id);
                }}
            >
                {#if $settings.pinnedModels.includes(model.id)}
                    <PinSlash />
                {:else}
                    <Pin />
                {/if}

                <div class="flex items-center">
                    {#if $settings.pinnedModels.includes(model.id)}
                        {'Hide from Sidebar'}
                    {:else}
                        {'Keep in Sidebar'}
                    {/if}
                </div>
            </DropdownMenu.Item>

            <DropdownMenu.Item
                class="flex gap-2 items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    cloneHandler();
                }}
            >
                <DocumentDuplicate />
                <div class="flex items-center">{'Clone'}</div>
            </DropdownMenu.Item>

            <hr class="border-gray-50/30 dark:border-gray-800/30 my-1" />

            <DropdownMenu.Item
                class="flex  gap-2  items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    deleteHandler();
                }}
            >
                <GarbageBin />
                <div class="flex items-center">{'Delete'}</div>
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </div>
</Dropdown>
