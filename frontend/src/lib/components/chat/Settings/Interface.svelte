<script lang="ts">
    import { settings } from '$lib/stores';
    import { createEventDispatcher, onMount } from 'svelte';
    import { toast } from 'svelte-sonner';
    import { updateUserInfo } from '$lib/apis/users';
    import { getUserPosition } from '$lib/utils';
    import { setTextScale } from '$lib/utils/text-scale';

    import Minus from '$lib/components/icons/Minus.svelte';
    import Plus from '$lib/components/icons/Plus.svelte';
    import Switch from '$lib/components/common/Switch.svelte';

    const dispatch = createEventDispatcher();

    export let saveSettings: Function;

    // Addons
    let scrollOnBranchChange = true;
    let userLocation = false;

    // Interface
    let defaultModelId = '';

    let regenerateMenu = true;

    let ctrlEnterToSend = false;

    let temporaryChatByDefault = false;
    let chatFadeStreamingText = true;

    let webSearch: boolean = false;

    let textScale: number | null = 1;

    const toggleUserLocation = async () => {
        if (userLocation) {
            const position = await getUserPosition().catch((error) => {
                toast.error(error.message);
                return null;
            });

            if (position) {
                await updateUserInfo(localStorage.token, { location: position });
                toast.success('User location successfully retrieved.');
            } else {
                userLocation = false;
            }
        }

        saveSettings({ userLocation });
    };

    const togglectrlEnterToSend = async () => {
        ctrlEnterToSend = !ctrlEnterToSend;
        saveSettings({ ctrlEnterToSend });
    };

    const updateInterfaceHandler = async () => {
        saveSettings({ model: defaultModelId });
    };

    const setTextScaleHandler = (scale: number) => {
        textScale = scale;
        setTextScale(textScale);

        saveSettings({ textScale });
    };

    onMount(async () => {
        chatFadeStreamingText = $settings.chatFadeStreamingText;

        regenerateMenu = $settings.regenerateMenu;

        scrollOnBranchChange = $settings.scrollOnBranchChange;

        temporaryChatByDefault = $settings.temporaryChatByDefault;
        userLocation = $settings.userLocation;

        ctrlEnterToSend = $settings.ctrlEnterToSend;

        defaultModelId = $settings.model;

        webSearch = $settings.webSearch;

        textScale = $settings.textScale;
    });
</script>

<form
    id="tab-interface"
    class="flex flex-col h-full justify-between space-y-3 text-sm"
    on:submit|preventDefault={() => {
        updateInterfaceHandler();
        dispatch('save');
    }}
>
    <div class=" space-y-3 overflow-y-scroll max-h-[28rem] md:max-h-full">
        <div>
            <h1 class=" mb-2 text-sm font-medium">{'UI'}</h1>

            <div>
                <div class="py-0.5 flex w-full justify-between">
                    <label id="ui-scale-label" class=" self-center text-xs" for="ui-scale-slider">
                        {'UI Scale'}
                    </label>

                    <div class="flex items-center gap-2 p-1">
                        <button
                            class="text-xs"
                            aria-live="polite"
                            type="button"
                            on:click={() => {
                                if (textScale === null) {
                                    textScale = 1;
                                } else {
                                    textScale = null;
                                    setTextScaleHandler(1);
                                }
                            }}
                        >
                            {#if textScale === null}
                                <span>{'Default'}</span>
                            {:else}
                                <span>{textScale}x</span>
                            {/if}
                        </button>
                    </div>
                </div>

                {#if textScale !== null}
                    <div class=" flex items-center gap-2 px-1 pb-1">
                        <button
                            type="button"
                            class="rounded-lg p-1 transition outline-gray-200 hover:bg-gray-100 dark:outline-gray-700 dark:hover:bg-gray-800"
                            on:click={() => {
                                textScale = Math.max(1, parseFloat((textScale! - 0.1).toFixed(2)));
                                setTextScaleHandler(textScale);
                            }}
                            aria-labelledby="ui-scale-label"
                            aria-label="Decrease UI Scale"
                        >
                            <Minus className="h-3.5 w-3.5" />
                        </button>

                        <div class="flex-1 flex items-center">
                            <input
                                id="ui-scale-slider"
                                class="w-full"
                                type="range"
                                min="1"
                                max="1.5"
                                step={0.01}
                                bind:value={textScale}
                                on:change={() => {
                                    setTextScaleHandler(textScale!);
                                }}
                                aria-labelledby="ui-scale-label"
                                aria-valuemin="1"
                                aria-valuemax="1.5"
                                aria-valuenow={textScale}
                                aria-valuetext={`${textScale}x`}
                            />
                        </div>

                        <button
                            type="button"
                            class="rounded-lg p-1 transition outline-gray-200 hover:bg-gray-100 dark:outline-gray-700 dark:hover:bg-gray-800"
                            on:click={() => {
                                textScale = Math.min(
                                    1.5,
                                    parseFloat((textScale! + 0.1).toFixed(2))
                                );
                                setTextScaleHandler(textScale);
                            }}
                            aria-labelledby="ui-scale-label"
                            aria-label="Increase UI Scale"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </button>
                    </div>
                {/if}
            </div>

            <div>
                <div id="allow-user-location-label" class=" py-0.5 flex w-full justify-between">
                    <div class=" self-center text-xs">{'Allow User Location'}</div>

                    <div class="flex items-center gap-2 p-1">
                        <Switch
                            ariaLabelledbyId="allow-user-location-label"
                            tooltip={true}
                            bind:state={userLocation}
                            on:change={() => {
                                toggleUserLocation();
                            }}
                        />
                    </div>
                </div>
            </div>

            <div class=" my-2 text-sm font-medium">{'Chat'}</div>

            <div>
                <div class=" py-0.5 flex w-full justify-between">
                    <div id="temp-chat-default-label" class=" self-center text-xs">
                        {'Temporary Chat by Default'}
                    </div>

                    <div class="flex items-center gap-2 p-1">
                        <Switch
                            ariaLabelledbyId="temp-chat-default-label"
                            tooltip={true}
                            bind:state={temporaryChatByDefault}
                            on:change={() => {
                                saveSettings({ temporaryChatByDefault });
                            }}
                        />
                    </div>
                </div>
            </div>

            <div>
                <div class=" py-0.5 flex w-full justify-between">
                    <div id="fade-streaming-label" class=" self-center text-xs">
                        {'Fade Effect for Streaming Text'}
                    </div>

                    <div class="flex items-center gap-2 p-1">
                        <Switch
                            ariaLabelledbyId="fade-streaming-label"
                            tooltip={true}
                            bind:state={chatFadeStreamingText}
                            on:change={() => {
                                saveSettings({ chatFadeStreamingText });
                            }}
                        />
                    </div>
                </div>
            </div>

            <div>
                <div class=" py-0.5 flex w-full justify-between">
                    <div id="regenerate-menu-label" class=" self-center text-xs">
                        {'Regenerate Menu'}
                    </div>

                    <div class="flex items-center gap-2 p-1">
                        <Switch
                            ariaLabelledbyId="regenerate-menu-label"
                            tooltip={true}
                            bind:state={regenerateMenu}
                            on:change={() => {
                                saveSettings({ regenerateMenu });
                            }}
                        />
                    </div>
                </div>
            </div>

            <div>
                <div class=" py-0.5 flex w-full justify-between">
                    <div id="scroll-on-branch-change-label" class=" self-center text-xs">
                        {'Scroll On Branch Change'}
                    </div>

                    <div class="flex items-center gap-2 p-1">
                        <Switch
                            ariaLabelledbyId="scroll-on-branch-change-label"
                            tooltip={true}
                            bind:state={scrollOnBranchChange}
                            on:change={() => {
                                saveSettings({ scrollOnBranchChange });
                            }}
                        />
                    </div>
                </div>
            </div>

            <div>
                <div class=" py-0.5 flex w-full justify-between">
                    <div id="web-search-in-chat-label" class=" self-center text-xs">
                        {'Allow Web Search by Default'}
                    </div>

                    <div class="flex items-center gap-2 p-1">
                        <Switch
                            ariaLabelledbyId="web-search-in-chat-label"
                            tooltip={true}
                            bind:state={webSearch}
                            on:change={() => {
                                saveSettings({ webSearch });
                            }}
                        />
                    </div>
                </div>
            </div>

            <div class=" my-2 text-sm font-medium">{'Input'}</div>

            <div>
                <div class=" py-0.5 flex w-full justify-between">
                    <div
                        id="enter-key-behavior-label ctrl-enter-to-send-state"
                        class=" self-center text-xs"
                    >
                        {'Enter Key Behavior'}
                    </div>

                    <button
                        aria-labelledby="enter-key-behavior-label"
                        class="p-1 px-3 text-xs flex rounded transition"
                        on:click={() => {
                            togglectrlEnterToSend();
                        }}
                        type="button"
                    >
                        <span class="ml-2 self-center" id="ctrl-enter-to-send-state"
                            >{ctrlEnterToSend === true
                                ? 'Ctrl+Enter to Send'
                                : 'Enter to Send'}</span
                        >
                    </button>
                </div>
            </div>
        </div>
    </div>

    <div class="flex justify-end text-sm font-medium">
        <button
            class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
            type="submit"
        >
            {'Save'}
        </button>
    </div>
</form>
