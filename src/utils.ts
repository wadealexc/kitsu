import * as fs from 'fs';
import { networkInterfaces } from "os";
import path from 'path';

// File extension for local models
const MODEL_FILE_EXT = '.gguf';                 

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