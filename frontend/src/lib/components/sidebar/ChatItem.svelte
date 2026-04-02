<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { goto } from '$app/navigation';
    import { onMount, createEventDispatcher, tick, onDestroy } from 'svelte';
    import type { ChatResponse } from '@backend/routes/types.js';
    const dispatch = createEventDispatcher();

    import {
        cloneChatById,
        deleteChatById,
        getChatById,
        getChatList,
        updateChatById,
        updateChatFolderIdById
    } from '$lib/apis/chats';
    import {
        chatId,
        chatTitle as _chatTitle,
        chats,
        mobile,
        showSidebar,
        currentChatPage,
        selectedFolder
    } from '$lib/stores';

    import ChatMenu from './ChatMenu.svelte';
    import DeleteConfirmDialog from '$lib/components/common/ConfirmDialog.svelte';
    import ShareChatModal from '$lib/components/chat/ShareChatModal.svelte';
    import DragGhost from '$lib/components/common/DragGhost.svelte';
    import Document from '$lib/components/icons/Document.svelte';

    export let className = '';

    export let id: string;
    export let title: string;

    export let selected = false;

    export let onDragEnd: (event: DragEvent) => void = () => {};

    let chat: ChatResponse | null = null;

    let mouseOver = false;
    let draggable = false;
    $: if (mouseOver) {
        loadChat();
    }

    const loadChat = async () => {
        if (!chat) {
            draggable = false;
            chat = await getChatById(localStorage.token, id);
            draggable = true;
        }
    };

    let showShareChatModal = false;
    let confirmEdit = false;

    let chatTitle = title;

    const editChatTitle = async (id: string, title: string) => {
        if (title === '') {
            toast.error('Title cannot be an empty string.');
        } else {
            await updateChatById(localStorage.token, id, {
                title: title
            });

            if (id === $chatId) {
                _chatTitle.set(title);
            }

            currentChatPage.set(1);
            await chats.set(await getChatList(localStorage.token, $currentChatPage));

            dispatch('change');
        }
    };

    const cloneChatHandler = async (id: string) => {
        const res = await cloneChatById(localStorage.token, id, `Clone of ${title}`).catch(
            (error) => {
                toast.error(`${error}`);
                return null;
            }
        );

        if (res) {
            goto(`/c/${res.id}`);

            currentChatPage.set(1);
            await chats.set(await getChatList(localStorage.token, $currentChatPage));
        }
    };

    const deleteChatHandler = async (id: string) => {
        const res = await deleteChatById(localStorage.token, id).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        if (res) {
            if ($chatId === id) {
                await goto('/');

                await chatId.set('');
                await tick();
            }

            dispatch('change');
        }
    };

    const moveChatHandler = async (chatId: string, folderId: string) => {
        if (chatId && folderId) {
            const res = await updateChatFolderIdById(localStorage.token, chatId, folderId).catch(
                (error) => {
                    toast.error(`${error}`);
                    return null;
                }
            );

            if (res) {
                currentChatPage.set(1);
                await chats.set(await getChatList(localStorage.token, $currentChatPage));

                dispatch('change');

                toast.success('Chat moved successfully');
            }
        } else {
            toast.error('Failed to move chat');
        }
    };

    let itemElement: HTMLDivElement;

    let doubleClicked = false;

    let dragged = false;
    let x = 0;
    let y = 0;

    const dragImage = new Image();
    dragImage.src =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

    const onDragStart = (event: DragEvent) => {
        event.stopPropagation();

        event.dataTransfer!.setDragImage(dragImage, 0, 0);

        // Set the data to be transferred
        event.dataTransfer!.setData(
            'text/plain',
            JSON.stringify({
                type: 'chat',
                id: id,
                item: chat
            })
        );

        dragged = true;
        itemElement.style.opacity = '0.5'; // Optional: Visual cue to show it's being dragged
    };

    const onDrag = (event: DragEvent) => {
        event.stopPropagation();

        x = event.clientX;
        y = event.clientY;
    };

    const onDragEndHandler = (event: DragEvent) => {
        event.stopPropagation();

        itemElement.style.opacity = '1'; // Reset visual cue after drag
        dragged = false;

        onDragEnd(event);
    };

    const onClickOutside = (event: MouseEvent) => {
        if (!itemElement.contains(event.target as Node)) {
            if (confirmEdit) {
                if (chatTitle !== title) {
                    editChatTitle(id, chatTitle);
                }

                confirmEdit = false;
                chatTitle = '';
            }
        }
    };

    onMount(() => {
        if (itemElement) {
            document.addEventListener('click', onClickOutside, true);

            // Event listener for when dragging starts
            itemElement.addEventListener('dragstart', onDragStart);
            // Event listener for when dragging occurs (optional)
            itemElement.addEventListener('drag', onDrag);
            // Event listener for when dragging ends
            itemElement.addEventListener('dragend', onDragEndHandler);
        }
    });

    onDestroy(() => {
        if (itemElement) {
            document.removeEventListener('click', onClickOutside, true);

            itemElement.removeEventListener('dragstart', onDragStart);
            itemElement.removeEventListener('drag', onDrag);
            itemElement.removeEventListener('dragend', onDragEndHandler);
        }
    });

    let showDeleteConfirm = false;

    const chatTitleInputKeydownHandler = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            setTimeout(() => {
                const input = document.getElementById(`chat-title-input-${id}`);
                if (input) input.blur();
            }, 0);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            confirmEdit = false;
            chatTitle = '';
        }
    };

    const renameHandler = async () => {
        chatTitle = title;
        confirmEdit = true;

        await tick();

        setTimeout(() => {
            const input = document.getElementById(`chat-title-input-${id}`);
            if (input) {
                input.focus();
                (input as HTMLInputElement).select();
            }
        }, 0);
    };
</script>

<ShareChatModal bind:show={showShareChatModal} chatId={id} />

<DeleteConfirmDialog
    bind:show={showDeleteConfirm}
    title="Delete chat?"
    on:confirm={() => {
        deleteChatHandler(id);
    }}
>
    <div class=" text-sm text-gray-500 flex-1 line-clamp-3">
        {'This will delete'} <span class="  font-semibold">{title}</span>.
    </div>
</DeleteConfirmDialog>

{#if dragged && x && y}
    <DragGhost {x} {y}>
        <div class=" bg-black/80 backdrop-blur-2xl px-2 py-1 rounded-lg w-fit max-w-40">
            <div class="flex items-center gap-1">
                <Document className=" size-[18px]" strokeWidth="2" />
                <div class=" text-xs text-white line-clamp-1">
                    {title}
                </div>
            </div>
        </div>
    </DragGhost>
{/if}

<div
    id="sidebar-chat-group"
    bind:this={itemElement}
    class=" w-full {className} relative group"
    draggable={draggable && !confirmEdit}
>
    {#if confirmEdit}
        <div
            id="sidebar-chat-item"
            class=" w-full flex justify-between rounded-lg px-[11px] py-[6px] {id === $chatId ||
            confirmEdit
                ? 'bg-gray-100 dark:bg-gray-850 selected'
                : selected
                  ? 'bg-gray-100 dark:bg-gray-850/70 selected'
                  : 'group-hover:bg-gray-100 dark:group-hover:bg-gray-850/50'}  whitespace-nowrap text-ellipsis relative"
        >
            <input
                id="chat-title-input-{id}"
                bind:value={chatTitle}
                class=" bg-transparent w-full outline-hidden mr-10"
                placeholder={''}
                on:keydown={chatTitleInputKeydownHandler}
                on:blur={async (e) => {
                    if (doubleClicked) {
                        e.preventDefault();
                        e.stopPropagation();

                        await tick();
                        setTimeout(() => {
                            const input = document.getElementById(`chat-title-input-${id}`);
                            if (input) input.focus();
                        }, 0);

                        doubleClicked = false;
                        return;
                    }
                }}
            />
        </div>
    {:else}
        <a
            id="sidebar-chat-item"
            class=" w-full flex justify-between rounded-lg px-[11px] py-[6px] {id === $chatId ||
            confirmEdit
                ? 'bg-gray-100 dark:bg-gray-850 selected'
                : selected
                  ? 'bg-gray-100 dark:bg-gray-850/70 selected'
                  : ' group-hover:bg-gray-100 dark:group-hover:bg-gray-850/50'}  whitespace-nowrap text-ellipsis"
            href="/c/{id}"
            on:click={() => {
                dispatch('select');

                if ($selectedFolder) {
                    selectedFolder.set(null);
                }

                if ($mobile) {
                    showSidebar.set(false);
                }
            }}
            on:dblclick={async (e) => {
                e.preventDefault();
                e.stopPropagation();

                doubleClicked = true;
                renameHandler();
            }}
            on:mouseenter={(e) => {
                mouseOver = true;
            }}
            on:mouseleave={(e) => {
                mouseOver = false;
            }}
            on:focus={(e) => {}}
            draggable="false"
        >
            <div class=" flex self-center flex-1 w-full">
                <div
                    dir="auto"
                    class=" text-left self-center overflow-hidden w-full h-[20px] truncate"
                >
                    {title}
                </div>
            </div>
        </a>
    {/if}

    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        id="sidebar-chat-item-menu"
        class="
        {id === $chatId || confirmEdit
            ? 'from-gray-100 dark:from-gray-850 selected'
            : selected
              ? 'from-gray-100 dark:from-gray-850/70 selected'
              : 'invisible group-hover:visible from-gray-100 dark:from-gray-850/50'}
            absolute {className === 'pr-2'
            ? 'right-[8px]'
            : 'right-1'} top-[4px] py-1 pr-0.5 mr-1.5 pl-5 bg-linear-to-l from-80%

              to-transparent"
        on:mouseenter={(e) => {
            mouseOver = true;
        }}
        on:mouseleave={(e) => {
            mouseOver = false;
        }}
    >
        <div class="flex self-center z-10 items-end">
            <ChatMenu
                chatId={id}
                cloneChatHandler={() => {
                    cloneChatHandler(id);
                }}
                shareHandler={() => {
                    showShareChatModal = true;
                }}
                {moveChatHandler}
                {renameHandler}
                deleteHandler={() => {
                    showDeleteConfirm = true;
                }}
                onClose={() => {
                    dispatch('unselect');
                }}
                on:change={async () => {
                    dispatch('change');
                }}
                on:tag={(e) => {
                    dispatch('tag', e.detail);
                }}
            >
                <button
                    aria-label="Chat Menu"
                    class=" self-center dark:hover:text-white transition m-0"
                    on:click={() => {
                        dispatch('select');
                    }}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        class="w-4 h-4"
                    >
                        <path
                            d="M2 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM6.5 8a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0ZM12.5 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"
                        />
                    </svg>
                </button>
            </ChatMenu>
        </div>
    </div>
</div>
