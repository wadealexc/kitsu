import { describe, test } from 'node:test';
import assert from 'node:assert';

import { accumulateUsage, getFinalUsage, newUsageInfo } from '../../src/routes/completions/helpers.js';

const round = (cache_n: number, prompt_n: number, prompt_ms: number, predicted_n: number, predicted_ms: number) => ({
    id: 'x', object: 'chat.completion', created: 0, model: 'm', choices: [],
    timings: { cache_n, prompt_n, prompt_ms, prompt_per_token_ms: 0, prompt_per_second: 0, predicted_n, predicted_ms, predicted_per_token_ms: 0, predicted_per_second: 0 },
}) as any;

describe('usage', () => {
    test('a reply with a tool round: context, what it added, and real speeds', () => {
        let usage = newUsageInfo();
        // Round 1: 10,000-token conversation, 9,900 cached; writes a 50-token tool call
        usage = accumulateUsage(usage, round(9_900, 100, 50, 50, 500));
        // Round 2: the tool result (2,000 tokens) is new; writes a 300-token answer
        usage = accumulateUsage(usage, round(10_050, 2_000, 1_000, 300, 3_000));
        const final = getFinalUsage(usage);

        assert.strictEqual(final.context_tokens, 12_350);
        assert.strictEqual(final.message_tokens, 2_350, 'tool call + tool result + answer');
        assert.strictEqual(final.completion_tokens_per_second, 350 / 3.5);
        assert.strictEqual(final.prompt_tokens_per_second, 2_100 / 1.05, 'processed tokens only, not cached ones');
    });

    test('no timings: no speeds', () => {
        const final = getFinalUsage(newUsageInfo());
        assert.strictEqual(final.prompt_tokens_per_second, undefined);
        assert.strictEqual(final.context_tokens, undefined);
    });
});
