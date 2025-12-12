import * as fs from 'fs';
import path from 'path';

import * as proto from './protocol.js';

export type ConfigBase = {
    llamaCpp: LlamaCppConfig,
    web: WebConfig,
    logs: LogConfig,
    models: ModelConfig,
};

export type LlamaCppConfig = {
    sleepAfterXSeconds: number,
};

export type WebConfig = {
    braveAPIKey: string,
    enable: boolean,
    runDangerouslyWithoutSandbox: boolean,
    screenshotWebpages: boolean,
};

export type LogConfig = {
    path: string,
    enable: boolean,
};

export type ModelConfig = {
    path: string,
    onStart: string,
    infos: proto.ModelInfo[],
};

type ModelFile = {
    params?: string[],
    // tools?: string[],
}

// TODO - default values if unset
export async function readConfig(path: string): Promise<ConfigBase> {
    let base = JSON.parse(fs.readFileSync(path, 'utf-8')) as ConfigBase;
    base.models.infos = await loadModelInfo(base.models.path);

    return base;
}

// Check for models locally as specified by config
async function loadModelInfo(modelsPath: string): Promise<proto.ModelInfo[]> {
    const dirEntries = await fs.promises.readdir(modelsPath, { withFileTypes: true });
    const modelInfos: proto.ModelInfo[] = [];

    for (const entry of dirEntries) {
        if (!entry.isDirectory()) continue;

        const subdirName = entry.name;
        const subdirPath = path.join(modelsPath, subdirName);
        const files = await fs.promises.readdir(subdirPath);

        // required: a .gguf file that does NOT contain "mmproj" in its name
        const mainModelFiles = files.filter((f) => f.endsWith('.gguf') && !f.includes("mmproj"));
        if (mainModelFiles.length === 0) {
            throw new Error(`config.loadModelInfo: expected ${subdirPath} to contain a non-mmproj model file`);
        }

        const mainModelPath = path.join(subdirPath, mainModelFiles.at(0)!)

        // optional: mmproj-*.gguf
        const mmprojFile = files.find((f) => f.endsWith('.gguf') && f.startsWith("mmproj"));
        const mmprojPath = mmprojFile
            ? path.join(subdirPath, mmprojFile)
            : undefined;

        // optional: model.json
        const modelFile = files.includes("model.json")
            ? path.join(subdirPath, "model.json")
            : undefined;

        let params: string[] = [];
        if (modelFile) {
            const raw = await fs.promises.readFile(modelFile, "utf8");

            let parsed;
            try {
                parsed = JSON.parse(raw) as ModelFile;
            } catch {
                throw new Error(`config.loadModelInfo: invalid JSON in ${modelFile}`);
            }

            if (parsed.params) {
                params = parsed.params;
            }
        }

        modelInfos.push({
            name: subdirName,
            path: mainModelPath,
            mmprojPath: mmprojPath,
            params: params,
        });
    }

    return modelInfos;
}