<script lang="ts">
    import { APP_NAME, showSidebar, mobile } from '$lib/stores';
    import Tooltip from '$lib/components/common/Tooltip.svelte';
    import Sidebar from '$lib/components/icons/Sidebar.svelte';
</script>

<svelte:head>
    <title>
        {'Models'} • {$APP_NAME}
    </title>
</svelte:head>

<div
    class=" relative flex flex-col w-full h-screen max-h-[100dvh] transition-width duration-200 ease-in-out {$showSidebar
        ? 'md:max-w-[calc(100%-var(--sidebar-width))]'
        : ''} max-w-full"
>
    <nav class="   px-2.5 pt-1.5 backdrop-blur-xl">
        <div class=" flex items-center gap-1">
            {#if $mobile}
                <div
                    class="{$showSidebar
                        ? 'md:hidden'
                        : ''} self-center flex flex-none items-center"
                >
                    <Tooltip
                        content={$showSidebar ? 'Close Sidebar' : 'Open Sidebar'}
                        interactive={true}
                    >
                        <button
                            id="sidebar-toggle-button"
                            class=" cursor-pointer flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition cursor-"
                            on:click={() => {
                                showSidebar.set(!$showSidebar);
                            }}
                        >
                            <div class=" self-center p-1.5">
                                <Sidebar />
                            </div>
                        </button>
                    </Tooltip>
                </div>
            {/if}

            <div class="flex items-center text-xl font-medium">{'Models'}</div>
        </div>
    </nav>

    <div class="  pb-1 px-3 md:px-[18px] flex-1 max-h-full overflow-y-auto" id="models-container">
        <slot />
    </div>
</div>
