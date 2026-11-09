<script lang="ts">
    import { reloadChatList } from '$lib/utils/chatList';
    import { uuid } from '$lib/utils/uuid';
    import { applyResumePosition, saveResumePosition, takeResumePosition } from '$lib/utils/resumePosition';
    import { toast } from 'svelte-sonner';

    import { onDestroy, onMount, tick } from 'svelte';
    import { fade } from 'svelte/transition';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    import { type Unsubscriber } from 'svelte/store';

    import type {
        Chat,
        ChatHistory,
        ChatMessage,
        ChatMessageFile,
        ChatMessageUsage,
        ToolCallBlock,
        ContentBlock,
        ReasoningBlock,
        Folder
    } from '@backend/routes/types';
    import type {
        SseEvent,
        SseToolCallProgressPayload,
        SseToolCallResultPayload,
        SseToolCallStartPayload
    } from '@backend/protocol/sse.js';

    import {
        chatId,
        chats,
        mobile,
        type Model,
        models,
        settings,
        showSidebar,
        user,
        currentChatPage,
        temporaryChatEnabled,
        chatTitle,
        selectedFolder,
        streamContext,
        selectedModel,
        isEditingMessage,
        editScrollPosition,
        toolServers,
        virtualKeyboardOpen,
        generatingChats
    } from '$lib/stores';
    import { wakeModel } from '$lib/apis/models';

    import { appendMessage, createMessagesList, getPromptVariables } from '$lib/utils';

    import {
        createNewChat,
        getChatById,
        getChatList,
        updateChatById,
        updateChatFolderIdById
    } from '$lib/apis/chats';
    import {
        chatCompletion,
        type StreamTimings,
        type PromptProgress,
        type ToolProgressState,
        type UrlStatus,
        type TextStreamUpdate,
        resumeChatCompletion,
        stopChatCompletion
    } from '$lib/apis/completions';
    import { getFolderById, updateFolderById } from '$lib/apis/folders';

    import MessageInput from '$lib/components/chat/MessageInput.svelte';
    import Messages from '$lib/components/chat/Messages.svelte';
    import Navbar from '$lib/components/Navbar.svelte';
    import SandboxDrawer from '$lib/components/chat/SandboxDrawer.svelte';
    import { addSandboxFiles, getSandboxStatus } from '$lib/apis/sandbox';
    import Spinner from './common/Spinner.svelte';
    import Tooltip from './common/Tooltip.svelte';
    import EyeSlash from './icons/EyeSlash.svelte';
    import InfoCircle from './icons/InfoCircle.svelte';
    import FolderTitle from './chat/FolderTitle.svelte';
    import SystemPromptMessage from './chat/SystemPromptMessage.svelte';
    import SystemPromptSaveModal from './chat/SystemPromptSaveModal.svelte';
    import { getModels, updateModelById, createNewModel } from '$lib/apis/models';

    export let chatIdProp = '';

    let loading: boolean = true;

    let messageInput: MessageInput | undefined;

    let messagesContainerElement: HTMLDivElement;
    
    let systemPromptVisible: boolean = false;
    let showSystemPromptSaveModal: boolean = false;
    let pendingSystemPromptEdit: string = '';
    // System prompt staged for a new chat that doesn't exist in DB yet
    let pendingChatSystemPrompt: string = '';
    /// Saved scroll position for system prompt toggle restoration
    let savedScrollState: number | undefined = undefined;
    let prevSystemPromptVisible: boolean = false;
    let prevIsEditingMessage: boolean = false;
    let suppressScrollToBottom: boolean = false;
    /// Track whether we're at the bottom of the messages container
    let isAtBottom: boolean = true;

    const SCROLL_THRESHOLD = 200; // pixels from bottom

    const hasScrollableContent = (): boolean => {
        if (!messagesContainerElement) return false;
        const distanceFromBottom = messagesContainerElement.scrollHeight - messagesContainerElement.scrollTop - messagesContainerElement.clientHeight;
        return distanceFromBottom > SCROLL_THRESHOLD;
    };

    let generating: boolean = false;
    let generationController: AbortController | null = null;

    let toolProgress: Map<string, ToolProgressState> | undefined = undefined;
    let modelStatus: { status: 'queued' | 'loading'; modelName: string } | undefined = undefined;

    let chat: Chat | null = null;

    const hostnameOf = (url: string): string => {
        try {
            return new URL(url).hostname;
        } catch {
            return url;
        }
    };

    let history: ChatHistory = {
        messages: {},
        currentId: null
    };

    $: hasMessages = history.currentId != null;

    // Chat Input
    let prompt: string = '';
    let files: ChatMessageFile[] = [];

    let lastSelectedModelId: string | undefined;
    let disabledToolServers: string[] = [];

    // The sandbox. Off in every chat until turned on; `activated` means it has been on
    // here, which keeps its files reachable after it's turned off.
    let sandboxEnabled = false;
    let sandboxActivated = false;
    let sandboxOpen = false;
    /** The folder open in the file panel. */
    let sandboxPath = '.';
    /** Opened by itself once per chat at most, the first time something happens in it. */
    let sandboxAutoOpened = false;
    let sandboxRefresh = 0;
    /** Files added since the last message, for telling the model. */
    let sandboxUploads: string[] = [];
    /** The chat got its id for a file, before its first message. */
    let chatIdWithoutMessages = false;

    $: sandboxServer = $toolServers.find((s) => s.enabled && s.sandbox);
    $: sandboxVisible = !!sandboxServer && !$temporaryChatEnabled && (sandboxEnabled || sandboxActivated);
    $: if (!sandboxVisible) sandboxOpen = false;

    const resetSandbox = (saved?: { sandboxEnabled?: boolean; sandboxActivated?: boolean }) => {
        sandboxEnabled = saved?.sandboxEnabled === true;
        sandboxActivated = saved?.sandboxActivated === true;
        sandboxOpen = false;
        sandboxAutoOpened = sandboxActivated;
        sandboxUploads = [];
        sandboxPath = '.';
        chatIdWithoutMessages = false;
    };

    /**
     * Seconds the model has been silent. A tool call only reaches us once it's complete,
     * so a long one (writing a big file, say) would otherwise look like nothing happening.
     */
    let lastOutputAt = 0;
    let quietSeconds = 0;
    let quietTimer: ReturnType<typeof setInterval> | undefined;
    const QUIET_AFTER_MS = 2000;
    $: if (generating && !quietTimer) {
        quietTimer = setInterval(() => {
            const message = history.currentId ? history.messages[history.currentId] : undefined;
            const toolRunning = message?.blocks?.some((b) => b.type === 'tool_call' && b.result === undefined);
            const started = !!message?.content || (message?.blocks?.length ?? 0) > 0;
            const silent = Date.now() - lastOutputAt;
            quietSeconds = started && !toolRunning && !modelStatus && silent >= QUIET_AFTER_MS ? Math.floor(silent / 1000) : 0;
        }, 500);
    } else if (!generating && quietTimer) {
        clearInterval(quietTimer);
        quietTimer = undefined;
        quietSeconds = 0;
    }

    /** With the sandbox on, files added from the input bar go to its workspace. */
    const addFilesToSandbox = async (list: File[]) => {
        const nonEmpty = list.filter((file) => file.size > 0);
        if (nonEmpty.length < list.length) toast.error('File is empty, skipping.');
        if (nonEmpty.length === 0) return;

        const id = ensureChatIdForSandbox();
        const folder = sandboxOpen ? sandboxPath : '.';
        if (!$mobile) sandboxOpen = true;
        const { added, errors } = await addSandboxFiles(localStorage.token, id, folder, nonEmpty);
        errors.forEach((error) => toast.error(error));
        if (added.length === 0) return;
        sandboxUploads = [...sandboxUploads, ...added];
        sandboxActivated = true;
        sandboxAutoOpened = true;
        sandboxRefresh += 1;
        if ($mobile) toast.success(added.length === 1 ? `Added ${added[0]} to Files` : `Added ${added.length} files to Files`);
    };

    /** Saved as soon as it's switched, so a reload doesn't undo it. */
    const saveSandboxToggle = (enabled: boolean) => {
        if (!$chatId || chatIdWithoutMessages || $temporaryChatEnabled) return;
        updateChatById(localStorage.token, $chatId, { sandboxEnabled: enabled }).catch(() => {});
    };

    /** A chat with files but no messages isn't saved yet: a reload comes back to it here. */
    const reopenUnsavedSandbox = async (): Promise<boolean> => {
        const id = $chatId;
        if (!id) return false;
        const status = await getSandboxStatus(localStorage.token, id).catch(() => null);
        if (!status?.exists) return false;

        await initNewChat();
        chatId.set(id);
        resetSandbox({ sandboxEnabled: true, sandboxActivated: true });
        chatIdWithoutMessages = true;
        sandboxOpen = !$mobile;
        return true;
    };

    /** Files can be added before the first message, and they need a chat to belong to. */
    const ensureChatIdForSandbox = (): string => {
        if ($chatId) return $chatId;
        const newId = uuid();
        chatId.set(newId);
        chatIdWithoutMessages = true;
        window.history.replaceState(null, '', `/c/${newId}`);
        return newId;
    };

    function triggerWake(model: Model): void {
        if (model.id !== lastSelectedModelId) {
            lastSelectedModelId = model.id;
            wakeModel(localStorage.token, model.id).catch((err: any) =>
                console.error(`triggerWake: API error: ${err}`)
            );
        }
    }

    $: if ($selectedModel && prompt.length > 0) {
        // lastSelectedModelId = $selectedModel.id;
        triggerWake($selectedModel);
    }

    $: if (chatIdProp) {
        navigateHandler();
    }

    /**
     * Executed on page load
     */
    const navigateHandler = async () => {
        console.log('navigateHandler');

        // Stop following the previous chat's reply here; it carries on on the backend
        streamSeq++;
        resumeAttempts = 0;
        generationController?.abort();
        generationController = null;
        generating = false;
        modelStatus = undefined;
        toolProgress = undefined;

        loading = true;

        prompt = '';
        messageInput?.setText('');

        files = [];
        disabledToolServers = [...($settings.disabledToolServers ?? [])];
        resetSandbox();
        systemPromptVisible = false;
        pendingChatSystemPrompt = '';
        selectedFolder.set(null);

        const pageLoaded = chatIdProp ? await loadChat() : false;
        if (!pageLoaded) {
            console.error(`navigateHandler: failed to load page for chat id ${chatIdProp}`);
            await goto('/');
            return;
        }

        const storageChatInput = localStorage.getItem(`chat-input-${chatIdProp}`);

        await tick();
        loading = false;

        // A reply still being written (on the backend)? Follow it.
        const last = history.currentId ? history.messages[history.currentId] : undefined;
        if (last?.role === 'assistant' && !last.done) {
            // The model list may not have loaded yet; it's only needed for the context meter
            void resumeResponse(resolveModel(last.model ?? '') ?? $selectedModel, last);
        }
        runningHere = !!$chatId && $generatingChats.has($chatId);

        // Back after iOS discarded the app? Return to where you were, not the bottom.
        const resume = takeResumePosition();
        if (resume) {
            suppressScrollToBottom = true;
            const restore = () => messagesContainerElement && applyResumePosition(messagesContainerElement, resume);
            window.setTimeout(restore, 0);
            // Again as messages finish rendering (code highlighting, images) and shift
            for (const ms of [300, 1000]) window.setTimeout(restore, ms);
            window.setTimeout(() => (suppressScrollToBottom = false), 1500);
        } else {
            window.setTimeout(() => scrollToBottom(), 0);
        }

        await tick();

        // Note: this looks to be responsible for the annoying behavior
        // that when you come back to a chat, it goes back to default
        // 'web search enabled' or 'tool X selected'
        if (storageChatInput) {
            try {
                const input = JSON.parse(storageChatInput);

                if (!$temporaryChatEnabled) {
                    messageInput?.setText(input.prompt);
                    files = input.files;
                    disabledToolServers = input.disabledToolServers ?? disabledToolServers;
                }
            } catch (e) {}
        }

        if (!$mobile) {
            const chatInput = document.getElementById('chat-input');
            chatInput?.focus();
        }
    };

    const resolveModel = (id: string): Model | null =>
        $models.find((m) => m.id === id && m.isActive) ?? null;

    $: if ($selectedModel && chatIdProp !== '') {
        saveSessionSelectedModel($selectedModel);
    }

    const saveSessionSelectedModel = (_selectedModel: Model) => {
        if (sessionStorage.selectedModel === _selectedModel.id) {
            return;
        }
        sessionStorage.selectedModel = _selectedModel.id;
        console.log('saveSessionSelectedModel', _selectedModel.id);
    };

    // Set selectedModel to current folder model, if set
    const setModelFromFolder = (folder: Folder) => {
        if (folder.data?.modelId && $selectedModel?.id !== folder.data.modelId) {
            selectedModel.set(resolveModel(folder.data.modelId));
            console.log('Set selectedModel from folder data:', folder.data.modelId);
        }
    };

    // Sync current folder model with backend
    const persistFolder = async (folder: Folder, model: Model) => {
        if (folder.data?.modelId !== model.id) {
            await updateFolderById(localStorage.token, folder.id, {
                data: {
                    modelId: model.id
                }
            });
        }
    };

    $: if ($selectedFolder && $selectedModel) {
        persistFolder($selectedFolder, $selectedModel);
    }

    let pageUnsubscribe: Unsubscriber;
    let selectedFolderUnsubscribe: Unsubscriber;

    // When the virtual keyboard opens/closes, re-scroll the messages container
    // to the bottom so the last message stays visible after the layout shrinks.
    const onViewportResize = () => {
        if ($isEditingMessage) return;
        if (suppressScrollToBottom) return;
        scrollToBottom();
    };

    onMount(async () => {
        loading = true;
        console.log('mounted');
        pageUnsubscribe = page.subscribe(async (p) => {
            if (p.url.pathname === '/') {
                await tick();
                initNewChat();
            }
        });

        const storageChatInput = localStorage.getItem(
            `chat-input${chatIdProp ? `-${chatIdProp}` : ''}`
        );

        if (!chatIdProp) {
            loading = false;
            await tick();
        }

        disabledToolServers = [...($settings.disabledToolServers ?? [])];

        if (storageChatInput) {
            prompt = '';
            messageInput?.setText('');

            files = [];

            try {
                const input = JSON.parse(storageChatInput);

                if (!$temporaryChatEnabled) {
                    messageInput?.setText(input.prompt);
                    files = input.files;
                    disabledToolServers = input.disabledToolServers ?? disabledToolServers;
                }
            } catch (e) {}
        }

        // When navigating to a folder, set selectedModel to the last
        // model we used in that folder.
        // TODO - this should be more visible, either in folder settings or apparent
        // when using the folder that it has an associated model.
        selectedFolderUnsubscribe = selectedFolder.subscribe(async (folder: Folder | null) => {
            if (folder) setModelFromFolder(folder);
        });

        const chatInput = document.getElementById('chat-input');
        chatInput?.focus();

        window.visualViewport?.addEventListener('resize', onViewportResize);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('pagehide', onPageHide);
    });

    // Note where the chat is when the app goes to the background (see resumePosition.ts)
    const onVisibilityChange = () => {
        if (document.visibilityState !== 'hidden') return;
        flushDraft();
        if (messagesContainerElement && $chatId) saveResumePosition(messagesContainerElement);
    };
    const onPageHide = () => onVisibilityChange();

    onDestroy(() => {
        window.visualViewport?.removeEventListener('resize', onViewportResize);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.removeEventListener('pagehide', onPageHide);
        try {
            pageUnsubscribe();
            selectedFolderUnsubscribe();
        } catch (e) {
            console.error(e);
        }
    });

    const initNewChat = async () => {
        console.log('initNewChat');
        chat = null;
        pendingChatSystemPrompt = '';

        if ($settings.temporaryChatByDefault) {
            if ($temporaryChatEnabled === false) {
                temporaryChatEnabled.set(true);
            } else if ($temporaryChatEnabled === null) {
                // if set to null set to false; refer to temp chat toggle click handler
                temporaryChatEnabled.set(false);
            }
        }

        // If we don't have a model selected, try to resolve a model from other locations
        if (!$selectedModel) {
            const availableModels = $models.filter((m) => m.isActive);
            let candidateId: string = '';

            if ($selectedFolder?.data?.modelId) {
                candidateId = $selectedFolder.data.modelId;
            } else if (sessionStorage.selectedModel) {
                candidateId = sessionStorage.selectedModel;
                localStorage.removeItem('selectedModel');
            } else if ($settings.model) {
                candidateId = $settings.model;
            }

            if (candidateId && availableModels.some((m) => m.id === candidateId)) {
                selectedModel.set(resolveModel(candidateId));
            } else {
                selectedModel.set(availableModels.at(0) ?? null);
            }
        }

        // Set start state
        chatId.set('');
        chatTitle.set('');
        resetSandbox();

        history = {
            messages: {},
            currentId: null
        };

        // Focus chat input
        setTimeout(() => document.getElementById('chat-input')?.focus(), 0);
    };

    /**
     * Loads a chat from the backend
     *
     * @returns true if loading successful; false otherwise
     */
    const loadChat = async (): Promise<boolean> => {
        console.log('loadChat');
        chatId.set(chatIdProp);

        if ($temporaryChatEnabled) {
            temporaryChatEnabled.set(false);
        }

        chat = await getChatById(localStorage.token, $chatId).catch((error) => {
            console.error(`loadChat: error fetching chat ${$chatId}: ${error}`);
            return null;
        });

        if (!chat) {
            if (await reopenUnsavedSandbox()) return true;
            await goto('/');
            return false;
        }

        const chatContent = chat.chat;

        selectedModel.set(resolveModel(chatContent.model));
        chatTitle.set(chatContent.title);

        // Load folder data so the folder system prompt is available for resolution
        if (chat.folderId) {
            const folder = await getFolderById(localStorage.token, chat.folderId).catch(() => null);
            if (folder) selectedFolder.set(folder);
        } else {
            selectedFolder.set(null);
        }

        resetSandbox(chatContent);

        // Older chats had one web search switch instead of a list of servers turned off
        disabledToolServers =
            chatContent.disabledToolServers ??
            (chatContent.webSearchEnabled === false
                ? $toolServers.map((s) => s.id)
                : chatContent.webSearchEnabled === true
                  ? []
                  : [...($settings.disabledToolServers ?? [])]);

        history = chatContent.history;
        await tick();

        // Older replies left unfinished (the backend went away mid-reply) count as
        // finished. The latest one may still be running on the backend: navigateHandler
        // follows it, or shows it as interrupted if nothing is running.
        for (const message of Object.values(history.messages)) {
            if (message && message.role === 'assistant' && message.id !== history.currentId) {
                message.done = true;
            }
        }

        await tick();
        return true;
    };

    const scrollToBottom = async () => {
        await tick();
        if (!messagesContainerElement) return;
        messagesContainerElement.scrollTo({
            top: messagesContainerElement.scrollHeight,
            behavior: 'auto'
        });
    };

    const scrollToTop = async () => {
        await tick();
        if (!messagesContainerElement) return;
        messagesContainerElement.scrollTo({ top: 0, behavior: 'auto' });
    };

    $: {
        if (systemPromptVisible && !prevSystemPromptVisible) {
            // toggle ON - save scroll position BEFORE DOM updates
            if (messagesContainerElement) {
                savedScrollState = messagesContainerElement.scrollTop;
            }
            // DOM will update systemPromptVisible, then we scroll to top
            scrollToTop();
        } else if (!systemPromptVisible && prevSystemPromptVisible) {
            // toggle OFF - wait for DOM to settle, then restore
            if (savedScrollState !== undefined) {
                tick().then(() => {
                    if (messagesContainerElement) {
                        messagesContainerElement.scrollTo({
                            top: savedScrollState,
                            behavior: 'auto'
                        });
                    }
                    // Reset AFTER restore completes
                    savedScrollState = undefined;
                });
            }
        }
        prevSystemPromptVisible = systemPromptVisible;
    }

    // Restore scroll position when message editing ends.
    // The scroll position is saved by the edit button handler (in
    // ResponseMessage/UserMessage) BEFORE the DOM changes, via the
    // editScrollPosition store.
    $: {
        if (!$isEditingMessage && prevIsEditingMessage) {
            suppressScrollToBottom = true;
            const savedPos = $editScrollPosition;
            tick().then(() => {
                if (savedPos !== undefined && messagesContainerElement) {
                    messagesContainerElement.scrollTo({
                        top: savedPos,
                        behavior: 'auto'
                    });
                    editScrollPosition.set(undefined);
                }
                setTimeout(() => {
                    suppressScrollToBottom = false;
                }, 1500);
            });
        }
        prevIsEditingMessage = $isEditingMessage;
    }

    //////////////////////////
    // System prompt
    //////////////////////////

    // Reactive: re-evaluates whenever chat, folder, or model changes.
    // Priority: pending (new chat) > chat-level > folder-level > model-level.
    $: resolvedSystemPrompt =
        pendingChatSystemPrompt ||
        chat?.chat?.systemPrompt ||
        $selectedFolder?.data?.systemPrompt ||
        $selectedModel?.params?.system ||
        '';

    $: usingCustomPrompt =
        systemPromptSource === 'pending' ||
        (systemPromptSource === 'folder' &&
            resolvedSystemPrompt !== $selectedModel?.params?.system) ||
        (systemPromptSource === 'chat' && resolvedSystemPrompt !== $selectedModel?.params?.system);

    $: noPromptDefined = resolvedSystemPrompt === '';
    $: systemPromptSource = pendingChatSystemPrompt
        ? 'pending'
        : chat?.chat?.systemPrompt
          ? 'chat'
          : $selectedFolder?.data?.systemPrompt
            ? 'folder'
            : null;

    type SaveTarget = 'chat' | 'folder' | 'model' | 'new-model';

    const saveSystemPrompt = async (target: SaveTarget, newPrompt: string): Promise<void> => {
        if (target === 'chat' && !$temporaryChatEnabled) {
            if (chat) {
                chat = { ...chat, chat: { ...chat.chat, systemPrompt: newPrompt } };
                await updateChatById(localStorage.token, $chatId ?? '', {
                    systemPrompt: newPrompt
                });
            } else {
                // Chat doesn't exist yet; stash and apply when first message creates it
                pendingChatSystemPrompt = newPrompt;
            }
        } else if (target === 'folder' && $selectedFolder) {
            const updated = await updateFolderById(localStorage.token, $selectedFolder.id, {
                data: { ...($selectedFolder.data ?? {}), systemPrompt: newPrompt }
            });
            selectedFolder.set(updated);
        } else if (target === 'model' && $selectedModel) {
            const updated = await updateModelById(localStorage.token, $selectedModel.id, {
                id: $selectedModel.id,
                baseModelId: $selectedModel.baseModelId,
                name: $selectedModel.name,
                meta: $selectedModel.meta,
                params: { ...$selectedModel.params, system: newPrompt },
                isPublic: $selectedModel.isPublic,
                isActive: $selectedModel.isActive
            });
            models.update((ms) => ms.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
            selectedModel.update((m) =>
                m ? { ...m, params: { ...m.params, system: newPrompt } } : m
            );
        } else if (target === 'new-model' && $selectedModel) {
            const newModel = await createNewModel(localStorage.token, {
                id: uuid(),
                baseModelId: $selectedModel.baseModelId,
                name: `${$selectedModel.name} (Custom)`,
                meta: $selectedModel.meta,
                params: { ...$selectedModel.params, system: newPrompt },
                isPublic: false,
                isActive: true
            });
            const freshModels = await getModels(localStorage.token);
            models.set(freshModels);
            selectedModel.set(freshModels.find((m) => m.id === newModel.id) ?? null);
        }
    };

    //////////////////////////
    // Chat functions
    //////////////////////////

    const submitPrompt = async (userPrompt: string) => {
        console.log('submitPrompt', userPrompt, $chatId);

        if (userPrompt === '' && files.length === 0) {
            toast.error('Please enter a prompt');
            return;
        }

        if (!$selectedModel) {
            toast.error('Model not selected');
            return;
        }

        if (history.currentId) {
            const lastMessage = history.messages[history.currentId];
            if (lastMessage.done != true) {
                // Response not done
                return;
            }

            if (lastMessage.error && !lastMessage.content) {
                // Error in response
                toast.error(`Oops! There was an error in the previous response.`);
                return;
            }
        }

        messageInput?.setText('');
        prompt = '';

        const messages = createMessagesList(history, history.currentId);
        const _files = structuredClone(files);

        files = [];
        messageInput?.setText('');

        // Create user message and append to history
        const userMessage = appendMessage(history, {
            parentId: messages.at(-1)?.id ?? null,
            role: 'user',
            content: userPrompt,
            files: _files,
            done: false,
            model: $selectedModel.id
        });

        // Focus chat input, except on mobile
        if (!$mobile) {
            document.getElementById('chat-input')?.focus();
        }

        saveSessionSelectedModel($selectedModel);
        await sendMessage(userMessage);
    };

    const sendMessage = async (userMessage: ChatMessage) => {
        scrollToBottom();
        
        const model = $selectedModel;
        if (!model) {
            toast.error(`Model not found`);
            return;
        }

        // First message in a new conversation - allocate a chat ID
        if (!$chatId || chatIdWithoutMessages) {
            if ($temporaryChatEnabled) {
                chatId.set(`local:${uuid()}`);
            } else {
                const newId = $chatId || uuid();
                chatIdWithoutMessages = false;
                chatId.set(newId);
                window.history.replaceState(null, '', `/c/${newId}`);

                // Optimistic sidebar insert so the entry appears immediately
                chats.update((list) => [
                    {
                        id: newId,
                        title: 'New Chat',
                        updatedAt: Date.now() / 1000,
                        createdAt: Date.now() / 1000,
                        timeRange: ''
                    },
                    ...(list ?? [])
                ]);
            }
        }

        await sendMessageSSE(model, userMessage);
    };

    const sendMessageSSE = async (model: Model, userMessage: ChatMessage) => {
        console.log(`sendMessageSSE | model: ${model.name}`);

        // Reset stream context immediately so the previous message's state
        // (e.g. promptProcessing) can't leak into the gap before the backend
        // sends its first event for this message.
        streamContext.set(null);

        // 1. Add empty assistant placeholder to history
        const stream = model.params.stream_response ?? true;
        const responseMessage = appendMessage(history, {
            parentId: userMessage.id,
            role: 'assistant',
            content: '',
            files: [],
            blocks: [],
            done: false,
            model: model.id,
            modelName: model.name
        });

        // Trigger reactivity and scroll before starting chat stream
        history = history;
        await tick();
        scrollToBottom();

        // Compute system prompt variables with client-side info
        const rawVars = await getPromptVariables($user!.username, $settings.userLocation, $settings.userLocationString);
        const promptVariables: Record<string, string> = Object.fromEntries(
            Object.entries(rawVars)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
        );

        if (sandboxEnabled) sandboxActivated = true;
        const uploadsToAnnounce = sandboxEnabled ? sandboxUploads : [];
        if (sandboxEnabled) sandboxUploads = [];

        await streamResponse(model, responseMessage, (controller) =>
            chatCompletion(localStorage.token, controller, {
                stream: stream,
                chatId: $chatId,
                chat: {
                    title: $chatTitle,
                    model: model.id,
                    history: history,
                    timestamp: Date.now(),
                    disabledToolServers,
                    sandboxEnabled,
                    sandboxActivated: sandboxActivated || sandboxEnabled,
                    ...(pendingChatSystemPrompt || chat?.chat?.systemPrompt
                        ? { systemPrompt: pendingChatSystemPrompt || chat!.chat.systemPrompt }
                        : {})
                },
                promptVariables,
                ...(uploadsToAnnounce.length ? { sandboxUploads: uploadsToAnnounce } : {}),
                ...($selectedFolder?.id ? { folderId: $selectedFolder.id } : {})
            })
        );
    };

    // Replies run on the backend whatever happens to the connection (see the
    // backend's completions/jobs.ts). A dropped stream is reconnected; leaving the
    // chat just stops following it here.
    let stoppedByUser = false;
    /** Increments when the chat changes, so an old stream stops touching the page. */
    let streamSeq = 0;
    let resumeAttempts = 0;
    const MAX_RESUME_ATTEMPTS = 6;

    /**
     * Replies started or finished somewhere else (another tab or device, or a
     * regenerate before a reload) while this chat is open: the sidebar's poll of
     * running replies tells us, then we reload the chat and follow the reply.
     */
    let runningHere = false;
    let syncingFromServer = false;
    $: onRunningChats($generatingChats);
    const onRunningChats = async (running: Set<string>) => {
        const id = $chatId;
        const nowRunning = !!id && running.has(id);
        const wasRunning = runningHere;
        runningHere = nowRunning;
        // Already streaming (or about to): generationController is set before the request
        if (!id || loading || generating || generationController || syncingFromServer || $isEditingMessage) return;
        if (nowRunning === wasRunning) return;

        // Finished: only reload if this page wasn't following the reply (its copy
        // is unfinished). One we streamed or stopped here is already up to date.
        if (!nowRunning) {
            const last = history.currentId ? history.messages[history.currentId] : undefined;
            if (!last || last.done) return;
        }

        syncingFromServer = true;
        try {
            const fresh = await getChatById(localStorage.token, id).catch(() => null);
            if (!fresh || id !== $chatId || generating) return;
            history = fresh.chat.history;
            await tick();
            const last = history.currentId ? history.messages[history.currentId] : undefined;
            if (nowRunning && last?.role === 'assistant' && !last.done) {
                void resumeResponse(resolveModel(last.model ?? '') ?? $selectedModel, last);
            }
        } finally {
            syncingFromServer = false;
        }
    };

    /** Follows a reply already running in this chat (or brings back its saved result). */
    const resumeResponse = async (model: Model | null, message: ChatMessage) => {
        const id = $chatId;
        if (!id) return;
        message.content = '';
        message.blocks = [];
        message.done = false;
        delete message.error;
        history.messages[message.id] = message;
        history = history;
        await streamResponse(model, message, (controller) =>
            resumeChatCompletion(localStorage.token, controller, id)
        );
    };

    /** Reconnects to a reply whose stream dropped, once the page is visible. */
    const scheduleResume = (model: Model | null, messageId: string) => {
        const seq = streamSeq;
        const run = async () => {
            document.removeEventListener('visibilitychange', onVisible);
            const message = history.messages[messageId];
            if (seq !== streamSeq || !message || message.done) return;
            if (resumeAttempts++ >= MAX_RESUME_ATTEMPTS) {
                await reconcileWithServer(message);
                return;
            }
            await resumeResponse(model, message);
        };
        const onVisible = () => {
            if (document.visibilityState === 'visible') setTimeout(run, 300);
        };
        if (document.visibilityState === 'visible') {
            setTimeout(run, Math.min(500 * 2 ** resumeAttempts, 8000));
        } else {
            document.addEventListener('visibilitychange', onVisible);
        }
    };

    /**
     * Nothing is running for this reply any more: show what the backend saved.
     * A reply still unfinished there was interrupted (e.g. the backend restarted).
     */
    const reconcileWithServer = async (message: ChatMessage) => {
        generating = false;
        generationController = null;
        modelStatus = undefined;
        toolProgress = undefined;
        const id = $chatId;
        const saved =
            id && !id.startsWith('local:')
                ? (await getChatById(localStorage.token, id).catch(() => null))?.chat?.history?.messages?.[message.id]
                : undefined;
        if (saved) Object.assign(message, saved);
        if (!message.done) {
            message.done = true;
            if (!message.error) message.error = { content: 'This reply was interrupted.' };
        }
        history.messages[message.id] = message;
        history = history;
    };

    /**
     * Streams a reply into `responseMessage`: `open` starts one (sendMessageSSE) or
     * follows one already running (resumeResponse; null when nothing is).
     */
    const streamResponse = async (
        model: Model | null,
        responseMessage: ChatMessage,
        open: (controller: AbortController) => Promise<AsyncGenerator<TextStreamUpdate> | null>
    ) => {
        stoppedByUser = false;
        const seq = streamSeq;
        try {
            generationController = new AbortController();

            // 2. API call
            const textStream = await open(generationController);
            if (!textStream) {
                await reconcileWithServer(responseMessage);
                return;
            }
            generatingChats.update((set) => new Set(set).add($chatId));

            // 3. Stream state setup
            generating = true;
            lastOutputAt = Date.now();
            const contextTotal = model?.contextLength ?? 0;
            toolProgress = new Map<string, ToolProgressState>();
            modelStatus = undefined;

            let reasoningStartTime = 0;
            let activeReasoningIdx: number | null = null;
            let contentTokens = '';
            let lastStreamContextUpdate = 0;
            let toolCallStartTime = 0;

            // 4. Handler closures
            const finalizeReasoning = () => {
                if (activeReasoningIdx === null) return;
                const block = responseMessage.blocks![activeReasoningIdx];
                if (block.type === 'reasoning' && !block.done) {
                    block.done = true;
                    block.duration = Math.round((Date.now() - reasoningStartTime) / 1000);
                }
                activeReasoningIdx = null;
            };

            let syncAnimationFrame: number | null = null;
            const syncMessage = () => {
                responseMessage.blocks = responseMessage.blocks;
                history.messages[responseMessage.id] = responseMessage;

                if (syncAnimationFrame === null) {
                    syncAnimationFrame = requestAnimationFrame(() => {
                        syncAnimationFrame = null;
                        history = history;
                        // Update scroll state after DOM updates
                        isAtBottom = !hasScrollableContent();
                    });
                }
            };

            const updateStreamContext = (
                timings?: StreamTimings,
                promptProgress?: PromptProgress
            ) => {
                const now = Date.now();
                if (now - lastStreamContextUpdate < 100) return;
                lastStreamContextUpdate = now;

                if (timings && contextTotal > 0) {
                    const contextUsed = timings.prompt_n + timings.cache_n + timings.predicted_n;
                    const tps =
                        timings.predicted_ms > 0
                            ? (timings.predicted_n / timings.predicted_ms) * 1000
                            : 0;
                    streamContext.set({ used: contextUsed, total: contextTotal, tps });
                }

                if (promptProgress) {
                    const current = $streamContext;
                    streamContext.set({
                        used: current?.used ?? 0,
                        total: current?.total ?? contextTotal,
                        tps: current?.tps ?? 0,
                        promptProcessing: {
                            processed: promptProgress.processed,
                            total: promptProgress.total
                        }
                    });
                }
            };

            const handleToolCallStart = (data: SseToolCallStartPayload['data']) => {
                finalizeReasoning();
                // Flush any accumulated content into a ContentBlock before the tool call
                if (contentTokens.trim() !== '') {
                    responseMessage.blocks!.push({
                        type: 'content',
                        content: contentTokens.trim(),
                        done: true
                    } satisfies ContentBlock);
                }
                contentTokens = '';
                responseMessage.content = '';
                responseMessage.blocks!.push({
                    type: 'tool_call',
                    id: data.id,
                    name: data.name,
                    arguments: data.arguments,
                    failed: false,
                    done: false,
                    round: data.round,
                    startedAt: data.startedAt,
                    ...(data.server ? { server: data.server } : {})
                });
                // Track when this round of tool calls started (overwritten for each call;
                // all calls in a round are emitted back-to-back so timestamps are near-identical)
                toolCallStartTime = Date.now();
            };

            const handleToolCallResult = (data: SseToolCallResultPayload['data']) => {
                const block = responseMessage.blocks!.find(
                    (b): b is ToolCallBlock => b.type === 'tool_call' && b.id === data.id
                );

                // Leave done=false - finalizeToolCalls() will set it on first token of next round
                if (block) {
                    block.result = data.result;
                    block.failed = data.failed;
                    if (data.structured) block.structured = data.structured;
                    if (data.images) block.images = data.images;

                    if (sandboxServer?.tools.some((t) => t.name === block.name) && !data.failed) {
                        sandboxActivated = true;
                        sandboxRefresh += 1;
                        // Phones don't get a sheet over the reply they're reading.
                        if (!sandboxAutoOpened && !$mobile) sandboxOpen = true;
                        sandboxAutoOpened = true;
                    }
                }
            };

            const handleToolCallProgress = (data: SseToolCallProgressPayload['data']) => {
                const p = data.progress;
                const state = toolProgress!.get(data.id) ?? { pages: [] };
                if (p.message) state.message = p.message;
                if (p.output !== undefined) state.output = p.output;

                if (p.page) {
                    const status: UrlStatus['status'] =
                        p.page.status === 'loaded' ? 'loaded' : p.page.status === 'failed' ? 'failed' : 'loading';
                    const entry = state.pages.find((u) => u.url === p.page!.url);
                    if (entry) entry.status = status;
                    else state.pages.push({ url: p.page.url, hostname: hostnameOf(p.page.url), status });
                }

                toolProgress!.set(data.id, state);
                // Trigger reactivity
                toolProgress = toolProgress;
            };

            const finalizeToolCalls = () => {
                for (const block of responseMessage.blocks!) {
                    if (block.type === 'tool_call' && !block.done) {
                        block.done = true;
                        // Only set duration if we have a meaningful start time and a result
                        if (toolCallStartTime > 0 && block.result !== undefined) {
                            block.duration = Math.round((Date.now() - toolCallStartTime) / 1000);
                        }
                    }
                }
            };

            const handleReasoning = (text: string) => {
                lastOutputAt = Date.now();
                finalizeToolCalls();
                if (activeReasoningIdx === null) {
                    reasoningStartTime = Date.now();
                    activeReasoningIdx = responseMessage.blocks!.length;
                    responseMessage.blocks!.push({ type: 'reasoning', content: '', done: false });
                }
                (responseMessage.blocks![activeReasoningIdx] as ReasoningBlock).content += text;
                syncMessage();
            };

            const handleContentToken = (value: string, usage?: ChatMessageUsage) => {
                lastOutputAt = Date.now();
                // TODO - maybe worth extracting these into like "finalizeLastBlock"
                finalizeToolCalls();
                finalizeReasoning();
                if (value === '\n' && contentTokens === '') return;
                contentTokens += value;
                responseMessage.content = contentTokens;
                if (usage) responseMessage.usage = usage;
                syncMessage();
            };

            const backendEventHandler = (event: SseEvent) => {
                const { type, data } = event.data;
                lastOutputAt = Date.now();

                if (type === 'tool_call:start') handleToolCallStart(data);
                else if (type === 'tool_call:result') handleToolCallResult(data);
                else if (type === 'tool_call:progress') handleToolCallProgress(data);
                else if (type === 'chat:notes') {
                    // Notes kitsu added for the model; kept so the chat is saved with them
                    for (const [id, notes] of Object.entries(data)) {
                        if (history.messages[id]) history.messages[id].notes = notes;
                    }
                }
                else if (type === 'model:queued')
                    modelStatus = { status: 'queued', modelName: model?.name ?? responseMessage.modelName ?? '' };
                else if (type === 'model:loading')
                    modelStatus = { status: 'loading', modelName: model?.name ?? responseMessage.modelName ?? '' };
                else if (type === 'chat:completion') {
                    finalizeReasoning();
                    generating = false;
                    generationController = null;
                    responseMessage.done = true;
                    responseMessage.usage = data.usage;
                    if (data.error) responseMessage.error = data.error;
                } else if (type === 'chat:title') {
                    chatTitle.set(data);
                    chats.update((list) =>
                        (list ?? []).map((c) => (c.id === $chatId ? { ...c, title: data } : c))
                    );
                }

                syncMessage();
            };

            // 5. Hot loop - handle streamed response token-by-token
            // TODO - is it possible to accidentally skip updates because `update` contains
            // multitudes?
            for await (const update of textStream) {
                // Another chat is open now: stop following here (the reply carries on)
                if (seq !== streamSeq) return;

                if (update.error) {
                    generating = false;
                    generationController = null;
                    responseMessage.error = { content: update.error };
                    responseMessage.done = true;
                    history.messages[responseMessage.id] = responseMessage;
                    await tick();
                    break;
                }

                // Physical stream close
                if (update.done) break;

                // Update prompt processing speed, TPS, context used/context total
                if (update.timings || update.promptProgress) {
                    updateStreamContext(update.timings, update.promptProgress);
                }

                if (update.backendEvent) {
                    backendEventHandler(update.backendEvent);
                    continue;
                }

                if (update.reasoning) {
                    handleReasoning(update.reasoning);
                    continue;
                }

                if (modelStatus) modelStatus = undefined;

                if (update.value !== '' || update.usage) {
                    handleContentToken(update.value, update.usage);
                }
            }

            // 6. The stream ended without the reply finishing: the connection dropped
            // (e.g. iOS suspended the app). The reply carries on on the backend, so
            // reconnect to it, unless the user stopped it.
            if (!responseMessage.done) {
                finalizeReasoning();
                finalizeToolCalls();
                if (stoppedByUser) {
                    responseMessage.done = true;
                } else {
                    generating = false;
                    generationController = null;
                    scheduleResume(model, responseMessage.id);
                }
                syncMessage();
                await tick();
            } else {
                resumeAttempts = 0;
            }

            toolProgress = undefined;
            modelStatus = undefined;
        } catch (error) {
            if (seq !== streamSeq) return; // another chat is open now
            console.error('SSE streaming error:', error);

            // Stopped by the user, or the connection dropped (the reply carries on on
            // the backend): neither is an error in the reply.
            if (stoppedByUser || (error as any)?.name === 'AbortError' || error instanceof TypeError) {
                for (const block of responseMessage.blocks ?? []) {
                    if (block.type === 'tool_call' && !block.done) block.done = true;
                }
                toolProgress = undefined;
                modelStatus = undefined;
                generating = false;
                generationController = null;
                if (stoppedByUser) {
                    responseMessage.done = true;
                    history.messages[responseMessage.id] = responseMessage;
                    history = history;
                } else {
                    scheduleResume(model, responseMessage.id);
                }
                return;
            }

            // TODO: This is a hack because I was too lazy to enable finalizeToolCalls
            // scoped within this error handler.
            //
            // Finalize any in-progress tool call blocks so they don't stay stuck
            for (const block of responseMessage.blocks ?? []) {
                if (block.type === 'tool_call' && !block.done) {
                    block.done = true;
                }
            }
            toolProgress = undefined;
            modelStatus = undefined;
            responseMessage.error = {
                content:
                    typeof error === 'string' ? error : (error as any)?.message || 'Unknown error'
            };
            responseMessage.done = true;
            history.messages[responseMessage.id] = responseMessage;
            history = history;

            toast.error(`${error}`);
        }
    };

    const stopResponse = async () => {
        if (generating) {
            stoppedByUser = true;
            generating = false;
            // The reply runs on the backend: stop it there (it keeps what it wrote)
            if ($chatId) void stopChatCompletion(localStorage.token, $chatId).catch(() => {});
            generationController?.abort();
            generationController = null;
            // The sidebar spinner clears when the poll sees the reply has ended,
            // which is after the backend has saved what it wrote
        }
    };

    const regenerateResponse = async (message: ChatMessage) => {
        console.log('regenerateResponse');

        if (history.currentId && message.parentId) {
            let userMessage = history.messages[message.parentId];

            if (!userMessage) {
                toast.error('Parent message not found');
                return;
            }

            await sendMessage(userMessage);
        }
    };

    const MAX_DRAFT_LENGTH = 5000;
    let saveDraftTimeout: ReturnType<typeof setTimeout> | null = null;

    type Draft = {
        prompt: string;
        files: ChatMessageFile[];
        disabledToolServers: string[];
    };

    // Drafts live in localStorage, which survives iOS discarding the app (session
    // storage doesn't), and are written at once when the app is hidden.
    let pendingDraft: { key: string; draft: Draft } | null = null;
    const flushDraft = () => {
        if (saveDraftTimeout) clearTimeout(saveDraftTimeout);
        saveDraftTimeout = null;
        if (!pendingDraft) return;
        try {
            localStorage.setItem(pendingDraft.key, JSON.stringify({ ...pendingDraft.draft, savedAt: Date.now() }));
        } catch {
            /* storage full: the draft is lost, as before */
        }
        pendingDraft = null;
    };

    const saveDraft = async (draft: Draft, chatId: string | null = null) => {
        if (saveDraftTimeout) {
            clearTimeout(saveDraftTimeout);
        }

        if (
            draft.prompt !== null &&
            draft.prompt.length > 0 &&
            draft.prompt.length < MAX_DRAFT_LENGTH
        ) {
            pendingDraft = { key: `chat-input${chatId ? `-${chatId}` : ''}`, draft };
            saveDraftTimeout = setTimeout(flushDraft, 500);
        } else {
            pendingDraft = null;
            localStorage.removeItem(`chat-input${chatId ? `-${chatId}` : ''}`);
        }
    };

    const clearDraft = async (chatId = null) => {
        if (saveDraftTimeout) {
            clearTimeout(saveDraftTimeout);
        }
        localStorage.removeItem(`chat-input${chatId ? `-${chatId}` : ''}`);
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
                chats.set(await getChatList(localStorage.token, 1));

                toast.success('Chat moved successfully');
            }
        } else {
            toast.error('Failed to move chat');
        }
    };
</script>

<svelte:head>
    <title>
        {$chatTitle
            ? `${$chatTitle.length > 30 ? `${$chatTitle.slice(0, 30)}...` : $chatTitle}`
            : `New Chat`}
    </title>
</svelte:head>

<div
    class="h-full transition-width duration-200 ease-in-out {$showSidebar
        ? '  md:max-w-[calc(100%-var(--sidebar-width))]'
        : ' '} w-full max-w-full flex flex-col"
    id="chat-container"
>
    {#if loading}
        <div class=" flex items-center justify-center h-full w-full">
            <div class="m-auto">
                <Spinner className="size-5" />
            </div>
        </div>
    {:else}
        <div class="w-full h-full flex min-h-0">
        <div class="flex-1 min-w-0 h-full flex flex-col">
            <Navbar
                chatId={$chatId}
                chatTitle={$chatTitle || 'New Chat'}
                {history}
                shareEnabled={!!history.currentId}
                {moveChatHandler}
                onSaveTempChat={async () => {
                    try {
                        if (!history?.currentId || !Object.keys(history.messages).length) {
                            toast.error('No conversation to save');
                            return;
                        }
                        const msgs = createMessagesList(history, history.currentId);
                        const title = msgs.find((m) => m.role === 'user')?.content ?? 'New Chat';

                        const savedChat = await createNewChat(localStorage.token, {
                            title: title.length > 50 ? `${title.slice(0, 50)}...` : title,
                            model: $selectedModel?.id ?? '',
                            history: history,
                            timestamp: Date.now()
                        });

                        if (savedChat) {
                            temporaryChatEnabled.set(false);
                            chatId.set(savedChat.id);
                            await reloadChatList();

                            await goto(`/c/${savedChat.id}`);
                            toast.success('Conversation saved successfully');
                        }
                    } catch (error) {
                        console.error('Error saving conversation:', error);
                        toast.error('Failed to save conversation');
                    }
                }}
            />

            <SystemPromptSaveModal
                bind:show={showSystemPromptSaveModal}
                systemPrompt={pendingSystemPromptEdit}
                folder={$selectedFolder}
                model={$selectedModel}
                user={$user}
                onSave={async ({ target, prompt }) => {
                    await saveSystemPrompt(target, prompt);
                    showSystemPromptSaveModal = false;
                }}
            />

            <div class="flex flex-col flex-auto z-10 w-full @container overflow-hidden min-h-0">
                {#if hasMessages || systemPromptVisible}
                    <div
                        class=" pb-16 flex flex-col justify-between w-full flex-auto overflow-auto h-0 max-w-full z-10 scrollbar-hidden"
                        id="messages-container"
                        bind:this={messagesContainerElement}
                        on:scroll={() => {
                            isAtBottom = !hasScrollableContent();
                        }}
                    >
                        <div class=" h-full w-full flex flex-col pt-2">
                            {#if usingCustomPrompt}
                                <div
                                    class="mx-auto max-w-3xl w-full px-4 mb-2"
                                    transition:fade={{ duration: 150 }}
                                >
                                    <div
                                        class="flex items-center gap-2 px-3 py-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                                    >
                                        <InfoCircle className="size-4 shrink-0" strokeWidth="1.5" />
                                        <span>
                                            {systemPromptSource === 'folder' && $selectedFolder
                                                ? `Folder "${$selectedFolder.name}" uses a custom system prompt`
                                                : 'Using a custom system prompt'}
                                        </span>
                                    </div>
                                </div>
                            {/if}

                            {#if systemPromptVisible}
                                {#if noPromptDefined}
                                    <div
                                        class="mx-auto max-w-3xl w-full px-4 mb-2"
                                        transition:fade={{ duration: 150 }}
                                    >
                                        <div
                                            class="flex items-center gap-2 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg"
                                        >
                                            <InfoCircle
                                                className="size-4 shrink-0"
                                                strokeWidth="1.5"
                                            />
                                            <span>{'System prompt not defined'}</span>
                                        </div>
                                    </div>
                                {/if}
                                <SystemPromptMessage
                                    systemPrompt={resolvedSystemPrompt}
                                    onSave={(content) => {
                                        pendingSystemPromptEdit = content;
                                        showSystemPromptSaveModal = true;
                                    }}
                                />
                            {/if}

                            {#if hasMessages}
                                <Messages
                                    chatId={$chatId}
                                    bind:history
                                    {sendMessage}
                                    {regenerateResponse}
                                    {toolProgress}
                                    {quietSeconds}
                                    {modelStatus}
                                    bottomPadding={files.length > 0}
                                    onBranchScroll={() => scrollToBottom()}
                                />
                            {/if}
                        </div>
                    </div>
                {/if}

                <div
                    class={hasMessages || systemPromptVisible
                        ? `${$mobile ? ($virtualKeyboardOpen ? 'pb-2' : 'pb-8') : 'pb-5'} z-10 relative ${$mobile && $isEditingMessage ? 'hidden' : ''}`
                        : `h-full flex flex-col items-center ${$mobile ? 'justify-end pb-5' : 'justify-center'}`}
                >
                    {#if !hasMessages && !systemPromptVisible}
                        <div class="w-full max-w-6xl px-2 @2xl:px-20 pt-16 text-center">
                            {#if $temporaryChatEnabled}
                                <Tooltip
                                    content="This chat won't appear in history and your messages will not be saved."
                                    className="w-full flex justify-center mb-0.5"
                                    placement="top"
                                >
                                    <div
                                        class="flex items-center gap-2 text-gray-500 text-base my-2 w-fit"
                                    >
                                        <EyeSlash
                                            strokeWidth="2.5"
                                            className="size-4"
                                        />{'Temporary Chat'}
                                    </div>
                                </Tooltip>
                            {/if}

                            <div
                                class="w-full text-3xl text-gray-800 dark:text-gray-100 text-center flex items-center gap-4"
                                style="font-family: 'Source Serif 4', 'InstrumentSerif', Georgia, serif;"
                            >
                                <div class="w-full flex flex-col justify-center items-center">
                                    {#if $selectedFolder}
                                        <FolderTitle
                                            folder={$selectedFolder}
                                            onUpdate={async () => {
                                                currentChatPage.set(1);
                                                chats.set(
                                                    await getChatList(
                                                        localStorage.token,
                                                        1
                                                    )
                                                );
                                            }}
                                            onDelete={async () => {
                                                currentChatPage.set(1);
                                                chats.set(
                                                    await getChatList(
                                                        localStorage.token,
                                                        1
                                                    )
                                                );
                                                selectedFolder.set(null);
                                            }}
                                        />
                                    {:else}
                                        <div
                                            class="flex flex-row justify-center gap-3 @sm:gap-3.5 w-fit px-5 max-w-xl"
                                        >
                                            <div
                                                class="text-3xl @sm:text-3xl line-clamp-1 flex items-center"
                                                in:fade={{ duration: 100 }}
                                            >
                                                Welcome, {$user?.username}
                                            </div>
                                        </div>
                                    {/if}
                                </div>
                            </div>

                            {#if usingCustomPrompt}
                                <div
                                    class="mx-auto max-w-3xl w-full px-4 mt-4"
                                    transition:fade={{ duration: 150 }}
                                >
                                    <div
                                        class="flex items-center gap-2 px-3 py-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg"
                                    >
                                        <InfoCircle className="size-4 shrink-0" strokeWidth="1.5" />
                                        <span>
                                            {systemPromptSource === 'folder' && $selectedFolder
                                                ? `Folder "${$selectedFolder.name}" uses a custom system prompt`
                                                : 'Using a custom system prompt'}
                                        </span>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/if}

                    <div
                        class={!hasMessages && !systemPromptVisible
                            ? 'text-base font-normal @md:max-w-3xl w-full py-3'
                            : ''}
                    >
                        <MessageInput
                            bind:this={messageInput}
                            {history}
                            bind:files
                            bind:prompt
                            showScrollButton={!isAtBottom && (hasMessages || systemPromptVisible)}
                            onScrollToBottomClick={() => {
                                isAtBottom = true;
                                scrollToBottom();
                            }}
                            bind:disabledToolServers
                            bind:sandboxEnabled
                            bind:sandboxOpen
                            {sandboxVisible}
                            onSandboxFiles={addFilesToSandbox}
                            onSandboxToggle={saveSandboxToggle}
                            bind:systemPromptVisible
                            {generating}
                            {stopResponse}
                            placeholder={!hasMessages && !systemPromptVisible
                                ? 'How can I help you today?'
                                : ''}
                            onChange={(data) => {
                                if (!$temporaryChatEnabled) {
                                    saveDraft(data, $chatId);
                                }
                                if ($selectedModel && data.prompt.length > 0) {
                                    triggerWake($selectedModel);
                                }
                            }}
                            on:submit={async (e) => {
                                clearDraft();
                                if (e.detail || files.length > 0) {
                                    await tick();
                                    submitPrompt(e.detail.replaceAll('\n\n', '\n'));
                                }
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
        {#if sandboxOpen}
            <SandboxDrawer
                bind:path={sandboxPath}
                chatId={$chatId}
                refresh={sandboxRefresh}
                onClose={() => (sandboxOpen = false)}
                ensureChatId={ensureChatIdForSandbox}
                onUploaded={(names) => {
                    sandboxUploads = [...sandboxUploads, ...names];
                    sandboxActivated = true;
                    sandboxAutoOpened = true;
                }}
            />
        {/if}
        </div>
    {/if}
</div>

<style>
    ::-webkit-scrollbar {
        height: 0.5rem;
        width: 0.5rem;
    }
</style>
