<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { goto } from '$app/navigation';
    import {
        chats,
        settings,
        chatId,
        folders as _folders,
        showSidebar,
        showSearch,
        mobile,
        scrollPaginationEnabled,
        currentChatPage,
        models,
        selectedFolder,
        APP_NAME,
        sidebarWidth
    } from '$lib/stores';
    import { onMount, tick, onDestroy } from 'svelte';
    import { getChatList, getChatById, updateChatFolderIdById, importChats } from '$lib/apis/chats';
    import { createNewFolder, getFolders, updateFolderParentIdById } from '$lib/apis/folders';

    import ChatItem from './sidebar/ChatItem.svelte';
    import Spinner from './common/Spinner.svelte';
    import Loader from './common/Loader.svelte';
    import Folder from './common/Folder.svelte';
    import Tooltip from './common/Tooltip.svelte';
    import Folders from './sidebar/Folders.svelte';
    import PencilSquare from './icons/PencilSquare.svelte';
    import Search from './icons/Search.svelte';
    import SearchModal from './sidebar/SearchModal.svelte';
    import FolderModal from './sidebar/Folders/FolderModal.svelte';
    import Sidebar from './icons/Sidebar.svelte';
    import PinnedModelList from './sidebar/PinnedModelList.svelte';
    import { slide } from 'svelte/transition';
    import type { SidebarFolder } from '$lib/types';
    import type { FolderNameIdResponse, FolderData } from '@backend/routes/types';

    let scrollTop = 0;

    let navElement: HTMLElement | undefined;
    let shiftKey = false;

    let selectedChatId: string | null = null;

    // Pagination variables
    let chatListLoading = false;
    let allChatsLoaded = false;

    let showCreateFolderModal = false;

    let pinnedModels: string[] = [];

    let showPinnedModels = false;
    let showFolders = false;

    let folders: Record<string, SidebarFolder> = {};
    let folderRegistry: Record<string, { setFolderItems: () => void }> = {};

    let newFolderId: string | null = null;

    $: if ($selectedFolder) {
        initFolders();
    }

    const initFolders = async (): Promise<void> => {
        const folderList: FolderNameIdResponse[] = await getFolders(localStorage.token).catch(
            (error) => {
                return [];
            }
        );
        _folders.set(folderList.sort((a, b) => b.updatedAt - a.updatedAt));

        folders = {};

        // First pass: Initialize all folder entries
        for (const folder of folderList) {
            // Ensure folder is added to folders with its data
            folders[folder.id] = { ...(folders[folder.id] || {}), ...folder };

            if (newFolderId && folder.id === newFolderId) {
                folders[folder.id].new = true;
                newFolderId = null;
            }
        }

        // Second pass: Tie child folders to their parents
        for (const folder of folderList) {
            if (folder.parentId) {
                // Ensure the parent folder is initialized if it doesn't exist
                if (!folders[folder.parentId]) {
                    folders[folder.parentId] = {} as SidebarFolder; // Create a placeholder if not already present
                }

                // Initialize childrenIds array if it doesn't exist and add the current folder id
                folders[folder.parentId].childrenIds = folders[folder.parentId].childrenIds
                    ? [...(folders[folder.parentId].childrenIds ?? []), folder.id]
                    : [folder.id];

                // Sort the children by updated_at field
                (folders[folder.parentId].childrenIds ?? []).sort((a: string, b: string) => {
                    return folders[b].updatedAt - folders[a].updatedAt;
                });
            }
        }
    };

    const createFolder = async ({
        name: rawName,
        data
    }: {
        name?: string;
        data?: FolderData;
    }): Promise<void> => {
        let name = rawName?.trim();
        if (!name) {
            toast.error('Folder name cannot be empty.');
            return;
        }

        let validName: string = name;
        const rootFolders = Object.values(folders).filter((folder) => folder.parentId === null);
        if (rootFolders.find((folder) => folder.name?.toLowerCase() === validName.toLowerCase())) {
            // If a folder with the same name already exists, append a number to the name
            let i = 1;
            while (
                rootFolders.find(
                    (folder) => folder.name?.toLowerCase() === `${validName} ${i}`.toLowerCase()
                )
            ) {
                i++;
            }

            validName = `${validName} ${i}`;
        }
        // Add a dummy folder to the list to show the user that the folder is being created
        const tempId = crypto.randomUUID();
        folders = {
            ...folders,
            [tempId]: {
                id: tempId,
                name: validName,
                isExpanded: false,
                createdAt: Date.now(),
                updatedAt: Date.now()
            }
        };

        const res = await createNewFolder(localStorage.token, {
            name: validName,
            data
        }).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        if (res) {
            // newFolderId = res.id;
            await initFolders();
            showFolders = true;
        }
    };

    const initChatList = async (): Promise<void> => {
        // Reset pagination variables
        console.log('initChatList');
        currentChatPage.set(1);
        allChatsLoaded = false;
        scrollPaginationEnabled.set(false);

        initFolders();

        const _chats = await getChatList(localStorage.token, $currentChatPage);
        await chats.set(_chats);

        // Enable pagination
        scrollPaginationEnabled.set(true);
    };

    const loadMoreChats = async (): Promise<void> => {
        chatListLoading = true;

        currentChatPage.set($currentChatPage + 1);

        let newChatList = [];

        newChatList = await getChatList(localStorage.token, $currentChatPage);

        // once the bottom of the list has been reached (no results) there is no need to continue querying
        allChatsLoaded = newChatList.length === 0;
        await chats.set([...($chats ? $chats : []), ...newChatList]);

        chatListLoading = false;
    };

    const importChatHandler = async (
        items: any[],
        folderId: string | null = null
    ): Promise<void> => {
        for (const item of items) {
            if (item.chat) {
                await importChats(localStorage.token, [
                    {
                        chat: item.chat,
                        meta: item?.meta ?? {},
                        folderId: folderId,
                        createdAt: item?.createdAt ?? null,
                        updatedAt: item?.updatedAt ?? null
                    }
                ]);
            }
        }

        initChatList();
    };

    const inputFilesHandler = async (files: FileList | File[]): Promise<void> => {
        console.log(files);

        for (const file of files) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const content = e.target!.result as string;

                try {
                    const chatItems = JSON.parse(content);
                    importChatHandler(chatItems);
                } catch {
                    toast.error(`Invalid file format.`);
                }
            };

            reader.readAsText(file);
        }
    };

    const tagEventHandler = async (
        type: string,
        tagName: string,
        chatId: string
    ): Promise<void> => {
        console.log(type, tagName, chatId);
        if (type === 'delete') {
            initChatList();
        } else if (type === 'add') {
            initChatList();
        }
    };

    let draggedOver = false;

    const onDragOver = (e: DragEvent): void => {
        e.preventDefault();

        // Check if a file is being draggedOver.
        if (e.dataTransfer?.types?.includes('Files')) {
            draggedOver = true;
        } else {
            draggedOver = false;
        }
    };

    const onDragLeave = (): void => {
        draggedOver = false;
    };

    const onDrop = async (e: DragEvent): Promise<void> => {
        e.preventDefault();
        console.log(e); // Log the drop event

        // Perform file drop check and handle it accordingly
        if (e.dataTransfer?.files) {
            const inputFiles = Array.from(e.dataTransfer?.files);

            if (inputFiles && inputFiles.length > 0) {
                console.log(inputFiles); // Log the dropped files
                inputFilesHandler(inputFiles); // Handle the dropped files
            }
        }

        draggedOver = false; // Reset draggedOver status after drop
    };

    let touchstart: Touch | undefined;
    let touchend: Touch | undefined;

    function checkDirection(): void {
        if (!touchstart || !touchend) return;
        const screenWidth = window.innerWidth;
        const swipeDistance = Math.abs(touchend.screenX - touchstart.screenX);
        if (touchstart.clientX < 40 && swipeDistance >= screenWidth / 8) {
            if (touchend.screenX < touchstart.screenX) {
                showSidebar.set(false);
            }
            if (touchend.screenX > touchstart.screenX) {
                showSidebar.set(true);
            }
        }
    }

    const onTouchStart = (e: TouchEvent): void => {
        touchstart = e.changedTouches[0];
        console.log(touchstart.clientX);
    };

    const onTouchEnd = (e: TouchEvent): void => {
        touchend = e.changedTouches[0];
        checkDirection();
    };

    const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Shift') {
            shiftKey = true;
        }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
        if (e.key === 'Shift') {
            shiftKey = false;
        }
    };

    const onFocus = (): void => {};

    const onBlur = (): void => {
        shiftKey = false;
        selectedChatId = null;
    };

    const MIN_WIDTH = 220;
    const MAX_WIDTH = 480;

    let isResizing = false;

    let startWidth = 0;
    let startClientX = 0;

    const resizeStartHandler = (e: MouseEvent): void => {
        if ($mobile) return;
        isResizing = true;

        startClientX = e.clientX;
        startWidth = $sidebarWidth ?? 260;

        document.body.style.userSelect = 'none';
    };

    const resizeEndHandler = (): void => {
        if (!isResizing) return;
        isResizing = false;

        document.body.style.userSelect = '';
        localStorage.setItem('sidebarWidth', String($sidebarWidth));
    };

    const resizeSidebarHandler = (endClientX: number): void => {
        const dx = endClientX - startClientX;
        const newSidebarWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + dx));

        sidebarWidth.set(newSidebarWidth);
        document.documentElement.style.setProperty('--sidebar-width', `${newSidebarWidth}px`);
    };

    let unsubscribers: (() => void)[] = [];

    onMount(async () => {
        try {
            const width = Number(localStorage.getItem('sidebarWidth'));
            if (!Number.isNaN(width) && width >= MIN_WIDTH && width <= MAX_WIDTH) {
                sidebarWidth.set(width);
            }
        } catch {}

        document.documentElement.style.setProperty('--sidebar-width', `${$sidebarWidth}px`);
        sidebarWidth.subscribe((w) => {
            document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
        });

        await showSidebar.set(!$mobile ? localStorage.sidebar === 'true' : false);

        unsubscribers = [
            mobile.subscribe((value) => {
                if ($showSidebar && value) {
                    showSidebar.set(false);
                }

                if ($showSidebar && !value) {
                    const navElement = document.getElementsByTagName('nav')[0];
                    if (navElement) {
                        navElement.style.setProperty('-webkit-app-region', 'drag');
                    }
                }
            }),
            showSidebar.subscribe(async (value) => {
                localStorage.sidebar = value;

                // nav element is not available on the first render
                const navElement = document.getElementsByTagName('nav')[0];

                if (navElement) {
                    if ($mobile) {
                        if (!value) {
                            navElement.style.setProperty('-webkit-app-region', 'drag');
                        } else {
                            navElement.style.setProperty('-webkit-app-region', 'no-drag');
                        }
                    } else {
                        navElement.style.setProperty('-webkit-app-region', 'drag');
                    }
                }

                if (value) await initChatList();
            }),
            settings.subscribe((value) => {
                if (pinnedModels !== value.pinnedModels) {
                    pinnedModels = value.pinnedModels;
                    showPinnedModels = pinnedModels.length > 0;
                }
            })
        ];

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

        window.addEventListener('touchstart', onTouchStart);
        window.addEventListener('touchend', onTouchEnd);

        window.addEventListener('focus', onFocus);
        window.addEventListener('blur', onBlur);

        const dropZone = document.getElementById('sidebar');

        dropZone?.addEventListener('dragover', onDragOver);
        dropZone?.addEventListener('drop', onDrop);
        dropZone?.addEventListener('dragleave', onDragLeave);
    });

    onDestroy(() => {
        if (unsubscribers && unsubscribers.length > 0) {
            unsubscribers.forEach((unsubscriber) => {
                if (unsubscriber) {
                    unsubscriber();
                }
            });
        }

        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);

        window.removeEventListener('touchstart', onTouchStart);
        window.removeEventListener('touchend', onTouchEnd);

        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);

        const dropZone = document.getElementById('sidebar');

        dropZone?.removeEventListener('dragover', onDragOver);
        dropZone?.removeEventListener('drop', onDrop);
        dropZone?.removeEventListener('dragleave', onDragLeave);
    });

    const newChatHandler = async (): Promise<void> => {
        selectedChatId = null;
        selectedFolder.set(null);

        setTimeout(() => {
            if ($mobile) {
                showSidebar.set(false);
            }
        }, 0);
    };

    const itemClickHandler = async (): Promise<void> => {
        selectedChatId = null;
        chatId.set('');

        if ($mobile) {
            showSidebar.set(false);
        }

        await tick();
    };

    const isWindows = /Windows/i.test(navigator.userAgent);
</script>

<FolderModal
    bind:show={showCreateFolderModal}
    onSubmit={async (folder: { name?: string; data?: FolderData }) => {
        await createFolder(folder);
        showCreateFolderModal = false;
    }}
/>

<!-- svelte-ignore a11y-no-static-element-interactions -->

{#if $showSidebar}
    <div
        class=" fixed md:hidden z-40 top-0 right-0 left-0 bottom-0 bg-black/60 w-full min-h-screen h-screen flex justify-center overflow-hidden overscroll-contain"
        on:mousedown={() => {
            showSidebar.set(!$showSidebar);
        }}
    ></div>
{/if}

<SearchModal
    bind:show={$showSearch}
    onClose={() => {
        if ($mobile) {
            showSidebar.set(false);
        }
    }}
/>

<svelte:window
    on:mousemove={(e) => {
        if (!isResizing) return;
        resizeSidebarHandler(e.clientX);
    }}
    on:mouseup={() => {
        resizeEndHandler();
    }}
/>

{#if !$mobile && !$showSidebar}
    <div
        class=" pt-[7px] pb-2 px-2 flex flex-col justify-between text-black dark:text-white hover:bg-gray-50/30 dark:hover:bg-gray-950/30 h-full z-10 transition-all border-e-[0.5px] border-gray-50 dark:border-gray-850/30"
        id="sidebar"
    >
        <button
            class="flex flex-col flex-1 {isWindows ? 'cursor-pointer' : 'cursor-[e-resize]'}"
            on:click={async () => {
                showSidebar.set(!$showSidebar);
            }}
        >
            <div class="pb-1.5">
                <Tooltip
                    content={$showSidebar ? 'Close Sidebar' : 'Open Sidebar'}
                    placement="right"
                >
                    <button
                        class="flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition group {isWindows
                            ? 'cursor-pointer'
                            : 'cursor-[e-resize]'}"
                        aria-label={$showSidebar ? 'Close Sidebar' : 'Open Sidebar'}
                    >
                        <div class=" self-center flex items-center justify-center size-9">
                            <img
                                src="/static/favicon.png"
                                class="sidebar-new-chat-icon size-6 rounded-full group-hover:hidden"
                                alt=""
                            />

                            <Sidebar className="size-5 hidden group-hover:flex" />
                        </div>
                    </button>
                </Tooltip>
            </div>

            <div class="-mt-[0.5px]">
                <div class="">
                    <Tooltip content="New Chat" placement="right">
                        <a
                            class=" cursor-pointer flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition group"
                            href="/"
                            draggable="false"
                            on:click={async (e) => {
                                e.stopImmediatePropagation();
                                e.preventDefault();

                                goto('/');
                                newChatHandler();
                            }}
                            aria-label="New Chat"
                        >
                            <div class=" self-center flex items-center justify-center size-9">
                                <PencilSquare className="size-4.5" />
                            </div>
                        </a>
                    </Tooltip>
                </div>

                <div>
                    <Tooltip content="Search" placement="right">
                        <button
                            class=" cursor-pointer flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition group"
                            on:click={(e) => {
                                e.stopImmediatePropagation();
                                e.preventDefault();

                                showSearch.set(true);
                            }}
                            draggable="false"
                            aria-label="Search"
                        >
                            <div class=" self-center flex items-center justify-center size-9">
                                <Search className="size-4.5" />
                            </div>
                        </button>
                    </Tooltip>
                </div>

                <div class="">
                    <Tooltip content="Models" placement="right">
                        <a
                            class=" cursor-pointer flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition group"
                            href="/models"
                            on:click={async (e) => {
                                e.stopImmediatePropagation();
                                e.preventDefault();

                                goto('/models');
                                itemClickHandler();
                            }}
                            aria-label="Models"
                            draggable="false"
                        >
                            <div class=" self-center flex items-center justify-center size-9">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke-width="1.5"
                                    stroke="currentColor"
                                    class="size-4.5"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z"
                                    />
                                </svg>
                            </div>
                        </a>
                    </Tooltip>
                </div>
            </div>
        </button>
    </div>
{/if}

{#if $showSidebar}
    <div
        bind:this={navElement}
        id="sidebar"
        class="h-screen max-h-[100dvh] min-h-screen select-none {$showSidebar
            ? `${$mobile ? 'bg-gray-50 dark:bg-gray-950' : 'bg-gray-50/70 dark:bg-gray-950'} z-50`
            : ' bg-transparent z-0 '} transition-all duration-300 shrink-0 text-gray-900 dark:text-gray-200 text-sm fixed top-0 left-0 overflow-x-hidden
        "
        transition:slide={{ duration: 250, axis: 'x' }}
        data-state={$showSidebar}
    >
        <div
            class=" my-auto flex flex-col justify-between h-screen max-h-[100dvh] w-[var(--sidebar-width)] overflow-x-hidden scrollbar-hidden z-50 {$showSidebar
                ? ''
                : 'invisible'}"
        >
            <div
                class="sidebar px-[0.5625rem] pt-2 pb-1.5 flex justify-between space-x-1 text-gray-600 dark:text-gray-400 sticky top-0 z-10 -mb-3"
            >
                <a
                    class="flex items-center rounded-lg size-8.5 h-full justify-center hover:bg-gray-100/50 dark:hover:bg-gray-850/50 transition"
                    href="/"
                    draggable="false"
                    on:click={newChatHandler}
                >
                    <img
                        crossorigin="anonymous"
                        src="/static/favicon.png"
                        class="sidebar-new-chat-icon size-6 rounded-full"
                        alt=""
                    />
                </a>

                <a href="/" class="flex flex-1 px-1.5" on:click={newChatHandler}>
                    <div
                        id="sidebar-app-name"
                        class=" self-center font-medium text-gray-850 dark:text-white font-primary"
                    >
                        {$APP_NAME}
                    </div>
                </a>
                <Tooltip
                    content={$showSidebar ? 'Close Sidebar' : 'Open Sidebar'}
                    placement="bottom"
                >
                    <button
                        class="flex rounded-lg size-8.5 justify-center items-center hover:bg-gray-100/50 dark:hover:bg-gray-850/50 transition {isWindows
                            ? 'cursor-pointer'
                            : 'cursor-[w-resize]'}"
                        on:click={() => {
                            showSidebar.set(!$showSidebar);
                        }}
                        aria-label={$showSidebar ? 'Close Sidebar' : 'Open Sidebar'}
                    >
                        <div class=" self-center p-1.5">
                            <Sidebar />
                        </div>
                    </button>
                </Tooltip>

                <div
                    class="{scrollTop > 0
                        ? 'visible'
                        : 'invisible'} sidebar-bg-gradient-to-b bg-linear-to-b from-gray-50 dark:from-gray-950 to-transparent from-50% pointer-events-none absolute inset-0 -z-10 -mb-6"
                ></div>
            </div>

            <div
                class="relative flex flex-col flex-1 overflow-y-auto scrollbar-hidden pt-3 pb-3"
                on:scroll={(e) => {
                    if ((e.target as HTMLElement).scrollTop === 0) {
                        scrollTop = 0;
                    } else {
                        scrollTop = (e.target as HTMLElement).scrollTop;
                    }
                }}
            >
                <div class="pb-1.5">
                    <div
                        class="px-[0.4375rem] flex justify-center text-gray-800 dark:text-gray-200"
                    >
                        <a
                            id="sidebar-new-chat-button"
                            class="group grow flex items-center space-x-3 rounded-lg px-2.5 py-2 hover:bg-gray-100 dark:hover:bg-gray-900 transition outline-none"
                            href="/"
                            draggable="false"
                            on:click={newChatHandler}
                            aria-label="New Chat"
                        >
                            <div class="self-center">
                                <PencilSquare className=" size-4.5" strokeWidth="2" />
                            </div>

                            <div class="flex flex-1 self-center translate-y-[0.5px]">
                                <div class=" self-center text-sm font-primary">{'New Chat'}</div>
                            </div>
                        </a>
                    </div>

                    <div
                        class="px-[0.4375rem] flex justify-center text-gray-800 dark:text-gray-200"
                    >
                        <button
                            id="sidebar-search-button"
                            class="group grow flex items-center space-x-3 rounded-lg px-2.5 py-2 hover:bg-gray-100 dark:hover:bg-gray-900 transition outline-none"
                            on:click={() => {
                                showSearch.set(true);
                            }}
                            draggable="false"
                            aria-label="Search"
                        >
                            <div class="self-center">
                                <Search strokeWidth="2" className="size-4.5" />
                            </div>

                            <div class="flex flex-1 self-center translate-y-[0.5px]">
                                <div class=" self-center text-sm font-primary">{'Search'}</div>
                            </div>
                        </button>
                    </div>

                    <div
                        class="px-[0.4375rem] flex justify-center text-gray-800 dark:text-gray-200"
                    >
                        <a
                            id="sidebar-models-button"
                            class="grow flex items-center space-x-3 rounded-lg px-2.5 py-2 hover:bg-gray-100 dark:hover:bg-gray-900 transition"
                            href="/models"
                            on:click={itemClickHandler}
                            draggable="false"
                            aria-label="Models"
                        >
                            <div class="self-center">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke-width="2"
                                    stroke="currentColor"
                                    class="size-4.5"
                                >
                                    <path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        d="M13.5 16.875h3.375m0 0h3.375m-3.375 0V13.5m0 3.375v3.375M6 10.5h2.25a2.25 2.25 0 0 0 2.25-2.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v2.25A2.25 2.25 0 0 0 6 10.5Zm0 9.75h2.25A2.25 2.25 0 0 0 10.5 18v-2.25a2.25 2.25 0 0 0-2.25-2.25H6a2.25 2.25 0 0 0-2.25 2.25V18A2.25 2.25 0 0 0 6 20.25Zm9.75-9.75H18a2.25 2.25 0 0 0 2.25-2.25V6A2.25 2.25 0 0 0 18 3.75h-2.25A2.25 2.25 0 0 0 13.5 6v2.25a2.25 2.25 0 0 0 2.25 2.25Z"
                                    />
                                </svg>
                            </div>

                            <div class="flex self-center translate-y-[0.5px]">
                                <div class=" self-center text-sm font-primary">{'Models'}</div>
                            </div>
                        </a>
                    </div>
                </div>

                {#if $models.length > 0 && $settings.pinnedModels.length > 0}
                    <Folder
                        id="sidebar-models"
                        bind:open={showPinnedModels}
                        className="px-2 mt-0.5"
                        name="Models"
                        chevron={false}
                        dragAndDrop={false}
                    >
                        <PinnedModelList bind:selectedChatId {shiftKey} />
                    </Folder>
                {/if}

                <Folder
                    id="sidebar-folders"
                    bind:open={showFolders}
                    className="px-2 mt-0.5"
                    name="Folders"
                    chevron={false}
                    onAdd={() => {
                        showCreateFolderModal = true;
                    }}
                    onAddLabel="New Folder"
                    on:drop={async (e) => {
                        const { type, id, item } = e.detail;

                        if (type === 'folder') {
                            if (folders[id].parentId === null) {
                                return;
                            }

                            const res = await updateFolderParentIdById(
                                localStorage.token,
                                id,
                                null
                            ).catch((error) => {
                                toast.error(`${error}`);
                                return null;
                            });

                            if (res) {
                                await initFolders();
                            }
                        }
                    }}
                >
                    <Folders
                        bind:folderRegistry
                        {folders}
                        onDelete={(folderId) => {
                            selectedFolder.set(null);
                            initChatList();
                        }}
                        on:update={() => {
                            initChatList();
                        }}
                        on:import={(e) => {
                            const { folderId, items } = e.detail;
                            importChatHandler(items, folderId);
                        }}
                        on:change={async () => {
                            initChatList();
                        }}
                    />
                </Folder>

                <Folder
                    id="sidebar-chats"
                    className="px-2 mt-0.5"
                    name="Chats"
                    chevron={false}
                    on:change={async (e) => {
                        selectedFolder.set(null);
                    }}
                    on:import={(e) => {
                        importChatHandler(e.detail);
                    }}
                    on:drop={async (e) => {
                        const { type, id, item } = e.detail;

                        if (type === 'chat') {
                            let chat = await getChatById(localStorage.token, id).catch((error) => {
                                return null;
                            });
                            if (!chat && item) {
                                const importResult = await importChats(localStorage.token, [
                                    {
                                        chat: item.chat,
                                        meta: item?.meta ?? {},
                                        folderId: null,
                                        createdAt: item?.createdAt ?? null,
                                        updatedAt: item?.updatedAt ?? null
                                    }
                                ]);
                                chat = importResult?.[0] ?? null;
                            }

                            if (chat) {
                                console.log(chat);
                                if (chat.folderId) {
                                    const res = await updateChatFolderIdById(
                                        localStorage.token,
                                        chat.id,
                                        null
                                    ).catch((error) => {
                                        toast.error(`${error}`);
                                        return null;
                                    });

                                    folderRegistry[chat.folderId]?.setFolderItems();
                                }

                                initChatList();
                            }
                        } else if (type === 'folder') {
                            if (folders[id].parentId === null) {
                                return;
                            }

                            const res = await updateFolderParentIdById(
                                localStorage.token,
                                id,
                                null
                            ).catch((error) => {
                                toast.error(`${error}`);
                                return null;
                            });

                            if (res) {
                                await initFolders();
                            }
                        }
                    }}
                >
                    <div class=" flex-1 flex flex-col overflow-y-auto scrollbar-hidden">
                        <div class="pt-1.5">
                            {#if $chats}
                                {#each $chats as chat, idx (`chat-${chat?.id ?? idx}`)}
                                    {#if idx === 0 || (idx > 0 && chat.timeRange !== $chats[idx - 1].timeRange)}
                                        <div
                                            class="w-full pl-2.5 text-xs text-gray-500 dark:text-gray-600 font-medium {idx ===
                                            0
                                                ? ''
                                                : 'pt-5'} pb-1.5"
                                        >
                                            {chat.timeRange}
                                        </div>
                                    {/if}

                                    <ChatItem
                                        className=""
                                        id={chat.id}
                                        title={chat.title}
                                        selected={selectedChatId === chat.id}
                                        on:select={() => {
                                            selectedChatId = chat.id;
                                        }}
                                        on:unselect={() => {
                                            selectedChatId = null;
                                        }}
                                        on:change={async () => {
                                            initChatList();
                                        }}
                                        on:tag={(e) => {
                                            const { type, name } = e.detail;
                                            tagEventHandler(type, name, chat.id);
                                        }}
                                    />
                                {/each}

                                {#if $scrollPaginationEnabled && !allChatsLoaded}
                                    <Loader
                                        on:visible={(e) => {
                                            if (!chatListLoading) {
                                                loadMoreChats();
                                            }
                                        }}
                                    >
                                        <div
                                            class="w-full flex justify-center py-1 text-xs animate-pulse items-center gap-2"
                                        >
                                            <Spinner className=" size-4" />
                                            <div class=" ">{'Loading...'}</div>
                                        </div>
                                    </Loader>
                                {/if}
                            {:else}
                                <div
                                    class="w-full flex justify-center py-1 text-xs animate-pulse items-center gap-2"
                                >
                                    <Spinner className=" size-4" />
                                    <div class=" ">{'Loading...'}</div>
                                </div>
                            {/if}
                        </div>
                    </div>
                </Folder>
            </div>
        </div>
    </div>

    {#if !$mobile}
        <div
            class="relative flex items-center justify-center group border-l border-gray-50 dark:border-gray-850/30 hover:border-gray-200 dark:hover:border-gray-800 transition z-20"
            id="sidebar-resizer"
            on:mousedown={resizeStartHandler}
            role="slider"
            aria-label="Resize sidebar"
            aria-valuenow={0}
            tabindex="0"
        >
            <div
                class=" absolute -left-1.5 -right-1.5 -top-0 -bottom-0 z-20 cursor-col-resize bg-transparent"
            ></div>
        </div>
    {/if}
{/if}
