<script lang="ts">
    /**
     * The raw view: what the next message would send to the inference server, as the
     * backend builds it. Only editing shows the system prompt's unfilled template.
     */
    import { tick } from 'svelte';
    import { toast } from 'svelte-sonner';
    import type { CompletionPreview } from '@backend/routes/types';
    import type { ContentPart, Message, ToolDefinition } from '@backend/protocol/index.js';
    import { copyToClipboard } from '$lib/utils';
    import Terminal from '../icons/Terminal.svelte';
    import Pencil from '../icons/Pencil.svelte';
    import Clipboard from '../icons/Clipboard.svelte';
    import Check from '../icons/Check.svelte';
    import ChevronDown from '../icons/ChevronDown.svelte';
    import ChevronUp from '../icons/ChevronUp.svelte';
    import Spinner from '../common/Spinner.svelte';
    import MessageEditor from './Messages/MessageEditor.svelte';

    /** The template, as the user wrote it. */
    export let systemPrompt: string = '';
    export let preview: CompletionPreview | null = null;
    export let error = '';
    export let onSave: (content: string) => void = () => {};

    let edit = false;
    let copied = false;
    let editorRef: MessageEditor;
    let toolsOpen = false;
    let openTools = new Set<string>();

    $: first = preview?.request.messages[0];
    $: renderedSystem = typeof first?.content === 'string' ? first.content : systemPrompt;
    $: conversation = (preview?.request.messages ?? []).slice(1);
    $: tools = (preview?.request.tools ?? []) as ToolDefinition[];
    $: modelSettings = (() => {
        if (!preview) return [];
        const { messages: _messages, tools: _tools, model: _model, ...rest } = preview.request;
        return Object.entries(rest).map(([key, value]) => ({ key, value: typeof value === 'object' ? JSON.stringify(value) : String(value) }));
    })();
    let modelOpen = false;

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
        const res = await copyToClipboard(renderedSystem);
        if (res) {
            toast.success('Copying to clipboard was successful!');
            copied = true;
            setTimeout(() => {
                copied = false;
            }, 2000);
        }
    };

    const toggleTool = (name: string) => {
        if (openTools.has(name)) openTools.delete(name);
        else openTools.add(name);
        openTools = openTools;
    };

    /** Text with the hidden notes picked out. */
    const noteParts = (text: string) =>
        text
            .split(/(<kitsu-note>[\s\S]*?<\/kitsu-note>)/)
            .filter(Boolean)
            .map((part) => ({ text: part, note: part.startsWith('<kitsu-note>') }));

    const pretty = (json: string) => {
        try {
            return JSON.stringify(JSON.parse(json || '{}'), null, 2);
        } catch {
            return json;
        }
    };

    const partsOf = (message: Message): ContentPart[] =>
        typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : ((message.content ?? []) as ContentPart[]);

    const bubble = 'rounded-lg bg-gray-50 dark:bg-gray-800 px-5 py-3';
    const label = 'flex items-center gap-2 mb-2 text-gray-500 dark:text-gray-400 text-xs font-medium';
    const body = 'whitespace-pre-wrap break-words font-mono text-xs leading-5 text-gray-800 dark:text-gray-200';
    const scroll = 'max-h-96 overflow-y-auto';
</script>

<div class="mx-auto max-w-3xl w-full px-4 mb-2 flex flex-col gap-2">
    <div>
        <div class={bubble}>
            <div class={label}>
                <Terminal className="size-3.5" strokeWidth="1.5" />
                <span>system</span>
            </div>

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
                <div class="{body} min-h-[1.5rem]">{renderedSystem || '(empty)'}</div>
            {/if}
        </div>

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

    {#if error}
        <div class="px-3 py-2 text-xs text-red-600 dark:text-red-300 bg-red-500/10 rounded-lg">{error}</div>
    {:else if !preview}
        <div class="flex justify-center py-4"><Spinner className="size-4" /></div>
    {:else}
        <div class={bubble}>
            <button class="{label} !mb-0 w-full" on:click={() => (modelOpen = !modelOpen)} aria-expanded={modelOpen}>
                <span>model: <span class="font-mono">{preview.request.model}</span></span>
                {#if modelOpen}<ChevronUp strokeWidth="3" className="size-3" />{:else}<ChevronDown strokeWidth="3" className="size-3" />{/if}
            </button>
            {#if modelOpen}
                <div class="mt-2 flex flex-col gap-0.5">
                    {#each modelSettings as setting (setting.key)}
                        <div class="{body} flex gap-2"><span class="text-gray-500 dark:text-gray-400 shrink-0">{setting.key}</span><span class="min-w-0">{setting.value}</span></div>
                    {/each}
                </div>
            {/if}
        </div>

        <div class={bubble}>
            <button class="{label} !mb-0 w-full" on:click={() => (toolsOpen = !toolsOpen)} aria-expanded={toolsOpen}>
                <span>tools · {tools.length}</span>
                {#if toolsOpen}<ChevronUp strokeWidth="3" className="size-3" />{:else}<ChevronDown strokeWidth="3" className="size-3" />{/if}
            </button>
            {#if toolsOpen}
                <div class="mt-2 -mx-2 flex flex-col gap-0.5">
                    {#each tools as tool (tool.function.name)}
                        <div>
                            <button
                                class="w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 font-mono text-xs text-gray-800 dark:text-gray-200 text-left bg-black/[0.03] dark:bg-white/[0.04] hover:bg-black/[0.07] dark:hover:bg-white/[0.09] transition-colors"
                                aria-expanded={openTools.has(tool.function.name)}
                                on:click={() => toggleTool(tool.function.name)}
                            >
                                <span class="truncate min-w-0">{tool.function.name}</span>
                                <span class="shrink-0 text-gray-500 dark:text-gray-400">
                                    {#if openTools.has(tool.function.name)}<ChevronUp strokeWidth="3" className="size-3" />{:else}<ChevronDown strokeWidth="3" className="size-3" />{/if}
                                </span>
                            </button>
                            {#if openTools.has(tool.function.name)}
                                <div class="{body} mt-1 mb-1 mx-2 ps-3 border-s-2 border-dotted border-s-gray-200 dark:border-gray-700">{tool.function.description ?? ''}

{JSON.stringify(tool.function.parameters ?? {}, null, 2)}</div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        {#each conversation as message, i}
            <div class={bubble}>
                <div class={label}>
                    <span>{message.role}</span>
                    {#if message.role === 'user' && conversation[i - 1]?.role === 'tool'}
                        <span class="text-amber-600 dark:text-amber-400">added by kitsu</span>
                    {/if}
                </div>

                {#if message.role === 'assistant' && message.reasoning_content}
                    <div class="{body} {scroll} !text-gray-500 dark:!text-gray-400 mb-2 ps-3 border-s-2 border-dotted border-s-gray-200 dark:border-gray-700">{message.reasoning_content}</div>
                {/if}

                <div class={scroll}>
                    {#each partsOf(message) as part}
                        {#if part.type === 'text'}
                            {#if part.text}
                                <div class={body}>{#each noteParts(part.text) as piece}<span class={piece.note ? 'text-amber-600 dark:text-amber-400' : ''}>{piece.text}</span>{/each}</div>
                            {/if}
                        {:else if part.type === 'image_url'}
                            <img src={part.image_url.url} alt="Sent to the model" class="max-h-40 max-w-full rounded mt-1" />
                        {/if}
                    {/each}
                </div>

                {#if message.role === 'assistant' && message.tool_calls?.length}
                    <div class="mt-1 flex flex-col gap-1.5">
                        {#each message.tool_calls as call}
                            <div class="{body} {scroll} text-sky-700 dark:text-sky-300">{call.function.name} {pretty(call.function.arguments)}</div>
                        {/each}
                    </div>
                {/if}
            </div>
        {/each}

        {#if preview.nextMessageNotes}
            <div class={bubble}>
                <div class={label}><span>added to your next message</span></div>
                <div class="{body} text-amber-600 dark:text-amber-400">{preview.nextMessageNotes}</div>
            </div>
        {/if}
    {/if}
</div>
