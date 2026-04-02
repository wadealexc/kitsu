<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
    const dispatch = createEventDispatcher();

    import { saveAs } from '$lib/utils';

    import { goto } from '$app/navigation';
    import { toast } from 'svelte-sonner';

    import { mobile, selectedFolder, showSidebar } from '$lib/stores';
    import type {
        ChatResponse,
        FolderChatListItemResponse,
        FolderData,
        FolderMeta
    } from '@backend/routes/types.js';
    import type { SidebarFolder } from '$lib/types';

    import {
        deleteFolderById,
        updateFolderIsExpandedById,
        updateFolderById,
        updateFolderParentIdById,
        getFolderById
    } from '$lib/apis/folders';
    import {
        getChatById,
        getChatsByFolderId,
        getChatListByFolderId,
        updateChatFolderIdById,
        importChats
    } from '$lib/apis/chats';

    import ChevronDown from '../icons/ChevronDown.svelte';
    import ChevronRight from '../icons/ChevronRight.svelte';
    import Collapsible from '../common/Collapsible.svelte';
    import DragGhost from '$lib/components/common/DragGhost.svelte';

    import FolderOpen from '$lib/components/icons/FolderOpen.svelte';
    import EllipsisHorizontal from '$lib/components/icons/EllipsisHorizontal.svelte';

    import ChatItem from './ChatItem.svelte';
    import FolderMenu from './Folders/FolderMenu.svelte';
    import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
    import FolderModal from './Folders/FolderModal.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';

    export let folderRegistry: Record<string, { setFolderItems: () => void }> = {};
    export let open = false;

    export let folders: Record<string, SidebarFolder>;
    export let folderId: string;

    export let className = '';

    export let deleteFolderContents = true;

    export let parentDragged = false;

    export let onDelete: (folderId: string) => void = (_e) => {};
    export let onItemMove: (e: {
        originFolderId: string | null | undefined;
        targetFolderId: string;
        e: DragEvent;
    }) => void = (_e) => {};

    let folderElement: HTMLDivElement;

    let showFolderModal = false;
    let edit = false;

    let draggedOver = false;
    let dragged = false;

    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    let name = '';

    const onDragOver = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragged || parentDragged) {
            return;
        }
        draggedOver = true;
    };

    const onDrop = async (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragged || parentDragged) {
            return;
        }

        if (folderElement.contains(e.target as Node)) {
            if (e.dataTransfer!.items && e.dataTransfer!.items.length > 0) {
                // Iterate over all items in the DataTransferItemList use functional programming
                for (const item of Array.from(e.dataTransfer!.items)) {
                    // If dropped items aren't files, reject them
                    if (item.kind === 'file') {
                        const file = item.getAsFile();
                        if (file && file.type === 'application/json') {
                            console.log('Dropped file is a JSON file!');

                            // Read the JSON file with FileReader
                            const reader = new FileReader();
                            reader.onload = async function (event: ProgressEvent<FileReader>) {
                                try {
                                    const fileContent = JSON.parse(event.target!.result as string);
                                    open = true;
                                    dispatch('import', {
                                        folderId: folderId,
                                        items: fileContent
                                    });
                                } catch (error) {
                                    console.error('Error parsing JSON file:', error);
                                }
                            };

                            // Start reading the file
                            reader.readAsText(file);
                        } else {
                            console.error('Only JSON file types are supported.');
                        }

                        console.log(file);
                    } else {
                        // Handle the drag-and-drop data for folders or chats (same as before)
                        const dataTransfer = e.dataTransfer!.getData('text/plain');

                        try {
                            const data = JSON.parse(dataTransfer);
                            console.log(data);

                            const { type, id, item } = data;

                            if (type === 'folder') {
                                open = true;
                                if (id === folderId) {
                                    return;
                                }
                                // Move the folder
                                const res = await updateFolderParentIdById(
                                    localStorage.token,
                                    id,
                                    folderId
                                ).catch((error) => {
                                    toast.error(`${error}`);
                                    return null;
                                });

                                if (res) {
                                    dispatch('update');
                                }
                            } else if (type === 'chat') {
                                open = true;

                                let chat: ChatResponse | null = await getChatById(
                                    localStorage.token,
                                    id
                                ).catch((error) => {
                                    return null;
                                });
                                if (!chat && item) {
                                    const importResult = await importChats(localStorage.token, [
                                        {
                                            chat: item.chat,
                                            meta: item?.meta ?? {},
                                            folder_id: null,
                                            created_at: item?.created_at ?? null,
                                            updated_at: item?.updated_at ?? null
                                        }
                                    ]).catch((error) => {
                                        toast.error(`${error}`);
                                        return null;
                                    });
                                    chat = importResult?.[0] ?? null;
                                }

                                if (!chat) return;

                                // Move the chat
                                const res = await updateChatFolderIdById(
                                    localStorage.token,
                                    chat.id,
                                    folderId
                                ).catch((error) => {
                                    toast.error(`${error}`);
                                    return null;
                                });

                                onItemMove({
                                    originFolderId: chat.folder_id,
                                    targetFolderId: folderId,
                                    e
                                });

                                if (res) {
                                    dispatch('update');
                                }
                            }
                        } catch (error) {
                            console.log('Error parsing dataTransfer:', error);
                        }
                    }
                }
            }

            setFolderItems();
            draggedOver = false;
        }
    };

    const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        if (dragged || parentDragged) {
            return;
        }

        draggedOver = false;
    };

    const dragImage = new Image();
    dragImage.src =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    let x: number | undefined;
    let y: number | undefined;

    const onDragStart = (event: DragEvent) => {
        event.stopPropagation();
        event.dataTransfer!.setDragImage(dragImage, 0, 0);

        // Set the data to be transferred
        event.dataTransfer!.setData(
            'text/plain',
            JSON.stringify({
                type: 'folder',
                id: folderId
            })
        );

        dragged = true;
        folderElement.style.opacity = '0.5'; // Optional: Visual cue to show it's being dragged
    };

    const onDrag = (event: DragEvent) => {
        event.stopPropagation();

        x = event.clientX;
        y = event.clientY;
    };

    const onDragEnd = (event: DragEvent) => {
        event.stopPropagation();

        folderElement.style.opacity = '1'; // Reset visual cue after drag
        dragged = false;
    };

    onMount(async () => {
        open = folders[folderId].is_expanded;
        folderRegistry[folderId] = {
            setFolderItems: () => {
                setFolderItems();
            }
        };
        if (folderElement) {
            folderElement.addEventListener('dragover', onDragOver);
            folderElement.addEventListener('drop', onDrop);
            folderElement.addEventListener('dragleave', onDragLeave);

            // Event listener for when dragging starts
            folderElement.addEventListener('dragstart', onDragStart);
            // Event listener for when dragging occurs (optional)
            folderElement.addEventListener('drag', onDrag);
            // Event listener for when dragging ends
            folderElement.addEventListener('dragend', onDragEnd);
        }

        if (folders[folderId]?.new) {
            delete folders[folderId].new;
            await tick();
            renameHandler();
        }
    });

    onDestroy(() => {
        if (folderElement) {
            folderElement.removeEventListener('dragover', onDragOver);
            folderElement.removeEventListener('drop', onDrop);
            folderElement.removeEventListener('dragleave', onDragLeave);

            folderElement.removeEventListener('dragstart', onDragStart);
            folderElement.removeEventListener('drag', onDrag);
            folderElement.removeEventListener('dragend', onDragEnd);
        }
    });

    let showDeleteConfirm = false;

    const deleteHandler = async () => {
        const res = await deleteFolderById(
            localStorage.token,
            folderId,
            deleteFolderContents
        ).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        if (res) {
            toast.success('Folder deleted successfully');
            onDelete(folderId);
        }
    };

    const updateHandler = async ({
        name,
        meta,
        data
    }: {
        name: string;
        meta?: FolderMeta;
        data?: FolderData;
    }) => {
        if (name === '') {
            toast.error('Folder name cannot be empty.');
            return;
        }

        const currentName = folders[folderId].name;

        name = name.trim();
        folders[folderId].name = name;

        const res = await updateFolderById(localStorage.token, folderId, {
            name,
            ...(meta ? { meta } : {}),
            ...(data ? { data } : {})
        }).catch((error) => {
            toast.error(`${error}`);

            folders[folderId].name = currentName;
            return null;
        });

        if (res) {
            folders[folderId].name = name;
            if (data) {
                folders[folderId].data = data;
            }

            // toast.success('Folder name updated successfully');
            toast.success('Folder updated successfully');

            if ($selectedFolder?.id === folderId) {
                const folder = await getFolderById(localStorage.token, folderId).catch((error) => {
                    toast.error(`${error}`);
                    return null;
                });

                if (folder) {
                    await selectedFolder.set(folder);
                }
            }
            dispatch('update');
        }
    };

    const isExpandedUpdateHandler = async () => {
        const res = await updateFolderIsExpandedById(localStorage.token, folderId, open).catch(
            (error) => {
                toast.error(`${error}`);
                return null;
            }
        );
    };

    let isExpandedUpdateTimeout: ReturnType<typeof setTimeout> | undefined;

    const isExpandedUpdateDebounceHandler = () => {
        clearTimeout(isExpandedUpdateTimeout);
        isExpandedUpdateTimeout = setTimeout(() => {
            isExpandedUpdateHandler();
        }, 500);
    };

    let chats: FolderChatListItemResponse[] | null = null;
    export const setFolderItems = async () => {
        await tick();
        if (open) {
            chats = await getChatListByFolderId(localStorage.token, folderId).catch((error) => {
                toast.error(`${error}`);
                return [];
            });
        } else {
            chats = null;
        }
    };

    $: if (open) {
        setFolderItems();
    }

    const renameHandler = async () => {
        console.log('Edit');
        await tick();
        name = folders[folderId].name;
        edit = true;

        await tick();
        await tick();

        const input = document.getElementById(`folder-${folderId}-input`);
        if (input) {
            input.focus();
            (input as HTMLInputElement).select();
        }
    };

    const exportHandler = async () => {
        const chats = await getChatsByFolderId(localStorage.token, folderId).catch((error) => {
            toast.error(`${error}`);
            return null;
        });
        if (!chats) {
            return;
        }

        const blob = new Blob([JSON.stringify(chats)], {
            type: 'application/json'
        });

        saveAs(blob, `folder-${folders[folderId].name}-export-${Date.now()}.json`);
    };
</script>

<DeleteConfirmDialog
    bind:show={showDeleteConfirm}
    title="Delete folder?"
    on:confirm={() => {
        deleteHandler();
    }}
>
    <div class=" text-sm text-gray-700 dark:text-gray-300 flex-1 line-clamp-3 mb-2">
        <!-- {`This will delete <strong>${folders[folderId].name}</strong> and <strong>all its contents</strong>.`} -->

        {`Are you sure you want to delete "${folders[folderId].name}"?`}
    </div>

    <div class="flex items-center gap-1.5">
        <input type="checkbox" bind:checked={deleteFolderContents} />

        <div class="text-xs text-gray-500">
            {'Delete all contents inside this folder'}
        </div>
    </div>
</DeleteConfirmDialog>

<FolderModal bind:show={showFolderModal} edit={true} {folderId} onSubmit={updateHandler} />

{#if dragged && x && y}
    <DragGhost {x} {y}>
        <div class=" bg-black/80 backdrop-blur-2xl px-2 py-1 rounded-lg w-fit max-w-40">
            <div class="flex items-center gap-1">
                <FolderOpen className="size-3.5" strokeWidth="2" />
                <div class=" text-xs text-white line-clamp-1">
                    {folders[folderId].name}
                </div>
            </div>
        </div>
    </DragGhost>
{/if}

<div bind:this={folderElement} class="relative {className}" draggable="true">
    {#if draggedOver}
        <div
            class="absolute top-0 left-0 w-full h-full rounded-xs bg-gray-100/50 dark:bg-gray-700/20 bg-opacity-50 dark:bg-opacity-10 z-50 pointer-events-none touch-none"
        ></div>
    {/if}

    <Collapsible
        bind:open
        className="w-full"
        buttonClassName="w-full"
        onChange={(state: boolean) => {
            dispatch('open', state);
        }}
    >
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div class="w-full group">
            <div
                id="folder-{folderId}-button"
                class="relative w-full py-1 px-1.5 rounded-lg flex items-center gap-1.5 hover:bg-gray-100 dark:hover:bg-gray-900 transition {$selectedFolder?.id ===
                folderId
                    ? 'bg-gray-100 dark:bg-gray-900 selected'
                    : ''}"
                on:dblclick={(e) => {
                    if (clickTimer) {
                        clearTimeout(clickTimer); // cancel the single-click action
                        clickTimer = null;
                    }
                    renameHandler();
                }}
                on:click={async (e) => {
                    e.stopPropagation();
                    if (clickTimer) {
                        clearTimeout(clickTimer);
                        clickTimer = null;
                    }

                    clickTimer = setTimeout(async () => {
                        const folder = await getFolderById(localStorage.token, folderId).catch(
                            (error) => {
                                toast.error(`${error}`);
                                return null;
                            }
                        );

                        if (folder) {
                            await selectedFolder.set(folder);
                        }

                        await goto('/');

                        if ($mobile) {
                            showSidebar.set(!$showSidebar);
                        }
                        clickTimer = null;
                    }, 100); // 100ms delay (typical double-click threshold)
                }}
                on:pointerup={(e) => {
                    e.stopPropagation();
                }}
            >
                <button
                    class="text-gray-500 dark:text-gray-500 transition-all p-1 hover:bg-gray-200 dark:hover:bg-gray-850 rounded-lg"
                    on:click={(e) => {
                        e.stopPropagation();
                        e.stopImmediatePropagation();
                        open = !open;
                        isExpandedUpdateDebounceHandler();
                    }}
                >
                    <div class="p-[1px]">
                        {#if open}
                            <ChevronDown className=" size-3" strokeWidth="2.5" />
                        {:else}
                            <ChevronRight className=" size-3" strokeWidth="2.5" />
                        {/if}
                    </div>
                </button>

                <div class="translate-y-[0.5px] flex-1 justify-start text-start line-clamp-1">
                    {#if edit}
                        <input
                            id="folder-{folderId}-input"
                            type="text"
                            bind:value={name}
                            on:blur={() => {
                                console.log('Blur');
                                updateHandler({ name });
                                edit = false;
                            }}
                            on:click={(e) => {
                                // Prevent accidental collapse toggling when clicking inside input
                                e.stopPropagation();
                            }}
                            on:mousedown={(e) => {
                                // Prevent accidental collapse toggling when clicking inside input
                                e.stopPropagation();
                            }}
                            on:keydown={(e) => {
                                if (e.key === 'Enter') {
                                    updateHandler({ name });
                                    edit = false;
                                }
                            }}
                            class="w-full h-full bg-transparent outline-hidden"
                        />
                    {:else}
                        {folders[folderId].name}
                    {/if}
                </div>

                <button
                    class="absolute z-10 right-2 invisible group-hover:visible self-center flex items-center dark:text-gray-300"
                >
                    <FolderMenu
                        onEdit={() => {
                            showFolderModal = true;
                        }}
                        onDelete={() => {
                            showDeleteConfirm = true;
                        }}
                        onExport={() => {
                            exportHandler();
                        }}
                    >
                        <div class="p-1 dark:hover:bg-gray-850 rounded-lg touch-auto">
                            <EllipsisHorizontal className="size-4" strokeWidth="2.5" />
                        </div>
                    </FolderMenu>
                </button>
            </div>
        </div>

        <div slot="content" class="w-full">
            {#if (folders[folderId]?.childrenIds ?? []).length > 0 || (chats ?? []).length > 0}
                <div
                    class="ml-3 pl-1 mt-[1px] flex flex-col overflow-y-auto scrollbar-hidden border-s border-gray-100 dark:border-gray-900"
                >
                    {#if folders[folderId]?.childrenIds}
                        {@const children = folders[folderId]
                            .childrenIds!.map((id) => folders[id])
                            .sort((a, b) =>
                                a.name.localeCompare(b.name, undefined, {
                                    numeric: true,
                                    sensitivity: 'base'
                                })
                            )}

                        {#each children as childFolder (`${folderId}-${childFolder.id}`)}
                            <svelte:self
                                bind:folderRegistry
                                {folders}
                                folderId={childFolder.id}
                                parentDragged={dragged}
                                {onItemMove}
                                {onDelete}
                                on:import={(e) => {
                                    dispatch('import', e.detail);
                                }}
                                on:update={(e) => {
                                    dispatch('update', e.detail);
                                }}
                                on:change={(e) => {
                                    dispatch('change', e.detail);
                                }}
                            />
                        {/each}
                    {/if}

                    {#each chats ?? [] as chat (chat.id)}
                        <ChatItem
                            id={chat.id}
                            title={chat.title}
                            on:change={(e) => {
                                dispatch('change', e.detail);
                            }}
                        />
                    {/each}
                </div>
            {/if}

            {#if chats === null}
                <div class="flex justify-center items-center p-2">
                    <Spinner className="size-4 text-gray-500" />
                </div>
            {/if}
        </div>
    </Collapsible>
</div>
