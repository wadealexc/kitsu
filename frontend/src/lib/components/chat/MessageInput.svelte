<script lang="ts">
    import { uuid } from '$lib/utils/uuid';
    import { toast } from 'svelte-sonner';

    import { onMount, tick, createEventDispatcher, onDestroy } from 'svelte';
    const dispatch = createEventDispatcher();

    import {
        mobile,
        settings,
        showSidebar,
        streamContext,
        user as _user,
        temporaryChatEnabled,
        toolServers
    } from '$lib/stores';

    import { convertHeicToJpeg, dataUrlToBlobUrl } from '$lib/utils';
    import { caretAt, focusWithoutPan, isIOS, keyboardOpen } from '$lib/utils/iosKeyboard';
    import { extractFile } from '$lib/apis/files';

    import InputMenu from './MessageInput/InputMenu.svelte';
    import FilesOverlay from './MessageInput/FilesOverlay.svelte';
    import RichTextInput from './MessageInput/RichTextInput.svelte';
    import Tooltip from '../common/Tooltip.svelte';
    import FileItem from './Messages/FileItem.svelte';
    import Image from '../common/Image.svelte';
    import TypingIndicator from './MessageInput/TypingIndicator.svelte';
    import ChevronDown from '../icons/ChevronDown.svelte';

    import GlobeAlt from '../icons/GlobeAlt.svelte';
    import Wrench from '../icons/Wrench.svelte';
    import AdjustmentsHorizontal from '../icons/AdjustmentsHorizontal.svelte';
    import Clip from '../icons/Clip.svelte';

    import type { ChatHistory, ChatMessageFile } from '@backend/routes/types';

    export let onChange: (data: {
        prompt: string;
        files: ChatMessageFile[];
        disabledToolServers: string[];
    }) => void = () => {};

    export let stopResponse: () => void;

    export let showScrollButton: boolean = false;
    export let onScrollToBottomClick: () => void = () => {};
    export let generating = false;

    export let history: ChatHistory;

    export let prompt = '';
    export let files: ChatMessageFile[] = [];

    /** MCP servers whose tools are turned off for this chat */
    export let disabledToolServers: string[] = [];

    // Servers that offer tools, each with its own switch
    $: switchableServers = $toolServers.filter((s) => s.enabled && s.tools.length > 0);
    const toggleServer = (id: string) => {
        disabledToolServers = disabledToolServers.includes(id)
            ? disabledToolServers.filter((s) => s !== id)
            : [...disabledToolServers, id];
    };
    const isWebServer = (name: string) => /web|search|browse/i.test(name);
    export let systemPromptVisible = false;

    type PendingFile = { id: string; name: string; size: number };
    let pendingFiles: PendingFile[] = [];

    $: extractingFiles = pendingFiles.length > 0;

    $: onChange({
        prompt,
        files: files.filter((file) => file.kind !== 'image'),
        disabledToolServers
    });

    $: submitDisabled = (prompt === '' && files.length === 0) || extractingFiles;

    // iOS: a tap in the message box (not its buttons) focuses the editor without the
    // whole app sliding up while the keyboard opens. See iosKeyboard.ts.
    const onComposerTouchEnd = (e: TouchEvent) => {
        const editor = document.getElementById('chat-input');
        // The editor may already have focus without a keyboard (kitsu focuses it
        // on load, which on iOS doesn't open one), so check the keyboard instead.
        if (!editor || !isIOS() || keyboardOpen()) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, label, select, [role=button]')) return;

        e.preventDefault();
        const touch = e.changedTouches[0];
        const caret = caretAt(touch?.clientX ?? -1, touch?.clientY ?? -1, editor);
        focusWithoutPan(editor, { moved: e.currentTarget as HTMLElement, caret, slide: true });
    };

    export const setText = async (text?: string): Promise<void> => {
        const chatInput = document.getElementById('chat-input');

        if (chatInput) {
            chatInputElement?.setText(text || '');
            if (!$mobile) chatInputElement?.focus();

            await tick();
        }
    };

    let isComposing = false;
    // Safari has a bug where compositionend is not triggered correctly #16615
    // when using the virtual keyboard on iOS.
    let compositionEndedAt = -2e8;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    function inOrNearComposition(event: Event): boolean {
        if (isComposing) {
            return true;
        }
        // See https://www.stum.de/2016/06/24/handling-ime-events-in-javascript/.
        // On Japanese input method editors (IMEs), the Enter key is used to confirm character
        // selection. On Safari, when Enter is pressed, compositionend and keydown events are
        // emitted. The keydown event triggers newline insertion, which we don't want.
        // This method returns true if the keydown event should be ignored.
        // We only ignore it once, as pressing Enter a second time *should* insert a newline.
        // Furthermore, the keydown event timestamp must be close to the compositionEndedAt timestamp.
        // This guards against the case where compositionend is triggered without the keyboard
        // (e.g. character confirmation may be done with the mouse), and keydown is triggered
        // afterwards- we wouldn't want to ignore the keydown event in this case.
        if (isSafari && Math.abs(event.timeStamp - compositionEndedAt) < 500) {
            compositionEndedAt = -2e8;
            return true;
        }
        return false;
    }

    let chatInputElement: RichTextInput;

    let filesInputElement: HTMLInputElement;

    let inputFiles: FileList | undefined;

    let dragged = false;

    export let placeholder = '';

    // TODO - we don't need this.
    const screenCaptureHandler = async (): Promise<void> => {
        try {
            const mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });
            const video = document.createElement('video');
            video.srcObject = mediaStream;
            await video.play();
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (!context) return;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            mediaStream.getTracks().forEach((track) => track.stop());

            window.focus();

            const imageUrl = canvas.toDataURL('image/png');
            const blob = await (await fetch(imageUrl)).blob();
            const file = new File([blob], `screen-capture-${Date.now()}.png`, {
                type: 'image/png'
            });
            inputFilesHandler([file]);
            video.srcObject = null;
        } catch (error) {
            console.error('Error capturing screen:', error);
        }
    };

    const inputFilesHandler = async (inputFiles: File[]): Promise<void> => {
        for (const file of inputFiles) {
            if (file.size === 0) {
                toast.error('File is empty, skipping.');
                continue;
            }

            const pendingId = uuid();
            pendingFiles = [...pendingFiles, { id: pendingId, name: file.name, size: file.size }];

            try {
                const converted = file.type === 'image/heic' ? await convertHeicToJpeg(file) : file;
                const processedFile = Array.isArray(converted) ? converted[0]! : converted;
                const extracted = await extractFile(localStorage.token, processedFile as File);
                files = [...files, extracted];
            } catch (e) {
                toast.error(`${e}`);
            } finally {
                pendingFiles = pendingFiles.filter((p) => p.id !== pendingId);
            }
        }
    };

    const onDragOver = (e: DragEvent): void => {
        e.preventDefault();

        // Check if a file is being dragged.
        if (e.dataTransfer?.types?.includes('Files')) {
            dragged = true;
        } else {
            dragged = false;
        }
    };

    const onDragLeave = () => {
        dragged = false;
    };

    const onDrop = async (e: DragEvent): Promise<void> => {
        e.preventDefault();

        if (e.dataTransfer?.files) {
            const inputFiles = Array.from(e.dataTransfer.files);
            if (inputFiles && inputFiles.length > 0) {
                inputFilesHandler(inputFiles);
            }
        }

        dragged = false;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            dragged = false;
        }
    };

    onMount(async () => {
        window.setTimeout(() => {
            const chatInput = document.getElementById('chat-input');
            chatInput?.focus();
        }, 0);

        window.addEventListener('keydown', onKeyDown);

        await tick();

        const dropzoneElement = document.getElementById('chat-container');

        dropzoneElement?.addEventListener('dragover', onDragOver);
        dropzoneElement?.addEventListener('drop', onDrop);
        dropzoneElement?.addEventListener('dragleave', onDragLeave);
    });

    // Blur active element when sidebar opens so the keyboard dismisses
    $: if ($showSidebar) {
        (document.activeElement as HTMLElement)?.blur();
    }

    onDestroy(() => {
        window.removeEventListener('keydown', onKeyDown);

        const dropzoneElement = document.getElementById('chat-container');

        if (dropzoneElement) {
            dropzoneElement?.removeEventListener('dragover', onDragOver);
            dropzoneElement?.removeEventListener('drop', onDrop);
            dropzoneElement?.removeEventListener('dragleave', onDragLeave);
        }
    });
</script>

<FilesOverlay show={dragged} />

<div class="w-full font-primary">
    <div class=" mx-auto inset-x-0 bg-transparent flex justify-center">
        <div class="flex flex-col px-3 max-w-6xl w-full">
            <div class="relative">
                {#if showScrollButton}
                    <div
                        class=" absolute -top-8 left-0 right-0 flex justify-center z-30 pointer-events-none"
                    >
                        {#if generating}
                            <!-- Typing indicator (clickable - scrolls to bottom) -->
                            <button
                                class="bg-gray-50 dark:bg-gray-800 border border-white/50 px-3 py-1.75 rounded-full pointer-events-auto"
                                aria-label="scroll to bottom"
                                on:click={onScrollToBottomClick}
                            >
                                <TypingIndicator />
                            </button>
                        {:else}
                            <!-- Scroll-to-bottom button -->
                            <button
                                class="bg-gray-50 dark:bg-gray-800 border border-white/50 px-4 py-0.25 rounded-full pointer-events-auto"
                                aria-label="scroll to bottom"
                                on:click={onScrollToBottomClick}
                            >
                                <ChevronDown className="w-4 h-4" strokeWidth="2" />
                            </button>
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    <div class="bg-transparent">
        <div class="max-w-6xl px-2.5 mx-auto inset-x-0">
            <div class="">
                <input
                    bind:this={filesInputElement}
                    bind:files={inputFiles}
                    type="file"
                    hidden
                    multiple
                    on:change={async () => {
                        if (inputFiles && inputFiles.length > 0) {
                            const _inputFiles = Array.from(inputFiles);
                            inputFilesHandler(_inputFiles);
                        } else {
                            toast.error(`File not found.`);
                        }

                        filesInputElement.value = '';
                    }}
                />

                <form
                    class="w-full flex flex-col gap-1.5"
                    on:submit|preventDefault={() => {
                        // check if selectedModels support image input
                        dispatch('submit', prompt);
                        (document.activeElement as HTMLElement)?.blur();
                    }}
                >
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        id="message-input-container"
                        class="flex-1 flex flex-col relative w-full shadow-lg rounded-xl border {$temporaryChatEnabled
                            ? 'border-dashed border-gray-100 dark:border-gray-800 hover:border-gray-200 focus-within:border-gray-200 hover:dark:border-gray-700 focus-within:dark:border-gray-700'
                            : ' border-gray-100/30 dark:border-gray-700/40 hover:border-gray-200 focus-within:border-gray-100 hover:dark:border-gray-600 focus-within:dark:border-gray-600'}  transition px-1 bg-gray-50 dark:bg-gray-800 backdrop-blur-sm dark:text-gray-100"
                        on:touchend|capture|nonpassive={onComposerTouchEnd}
                        on:pointerdown={(e) => {
                            // Prevent focus loss (keyboard dismiss) for all elements
                            // except the submit button, which needs click to fire for form submit
                            const submitBtn = document.getElementById('send-message-button');
                            if (!submitBtn?.contains(e.target as Node)) {
                                e.preventDefault();
                            }
                        }}
                    >
                        {#if files.length > 0 || pendingFiles.length > 0}
                            <div class="mx-2 mt-2.5 pb-1.5 flex items-center flex-wrap gap-2">
                                {#each files as file, fileIdx}
                                    {#if file.kind === 'image'}
                                        <div class=" relative group">
                                            <div class="relative flex items-center">
                                                <Image
                                                    src={dataUrlToBlobUrl(file.dataUrl)}
                                                    alt={file.name}
                                                    imageClassName=" size-10 rounded-xl object-cover"
                                                />
                                            </div>
                                            <div class=" absolute -top-1 -right-1">
                                                <button
                                                    class=" bg-white text-black border border-white rounded-full outline-hidden focus:outline-hidden group-hover:visible invisible transition"
                                                    type="button"
                                                    aria-label="Remove file"
                                                    on:click={() => {
                                                        files.splice(fileIdx, 1);
                                                        files = files;
                                                    }}
                                                >
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        viewBox="0 0 20 20"
                                                        fill="currentColor"
                                                        aria-hidden="true"
                                                        class="size-4"
                                                    >
                                                        <path
                                                            d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"
                                                        />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    {:else}
                                        <FileItem
                                            item={file}
                                            dismissible={true}
                                            small={true}
                                            on:dismiss={async () => {
                                                // Remove from UI state
                                                files.splice(fileIdx, 1);
                                                files = files;
                                            }}
                                            on:click={() => {}}
                                        />
                                    {/if}
                                {/each}
                                {#each pendingFiles as pending, idx}
                                    <FileItem
                                        item={{
                                            kind: 'text',
                                            name: pending.name,
                                            size: pending.size,
                                            contentType: 'application/octet-stream',
                                            content: ''
                                        }}
                                        loading={true}
                                        dismissible={true}
                                        small={true}
                                        on:dismiss={async () => {
                                            pendingFiles = pendingFiles.filter(
                                                (p) => p.id !== pending.id
                                            );
                                        }}
                                        on:click={() => {}}
                                    />
                                {/each}
                            </div>
                        {/if}

                        <div class="px-2.5">
                            <div
                                class="scrollbar-hidden text-left bg-transparent dark:text-gray-100 outline-hidden w-full pb-1 px-1 resize-none h-fit overflow-auto {files.length ===
                                0
                                    ? 'pt-2.5'
                                    : ''}"
                                style="max-height: min(24rem, calc(var(--app-height, 100dvh) - 12rem));"
                                id="chat-input-container"
                                on:pointerdown|stopPropagation
                            >
                                <RichTextInput
                                    bind:this={chatInputElement}
                                    id="chat-input"
                                    onChange={(content) => {
                                        prompt = content.md;
                                    }}
                                    messageInput={true}
                                    shiftEnter={!$settings.ctrlEnterToSend &&
                                        !$mobile &&
                                        !('ontouchstart' in window || navigator.maxTouchPoints > 0)}
                                    placeholder={placeholder ? placeholder : 'Send a Message'}
                                    oncompositionstart={() => (isComposing = true)}
                                    oncompositionend={(e) => {
                                        compositionEndedAt = e.timeStamp;
                                        isComposing = false;
                                    }}
                                    on:keydown={async (customEvent) => {
                                        const e: KeyboardEvent = customEvent.detail.event;

                                        const isCtrlPressed = e.ctrlKey || e.metaKey;

                                        if (e.key === 'Escape') {
                                            stopResponse();
                                        }

                                        if (prompt === '' && e.key == 'ArrowUp') {
                                            e.preventDefault();

                                            const userMessageElement = [
                                                ...document.getElementsByClassName('user-message')
                                            ]?.at(-1);

                                            if (userMessageElement) {
                                                userMessageElement.scrollIntoView({
                                                    block: 'center'
                                                });
                                                const editButton = [
                                                    ...document.getElementsByClassName(
                                                        'edit-user-message-button'
                                                    )
                                                ]?.at(-1);

                                                (editButton as HTMLElement)?.click();
                                            }
                                        }

                                        if (
                                            !$mobile ||
                                            !(
                                                'ontouchstart' in window ||
                                                navigator.maxTouchPoints > 0
                                            )
                                        ) {
                                            if (inOrNearComposition(e)) {
                                                return;
                                            }

                                            // Uses keyCode '13' for Enter key for chinese/japanese keyboards.
                                            //
                                            // Depending on the user's settings, it will send the message
                                            // either when Enter is pressed or when Ctrl+Enter is pressed.
                                            const enterPressed = $settings.ctrlEnterToSend
                                                ? (e.key === 'Enter' || e.keyCode === 13) &&
                                                  isCtrlPressed
                                                : (e.key === 'Enter' || e.keyCode === 13) &&
                                                  !e.shiftKey;

                                            if (enterPressed) {
                                                e.preventDefault();
                                                if (!submitDisabled) {
                                                    dispatch('submit', prompt);
                                                }
                                            }
                                        }
                                    }}
                                    on:paste={async (customEvent) => {
                                        const e: ClipboardEvent = customEvent.detail.event;

                                        const clipboardData = e.clipboardData;

                                        if (clipboardData && clipboardData.items) {
                                            for (const item of clipboardData.items) {
                                                if (item.type !== 'text/plain') {
                                                    const file = item.getAsFile();
                                                    if (file) {
                                                        await inputFilesHandler([file]);
                                                        e.preventDefault();
                                                    }
                                                }
                                            }
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        <div class="flex justify-between mt-0.5 mb-2.5 mx-0.5 max-w-full relative">
                            <div class="ml-1 self-end flex items-center">
                                <InputMenu
                                    {screenCaptureHandler}
                                    {inputFilesHandler}
                                    uploadFilesHandler={() => {
                                        filesInputElement.click();
                                    }}
                                    onClose={async () => {
                                        await tick();

                                        // Don't change focus on mobile
                                        if (!$mobile) {
                                            const chatInput = document.getElementById('chat-input');
                                            chatInput?.focus();
                                        }
                                    }}
                                >
                                    <div
                                        id="input-menu-button"
                                        class="bg-transparent hover:bg-gray-100 text-gray-700 dark:text-white dark:hover:bg-gray-800 rounded-full size-8 flex justify-center items-center outline-hidden focus:outline-hidden"
                                    >
                                        <Clip className="size-4" />
                                    </div>
                                </InputMenu>

                                <div class="flex self-center w-[1px] h-4 ml-1"></div>

                                <div class="flex items-center gap-1">
                                    {#each switchableServers as server (server.id)}
                                        {@const on = !disabledToolServers.includes(server.id)}
                                        <Tooltip
                                            content={`${server.name}: ${server.tools.map((t) => t.name).join(', ')}${server.state === 'error' ? ' (unreachable)' : ''}`}
                                            placement="top"
                                        >
                                            <button
                                                on:click|preventDefault={() => toggleServer(server.id)}
                                                type="button"
                                                aria-pressed={on}
                                                aria-label={`${server.name} tools ${on ? 'on' : 'off'}`}
                                                class="rounded-md flex items-center {$mobile
                                                    ? 'p-1.5'
                                                    : 'gap-1.5 pl-2 pr-2.5 py-1.5'} text-xs font-medium outline-hidden focus:outline-hidden transition-colors border {on
                                                    ? 'text-sky-500 dark:text-sky-300 bg-sky-50 hover:bg-sky-100 dark:bg-sky-400/10 dark:hover:bg-sky-600/10 border-sky-200/40 dark:border-sky-500/20'
                                                    : 'text-gray-500 dark:text-gray-400 bg-transparent md:hover:bg-gray-900 md:hover:text-white border-transparent'}"
                                            >
                                                {#if isWebServer(server.name)}
                                                    <GlobeAlt className="size-4.5" strokeWidth="1.5" />
                                                {:else}
                                                    <Wrench className="size-4" strokeWidth="1.5" />
                                                {/if}
                                                {#if !$mobile}
                                                    <span>{server.name}</span>
                                                {/if}
                                            </button>
                                        </Tooltip>
                                    {/each}
                                </div>
                            </div>

                            <div class="absolute left-1/2 -translate-x-1/2 bottom-1.5">
                                {#if $streamContext && $streamContext.total > 0}
                                    {@const ctxRatio = $streamContext.used / $streamContext.total}
                                    {@const pillClass = `font-mono tabular-nums text-xs px-2 py-0.5 rounded-lg ${ctxRatio < 0.5 ? 'text-green-500 dark:text-green-400 bg-green-100 dark:bg-green-900/20' : ctxRatio < 0.8 ? 'text-yellow-500 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/20' : 'text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-900/20'}`}
                                    {#if generating}
                                        <span class={pillClass}>
                                            {$streamContext.tps.toFixed(1)} t/s
                                        </span>
                                    {:else}
                                        <Tooltip content="Context" placement="top">
                                            <span class={pillClass}>
                                                {($streamContext.used / 1000).toFixed(
                                                    1
                                                )}K/{Math.round($streamContext.total / 1000)}K
                                            </span>
                                        </Tooltip>
                                    {/if}
                                {/if}
                            </div>

                            <div class="self-end flex items-center mr-[3px] gap-2">
                                <button
                                    on:click|preventDefault={() =>
                                        (systemPromptVisible = !systemPromptVisible)}
                                    type="button"
                                    class="rounded-md flex items-center {$mobile
                                        ? 'p-1.5'
                                        : 'gap-1.5 pl-1.5 pr-1 py-1.5'} text-xs font-medium outline-hidden focus:outline-hidden transition-colors border {systemPromptVisible
                                        ? 'text-sky-500 dark:text-sky-300 bg-sky-50 hover:bg-sky-100 dark:bg-sky-400/10 dark:hover:bg-sky-600/10 border-sky-200/40 dark:border-sky-500/20'
                                        : 'text-gray-500 dark:text-gray-400 bg-transparent md:hover:bg-gray-900 md:hover:text-white border-transparent'}"
                                >
                                    {#if !$mobile}
                                        <span>{'System'}</span>
                                    {/if}
                                    <AdjustmentsHorizontal className="size-4.5" strokeWidth="1.5" />
                                </button>
                                {#if (history.currentId && history.messages[history.currentId]?.done != true) || generating}
                                    <div class=" flex items-center">
                                        <Tooltip content="Stop">
                                            <button
                                                class="bg-white hover:bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-800 transition rounded-lg px-4 py-1.5 self-center"
                                                aria-label="Stop"
                                                on:click={() => {
                                                    stopResponse();
                                                }}
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 24 24"
                                                    fill="currentColor"
                                                    class="size-5"
                                                >
                                                    <path
                                                        fill-rule="evenodd"
                                                        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm6-2.438c0-.724.588-1.312 1.313-1.312h4.874c.725 0 1.313.588 1.313 1.313v4.874c0 .725-.588 1.313-1.313 1.313H9.564a1.312 1.312 0 01-1.313-1.313V9.564z"
                                                        clip-rule="evenodd"
                                                    />
                                                </svg>
                                            </button>
                                        </Tooltip>
                                    </div>
                                {:else}
                                    <div class=" flex items-center">
                                        <Tooltip content="Send message">
                                            <button
                                                id="send-message-button"
                                                class="{!submitDisabled
                                                    ? 'bg-cyan-600 text-white hover:bg-cyan-500 dark:bg-cyan-600 dark:text-white dark:hover:bg-cyan-500 '
                                                    : 'text-white bg-gray-200 dark:text-gray-900 dark:bg-gray-700 disabled'} transition rounded-lg px-4 py-1.5 self-center"
                                                aria-label="Send message"
                                                type="submit"
                                                disabled={submitDisabled}
                                            >
                                                <svg
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 16 16"
                                                    fill="currentColor"
                                                    class="size-5"
                                                >
                                                    <path
                                                        fill-rule="evenodd"
                                                        d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z"
                                                        clip-rule="evenodd"
                                                    />
                                                </svg>
                                            </button>
                                        </Tooltip>
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>
