import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import path from 'node:path';

import { readConfig } from '../../src/config.js';

describe('readConfig', () => {
    let dir: string;

    before(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitsu-config-'));
        fs.mkdirSync(path.join(dir, 'backend', 'logs'), { recursive: true });
    });

    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    function write(config: unknown): string {
        const file = path.join(dir, 'config.json');
        fs.writeFileSync(file, JSON.stringify(config));
        return file;
    }

    test('accepts the example config', async () => {
        const example = JSON.parse(fs.readFileSync('../config.example.json', 'utf-8'));
        const cfg = await readConfig(write(example));

        assert.strictEqual(cfg.llamaManager.url, 'http://127.0.0.1:10001');
        assert.strictEqual(cfg.logs.path, path.join(dir, 'backend', 'logs'));
    });

    test('requires llamaManager', async () => {
        const example = JSON.parse(fs.readFileSync('../config.example.json', 'utf-8'));
        delete example.llamaManager;
        await assert.rejects(readConfig(write(example)), /llamaManager/);
    });

    test('rejects settings from the old local llama.cpp runner', async () => {
        const example = JSON.parse(fs.readFileSync('../config.example.json', 'utf-8'));
        example.llamaCpp = { sleepAfterXSeconds: 600 };
        await assert.rejects(readConfig(write(example)), /llamaCpp/);
    });

    test('rejects a models list: llama-manager says which models exist', async () => {
        const example = JSON.parse(fs.readFileSync('../config.example.json', 'utf-8'));
        example.models = { models: [{ alias: 'x' }] };
        await assert.rejects(readConfig(write(example)), /models/);
    });
});
