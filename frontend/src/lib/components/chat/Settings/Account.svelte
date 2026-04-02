<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { onMount } from 'svelte';
    import { user, chats, scrollPaginationEnabled, currentChatPage } from '$lib/stores';
    import { updateUserProfile, getSessionUser } from '$lib/apis/auths';
    import { deleteAllChats, getAllChats, getChatList, importChats } from '$lib/apis/chats';
    import { getImportOrigin, convertOpenAIChats } from '$lib/utils';
    import { goto } from '$app/navigation';
    import { saveAs } from '$lib/utils';

    import UpdatePassword from './Account/UpdatePassword.svelte';

    export let saveHandler: Function;

    let loaded = false;

    let username = '';

    // Chat data management
    let importFiles: FileList | null = null;
    let showDeleteConfirm = false;
    let chatImportInputElement: HTMLInputElement;

    $: if (importFiles) {
        let reader = new FileReader();
        reader.onload = (event) => {
            if (!event.target) return;
            let chatsData = JSON.parse(event.target.result as string);
            if (getImportOrigin(chatsData) == 'openai') {
                try {
                    chatsData = convertOpenAIChats(chatsData);
                } catch (error) {
                    console.log('Unable to import chats:', error);
                }
            }
            importChatsHandler(chatsData);
        };
        if (importFiles.length > 0) {
            reader.readAsText(importFiles[0]);
        }
    }

    const importChatsHandler = async (_chats: any[]) => {
        const res = await importChats(
            localStorage.token,
            _chats.map((chat) => {
                if (chat.chat) {
                    return {
                        chat: chat.chat,
                        meta: chat.meta ?? {},
                        folder_id: chat?.folder_id ?? null,
                        created_at: chat?.created_at ?? null,
                        updated_at: chat?.updated_at ?? null
                    };
                } else {
                    return {
                        chat: chat,
                        meta: {},
                        folder_id: null,
                        created_at: chat?.created_at ?? null,
                        updated_at: chat?.updated_at ?? null
                    };
                }
            })
        );
        if (res) {
            toast.success(`Successfully imported ${res.length} chats.`);
        }
        currentChatPage.set(1);
        await chats.set(await getChatList(localStorage.token, $currentChatPage));
        scrollPaginationEnabled.set(true);
    };

    const exportChats = async () => {
        let blob = new Blob([JSON.stringify(await getAllChats(localStorage.token))], {
            type: 'application/json'
        });
        saveAs(blob, `chat-export-${Date.now()}.json`);
    };

    const deleteAllChatsHandler = async () => {
        await goto('/');
        await deleteAllChats(localStorage.token).catch((error) => {
            toast.error(`${error}`);
        });
        currentChatPage.set(1);
        await chats.set(await getChatList(localStorage.token, $currentChatPage));
        scrollPaginationEnabled.set(true);
    };

    const submitHandler = async () => {
        const updatedUser = await updateUserProfile(localStorage.token, {
            username: username
        }).catch((error) => {
            toast.error(`${error}`);
        });

        if (updatedUser) {
            // Get Session User Info
            const sessionUser = await getSessionUser(localStorage.token).catch((error) => {
                toast.error(`${error}`);
                return null;
            });

            user.set(sessionUser ?? undefined);
            return true;
        }
        return false;
    };

    onMount(async () => {
        const sessionUser = await getSessionUser(localStorage.token).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        if (sessionUser) {
            username = sessionUser?.username ?? '';
        }

        loaded = true;
    });
</script>

<div id="tab-account" class="flex flex-col h-full justify-between text-sm">
    <div class=" overflow-y-scroll max-h-[28rem] md:max-h-full">
        <div class="space-y-1">
            <div>
                <div class="text-base font-medium">{'Your Account'}</div>

                <div class="text-xs text-gray-500 mt-0.5">
                    {'Manage your account information.'}
                </div>
            </div>

            <div class="my-4">
                <div class="flex flex-col w-full">
                    <div class=" mb-1 text-xs font-medium">{'Username'}</div>

                    <div class="flex-1">
                        <input
                            class="w-full text-sm dark:text-gray-300 bg-transparent outline-hidden"
                            type="text"
                            bind:value={username}
                            required
                            placeholder="Enter your username"
                        />
                    </div>
                </div>

                <div class="mt-2">
                    <UpdatePassword />
                </div>
            </div>
        </div>

        <hr class="border-gray-50 dark:border-gray-850/30 my-4" />

        <div class="space-y-1">
            <div class="text-base font-medium">{'Chats'}</div>
            <div class="text-xs text-gray-500 mt-0.5">
                {'Import, export, or delete your chat history.'}
            </div>
        </div>

        <input
            id="chat-import-input"
            bind:this={chatImportInputElement}
            bind:files={importFiles}
            type="file"
            accept=".json"
            hidden
        />

        <div class="flex flex-col mt-2">
            <button
                class="flex rounded-md py-2 px-3.5 w-full hover:bg-gray-200 dark:hover:bg-gray-800 transition"
                on:click={() => {
                    chatImportInputElement.click();
                }}
            >
                <div class="self-center text-sm font-medium">{'Import Chats'}</div>
            </button>

            <button
                class="flex rounded-md py-2 px-3.5 w-full hover:bg-gray-200 dark:hover:bg-gray-800 transition"
                on:click={() => {
                    exportChats();
                }}
            >
                <div class="self-center text-sm font-medium">{'Export Chats'}</div>
            </button>

            {#if showDeleteConfirm}
                <div
                    class="flex justify-between rounded-md items-center py-2 px-3.5 w-full transition"
                >
                    <span>{'Are you sure?'}</span>
                    <div class="flex space-x-1.5 items-center">
                        <button
                            class="hover:text-white transition"
                            aria-label="Confirm delete"
                            on:click={() => {
                                deleteAllChatsHandler();
                                showDeleteConfirm = false;
                            }}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                class="w-4 h-4"
                                ><path
                                    fill-rule="evenodd"
                                    d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
                                    clip-rule="evenodd"
                                /></svg
                            >
                        </button>
                        <button
                            class="hover:text-white transition"
                            aria-label="Cancel delete"
                            on:click={() => {
                                showDeleteConfirm = false;
                            }}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                class="w-4 h-4"
                                ><path
                                    d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                                /></svg
                            >
                        </button>
                    </div>
                </div>
            {:else}
                <button
                    class="flex rounded-md py-2 px-3.5 w-full hover:bg-gray-200 dark:hover:bg-gray-800 transition"
                    on:click={() => {
                        showDeleteConfirm = true;
                    }}
                >
                    <div class="self-center text-sm font-medium">{'Delete All Chats'}</div>
                </button>
            {/if}
        </div>
    </div>

    <div class="flex justify-end pt-3 text-sm font-medium">
        <button
            class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
            on:click={async () => {
                const res = await submitHandler();

                if (res) {
                    saveHandler();
                }
            }}
        >
            {'Save'}
        </button>
    </div>
</div>
