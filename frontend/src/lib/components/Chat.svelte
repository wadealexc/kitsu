<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { onDestroy, onMount, tick } from 'svelte';
    import { fade } from 'svelte/transition';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    import { type Unsubscriber } from 'svelte/store';

    import type {
        ChatResponse,
        ChatHistory,
        ChatMessage,
        ChatMessageFile,
        ChatMessageUsage,
        ToolCallBlock,
        ContentBlock,
        ReasoningBlock,
        FolderModel
    } from '@backend/routes/types.js';
    import type { SseEvent } from '@backend/routes/sseEvents.js';
    import type { Message } from '@backend/protocol';

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
        isEditingMessage
    } from '$lib/stores';
    import { wakeModel } from '$lib/apis/models';

    import {
        appendMessage,
        createMessagesList,
        expandMessageBlocks,
        getPromptVariables,
        applyPromptVariables
    } from '$lib/utils';

    import {
        createNewChat,
        getChatById,
        getChatList,
        updateChatById,
        updateChatFolderIdById
    } from '$lib/apis/chats';
    import { chatCompletion } from '$lib/apis/chat';
    import { getAndUpdateUserLocation } from '$lib/apis/users';
    import {
        createOpenAITextStream,
        type StreamTimings,
        type PromptProgress,
        type WebSearchProgress
    } from '$lib/apis/streaming';
    import { getFolderById, updateFolderById } from '$lib/apis/folders';

    import MessageInput from '$lib/components/chat/MessageInput.svelte';
    import Messages from '$lib/components/chat/Messages.svelte';
    import Navbar from '$lib/components/Navbar.svelte';
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
    let autoScroll: boolean = true;
    /// An observer attached to the messages container to dispatch scrollToBottom
    /// calls as stream input is rendered.
    ///
    /// scrollObserver uses scrollPending to deduplicate scrollToBottom calls
    let scrollObserver: MutationObserver | null = null;
    let scrollPending: boolean = false;
    /// Set to true when we're programmatically scrolling. Used to check if a scroll
    /// event came from the user.
    let programmaticScroll: boolean = false;

    let webSearchEnabled: boolean = false;
    let systemPromptVisible: boolean = false;
    let showSystemPromptSaveModal: boolean = false;
    let pendingSystemPromptEdit: string = '';
    // System prompt staged for a new chat that doesn't exist in DB yet
    let pendingChatSystemPrompt: string = '';
    let savedScrollState: { scrollTop: number; autoScroll: boolean } | null = null;
    let prevSystemPromptVisible: boolean = false;

    let generating: boolean = false;
    let generationController: AbortController | null = null;

    let toolProgress: Map<string, WebSearchProgress> | undefined = undefined;
    let modelStatus: { status: 'queued' | 'loading'; modelName: string } | undefined = undefined;

    let chat: ChatResponse | null = null;

    let history: ChatHistory = {
        messages: {},
        currentId: null
    };

    $: hasMessages = history.currentId != null;

    // Chat Input
    let prompt: string = '';
    let files: ChatMessageFile[] = [];

    let lastSelectedModelId: string | undefined;

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

    $: if (autoScroll && files.length > 0 && messagesContainerElement) {
        scrollToBottom();
    }

    /**
     * Executed on page load
     */
    const navigateHandler = async () => {
        console.log('navigateHandler');

        loading = true;

        prompt = '';
        messageInput?.setText('');

        files = [];
        webSearchEnabled = $settings.webSearch;
        systemPromptVisible = false;
        pendingChatSystemPrompt = '';
        selectedFolder.set(null);

        const pageLoaded = chatIdProp ? await loadChat() : false;
        if (!pageLoaded) {
            console.error(`navigateHandler: failed to load page for chat id ${chatIdProp}`);
            await goto('/');
            return;
        }

        const storageChatInput = sessionStorage.getItem(`chat-input-${chatIdProp}`);

        await tick();
        loading = false;
        window.setTimeout(() => scrollToBottom(), 0);

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
                    webSearchEnabled = input.webSearchEnabled;
                }
            } catch (e) {}
        }

        if (!$mobile) {
            const chatInput = document.getElementById('chat-input');
            chatInput?.focus();
        }
    };

    const resolveModel = (id: string): Model | null =>
        $models.find((m) => m.id === id && m.is_active) ?? null;

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

    // sseEventHandler handles named backend events embedded in the SSE stream.
    const sseEventHandler = async (event: SseEvent, responseMessage: ChatMessage) => {
        console.log(`sseEventHandler: ${JSON.stringify(event)}`);

        const { type, data } = event.data;

        if (type === 'chat:completion') {
            responseMessage.usage = data.usage;
        } else if (type === 'chat:message:error') {
            responseMessage.error = data.error;
        } else if (type === 'chat:title') {
            console.log(`got chat title: ${data}`);
            chatTitle.set(data);

            // Optimistic sidebar title update
            chats.update((list) =>
                (list ?? []).map((c) => (c.id === $chatId ? { ...c, title: data } : c))
            );
        }

        history.messages[responseMessage.id] = responseMessage;
    };

    // Set selectedModel to current folder model, if set
    const setModelFromFolder = (folder: FolderModel) => {
        if (folder.data?.model_id && $selectedModel?.id !== folder.data.model_id) {
            selectedModel.set(resolveModel(folder.data.model_id));
            console.log('Set selectedModel from folder data:', folder.data.model_id);
        }
    };

    // Sync current folder model with backend
    const persistFolderModel = async (folder: FolderModel, model: Model) => {
        if (folder.data?.model_id !== model.id) {
            await updateFolderById(localStorage.token, folder.id, {
                data: {
                    model_id: model.id
                }
            });
        }
    };

    $: if ($selectedFolder && $selectedModel) {
        persistFolderModel($selectedFolder, $selectedModel);
    }

    let pageUnsubscribe: Unsubscriber;
    let selectedFolderUnsubscribe: Unsubscriber;

    // When the virtual keyboard opens/closes, re-scroll the messages container
    // to the bottom so the last message stays visible after the layout shrinks.
    const onViewportResize = () => {
        if (autoScroll) scrollToBottom();
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

        const storageChatInput = sessionStorage.getItem(
            `chat-input${chatIdProp ? `-${chatIdProp}` : ''}`
        );

        if (!chatIdProp) {
            loading = false;
            await tick();
        }

        webSearchEnabled = $settings.webSearch;

        if (storageChatInput) {
            prompt = '';
            messageInput?.setText('');

            files = [];

            try {
                const input = JSON.parse(storageChatInput);

                if (!$temporaryChatEnabled) {
                    messageInput?.setText(input.prompt);
                    files = input.files;
                    webSearchEnabled = input.webSearchEnabled;
                }
            } catch (e) {}
        }

        // When navigating to a folder, set selectedModel to the last
        // model we used in that folder.
        // TODO - this should be more visible, either in folder settings or apparent
        // when using the folder that it has an associated model.
        selectedFolderUnsubscribe = selectedFolder.subscribe(async (folder: FolderModel | null) => {
            if (folder) setModelFromFolder(folder);
        });

        const chatInput = document.getElementById('chat-input');
        chatInput?.focus();

        window.visualViewport?.addEventListener('resize', onViewportResize);
    });

    onDestroy(() => {
        scrollObserver?.disconnect();
        window.visualViewport?.removeEventListener('resize', onViewportResize);
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
            const availableModels = $models.filter((m) => m.is_active);
            let candidateId: string = '';

            if ($selectedFolder?.data?.model_id) {
                candidateId = $selectedFolder.data.model_id;
            } else if (sessionStorage.selectedModel) {
                candidateId = sessionStorage.selectedModel;
                sessionStorage.removeItem('selectedModel');
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

        autoScroll = true;

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

        chat = await getChatById(localStorage.token, $chatId).catch(async (error) => {
            console.error(`loadChat: error fetching chat ${$chatId}: ${error}`);
            await goto('/');
            return null;
        });

        if (!chat) return false;

        const chatContent = chat.chat;

        selectedModel.set(resolveModel(chatContent.model));
        chatTitle.set(chatContent.title);

        // Load folder data so the folder system prompt is available for resolution
        if (chat.folder_id) {
            const folder = await getFolderById(localStorage.token, chat.folder_id).catch(
                () => null
            );
            if (folder) selectedFolder.set(folder);
        } else {
            selectedFolder.set(null);
        }

        autoScroll = true;
        webSearchEnabled = chatContent.webSearchEnabled ?? $settings.webSearch;

        history = chatContent.history;
        await tick();

        // Note: can restrict to just string | null?
        if (history.currentId) {
            // Note: ... why?
            for (const message of Object.values(history.messages)) {
                if (message && message.role === 'assistant') {
                    message.done = true;
                }
            }
        }

        await tick();
        return true;
    };

    const scrollToBottom = async () => {
        await tick();
        if (!messagesContainerElement) return;
        programmaticScroll = true;
        messagesContainerElement.scrollTo({
            top: messagesContainerElement.scrollHeight,
            behavior: 'auto'
        });
        // Double-rAF ensures programmaticScroll clears after the scroll event fires.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                programmaticScroll = false;
            });
        });
    };

    const scrollToTop = async () => {
        autoScroll = false; // set before tick so MutationObserver won't fire scrollToBottom during DOM update
        await tick();
        if (!messagesContainerElement) return;
        programmaticScroll = true;
        messagesContainerElement.scrollTo({ top: 0, behavior: 'auto' });
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                programmaticScroll = false;
            });
        });
    };

    $: {
        if (systemPromptVisible && !prevSystemPromptVisible) {
            // toggle ON — save current scroll state, scroll to top
            if (messagesContainerElement) {
                savedScrollState = { scrollTop: messagesContainerElement.scrollTop, autoScroll };
            }
            scrollToTop();
        } else if (!systemPromptVisible && prevSystemPromptVisible) {
            // toggle OFF — restore saved scroll state
            if (savedScrollState) {
                autoScroll = savedScrollState.autoScroll;
                if (autoScroll) {
                    scrollToBottom();
                } else if (messagesContainerElement) {
                    programmaticScroll = true;
                    messagesContainerElement.scrollTo({
                        top: savedScrollState.scrollTop,
                        behavior: 'auto'
                    });
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            programmaticScroll = false;
                        });
                    });
                }
                savedScrollState = null;
            }
        }
        prevSystemPromptVisible = systemPromptVisible;
    }

    // Watch for DOM changes inside the scroll container (new tokens, markdown
    // re-renders, etc.) and scroll to bottom while autoScroll is active.
    $: if (messagesContainerElement) {
        scrollObserver?.disconnect();
        scrollObserver = new MutationObserver(() => {
            if (autoScroll && !scrollPending) {
                scrollPending = true;
                scrollToBottom().then(() => {
                    scrollPending = false;
                });
            }
        });
        scrollObserver.observe(messagesContainerElement, {
            childList: true,
            subtree: true,
            characterData: true
        });
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
                base_model_id: $selectedModel.base_model_id,
                name: $selectedModel.name,
                meta: $selectedModel.meta,
                params: { ...$selectedModel.params, system: newPrompt },
                isPublic: $selectedModel.isPublic,
                is_active: $selectedModel.is_active
            });
            models.update((ms) => ms.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
            selectedModel.update((m) =>
                m ? { ...m, params: { ...m.params, system: newPrompt } } : m
            );
        } else if (target === 'new-model' && $selectedModel) {
            const newModel = await createNewModel(localStorage.token, {
                id: crypto.randomUUID(),
                base_model_id: $selectedModel.base_model_id,
                name: `${$selectedModel.name} (Custom)`,
                meta: $selectedModel.meta,
                params: { ...$selectedModel.params, system: newPrompt },
                isPublic: false,
                is_active: true
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

        if (
            files.length > 0 &&
            files.filter((file) => file.type !== 'image' && file.status === 'uploading').length > 0
        ) {
            toast.error(
                `Oops! There are files still uploading. Please wait for the upload to complete.`
            );
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
        await sendMessage(userMessage, { newChat: true });
    };

    const sendMessage = async (
        userMessage: ChatMessage,
        { newChat = false }: { newChat?: boolean } = {}
    ) => {
        if (autoScroll) {
            scrollToBottom();
        }

        // Determine the model to use
        const model = $selectedModel;
        if (!model) {
            toast.error(`Model not found`);
            return;
        }

        // Create response message and append to live history
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

        history = history;
        let _chatId: string = $chatId;

        // Generate a chat ID for the first message in the conversation
        if (newChat && !userMessage.parentId) {
            _chatId = await initChatHandler();
        }

        await tick();
        scrollToBottom();

        await sendMessageSSE(
            model,
            userMessage,
            responseMessage,
            _chatId,
            newChat && !userMessage.parentId
        );
    };

    /**
     * Generates a chat ID locally. For non-temporary chats the backend will
     * create the DB record on the first completion request.
     */
    const initChatHandler = async (): Promise<string> => {
        if ($temporaryChatEnabled) {
            const _chatId = `local:${crypto.randomUUID()}`;
            chatId.set(_chatId);
            return _chatId;
        }

        const _chatId = crypto.randomUUID();
        chatId.set(_chatId);
        window.history.replaceState(null, '', `/c/${_chatId}`);

        // Optimistic sidebar insert so the entry appears immediately
        chats.update((list) => [
            {
                id: _chatId,
                title: 'New Chat',
                updated_at: Date.now() / 1000,
                created_at: Date.now() / 1000,
                time_range: ''
            },
            ...(list ?? [])
        ]);

        return _chatId;
    };

    /**
     * Builds the data needed to make a chat completion API call:
     * syncs chatFiles, collects per-request files, fetches user location,
     * determines stream setting, and formats the OpenAI message array.
     */
    const buildChatRequest = async (responseMessage: ChatMessage, model: Model) => {
        const _messages = createMessagesList(history, responseMessage.id);

        // Get user location if enabled
        let userLocation;
        if ($settings.userLocation) {
            userLocation = await getAndUpdateUserLocation(localStorage.token).catch((err) => {
                console.error(err);
                return undefined;
            });
        }

        // Stream setting: prefer model-level, default true
        const stream = model.params.stream_response ?? true;

        // Build OpenAI-format message array, excluding the empty response message slot
        const systemPrompt = applyPromptVariables(
            resolvedSystemPrompt,
            getPromptVariables($user?.username, userLocation ?? undefined)
        );
        const priorMessages = _messages.filter((m) => m.id !== responseMessage.id);
        const hasSystemPrompt = priorMessages.some((m) => m.role === 'system');

        const messages: Message[] = [
            ...(hasSystemPrompt ? [] : [{ role: 'system' as const, content: systemPrompt }]),
            ...priorMessages.flatMap((message): Message[] => {
                if (message.role === 'assistant') {
                    return expandMessageBlocks(message);
                } else if (message.role === 'user') {
                    const imageFiles = message.files.filter(
                        (file) => file.type === 'image' || file.contentType.startsWith('image/')
                    );
                    const textFiles = message.files.filter(
                        (file) =>
                            file.type !== 'image' &&
                            !file.contentType.startsWith('image/') &&
                            file.content
                    );
                    if (imageFiles.length > 0 || textFiles.length > 0) {
                        return [
                            {
                                role: 'user',
                                content: [
                                    { type: 'text', text: message.content },
                                    ...imageFiles.map((file) => ({
                                        type: 'image_url' as const,
                                        image_url: { url: file.url ?? '' }
                                    })),
                                    ...textFiles.map((file) => ({
                                        type: 'text' as const,
                                        text: `[File: ${file.name}]\n${file.content}`
                                    }))
                                ]
                            }
                        ];
                    }
                    return [{ role: 'user', content: message.content }];
                }
                return [{ role: 'system', content: message.content }];
            })
        ];

        return { messages, stream, systemPrompt };
    };

    const sendMessageSSE = async (
        model: Model,
        userMessage: ChatMessage,
        responseMessage: ChatMessage,
        _chatId: string,
        generateTitle: boolean = false
    ) => {
        console.log(`sendMessageSSE | model: ${model.name}`);

        // 1. Build request
        const { messages, stream, systemPrompt } = await buildChatRequest(responseMessage, model);

        try {
            // 2. API call
            const [res, controller] = await chatCompletion(localStorage.token, {
                stream: stream,
                model: model.id,
                messages: messages,
                chatId: $chatId,
                userMessage: userMessage,
                chat: {
                    title: $chatTitle || 'New Chat',
                    model: model.id,
                    history: history,
                    timestamp: Date.now(),
                    webSearchEnabled: webSearchEnabled
                },
                ...(generateTitle && $selectedFolder?.id ? { folderId: $selectedFolder.id } : {}),
                params: model.params,
                webSearchEnabled: webSearchEnabled,
                generateTitle: generateTitle,
                systemPrompt: systemPrompt
            });

            if (!res?.ok || !res.body) {
                throw new Error('Failed to get streaming response');
            }

            // 3. Stream state setup
            generationController = controller;
            generating = true;
            autoScroll = true;
            const contextTotal = model.context_length ?? 0;
            streamContext.set(null);
            toolProgress = new Map<string, WebSearchProgress>();
            modelStatus = undefined;

            const textStream = await createOpenAITextStream(res.body);

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

            const handleToolCallStart = (data: { id: string; name: string; arguments: string }) => {
                finalizeReasoning();
                // Flush any accumulated content into a ContentBlock before the tool call
                if (contentTokens.trim() !== '') {
                    responseMessage.blocks!.push({
                        type: 'content',
                        content: contentTokens,
                        done: true
                    } satisfies ContentBlock);
                    contentTokens = '';
                    responseMessage.content = '';
                }
                responseMessage.blocks!.push({
                    type: 'tool_call',
                    id: data.id,
                    name: data.name,
                    arguments: data.arguments,
                    done: false
                });
                // Track when this round of tool calls started (overwritten for each call;
                // all calls in a round are emitted back-to-back so timestamps are near-identical)
                toolCallStartTime = Date.now();
                syncMessage();
            };

            const handleToolCallResult = (data: { id: string; result: string }) => {
                const block = responseMessage.blocks!.find(
                    (b): b is ToolCallBlock => b.type === 'tool_call' && b.id === data.id
                );

                // Leave done=false — finalizeToolCalls() will set it on first token of next round
                if (block) block.result = data.result;

                syncMessage();
            };

            const handleToolCallProgress = (data: { id: string; name: string; progress: any }) => {
                if (data.name !== 'webSearch') return;
                const p = data.progress;

                if (p.type === 'search_results') {
                    toolProgress!.set(data.id, {
                        queries: p.data.queries,
                        urls: p.data.urls.map((u: any) => ({ ...u, status: 'loading' as const }))
                    });
                } else if (p.type === 'page_loaded' || p.type === 'page_failed') {
                    const state = toolProgress!.get(data.id);
                    if (state) {
                        const entry = state.urls.find((u) => u.url === p.data.url);
                        if (entry) entry.status = p.type === 'page_loaded' ? 'loaded' : 'failed';
                    }
                }

                // Trigger reactivity
                toolProgress = toolProgress;
                syncMessage();
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
                // Remove failed URL pills from toolProgress
                if (toolProgress) {
                    for (const [, state] of toolProgress) {
                        state.urls = state.urls.filter((u) => u.status !== 'failed');
                    }
                }
            };

            const handleReasoning = (text: string) => {
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
                // TODO - maybe worth extracting these into like "finalizeLastBlock"
                finalizeToolCalls();
                finalizeReasoning();
                if (value === '\n' && contentTokens === '') return;
                contentTokens += value;
                responseMessage.content = contentTokens;
                if (usage) responseMessage.usage = usage;
                syncMessage();
            };

            // 5. Hot loop - handle streamed response token-by-token
            for await (const update of textStream) {
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

                // [DONE] sentinel: tokens finished, but keep reading for backend events
                if (update.tokensDone) {
                    finalizeReasoning();
                    generating = false;
                    generationController = null;
                    responseMessage.done = true;
                    syncMessage();
                    continue;
                }

                // Update prompt processing speed, TPS, context used/context total
                if (update.timings || update.promptProgress) {
                    updateStreamContext(update.timings, update.promptProgress);
                }

                if (update.backendEvent) {
                    const { type, data } = update.backendEvent.data;
                    if (type === 'tool_call:start') handleToolCallStart(data);
                    else if (type === 'tool_call:result') handleToolCallResult(data);
                    else if (type === 'tool_call:progress') handleToolCallProgress(data);
                    else if (type === 'model:queued')
                        modelStatus = { status: 'queued', modelName: model.name };
                    else if (type === 'model:loading')
                        modelStatus = { status: 'loading', modelName: model.name };
                    else await sseEventHandler(update.backendEvent, responseMessage);
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

            // 6. Fallback: if the backend never sent a chat-event (e.g. aborted connection),
            // ensure the message is marked done.
            if (!responseMessage.done) {
                finalizeReasoning();
                finalizeToolCalls();
                responseMessage.done = true;
                syncMessage();
                await tick();
            }

            toolProgress = undefined;
            modelStatus = undefined;
        } catch (error) {
            console.error('SSE streaming error:', error);

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
            generating = false;
            generationController?.abort();
            generationController = null;
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
        webSearchEnabled: boolean;
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
            saveDraftTimeout = setTimeout(async () => {
                sessionStorage.setItem(
                    `chat-input${chatId ? `-${chatId}` : ''}`,
                    JSON.stringify(draft)
                );
            }, 500);
        } else {
            sessionStorage.removeItem(`chat-input${chatId ? `-${chatId}` : ''}`);
        }
    };

    const clearDraft = async (chatId = null) => {
        if (saveDraftTimeout) {
            clearTimeout(saveDraftTimeout);
        }
        sessionStorage.removeItem(`chat-input${chatId ? `-${chatId}` : ''}`);
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
                chats.set(await getChatList(localStorage.token, $currentChatPage));

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
        <div class="w-full h-full flex flex-col min-h-0">
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
                            id: crypto.randomUUID(),
                            title: title.length > 50 ? `${title.slice(0, 50)}...` : title,
                            model: $selectedModel?.id ?? '',
                            history: history,
                            timestamp: Date.now()
                        });

                        if (savedChat) {
                            temporaryChatEnabled.set(false);
                            chatId.set(savedChat.id);
                            chats.set(await getChatList(localStorage.token, $currentChatPage));

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
                            if (programmaticScroll) return;
                            const el = messagesContainerElement;
                            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 10;
                            autoScroll = atBottom;
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
                        ? `${$mobile ? 'pb-8' : 'pb-5'} z-10 relative ${$mobile && $isEditingMessage ? 'hidden' : ''}`
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
                                                        $currentChatPage
                                                    )
                                                );
                                            }}
                                            onDelete={async () => {
                                                currentChatPage.set(1);
                                                chats.set(
                                                    await getChatList(
                                                        localStorage.token,
                                                        $currentChatPage
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
                            showScrollButton={!autoScroll && (hasMessages || systemPromptVisible)}
                            onScrollToBottomClick={() => {
                                autoScroll = true;
                                scrollToBottom();
                            }}
                            bind:webSearchEnabled
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
    {/if}
</div>

<style>
    ::-webkit-scrollbar {
        height: 0.5rem;
        width: 0.5rem;
    }
</style>
