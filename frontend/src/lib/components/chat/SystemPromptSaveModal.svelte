<script lang="ts">
    import { temporaryChatEnabled } from '$lib/stores';
    import type { FolderModel, ModelResponse } from '@backend/routes/types';
    import type { SessionUser } from '$lib/stores';
    import Modal from '$lib/components/common/Modal.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';

    export let show = false;
    export let systemPrompt: string = '';
    export let folder: FolderModel | null = null;
    export let model: ModelResponse | null = null;
    export let user: SessionUser | undefined = undefined;
    export let onSave: (data: { target: SaveTarget; prompt: string }) => void = () => {};

    type SaveTarget = 'chat' | 'folder' | 'model' | 'new-model';

    const save = (target: SaveTarget) => {
        onSave({ target, prompt: systemPrompt });
    };
</script>

<Modal size="sm" bind:show>
    <div>
        <div class="flex justify-between dark:text-gray-300 px-5 pt-4 pb-1">
            <div class="text-lg font-medium self-center">{'Save System Prompt'}</div>
            <button class="self-center" on:click={() => (show = false)}>
                <XMark className="size-5" />
            </button>
        </div>

        <div class="flex flex-col px-5 pb-5 gap-2 text-sm dark:text-gray-200">
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {'Save this system prompt to…'}
            </p>

            {#if !$temporaryChatEnabled}
                <button
                    class="w-full text-left px-4 py-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    on:click={() => save('chat')}
                >
                    <div class="font-medium">{'This chat only'}</div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {'Overrides the prompt for this conversation'}
                    </div>
                </button>
            {/if}

            {#if folder !== null}
                <button
                    class="w-full text-left px-4 py-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    on:click={() => save('folder')}
                >
                    <div class="font-medium">{'All chats in this folder'}</div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {`Applied to all chats in "${folder.name}"`}
                    </div>
                </button>
            {/if}

            {#if model !== null && model.userId === user?.id}
                <button
                    class="w-full text-left px-4 py-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    on:click={() => save('model')}
                >
                    <div class="font-medium">{`Update "${model.name}"`}</div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {'Changes the default prompt for this model'}
                    </div>
                    {#if model.isPublic}
                        <div class="text-xs text-amber-500 dark:text-amber-400 mt-1">
                            {'This will affect all users of this model.'}
                        </div>
                    {/if}
                </button>
            {/if}

            {#if model !== null}
                <button
                    class="w-full text-left px-4 py-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                    on:click={() => save('new-model')}
                >
                    <div class="font-medium">{'New custom model'}</div>
                    <div class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {`Creates "${model.name} (Custom)" with this prompt`}
                    </div>
                </button>
            {/if}
        </div>
    </div>
</Modal>
