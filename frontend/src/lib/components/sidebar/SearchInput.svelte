<script lang="ts">
    import { folders } from '$lib/stores';
    import { createEventDispatcher, tick } from 'svelte';
    import { fade } from 'svelte/transition';
    import Search from '$lib/components/icons/Search.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';

    const dispatch = createEventDispatcher();
    export let placeholder = '';
    export let value = '';
    export let showClearButton = false;

    export let onFocus = () => {};
    export let onKeydown: (e: KeyboardEvent) => void = (e) => {};

    let selectedIdx: number | null = 0;
    let selectedOption: string | null = null;

    let lastWord = '';
    $: lastWord = value ? (value.split(' ').at(-1) ?? '') : value;

    let options = [
        {
            name: 'folder:',
            description: 'search for folders'
        },
        {
            name: 'shared:',
            description: 'search for shared chats'
        }
    ];
    let focused = false;
    let loading = false;

    let hovering = false;

    let filteredOptions = options;
    $: filteredOptions = options.filter((option) => {
        return option.name.startsWith(lastWord);
    });

    let filteredItems: any[] = [];

    $: if (lastWord && lastWord !== null) {
        initItems();
    }

    const initItems = async () => {
        console.log('initItems', lastWord);
        loading = true;
        await tick();

        if (lastWord.startsWith('folder:')) {
            filteredItems = [...$folders]
                .filter((folder) => {
                    const folderName = lastWord.slice(7);
                    if (folderName) {
                        const id = folder.name.replaceAll(' ', '_').toLowerCase();
                        const folderId = folderName.replaceAll(' ', '_').toLowerCase();

                        if (id !== folderId) {
                            return id.startsWith(folderId);
                        } else {
                            return false;
                        }
                    } else {
                        return true;
                    }
                })
                .map((folder) => {
                    return {
                        id: folder.name.replaceAll(' ', '_').toLowerCase(),
                        name: folder.name,
                        type: 'folder'
                    };
                });
        } else if (lastWord.startsWith('shared:')) {
            filteredItems = [
                {
                    id: 'true',
                    name: 'true',
                    type: 'shared'
                },
                {
                    id: 'false',
                    name: 'false',
                    type: 'shared'
                }
            ].filter((item) => {
                const sharedValue = lastWord.slice(7);
                if (sharedValue) {
                    return item.id.startsWith(sharedValue) && item.id !== sharedValue;
                } else {
                    return true;
                }
            });
        } else {
            filteredItems = [];
        }

        loading = false;
    };

    const clearSearchInput = () => {
        value = '';
        dispatch('input');
    };
</script>

<div class="px-1 mb-1 flex justify-center space-x-2 relative z-10" id="search-container">
    <div class="flex w-full rounded-xl" id="chat-search">
        <div class="self-center py-2 rounded-l-xl bg-transparent dark:text-gray-300">
            <Search />
        </div>

        <input
            id="search-input"
            class="w-full rounded-r-xl py-1.5 pl-2.5 text-sm bg-transparent dark:text-gray-300 outline-hidden"
            placeholder={placeholder ? placeholder : 'Search'}
            autocomplete="off"
            maxlength="500"
            bind:value
            on:input={() => {
                dispatch('input');
            }}
            on:click={() => {
                if (!focused) {
                    onFocus();
                    hovering = false;

                    focused = true;
                }
            }}
            on:blur={() => {
                if (!hovering) {
                    focused = false;
                }
            }}
            on:keydown={(e) => {
                if (e.key === 'Enter') {
                    if (filteredItems.length > 0) {
                        const itemElement = document.getElementById(`search-item-${selectedIdx}`);
                        itemElement?.click();
                        return;
                    }

                    if (filteredOptions.length > 0) {
                        const optionElement = document.getElementById(
                            `search-option-${selectedIdx}`
                        );
                        optionElement?.click();
                        return;
                    }
                }

                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedIdx = Math.max(0, (selectedIdx ?? 0) - 1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();

                    if (filteredItems.length > 0) {
                        if (selectedIdx === filteredItems.length - 1) {
                            focused = false;
                        } else {
                            selectedIdx = Math.min(
                                (selectedIdx ?? 0) + 1,
                                filteredItems.length - 1
                            );
                        }
                    } else {
                        if (selectedIdx === filteredOptions.length - 1) {
                            focused = false;
                        } else {
                            selectedIdx = Math.min(
                                (selectedIdx ?? 0) + 1,
                                filteredOptions.length - 1
                            );
                        }
                    }
                } else {
                    // if the user types something, reset to the top selection.
                    if (!focused) {
                        onFocus();
                        hovering = false;

                        focused = true;
                    }

                    selectedIdx = 0;
                }

                const item = document.querySelector(`[data-selected="true"]`);
                item?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });

                if (!document.getElementById('search-options-container')) {
                    onKeydown(e);
                }
            }}
        />

        {#if showClearButton && value}
            <div class="self-center pl-1.5 translate-y-[0.5px] rounded-l-xl bg-transparent">
                <button
                    class="p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-900 transition"
                    on:click={clearSearchInput}
                >
                    <XMark className="size-3" strokeWidth="2" />
                </button>
            </div>
        {/if}
    </div>

    {#if focused && (filteredOptions.length > 0 || filteredItems.length > 0)}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="absolute top-0 mt-8 left-0 right-1 border border-gray-100 dark:border-gray-900 bg-gray-50 dark:bg-gray-950 rounded-2xl z-10 shadow-lg"
            id="search-options-container"
            in:fade={{ duration: 50 }}
            on:mouseenter={() => {
                hovering = true;
                selectedIdx = null;
            }}
            on:mouseleave={() => {
                hovering = false;
                selectedIdx = 0;
            }}
        >
            <div class="px-3 py-2.5 text-xs group">
                {#if filteredItems.length > 0}
                    <div class="px-1 font-medium dark:text-gray-300 text-gray-700 mb-1 capitalize">
                        {selectedOption}
                    </div>

                    <div class="max-h-60 overflow-auto">
                        {#each filteredItems as item, itemIdx}
                            <button
                                class=" px-1.5 py-0.5 flex gap-1 hover:bg-gray-100 dark:hover:bg-gray-900 w-full rounded {selectedIdx ===
                                itemIdx
                                    ? 'bg-gray-100 dark:bg-gray-900'
                                    : ''}"
                                data-selected={selectedIdx === itemIdx}
                                id="search-item-{itemIdx}"
                                on:click|stopPropagation={async () => {
                                    const words = value.split(' ');

                                    words.pop();
                                    words.push(`${item.type}:${item.id} `);

                                    value = words.join(' ');

                                    filteredItems = [];
                                    dispatch('input');
                                }}
                            >
                                <div
                                    class="dark:text-gray-300 text-gray-700 font-medium line-clamp-1 shrink-0"
                                >
                                    {item.name}
                                </div>

                                <div class=" text-gray-500 line-clamp-1">
                                    {item.id}
                                </div>
                            </button>
                        {/each}
                    </div>
                {:else if filteredOptions.length > 0}
                    <div class="px-1 font-medium dark:text-gray-300 text-gray-700 mb-1">
                        {'Search options'}
                    </div>

                    <div class=" max-h-60 overflow-auto">
                        {#each filteredOptions as option, optionIdx}
                            <button
                                class=" px-1.5 py-0.5 flex gap-1 hover:bg-gray-100 dark:hover:bg-gray-900 w-full rounded {selectedIdx ===
                                optionIdx
                                    ? 'bg-gray-100 dark:bg-gray-900'
                                    : ''}"
                                id="search-option-{optionIdx}"
                                on:click|stopPropagation={async () => {
                                    const words = value.split(' ');

                                    words.pop();
                                    words.push(`${option.name}`);

                                    selectedOption = option.name.replace(':', '');

                                    value = words.join(' ');

                                    dispatch('input');
                                }}
                            >
                                <div class="dark:text-gray-300 text-gray-700 font-medium">
                                    {option.name}
                                </div>

                                <div class=" text-gray-500 line-clamp-1">
                                    {option.description}
                                </div>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
