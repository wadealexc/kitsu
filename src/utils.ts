import * as fs from 'fs';
import { access, constants } from 'node:fs/promises';
import { networkInterfaces } from "os";
import path from 'path';
import * as https from "https";
import * as http from "http";

import chalk from 'chalk';

import { type ModelConfig } from './config.js';

// File extension for local models
const MODEL_FILE_EXT = '.gguf';

export type BaseModel = {
    type: 'base',
    name: string,
    path: string,
};

export type OCRModel = {
    type: 'ocr',
    name: string,
    path: string,
    mmprojPath: string,
};

export type ModelInfos = {
    base: {
        default: BaseModel,
        alts: BaseModel[]
    },
    ocr: OCRModel,
};

// Check for models locally as specified by config, or fetch from supplied
// URLs if not found
// TODO - parallel fetch if needed
export async function fetchModels(cfg: ModelConfig): Promise<ModelInfos> {
    const baseModelPath = path.join(cfg.path, '/base', cfg.base.name) + '.gguf';
    const ocrModelPath = path.join(cfg.path, '/ocr', cfg.ocr.name) + '.gguf';
    const ocrMMProjPath = path.join(cfg.path, '/ocr', cfg.ocr.name) + '.mmproj.gguf';

    try {
        await access(baseModelPath, constants.R_OK | constants.W_OK);
    } catch {
        process.stdout.write(chalk.dim(`Base model ${cfg.base.name} not found locally, downloading...`));
        await downloadModel(cfg.base.url, baseModelPath);
        process.stdout.write(chalk.green('done!\n'));
    }

    try {
        await access(ocrModelPath, constants.R_OK | constants.W_OK);
    } catch {
        process.stdout.write(chalk.dim(`OCR model ${cfg.ocr.name} not found locally, downloading...`));
        await downloadModel(cfg.ocr.url, ocrModelPath);
        process.stdout.write(chalk.green('done!\n'));
    }

    try {
        await access(ocrMMProjPath, constants.R_OK | constants.W_OK);
    } catch {
        process.stdout.write(chalk.dim(`OCR MMProj for model ${cfg.ocr.name} not found locally, downloading...`));
        await downloadModel(cfg.ocr.mmprojUrl, ocrMMProjPath);
        process.stdout.write(chalk.green('done!\n'));
    }

    return {
        base: {
            default: {
                type: 'base',
                name: cfg.base.name,
                path: baseModelPath,
            },
            alts: [],
        },
        ocr: {
            type: 'ocr',
            name: cfg.ocr.name,
            path: ocrModelPath,
            mmprojPath: ocrMMProjPath,
        }
    };
}

async function downloadModel(
    url: string,
    destination: string,
    maxRedirects = 5,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === "https:" ? https : http;

        const request = protocol.get(url, (response) => {
            // Handle redirects (301, 302, 303, 307, 308)
            if (
                response.statusCode &&
                response.statusCode >= 300 &&
                response.statusCode < 400 &&
                response.headers.location
            ) {
                if (maxRedirects <= 0) {
                    reject(new Error("Too many redirects"));
                    return;
                }

                const redirectUrl = new URL(response.headers.location, url).toString();
                response.destroy(); // clean up current response
                // recursively follow redirect
                downloadModel(redirectUrl, destination, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            // Error responses
            if (response.statusCode && response.statusCode >= 400) {
                reject(new Error(`HTTP Error: ${response.statusCode} ${response.statusMessage}`));
                return;
            }

            const file = fs.createWriteStream(destination);
            response.pipe(file);

            file.on("finish", () => {
                file.close();
                resolve();
            });

            file.on("error", (err) => {
                fs.unlink(destination, () => reject(err));
            });
        });

        request.on("error", (err) => {
            fs.unlink(destination, () => reject(err)); // clean up partial file
        });
    });
}

// Recursively find all .gguf files in a given directory
export function findModels(dir: string): string[] {
    let results: string[] = [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            // Recurse into subdirectories
            results = results.concat(findModels(fullPath));
        } else if (entry.isFile() && fullPath.endsWith(MODEL_FILE_EXT)) {
            // Match .gguf files
            results.push(fullPath);
        }
    }

    return results;
}

/**
 * Strip the .gguf extension from a model file
 * (input: "gpt-oss-20b-mxfp4.gguf", output: "gpt-oss-20b-mxfp4")
 */
export function modelNameFromPath(p: string): string {
    return path.basename(p, MODEL_FILE_EXT);
}

export function getLanIPv4(): string {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
        for (const net of nets[name] ?? []) {
            // skip over non‑IPv4 and internal (loopback) addresses
            if (net.family === "IPv4" && !net.internal) {
                return net.address; // e.g., "192.168.1.42"
            }
        }
    }

    throw new Error(`unable to find valid LAN IPv4 address`);
}