<script lang="ts">
    import { createEventDispatcher, onMount } from 'svelte';
    import { settings, toolServers } from '$lib/stores';

    import Switch from '$lib/components/common/Switch.svelte';

    const dispatch = createEventDispatcher();

    export let saveSettings: Function;

    // Local state for form fields
    // Tool servers on in new chats (stored as the ones turned off)
    let disabledToolServers: string[] = [];
    $: switchableServers = $toolServers.filter((s) => s.enabled && s.tools.length > 0);
    const toggleDefault = (id: string, on: boolean) => {
        disabledToolServers = on
            ? disabledToolServers.filter((s) => s !== id)
            : [...new Set([...disabledToolServers, id])];
        saveSettings({ disabledToolServers });
    };
    let userLocation: boolean = false;
    let userLocationString: string = '';

    // Snapshot for dirty detection (only userLocationString needs explicit save)
    let savedUserLocationString: string = '';

    onMount(async () => {
        disabledToolServers = [...($settings.disabledToolServers ?? [])];
        userLocation = $settings.userLocation;
        userLocationString = $settings.userLocationString ?? '';
        savedUserLocationString = userLocationString;
    });

    // Dirty detection - only tracks userLocationString changes
    $: isDirty = userLocationString !== savedUserLocationString;

    const handleSubmit = async (event: Event) => {
        event.preventDefault();
        await saveSettings({ userLocationString: userLocationString || undefined });
        savedUserLocationString = userLocationString;
        dispatch('save');
    };
</script>

<form
    id="tab-chat"
    class="flex flex-col h-full justify-between text-sm"
    on:submit={handleSubmit}
>
    <div class="overflow-y-scroll max-h-full">
        <h1 class="mb-2 text-sm font-medium">{'Chat'}</h1>

        <!-- Tools on in new chats -->
        {#each switchableServers as server (server.id)}
            <div class="py-0.5 flex w-full justify-between">
                <div id={`tool-default-${server.id}`} class="self-center text-xs">
                    {`${server.name} tools on in new chats`}
                </div>

                <div class="flex items-center gap-2 p-1">
                    <Switch
                        ariaLabelledbyId={`tool-default-${server.id}`}
                        tooltip={true}
                        state={!disabledToolServers.includes(server.id)}
                        on:change={(e) => toggleDefault(server.id, e.detail)}
                    />
                </div>
            </div>
        {/each}

        <!-- Enable user location -->
        <div class="py-0.5 flex w-full justify-between">
            <div id="enable-user-location-label" class="self-center text-xs">
                {'Enable user location'}
            </div>

            <div class="flex items-center gap-2 p-1">
                <Switch
                    ariaLabelledbyId="enable-user-location-label"
                    tooltip={true}
                    bind:state={userLocation}
                    on:change={() => {
                        saveSettings({ userLocation });
                    }}
                />
            </div>
        </div>

        <!-- User location text input -->
        <div class="py-0.5 flex w-full justify-between items-center">
            <label
                id="user-location-text-label"
                class="self-center text-xs"
                for="user-location-text"
            >
                {'User location: '}
                <span class="text-gray-500 dark:text-gray-400">
                    {userLocationString || 'Unknown'}
                </span>
            </label>

            <div class="flex items-center gap-2 p-1">
                <input
                    id="user-location-text"
                    type="text"
                    bind:value={userLocationString}
                    disabled={!userLocation}
                    autocomplete="off"
                    on:focus={(e) => {
                        const input = e.currentTarget;
                        requestAnimationFrame(() => {
                            input.selectionStart = input.selectionEnd = input.value.length;
                        });
                    }}
                    class="px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    placeholder="Enter your location"
                    aria-labelledby="user-location-text-label"
                />
            </div>
        </div>
    </div>

    <div class="flex justify-end text-sm font-medium">
        <button
            class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
            type="submit"
            disabled={!isDirty}
            aria-disabled={!isDirty}
        >
            {'Save'}
        </button>
    </div>
</form>
