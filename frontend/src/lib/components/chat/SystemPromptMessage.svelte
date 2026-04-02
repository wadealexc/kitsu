<script lang="ts">
    import { tick } from 'svelte';
    import { toast } from 'svelte-sonner';
    import { copyToClipboard } from '$lib/utils';
    import Terminal from '../icons/Terminal.svelte';
    import Pencil from '../icons/Pencil.svelte';
    import Clipboard from '../icons/Clipboard.svelte';
    import Check from '../icons/Check.svelte';
    import MessageEditor from './Messages/MessageEditor.svelte';

    export let systemPrompt: string = '';
    export let onSave: (content: string) => void = () => {};

    let edit = false;
    let copied = false;
    let editorRef: MessageEditor;

    const startEdit = async () => {
        edit = true;
        await tick();
        editorRef.activate(systemPrompt);
    };

    const cancelEdit = async () => {
        edit = false;
        await tick();
    };

    const copyPrompt = async () => {
        const res = await copyToClipboard(systemPrompt);
        if (res) {
            toast.success('Copying to clipboard was successful!');
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2000);
        }
    };
</script>

<div class="mx-auto max-w-3xl w-full px-4 mb-2">
    <!-- Bubble -->
    <div class="rounded-lg bg-gray-50 dark:bg-gray-800 px-5 py-3">
        <!-- Header -->
        <div
            class="flex items-center gap-2 mb-2 text-gray-500 dark:text-gray-400 text-xs font-medium"
        >
            <Terminal className="size-3.5" strokeWidth="1.5" />
            <span>system</span>
        </div>

        <!-- Edit mode -->
        {#if edit}
            <MessageEditor
                bind:this={editorRef}
                content={systemPrompt}
                primaryLabel="Save"
                containerClass=""
                scrollContainer={true}
                textareaClass="font-mono text-sm text-gray-800 dark:text-gray-200"
                on:confirm={({ detail }) => {
                    onSave(detail.content);
                    edit = false;
                }}
                on:cancel={cancelEdit}
            />
        {:else}
            <!-- View mode -->
            <div
                class="whitespace-pre-wrap font-mono text-sm text-gray-800 dark:text-gray-200 min-h-[1.5rem]"
            >
                {systemPrompt || '(empty)'}
            </div>
        {/if}
    </div>

    <!-- Action buttons — below the bubble, view mode only -->
    {#if !edit}
        <div class="flex items-center gap-0.5 mt-1 ml-1">
            <button
                class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition"
                title="Edit system prompt"
                on:click={startEdit}
            >
                <Pencil className="size-3.5" strokeWidth="1.5" />
            </button>
            <button
                class="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-black/5 dark:hover:bg-white/5 transition"
                title="Copy system prompt"
                on:click={copyPrompt}
            >
                {#if copied}
                    <Check className="size-3.5" strokeWidth="1.5" />
                {:else}
                    <Clipboard className="size-3.5" strokeWidth="1.5" />
                {/if}
            </button>
        </div>
    {/if}
</div>
