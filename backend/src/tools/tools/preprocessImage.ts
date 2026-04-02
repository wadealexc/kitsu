import { writeFile } from "fs/promises";

import sharp from 'sharp';

import { z } from 'zod';
import type { Tool, ToolContext, BeforeRequestOptions, ToolEmit } from '../types.js';
import * as proto from '../../protocol.js';

const IMAGELABEL_START = `img_`;
const PREPROCESSED_IMAGE_SUFFIX = `_p`;

// matches "img_0", "img_123"
const RAW_IMAGELABEL_REGEX = /^img_\d+$/;
// matches "img_0_p", "img_123_p"
const PP_IMAGELABEL_REGEX = /^img_\d+_p$/;

// Match either raw/preprocessed image labels
function isImageLabel(text: string): boolean {
    return RAW_IMAGELABEL_REGEX.test(text) || PP_IMAGELABEL_REGEX.test(text);
}

// Match only preprocessed image labels
function isRawImageLabel(text: string): boolean {
    return RAW_IMAGELABEL_REGEX.test(text);
}

// Match only preprocessed image labels
function isPreprocessedImageLabel(text: string): boolean {
    return PP_IMAGELABEL_REGEX.test(text);
}

function createRawLabel(idx: number): string {
    const label = `${IMAGELABEL_START}${idx}`;

    // This should never happen, but hey, chill out, i'm not omniscient
    if (!RAW_IMAGELABEL_REGEX.test(label)) throw new Error(`invalid raw image label: ${label}`);
    return label;
}

function createPreprocessedLabel(label: string): string {
    label = `${label}${PREPROCESSED_IMAGE_SUFFIX}`;

    // Ping Pong the Animation is a really good anime
    if (!PP_IMAGELABEL_REGEX.test(label)) throw new Error(`invalid preprocessed image label: ${label}`);
    return label;
}

const InputSchema = z.object({
    imageLabels: z.array(z.string())
}).describe(`a list of image labels to preprocess. Use image labels as instructed by the system prompt. Example: ["img_1", "img_2"]`);

const OutputSchema = z.object({
    oldLabels: z.array(z.string()),
    newLabels: z.array(z.string())
}).describe(`a list of the input image labels, and their corresponding labels after preprocessing.`);

// const InputSchema = z.object({
//     imageLabels: z.array(z.string().regex(RAW_IMAGELABEL_REGEX))
// }).describe(`a list of image labels to preprocess. Use image labels as instructed by the system prompt. Example: ["img_1", "img_2"]`);

// const OutputSchema = z.object({
//     oldLabels: z.array(z.string().regex(RAW_IMAGELABEL_REGEX)),
//     newLabels: z.array(z.string().regex(PP_IMAGELABEL_REGEX))
// })
//     .refine((data) => data.oldLabels.length === data.newLabels.length)
//     .describe(`a list of the input image labels, and their corresponding labels after preprocessing.`);

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

/**
 * PreprocessImage:
 * 
 * Images are passed to completion requests as an `ImageContentPart`. In `beforeRequest`,
 * we ensure that `ImageContentParts` are preceeded by an 'image label' that the model
 * can use to reference the image for tool calls. 
 * 
 * Example initial request snippet:
 * 
 * ```json
 * [
 *     {
 *         "type": "text",
 *         "text": "img_0"
 *     },
 *     {
 *         "type": "image",
 *         "image_url": "<base64 | url>"
 *     }
 * ]
 * ```
 * 
 * When the model uses the PreprocessImage tool, it should reference the image label
 * given in the request. 
 * 
 * Example tool call:
 * 
 * ```json
 * {
 *     "name": "preprocessImage"
 *     "arguments": {
 *         "imageLabels": ["img_0"]
 *     }
 * }
 * ```
 * 
 * The tool performs preprocessing, and then provides a tool call result. On the next request
 * to the model, `beforeRequest` will replace:
 * - existing imageLabels with a version that signals the image has been preprocessed
 * - images with their preprocessed version
 * 
 * Example final request:
 * 
 * ```json
 * [
 *     {
 *         "type": "text",
 *         "text": "img_0_p"
 *     },
 *     {
 *         "type": "image",
 *         "image_url": "preprocessed version of original image <base64 | url>"
 *     }
 * ]
 * ```
 */
class PreprocessImage implements Tool<Input, Output> {

    constructor(ctx: ToolContext) { }

    name(): string {
        return `preprocessImage`;
    }

    description(): string {
        return (
            `Replaces any images in the input with a preprocessed version that is optimized for text readability. ` +
            `Use when reading text is an important component in a vision task. Never use if an image does not contain text.`
        );
    }

    // Added to system prompt when images are included
    systemPromptSnippet(): string {
        return (
            `

#### Images

* Images are labeled in order: 'img_0', 'img_1', 'img_2', and so on. 
* Image labels with a '_p' suffix (e.g: 'img_0_p') denote that the image has been preprocessed to make text easier to see.
* When using tools in conjunction with images, you should reference images by their image label.`
        );
    }

    inputSchema(): z.ZodType<Input> {
        return InputSchema;
    }

    // The actual preprocessing happens in `beforeRequest`, because
    // due to OWUI tool call semantics, we have no way to attribute a tool
    // call to the completion request/messages it comes from.
    call(args: Input, _signal: AbortSignal, _emit: ToolEmit): Output {
        return {
            oldLabels: args.imageLabels,
            newLabels: args.imageLabels.map(label => {
                if (!RAW_IMAGELABEL_REGEX.test(label)) throw new Error(`expected raw image label; got: ${label}`);
                return `${label}_p`;
            })
        };
    }

    async beforeRequest(req: proto.CompletionRequest, _opts: BeforeRequestOptions): Promise<proto.CompletionRequest> {
        let newReq: proto.CompletionRequest = req;

        const snippet = this.systemPromptSnippet();
        let systemPrompt = newReq.messages.at(0);

        // If the request has no system prompt, ... that's weird. Panic. Run.
        if (systemPrompt === undefined || systemPrompt.role !== 'system') {
            throw new Error(`no system prompt`);
        } else if (typeof systemPrompt.content !== 'string') {
            throw new Error(`system prompt contains text chunks`);
        } else if (!proto.hasVisionContent(newReq.messages)) {
            return newReq; // no vision content, no tweaks needed
        }

        // Add the system prompt snippet to tell the model about image labels
        systemPrompt.content += snippet;
        newReq.messages[0] = systemPrompt;

        // Find any assistant messages calling this tool and keep track of any image labels
        const imageRequests: Set<string> = new Set();
        for (const m of proto.assistantMessages(newReq.messages)) {
            if (!m.tool_calls) continue;

            m.tool_calls.forEach(tc => {
                if (tc.function.name !== this.name()) return;

                try {
                    const args = JSON.parse(tc.function.arguments);
                    const labels: Input = InputSchema.parse(args);
                    labels.imageLabels.forEach(label => imageRequests.add(label));
                } catch (err: any) {
                    console.error(`preprocessImage.beforeRequest: failed to validate input for tool call. Err ${err}`);
                    return;
                }
            })
        }

        // Add image labels to images, and track tool messages to see if we need to
        // process any images
        let numImages = 0;
        for (const m of newReq.messages) {
            if (typeof m.content === 'string') continue;

            const newParts: proto.ContentPart[] = [];
            const parts: proto.ContentPart[] = m.content;

            let cur: proto.ContentPart;
            let prev: proto.ContentPart | undefined = undefined;
            let prevIdx: number | undefined = undefined;
            for (let i = 0; i < parts.length; i++) {
                cur = parts.at(i)!;

                // If this content part is an image:
                // - if the image has no label, add a raw label
                // - if the image has a label and it's in `imageRequests`, process the image
                if (cur.type === 'image_url') {

                    // Cur is image and prev is not an image label; push a raw label
                    if (!prev || prev.type !== 'text' || !isImageLabel(prev.text)) {
                        const labelPart: proto.TextContentPart = {
                            type: 'text',
                            text: createRawLabel(numImages),
                        };

                        prev = labelPart;
                        prevIdx = newParts.length;

                        newParts.push(labelPart);
                    }

                    // If cur is image, prev is a raw label, and cur is requested: process image
                    if (isRawImageLabel(prev.text) && imageRequests.has(prev.text)) {
                        try {
                            cur.image_url.url = await processImage(cur);
                            prev.text = createPreprocessedLabel(prev.text);
                        } catch (err: any) {
                            console.log(`unable to process image: ${err}`);
                        }
                    }

                    numImages++;
                }

                prev = cur;
                prevIdx = newParts.length;
                newParts.push(cur);
            }

            const lenDiff = newParts.length - parts.length;
            console.log(`Added ${lenDiff} image labels to completion input`);

            m.content = newParts;
        }

        // Wait for work to be complete
        // await Promise.all(imageWork);

        // Return the modified version of the request
        return newReq;
    }
}

export default function preprocessImage(ctx: ToolContext): Tool<Input, Output> {
    return new PreprocessImage(ctx);
}

/**
 * Extract raw image bytes from an OpenAI Chat Completions image content part.
 * Supports both data: URLs (base64) and remote HTTP(S) URLs.
 */
async function loadImageBufferFromContentPart(part: proto.ImageContentPart): Promise<Buffer> {
    const url = part.image_url.url;

    // data:image/png;base64,...
    if (url.startsWith("data:")) {
        const base64Match = url.match(/^data:.+;base64,(.*)$/);
        if (!base64Match) {
            throw new Error("Unsupported data URL format");
        }
        const base64 = base64Match[1];
        return Buffer.from(base64!, "base64");
    }

    // Remote URL (http/https)
    if (url.startsWith("http://") || url.startsWith("https://")) {
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
        }
        const arrayBuffer = await res.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    throw new Error("Unsupported image URL format");
}


/**
 * Simple preprocessing pipeline to make text pop:
 * - auto-orient
 * - optional upscaling if small
 * - convert to greyscale
 * - normalise contrast
 * - light sharpen
 * - output as PNG
 */
async function preprocessForText(buffer: Buffer): Promise<Buffer> {
    const img = sharp(buffer);

    const metadata = await img.metadata();

    const targetMinWidth = 1024; // adjust as needed
    let pipeline = img.rotate(); // auto-orient based on EXIF

    // Upscale if the image is very small
    if (metadata.width && metadata.width < targetMinWidth) {
        pipeline = pipeline.resize({
            width: targetMinWidth,
            withoutEnlargement: false,
        });
    }

    // Greyscale + normalize contrast + light sharpen
    pipeline = pipeline
        .greyscale()
        .normalise() // enhance contrast
        .sharpen(1); // light sharpen (amount=1)

    // Export as PNG for lossless quality
    return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

async function processImage(image: proto.ImageContentPart): Promise<string> {
    const originalBuffer = await loadImageBufferFromContentPart(image);
    const processedBuffer = await preprocessForText(originalBuffer);

    // await writeFile('./out.png', processedBuffer);

    const base64 = processedBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;

    return dataUrl;
}