import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toolRoundMessages } from '../../src/routes/completions/messages.js';
import type { MessageBlock } from '../../src/routes/types/index.js';

const tool = (id: string, round: number, extra: Partial<Extract<MessageBlock, { type: 'tool_call' }>> = {}): MessageBlock => ({
    type: 'tool_call', id, name: 'bash', arguments: '{}', result: `result ${id}`, failed: false, done: true, round, ...extra,
});

describe('toolRoundMessages', () => {
    it('keeps back-to-back rounds as separate turns, and one round together', () => {
        const { messages } = toolRoundMessages([tool('a', 0), tool('b', 0), tool('c', 1)]);
        assert.deepEqual(messages.map(m => m.role), ['assistant', 'tool', 'tool', 'assistant', 'tool']);
        assert.equal((messages[0] as any).tool_calls.length, 2);
        assert.equal((messages[3] as any).tool_calls.length, 1);
    });

    it('sends a failed call as the model first saw it', () => {
        const { messages } = toolRoundMessages([tool('a', 0, { failed: true, result: 'no such file' })]);
        assert.equal(messages[1]!.content, 'Error: no such file');
    });

    it('keeps what the model said and reasoned in each round', () => {
        const { messages, reasoning } = toolRoundMessages([
            { type: 'reasoning', content: 'thinking', done: true },
            { type: 'content', content: 'Let me check.', done: true },
            tool('a', 0),
            { type: 'reasoning', content: 'done now', done: true },
        ]);
        assert.equal((messages[0] as any).content, 'Let me check.');
        assert.equal((messages[0] as any).reasoning_content, 'thinking');
        assert.equal(reasoning, 'done now');
    });

    it('gives tool images to the model in a user message after the results', () => {
        const { messages } = toolRoundMessages([tool('a', 0, { images: [{ mimeType: 'image/png', data: 'AAAA' }] })]);
        assert.deepEqual(messages.map(m => m.role), ['assistant', 'tool', 'user']);
        const parts = messages[2]!.content as any[];
        assert.equal(parts[1].image_url.url, 'data:image/png;base64,AAAA');
    });
});
