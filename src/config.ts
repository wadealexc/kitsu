import * as fs from 'fs';
import path from 'path';

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
    infos: ModelInfo[],
};

// TODO - default values if unset
export async function readConfig(path: string): Promise<ConfigBase> {
    let base = JSON.parse(fs.readFileSync(path, 'utf-8')) as ConfigBase;
    base.models.infos = await loadModelInfo(base.models.path);

    return base;
}

export interface ModelInfo {
    name: string;
    path: string;                        // required: non-mmproj .gguf
    mmprojPath: string | undefined;      // optional: mmproj-*.gguf
    params: string[] | undefined;        // optional: params.json
}

// Check for models locally as specified by config
async function loadModelInfo(modelsPath: string): Promise<ModelInfo[]> {
    const dirEntries = await fs.promises.readdir(modelsPath, { withFileTypes: true });
    const modelInfos: ModelInfo[] = [];

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

        // optional: params.json
        const paramsFile = files.includes("params.json")
            ? path.join(subdirPath, "params.json")
            : undefined;

        let params: string[] | undefined = undefined;
        if (paramsFile) {
            const raw = await fs.promises.readFile(paramsFile, "utf8");

            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch {
                throw new Error(`config.loadModelInfo: invalid JSON in ${paramsFile}`);
            }

            if (!Array.isArray(parsed)) {
                throw new Error(`config.loadModelInfo: params.json in ${subdirName} must contain an array`);
            }

            // params.json must contain an array where each element is a number or string
            for (const el of parsed) {
                const t = typeof el;
                if (t !== "string" && t !== "number") {
                    throw new Error(`config.loadModelInfo: ${paramsFile} must contain an array of only strings or numbers`);
                }
            }

            params = parsed.map((v) => String(v));
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