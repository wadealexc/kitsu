import * as fs from 'fs';

export type ModelConfig = {
    path: string,
    base: {
        name: string,
        url: string,
    },
    ocr: {
        name: string,
        url: string,
        mmprojUrl: string,
    }
}

export type ConfigBase = {
    logPath: string,
    sleepAfterXSeconds: number,
    llamaServer: {
        useSubmodule: boolean,
    },
    models: ModelConfig,
};

// TODO - default values if unset
export function readConfig(path: string): ConfigBase {
    return JSON.parse(fs.readFileSync(path, 'utf-8')) as ConfigBase;
}