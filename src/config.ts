import * as fs from 'fs';

export type ModelConfig = {
    path: string,
    base: {
        name: string,
        url: string,
        ctxSize: number,
    },
    ocr: {
        name: string,
        url: string,
        mmprojUrl: string,
        ctxSize: number,
    }
}

export type ConfigBase = {
    braveAPIKey: string,
    logPath: string,
    sleepAfterXSeconds: number,
    llamaServer: {
        useSubmodule: boolean,
    },
    models: ModelConfig,
};

// TODO - default values if unset
export function readConfig(path: string): ConfigBase {
    let cfg = JSON.parse(fs.readFileSync(path, 'utf-8')) as ConfigBase;
    
    if (!(cfg.models.base.ctxSize as any)) cfg.models.base.ctxSize = 0;
    if (!(cfg.models.ocr.ctxSize as any)) cfg.models.ocr.ctxSize = 0;

    return cfg;
}