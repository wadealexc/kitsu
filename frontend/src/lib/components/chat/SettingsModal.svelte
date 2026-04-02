<script lang="ts">
    import { tick } from 'svelte';
    import { toast } from 'svelte-sonner';
    import { models, settings, user, config, type Settings } from '$lib/stores';
    import { updateUserSettings } from '$lib/apis/users';
    import { getModels as _getModels } from '$lib/apis/models';
    import { getBackendConfig } from '$lib/apis/configs';

    import Modal from '../common/Modal.svelte';
    import Account from './Settings/Account.svelte';
    import Interface from './Settings/Interface.svelte';
    import XMark from '../icons/XMark.svelte';
    import UserCircle from '../icons/UserCircle.svelte';
    import AppNotification from '../icons/AppNotification.svelte';
    import Users from '../icons/Users.svelte';
    import Wrench from '../icons/Wrench.svelte';

    import UserList from '$lib/components/admin/Users/UserList.svelte';
    import General from '$lib/components/admin/Settings/General.svelte';

    export let show = false;

    $: if (show) {
        addScrollListener();
    } else {
        removeScrollListener();
    }

    const saveSettings = async (updated: Partial<Settings>) => {
        console.log(updated);
        await settings.set({ ...$settings, ...updated });
        await models.set(await getModels());
        await updateUserSettings(localStorage.token, { ui: $settings });
    };

    const getModels = async () => {
        return await _getModels(localStorage.token);
    };

    let selectedTab = 'interface';

    const tabs = ['interface', 'account'];

    // Function to handle sideways scrolling
    const scrollHandler = (event: WheelEvent) => {
        const settingsTabsContainer = document.getElementById('settings-tabs-container');
        if (settingsTabsContainer) {
            event.preventDefault(); // Prevent default vertical scrolling
            settingsTabsContainer.scrollLeft += event.deltaY; // Scroll sideways
        }
    };

    const addScrollListener = async () => {
        await tick();
        const settingsTabsContainer = document.getElementById('settings-tabs-container');
        if (settingsTabsContainer) {
            settingsTabsContainer.addEventListener('wheel', scrollHandler);
        }
    };

    const removeScrollListener = async () => {
        await tick();
        const settingsTabsContainer = document.getElementById('settings-tabs-container');
        if (settingsTabsContainer) {
            settingsTabsContainer.removeEventListener('wheel', scrollHandler);
        }
    };
</script>

<Modal size="2xl" bind:show>
    <div class="text-gray-700 dark:text-gray-100 mx-1">
        <div
            class=" flex justify-between dark:text-gray-300 px-4 md:px-4.5 pt-4.5 pb-0.5 md:pb-2.5"
        >
            <div class=" text-lg font-medium self-center">{'Settings'}</div>
            <button
                aria-label="Close settings modal"
                class="self-center"
                on:click={() => {
                    show = false;
                }}
            >
                <XMark className="w-5 h-5"></XMark>
            </button>
        </div>

        <div class="flex flex-col md:flex-row w-full pt-1 pb-4">
            <div
                role="tablist"
                id="settings-tabs-container"
                class="tabs flex flex-row overflow-x-auto gap-2.5 mx-3 md:pr-4 md:gap-1 md:flex-col flex-1 md:flex-none md:w-50 md:min-h-[42rem] md:max-h-[42rem] dark:text-gray-200 text-sm text-left mb-1 md:mb-0 -translate-y-1"
            >
                {#each tabs as tabId (tabId)}
                    {#if tabId === 'interface'}
                        <button
                            role="tab"
                            aria-controls="tab-interface"
                            aria-selected={selectedTab === 'interface'}
                            class="px-0.5 md:px-2.5 py-1 min-w-fit rounded-xl flex-1 md:flex-none flex text-left transition {selectedTab ===
                            'interface'
                                ? ''
                                : 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'}"
                            on:click={() => {
                                selectedTab = 'interface';
                            }}
                        >
                            <div class=" self-center mr-2">
                                <AppNotification strokeWidth="2" />
                            </div>
                            <div class=" self-center">{'Interface'}</div>
                        </button>
                    {:else if tabId === 'account'}
                        <button
                            role="tab"
                            aria-controls="tab-account"
                            aria-selected={selectedTab === 'account'}
                            class="px-0.5 md:px-2.5 py-1 min-w-fit rounded-xl flex-1 md:flex-none flex text-left transition {selectedTab ===
                            'account'
                                ? ''
                                : 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'}"
                            on:click={() => {
                                selectedTab = 'account';
                            }}
                        >
                            <div class=" self-center mr-2">
                                <UserCircle strokeWidth="2" />
                            </div>
                            <div class=" self-center">{'Account'}</div>
                        </button>
                    {/if}
                {/each}
                {#if $user?.role === 'admin'}
                    <div class="hidden md:block md:mt-auto">
                        <div
                            class="text-sm font-medium text-gray-400 dark:text-gray-600 px-2.5 py-1"
                        >
                            {''}
                        </div>
                        <hr class="border-gray-100 dark:border-gray-800 my-1" />
                    </div>
                    <button
                        role="tab"
                        aria-controls="tab-users"
                        aria-selected={selectedTab === 'users'}
                        class="px-0.5 md:px-2.5 py-1 min-w-fit rounded-xl flex-1 md:flex-none flex text-left transition {selectedTab ===
                        'users'
                            ? ''
                            : 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'}"
                        on:click={() => {
                            selectedTab = 'users';
                        }}
                    >
                        <div class=" self-center mr-2">
                            <Users className="size-4" strokeWidth="1.5" />
                        </div>
                        <div class=" self-center">{'Users'}</div>
                    </button>
                    <button
                        role="tab"
                        aria-controls="tab-config"
                        aria-selected={selectedTab === 'config'}
                        class="px-0.5 md:px-2.5 py-1 min-w-fit rounded-xl flex-1 md:flex-none flex text-left transition {selectedTab ===
                        'config'
                            ? ''
                            : 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'}"
                        on:click={() => {
                            selectedTab = 'config';
                        }}
                    >
                        <div class=" self-center mr-2">
                            <Wrench className="size-4" strokeWidth="1.5" />
                        </div>
                        <div class=" self-center">{'Config'}</div>
                    </button>
                {/if}
            </div>
            <div class="flex-1 px-3.5 md:pl-0 md:pr-4.5 md:min-h-[42rem] max-h-[42rem]">
                {#if selectedTab === 'interface'}
                    <Interface
                        {saveSettings}
                        on:save={() => {
                            toast.success('Settings saved successfully!');
                        }}
                    />
                {:else if selectedTab === 'account'}
                    <Account
                        saveHandler={() => {
                            toast.success('Settings saved successfully!');
                        }}
                    />
                {:else if selectedTab === 'users'}
                    <UserList />
                {:else if selectedTab === 'config'}
                    <General
                        saveHandler={async () => {
                            toast.success('Settings saved successfully!');
                            config.set(await getBackendConfig());
                        }}
                    />
                {/if}
            </div>
        </div>
    </div>
</Modal>

<style>
    .tabs::-webkit-scrollbar {
        display: none; /* for Chrome, Safari and Opera */
    }

    .tabs {
        -ms-overflow-style: none; /* IE and Edge */
        scrollbar-width: none; /* Firefox */
    }
</style>
