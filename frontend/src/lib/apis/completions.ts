import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { ParsedEvent } from 'eventsource-parser';

import { API_BASE_URL } from '$lib/constants';
import type { ChatCompletionForm, ChatMessageUsage } from '@backend/routes/types';
import type { SseEvent } from '@backend/protocol/sse.js';

export type StreamTimings = {
    predicted_n: number;
    predicted_ms: number;
    predicted_per_second: number;
    prompt_n: number;
    prompt_ms: number;
    prompt_per_second: number;
    cache_n: number;
};

export type PromptProgress = {
    total: number;
    cache: number;
    processed: number;
    time_ms?: number;
};

export type UrlStatus = { url: string; hostname: string; status: 'loading' | 'loaded' | 'failed' };
/** Live progress of one tool call: the latest message, and pages in the order they started */
export type ToolProgressState = { message?: string; pages: UrlStatus[] };

export type TextStreamUpdate = {
    done: boolean;
    value: string;
    error?: any;
    usage?: ChatMessageUsage;
    /** reasoning content from choices[0].delta.reasoning_content */
    reasoning?: string;
    /** parsed payload from a named 'chat-event' SSE frame */
    backendEvent?: SseEvent;
    /** per-token timings from llama.cpp timings_per_token */
    timings?: StreamTimings;
    /** prompt evaluation progress from llama.cpp return_progress */
    promptProgress?: PromptProgress;
};

/* -------------------- API -------------------- */

export const chatCompletion = async (
    token: string,
    controller: AbortController,
    body: ChatCompletionForm,
): Promise<AsyncGenerator<TextStreamUpdate>> => {

    const route = '/chat/custom-completions';
    const res = await fetch(`${API_BASE_URL}${route}`, {
        signal: controller.signal,
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw err.detail ?? `Request failed: ${route}`;
    }

    if (!res.body) {
        throw `No response body: ${route}`;
    }

    const stream = createSSEStream(res.body);
    return stream;
};

/**
 * Follows the reply being generated in a chat: everything so far, then the rest
 * live. Replies keep running on the backend when a connection drops, so this is
 * how a client picks one back up. Resolves to null when nothing is running there.
 */
export const resumeChatCompletion = async (
    token: string,
    controller: AbortController,
    chatId: string,
): Promise<AsyncGenerator<TextStreamUpdate> | null> => {
    const route = `/chat/custom-completions/${encodeURIComponent(chatId)}/stream`;
    const res = await fetch(`${API_BASE_URL}${route}`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 404) return null;
    if (!res.ok || !res.body) throw `Request failed: ${route}`;
    return createSSEStream(res.body);
};

/** Stops the reply being generated in a chat; what it wrote so far is kept. */
export const stopChatCompletion = async (token: string, chatId: string): Promise<boolean> => {
    const res = await fetch(`${API_BASE_URL}/chat/custom-completions/${encodeURIComponent(chatId)}/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
    });
    return res.ok;
};

export type ActiveCompletion = { chatId: string; messageId: string | null; startedAt: number };

/** The user's chats with a reply being generated right now. */
export const getActiveCompletions = async (token: string): Promise<ActiveCompletion[]> => {
    const res = await fetch(`${API_BASE_URL}/chat/custom-completions/active`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return await res.json();
};

/* -------------------- STREAMING -------------------- */

// createSSEStream takes a responseBody with a SSE response,
// and returns an async generator that emits delta updates
function createSSEStream(
    responseBody: ReadableStream<Uint8Array>
): AsyncGenerator<TextStreamUpdate> {
    const eventStream = responseBody
        .pipeThrough(new TextDecoderStream() as any)
        .pipeThrough(new EventSourceParserStream())
        .getReader();

    return streamToIterator(eventStream);
}

async function* streamToIterator(
    reader: ReadableStreamDefaultReader<ParsedEvent>
): AsyncGenerator<TextStreamUpdate> {
    while (true) {
        const { value, done } = await reader.read();

        // Physical end of stream (HTTP response body closed)
        if (done) {
            yield { done: true, value: '' };
            break;
        }

        if (!value) {
            continue;
        }

        // Named backend event (e.g. 'chat-event') - route to caller for handling
        if (value.event === 'chat-event') {
            try {
                const parsedData = JSON.parse(value.data);
                yield { done: false, value: '', backendEvent: parsedData };
            } catch (e) {
                console.error('Error parsing chat-event data:', e);
            }
            continue;
        }

        // Standard unnamed SSE message
        const data = value.data;

        try {
            const parsedData = JSON.parse(data);

            if (parsedData.error) {
                yield { done: true, value: '', error: parsedData.error };
                break;
            }

            if (parsedData.usage) {
                yield { done: false, value: '', usage: parsedData.usage };
                continue;
            }

            const reasoning = parsedData.choices?.[0]?.delta?.reasoning_content;
            const content = parsedData.choices?.[0]?.delta?.content ?? '';
            const timings: StreamTimings | undefined = parsedData.timings;
            const promptProgress: PromptProgress | undefined = parsedData.prompt_progress;

            yield {
                done: false,
                value: content,
                ...(reasoning ? { reasoning } : {}),
                ...(timings ? { timings } : {}),
                ...(promptProgress ? { promptProgress } : {})
            };
        } catch (e) {
            console.error('Error extracting delta from SSE event:', e);
        }
    }
}
