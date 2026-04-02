<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { onMount, tick, createEventDispatcher, onDestroy } from 'svelte';
    const dispatch = createEventDispatcher();

    import {
        mobile,
        settings,
        showSidebar,
        streamContext,
        user as _user,
        temporaryChatEnabled
    } from '$lib/stores';

    import { convertHeicToJpeg } from '$lib/utils';
    import { uploadFile, extractFileContent } from '$lib/apis/files';

    import { API_BASE_URL } from '$lib/constants';

    import InputMenu from './MessageInput/InputMenu.svelte';
    import FilesOverlay from './MessageInput/FilesOverlay.svelte';
    import RichTextInput from './MessageInput/RichTextInput.svelte';
    import Tooltip from '../common/Tooltip.svelte';
    import FileItem from './Messages/FileItem.svelte';
    import Image from '../common/Image.svelte';

    import GlobeAlt from '../icons/GlobeAlt.svelte';
    import AdjustmentsHorizontal from '../icons/AdjustmentsHorizontal.svelte';
    import Clip from '../icons/Clip.svelte';

    import type { ChatHistory } from '@backend/routes/types';
    import type { InputFileItem } from '$lib/types';

    export let onChange: (data: {
        prompt: string;
        files: InputFileItem[];
        webSearchEnabled: boolean;
    }) => void = () => {};

    export let stopResponse: () => void;

    export let showScrollButton: boolean = false;
    export let onScrollToBottomClick: () => void = () => {};
    export let generating = false;

    export let history: ChatHistory;

    export let prompt = '';
    export let files: InputFileItem[] = [];

    export let webSearchEnabled = false;
    export let systemPromptVisible = false;

    $: onChange({
        prompt,
        files: files
            .filter((file) => file.type !== 'image')
            .map((file) => {
                return {
                    ...file,
                    user: undefined,
                    access_control: undefined
                };
            }),
        webSearchEnabled
    });

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
    let shiftKey = false;

    export let placeholder = '';

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

    const uploadFileHandler = async (file: File): Promise<void> => {
        const tempItemId = crypto.randomUUID();
        const fileItem: InputFileItem = {
            type: 'file',
            id: tempItemId,
            url: '',
            name: file.name,
            contentType: '',
            size: file.size,
            status: 'uploading',
            itemId: tempItemId
        };

        if (file.size === 0) {
            toast.error('You cannot upload an empty file.');
            return;
        }

        files = [...files, fileItem];

        if (!$temporaryChatEnabled) {
            try {
                const uploaded = await uploadFile(localStorage.token, file);

                fileItem.status = 'uploaded';
                fileItem.id = uploaded.id;
                fileItem.url = uploaded.id;
                fileItem.name = uploaded.filename;
                fileItem.contentType = uploaded.meta.contentType;
                fileItem.size = uploaded.meta.size;
                fileItem.content = uploaded.data?.content;
                fileItem.file = uploaded;

                files = files;
            } catch (e) {
                toast.error(`${e}`);
                files = files.filter((f) => f.itemId !== tempItemId);
            }
        } else {
            const content = await extractFileContent(localStorage.token, file).catch((error) => {
                toast.error(`Failed to extract content from the file: ${error}`);
                return null;
            });

            if (content === null) {
                files = files.filter((f) => f.itemId !== tempItemId);
            } else {
                fileItem.status = 'uploaded';
                fileItem.type = 'text';
                fileItem.content = content;
                files = files;
            }
        }
    };

    const inputFilesHandler = async (inputFiles: File[]): Promise<void> => {
        inputFiles.forEach(async (file: File) => {
            if (file.type.startsWith('image/')) {
                let reader = new FileReader();

                reader.onload = async (event) => {
                    const imageUrl = event.target?.result;
                    if (typeof imageUrl !== 'string') return;

                    if ($temporaryChatEnabled) {
                        files = [
                            ...files,
                            {
                                type: 'image',
                                id: crypto.randomUUID(),
                                url: imageUrl,
                                name: file.name,
                                contentType: file.type,
                                size: file.size
                            }
                        ];
                    } else {
                        const blob = await (await fetch(imageUrl)).blob();
                        const compressedFile = new File([blob], file.name, { type: file.type });

                        uploadFileHandler(compressedFile);
                    }
                };

                const readTarget =
                    file.type === 'image/heic' ? await convertHeicToJpeg(file) : file;
                reader.readAsDataURL(Array.isArray(readTarget) ? readTarget[0] : readTarget);
            } else {
                uploadFileHandler(file);
            }
        });
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
        if (e.key === 'Shift') {
            shiftKey = true;
        }

        if (e.key === 'Escape') {
            dragged = false;
        }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
        if (e.key === 'Shift') {
            shiftKey = false;
        }
    };

    onMount(async () => {
        window.setTimeout(() => {
            const chatInput = document.getElementById('chat-input');
            chatInput?.focus();
        }, 0);

        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);

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
        window.removeEventListener('keyup', onKeyUp);

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
                        class=" absolute -top-12 left-0 right-0 flex justify-center z-30 pointer-events-none"
                    >
                        <button
                            class=" bg-white border border-gray-100 dark:border-none dark:bg-white/20 p-1.5 rounded-full pointer-events-auto"
                            aria-label="scroll"
                            on:click={onScrollToBottomClick}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                class="w-5 h-5"
                            >
                                <path
                                    fill-rule="evenodd"
                                    d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                                    clip-rule="evenodd"
                                />
                            </svg>
                        </button>
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
                        on:pointerdown={(e) => {
                            // Prevent focus loss (keyboard dismiss) for all elements
                            // except the submit button, which needs click to fire for form submit
                            const submitBtn = document.getElementById('send-message-button');
                            if (!submitBtn?.contains(e.target as Node)) {
                                e.preventDefault();
                            }
                        }}
                    >
                        {#if files.length > 0}
                            <div class="mx-2 mt-2.5 pb-1.5 flex items-center flex-wrap gap-2">
                                {#each files as file, fileIdx}
                                    {#if file.type === 'image' || file.contentType.startsWith('image/')}
                                        {@const fileUrl =
                                            file.url.startsWith('data') ||
                                            file.url.startsWith('http')
                                                ? file.url
                                                : `${API_BASE_URL}/files/${file.url}/content`}
                                        <div class=" relative group">
                                            <div class="relative flex items-center">
                                                <Image
                                                    src={fileUrl}
                                                    alt=""
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
                                            loading={file.status === 'uploading'}
                                            dismissible={true}
                                            edit={true}
                                            small={true}
                                            modal={['file', 'collection'].includes(file.type)}
                                            on:dismiss={async () => {
                                                // Remove from UI state
                                                files.splice(fileIdx, 1);
                                                files = files;
                                            }}
                                            on:click={() => {}}
                                        />
                                    {/if}
                                {/each}
                            </div>
                        {/if}

                        <div class="px-2.5">
                            <div
                                class="scrollbar-hidden text-left bg-transparent dark:text-gray-100 outline-hidden w-full pb-1 px-1 resize-none h-fit max-h-96 overflow-auto {files.length ===
                                0
                                    ? 'pt-2.5'
                                    : ''}"
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
                                                if (prompt !== '' || files.length > 0) {
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
                                    <button
                                        on:click|preventDefault={() =>
                                            (webSearchEnabled = !webSearchEnabled)}
                                        type="button"
                                        class="rounded-md flex items-center {$mobile
                                            ? 'p-1.5'
                                            : 'gap-1.5 pl-2 pr-2.5 py-1.5'} text-xs font-medium outline-hidden focus:outline-hidden transition-colors border {webSearchEnabled
                                            ? 'text-sky-500 dark:text-sky-300 bg-sky-50 hover:bg-sky-100 dark:bg-sky-400/10 dark:hover:bg-sky-600/10 border-sky-200/40 dark:border-sky-500/20'
                                            : 'text-gray-500 dark:text-gray-400 bg-transparent md:hover:bg-gray-900 md:hover:text-white border-transparent'}"
                                    >
                                        <GlobeAlt className="size-4.5" strokeWidth="1.5" />
                                        {#if !$mobile}
                                            <span>{'Search'}</span>
                                        {/if}
                                    </button>
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
                                                class="bg-white hover:bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-800 transition rounded-lg p-1.5"
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
                                                class="{!(prompt === '' && files.length === 0)
                                                    ? 'bg-orange-300 text-white hover:bg-orange-400 dark:bg-orange-300 dark:text-white dark:hover:bg-orange-400 '
                                                    : 'text-white bg-gray-200 dark:text-gray-900 dark:bg-gray-700 disabled'} transition rounded-lg px-2.5 py-1.5 self-center"
                                                aria-label="Send message"
                                                type="submit"
                                                disabled={prompt === '' && files.length === 0}
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
