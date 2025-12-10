export interface ModelInfo {
    name: string;
    path: string;                        // required: non-mmproj .gguf
    mmprojPath: string | undefined;      // optional: mmproj-*.gguf
    params: string[];                    // optional: model.json.params
}

// https://platform.openai.com/docs/api-reference/chat/create
// (only tracking the fields we care about)
export type CompletionRequest = {
    stream?: boolean,
    model: string,
    messages: Message[],
    tools?: ToolDefinition[],
};

// Top-level tool definition provided to assistant
export type ToolDefinition = {
    type: 'function',
    function: {
        name: string,
        description?: string,
        parameters?: any,
        strict?: boolean,
    }
};

export type Message = BasicMessage | AssistantMessage | ToolMessage;

type BasicMessage = {
    role: 'user' | 'system' | 'developer',
    content: string | ContentPart[],
    name?: string,
}

type ToolMessage = {
    role: 'tool',
    tool_call_id: string,
    content: string | ContentPart[],
};

type AssistantMessage = {
    role: 'assistant',
    content: string | ContentPart[],
    reasoning_content?: string,        // Not in OAI API docs, but Aldehir's adapter uses it
    name?: string,
    refusal?: string,
    tool_calls?: AssistantToolCall[],
};

type AssistantToolCall = {
    index?: number,                    // Not in OAI API docs, but OWU supplies it
    id: string,
    type: 'function',
    function: {
        name: string,
        arguments: string,
    }
};

type ContentPart = TextContentPart | ImageContentPart;

type TextContentPart = {
    type: 'text',
    text: string,
};

type ImageContentPart = {
    type: 'image_url',
    image_url: {
        url: string,
        detail?: string,
    },
};

export type CompletionResponse = {
    created: number,
    id: string,
    model: string,
    system_fingerprint: string,
    object: string,
    usage?: {
        completion_tokens: number,
        prompt_tokens: number,
        total_tokens: number,
    },
    timings?: {
        cache_n: number,
        prompt_n: number,
        prompt_ms: number,
        prompt_per_token_ms: number,
        prompt_per_second: number,
        predicted_n: number,
        predicted_ms: number,
        predicted_per_token_ms: number,
        predicted_per_second: number,
    },
    choices: ChatChoice[],
};

export type ChatChoice = {
    finish_reason?: string,
    index: number,
    delta: ChatDelta,
};

export type ChatDelta = {
    role?: string,
    content?: string,
    reasoning_content?: string,
    refusal?: string,
    tool_calls?: ToolCall[],
};

type ToolCall = {
    index: number,
    id: string,
    type: string,
    function: {
        arguments: string,
        name: string,
    },
};

export type Result<T, E> =
    | { ok: true; value: T }
    | { ok: false; value: E };