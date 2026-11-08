<script lang="ts">
    import { onDestroy } from 'svelte';
    import { toast } from 'svelte-sonner';

    import { mobile } from '$lib/stores';
    import { saveAs } from '$lib/utils';
    import {
        deleteSandboxFile,
        fetchSandboxFile,
        getSandboxStatus,
        listSandboxFiles,
        uploadSandboxFile,
        type SandboxEntry,
        type SandboxStatus
    } from '$lib/apis/sandbox';

    import Spinner from '../common/Spinner.svelte';
    import PdfPreview from './PdfPreview.svelte';
    import ChevronLeft from '../icons/ChevronLeft.svelte';
    import Document from '../icons/Document.svelte';
    import Download from '../icons/Download.svelte';
    import Folder from '../icons/Folder.svelte';
    import GarbageBin from '../icons/GarbageBin.svelte';
    import Plus from '../icons/Plus.svelte';
    import XMark from '../icons/XMark.svelte';

    /** Empty until the chat has an id: see ensureChatId. */
    export let chatId: string;
    /** Goes up when something in the workspace may have changed. */
    export let refresh = 0;
    export let onClose: () => void;
    /** A new chat gets its id when the first file is added. */
    export let ensureChatId: () => string;
    export let onUploaded: (names: string[]) => void = () => {};

    const IMAGE_TYPES: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        bmp: 'image/bmp',
        // Safe as an image: scripts in an SVG don't run when it's shown through <img>.
        svg: 'image/svg+xml'
    };
    const MAX_TEXT_PREVIEW_BYTES = 200_000;
    const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;

    let path = '.';
    let entries: SandboxEntry[] = [];
    let status: SandboxStatus | null = null;
    let loading = false;
    let uploading = 0;
    let dragging = false;
    let fileInput: HTMLInputElement;

    type Preview =
        | { kind: 'image'; entry: SandboxEntry; url: string }
        | { kind: 'text'; entry: SandboxEntry; text: string; cut: boolean }
        | { kind: 'none'; entry: SandboxEntry }
        | { kind: 'loading'; entry: SandboxEntry };
    let preview: Preview | null = null;
    let previewUrl: string | null = null;
    /** PDFs open over the whole page: the panel is too narrow to read one. */
    let fullPdf: { entry: SandboxEntry; blob: Blob } | null = null;

    const join = (name: string) => (path === '.' ? name : `${path}/${name}`);
    $: inFolder = path !== '.';
    $: folderName = path.split('/').at(-1) ?? '';
    const goUp = () => {
        const parts = path.split('/');
        path = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    };

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    };

    let loadSeq = 0;
    const load = async (id: string, at: string) => {
        const mine = ++loadSeq;
        if (!id) {
            entries = [];
            status = null;
            return;
        }
        loading = true;
        try {
            const [listing, current] = await Promise.all([
                listSandboxFiles(localStorage.token, id, at),
                getSandboxStatus(localStorage.token, id)
            ]);
            if (mine !== loadSeq) return;
            entries = listing.entries;
            status = current;
        } catch (err) {
            if (mine === loadSeq) toast.error(`${err}`);
        } finally {
            if (mine === loadSeq) loading = false;
        }
    };

    $: void refresh, load(chatId, path);

    const clearPreview = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = null;
        preview = null;
        fullPdf = null;
    };
    onDestroy(clearPreview);

    // A different chat starts back at the top of its own workspace.
    let shownChat = chatId;
    $: if (chatId !== shownChat) {
        shownChat = chatId;
        path = '.';
        clearPreview();
    }

    const open = async (entry: SandboxEntry) => {
        if (entry.type === 'dir') {
            path = join(entry.name);
            return;
        }

        clearPreview();
        const file = join(entry.name);
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
        const imageType = IMAGE_TYPES[ext];
        if (entry.size > MAX_PREVIEW_BYTES) {
            preview = { kind: 'none', entry };
            return;
        }

        preview = { kind: 'loading', entry };
        try {
            const blob = await fetchSandboxFile(localStorage.token, chatId, file);
            if (imageType) {
                previewUrl = URL.createObjectURL(new Blob([blob], { type: imageType }));
                preview = { kind: 'image', entry, url: previewUrl };
                return;
            }
            if (ext === 'pdf') {
                preview = null;
                fullPdf = { entry, blob };
                return;
            }
            // Text only, shown as text: an HTML file made in here must never be rendered.
            const head = new Uint8Array(await blob.slice(0, MAX_TEXT_PREVIEW_BYTES).arrayBuffer());
            if (head.includes(0)) {
                preview = { kind: 'none', entry };
                return;
            }
            preview = {
                kind: 'text',
                entry,
                text: new TextDecoder().decode(head),
                cut: blob.size > MAX_TEXT_PREVIEW_BYTES
            };
        } catch (err) {
            toast.error(`${err}`);
            preview = null;
        }
    };

    const download = async (entry: SandboxEntry) => {
        try {
            saveAs(await fetchSandboxFile(localStorage.token, chatId, join(entry.name)), entry.name);
        } catch (err) {
            toast.error(`${err}`);
        }
    };

    const remove = async (entry: SandboxEntry) => {
        if (!confirm(`Delete ${entry.name}${entry.type === 'dir' ? ' and everything in it' : ''}?`)) return;
        try {
            await deleteSandboxFile(localStorage.token, chatId, join(entry.name));
            clearPreview();
            await load(chatId, path);
        } catch (err) {
            toast.error(`${err}`);
        }
    };

    const upload = async (files: FileList | File[]) => {
        const list = [...files];
        if (list.length === 0) return;

        const id = ensureChatId();
        uploading += list.length;
        const added: string[] = [];
        await Promise.all(
            list.map(async (file) => {
                const target = join(file.name);
                try {
                    await uploadSandboxFile(localStorage.token, id, target, file);
                    added.push(target);
                } catch (err) {
                    toast.error(`${file.name}: ${err}`);
                } finally {
                    uploading -= 1;
                }
            })
        );
        if (added.length) onUploaded(added);
        await load(id, path);
    };

    /** Moves the panel to the top of the page on phones, to cover the whole screen. */
    function coverScreen(node: HTMLElement, cover: boolean) {
        if (cover) document.body.appendChild(node);
        return {
            destroy() {
                if (cover) node.remove();
            }
        };
    }

    const iconButton =
        'p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200 transition';
</script>

<svelte:window on:keydown={(e) => e.key === 'Escape' && fullPdf && (fullPdf = null)} />

{#if fullPdf}
    {@const shown = fullPdf.entry}
    <div
        use:coverScreen={true}
        role="dialog"
        aria-modal="true"
        aria-label={shown.name}
        class="fixed inset-0 z-50 flex flex-col bg-gray-100 dark:bg-gray-950 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
        <div class="flex items-center gap-1 px-3 h-12 shrink-0">
            <div class="font-medium text-sm truncate min-w-0 pl-1">{shown.name}</div>
            <div class="ml-auto flex items-center shrink-0">
                <button class={iconButton} aria-label="Download" on:click={() => download(shown)}>
                    <Download className="size-4" />
                </button>
                <button class={iconButton} aria-label="Close PDF" on:click={() => (fullPdf = null)}>
                    <XMark className="size-4" />
                </button>
            </div>
        </div>
        <div class="flex-1 min-h-0 overflow-auto px-2 pb-3">
            {#key fullPdf.blob}
                <PdfPreview blob={fullPdf.blob} />
            {/key}
        </div>
    </div>
{/if}

<!-- svelte-ignore a11y-no-static-element-interactions -->
<aside
    use:coverScreen={$mobile}
    aria-label="Workspace"
    class={$mobile
        ? 'fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]'
        : 'relative shrink-0 w-[380px] max-w-[45%] h-full flex flex-col border-l border-gray-100 dark:border-gray-850 bg-white dark:bg-gray-900'}
    on:dragover|preventDefault={() => (dragging = true)}
    on:dragleave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) dragging = false;
    }}
    on:drop|preventDefault={(e) => {
        dragging = false;
        if (e.dataTransfer?.files) void upload(e.dataTransfer.files);
    }}
>
    <div class="flex items-center gap-1 px-3 h-12 shrink-0">
        {#if preview}
            <button class={iconButton} aria-label="Back to files" on:click={clearPreview}>
                <ChevronLeft className="size-4" />
            </button>
            <div class="font-medium text-sm truncate min-w-0">{preview.entry.name}</div>
            <div class="ml-auto flex items-center shrink-0">
                {#if preview}
                    {@const shown = preview.entry}
                    <button class={iconButton} aria-label="Download" on:click={() => download(shown)}>
                        <Download className="size-4" />
                    </button>
                    <button class={iconButton} aria-label="Delete" on:click={() => remove(shown)}>
                        <GarbageBin className="size-4" />
                    </button>
                {/if}
            </div>
        {:else}
            {#if inFolder}
                <button class={iconButton} aria-label="Back" on:click={goUp}>
                    <ChevronLeft className="size-4" />
                </button>
                <div class="font-medium text-sm truncate min-w-0">{folderName}</div>
            {:else}
                <div class="font-medium text-sm">Workspace</div>
            {/if}
            {#if status?.exists && !inFolder}
                <div class="text-xs text-gray-500 dark:text-gray-400 ml-1 {status.overLimit ? 'text-red-500 dark:text-red-400' : ''}">
                    {formatSize(status.sizeBytes)} of {formatSize(status.limitBytes)}
                </div>
            {/if}
            <div class="ml-auto flex items-center shrink-0">
                {#if loading || uploading > 0}<Spinner className="size-4 mr-1" />{/if}
                <button class={iconButton} aria-label="Add files" on:click={() => fileInput.click()}>
                    <Plus className="size-4" />
                </button>
            </div>
        {/if}
        <button class={iconButton} aria-label="Close workspace" on:click={onClose}>
            <XMark className="size-4" />
        </button>
    </div>

    <input
        bind:this={fileInput}
        type="file"
        multiple
        hidden
        on:change={(e) => {
            if (e.currentTarget.files) void upload(e.currentTarget.files);
            e.currentTarget.value = '';
        }}
    />

    {#if preview}
        <div class="flex-1 min-h-0 overflow-auto px-3 pb-3">
            {#if preview.kind === 'loading'}
                <div class="flex justify-center py-8"><Spinner className="size-5" /></div>
            {:else if preview.kind === 'image'}
                <img src={preview.url} alt={preview.entry.name} class="max-w-full h-auto rounded-lg" />
            {:else if preview.kind === 'text'}
                <pre class="text-xs whitespace-pre-wrap break-words font-mono">{preview.text}</pre>
                {#if preview.cut}
                    <div class="text-xs text-gray-500 dark:text-gray-400 mt-2">Only the start is shown. Download it for the rest.</div>
                {/if}
            {:else}
                <div class="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">No preview for this file.</div>
            {/if}
        </div>
    {:else}
        <div class="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
            {#if entries.length === 0 && !loading}
                <button
                    class="w-full text-sm text-gray-500 dark:text-gray-400 py-10 px-4 text-center"
                    on:click={() => fileInput.click()}
                >
                    {inFolder ? 'This folder is empty.' : 'No files yet. Tap to add some, or ask the model to make them.'}
                </button>
            {/if}
            {#each entries as entry (entry.name)}
                <div class="group flex items-center rounded-lg hover:bg-gray-50 dark:hover:bg-gray-850">
                    <button class="flex-1 min-w-0 flex items-center gap-2 text-left px-1.5 py-2" on:click={() => open(entry)}>
                        {#if entry.type === 'dir'}
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" class="size-4.5 shrink-0 text-amber-400 dark:text-amber-300">
                                <path d="M3 6.75A2.25 2.25 0 0 1 5.25 4.5h3.88c.6 0 1.17.24 1.59.66l1.06 1.06c.14.14.33.22.53.22h6.44A2.25 2.25 0 0 1 21 8.69v8.56a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 17.25V6.75Z" />
                            </svg>
                        {:else}
                            <span class="shrink-0 text-gray-400 dark:text-gray-500"><Document className="size-4.5" /></span>
                        {/if}
                        <span class="text-sm truncate min-w-0">{entry.name}</span>
                        {#if entry.type !== 'dir'}
                            <span class="ml-auto pl-2 text-xs text-gray-500 dark:text-gray-400 shrink-0">{formatSize(entry.size)}</span>
                        {/if}
                    </button>
                    {#if entry.type === 'file'}
                        <button class="{iconButton} shrink-0" aria-label={`Download ${entry.name}`} on:click={() => download(entry)}>
                            <Download className="size-4" />
                        </button>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}

    {#if dragging}
        <div class="absolute inset-0 flex items-center justify-center bg-sky-50/90 dark:bg-gray-900/90 border-2 border-dashed border-sky-400 rounded-lg m-1 text-sm pointer-events-none">
            Drop files to add them
        </div>
    {/if}
</aside>
