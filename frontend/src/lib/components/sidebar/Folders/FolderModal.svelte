<script lang="ts">
    import { tick } from 'svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import Modal from '$lib/components/common/Modal.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';

    import { toast } from 'svelte-sonner';
    import Textarea from '$lib/components/common/Textarea.svelte';
    import { getFolderById } from '$lib/apis/folders';
    import type { FolderData, FolderMeta, FolderModel } from '@backend/routes/types';
    export let show = false;
    export let onSubmit: (e: { name: string; meta: FolderMeta; data: FolderData }) => void = (
        e
    ) => {};

    export let folderId: string | null = null;
    export let edit = false;

    let folder: FolderModel | null = null;
    let name = '';
    let meta: FolderMeta = {};
    let data: FolderData = {
        systemPrompt: '',
        files: []
    };

    let loading = false;

    const submitHandler = async () => {
        loading = true;

        if ((data?.files ?? []).some((file) => file.status === 'uploading')) {
            toast.error('Please wait until all files are uploaded.');
            loading = false;
            return;
        }

        await onSubmit({
            name,
            meta,
            data
        });
        show = false;
        loading = false;
    };

    const init = async () => {
        if (folderId) {
            folder = await getFolderById(localStorage.token, folderId).catch((error) => {
                toast.error(`${error}`);
                return null;
            });

            if (!folder) return;

            name = folder.name;
            meta = folder.meta || {};
            data = folder.data || {
                systemPrompt: '',
                files: []
            };
        }

        focusInput();
    };

    const focusInput = async () => {
        await tick();
        const input = document.getElementById('folder-name') as HTMLInputElement;
        if (input) {
            input.focus();
            input.select();
        }
    };

    $: if (show) {
        init();
    }

    $: if (!show && !edit) {
        name = '';
        meta = {};
        data = {
            systemPrompt: '',
            files: []
        };
    }
</script>

<Modal size="md" bind:show>
    <div>
        <div class=" flex justify-between dark:text-gray-300 px-5 pt-4 pb-1">
            <div class=" text-lg font-medium self-center">
                {#if edit}
                    {'Edit Folder'}
                {:else}
                    {'Create Folder'}
                {/if}
            </div>
            <button
                class="self-center"
                on:click={() => {
                    show = false;
                }}
            >
                <XMark className="size-5" />
            </button>
        </div>

        <div class="flex flex-col md:flex-row w-full px-5 pb-4 md:space-x-4 dark:text-gray-200">
            <div class=" flex flex-col w-full sm:flex-row sm:justify-center sm:space-x-6">
                <form
                    class="flex flex-col w-full"
                    on:submit|preventDefault={() => {
                        submitHandler();
                    }}
                >
                    <div class="flex flex-col w-full mt-1">
                        <div class=" mb-1 text-xs text-gray-500">{'Folder Name'}</div>

                        <div class="flex-1">
                            <input
                                id="folder-name"
                                class="w-full text-sm bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-700 outline-hidden"
                                type="text"
                                bind:value={name}
                                placeholder="Enter folder name"
                                autocomplete="off"
                            />
                        </div>
                    </div>

                    <hr class=" border-gray-50 dark:border-gray-850/30 my-2.5 w-full" />

                    <div class="my-1">
                        <div class="mb-2 text-xs text-gray-500">{'System Prompt'}</div>
                        <div>
                            <Textarea
                                className=" text-sm w-full bg-transparent outline-hidden "
                                placeholder={'Write your model system prompt content here\ne.g.) You are Mario from Super Mario Bros, acting as an assistant.'}
                                maxSize={200}
                                bind:value={data.systemPrompt}
                            />
                        </div>
                    </div>

                    <div class="flex justify-end pt-3 text-sm font-medium gap-1.5">
                        <button
                            class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-950 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full flex flex-row space-x-1 items-center {loading
                                ? ' cursor-not-allowed'
                                : ''}"
                            type="submit"
                            disabled={loading}
                        >
                            {'Save'}

                            {#if loading}
                                <div class="ml-2 self-center">
                                    <Spinner />
                                </div>
                            {/if}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
</Modal>
