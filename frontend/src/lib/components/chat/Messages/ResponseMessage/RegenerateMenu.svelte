<script lang="ts">
    import { DropdownMenu } from 'bits-ui';
    import { flyAndScale } from '$lib/utils/transitions';
    import Dropdown from '$lib/components/common/Dropdown.svelte';

    export let onRegenerate: Function;
    export let onClose: Function = () => {};

    let show = false;
</script>

<Dropdown
    bind:show
    on:change={(e) => {
        if (e.detail === false) {
            onClose();
        }
    }}
    align="end"
>
    <slot></slot>

    <div slot="content">
        <DropdownMenu.Content
            class="w-full max-w-[200px] rounded-2xl px-1 py-1 border border-gray-100 dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg transition"
            sideOffset={-2}
            side="bottom"
            align="start"
            transition={flyAndScale}
        >
            <DropdownMenu.Item
                class="flex  gap-2  items-center px-3 py-1.5 text-sm  cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 rounded-xl"
                on:click={() => {
                    onRegenerate();
                    show = false;
                }}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke-width="2"
                    aria-hidden="true"
                    stroke="currentColor"
                    class="w-4 h-4"
                >
                    <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                    />
                </svg>
                <div class="flex items-center">{'Confirm'}</div>
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </div>
</Dropdown>
