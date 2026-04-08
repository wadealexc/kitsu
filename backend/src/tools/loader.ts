import type { ToolFactory } from './types.js';

import webSearch from './tools/webSearch.js';
import systemInfo from './tools/systemInfo.js';
import loadWebpage from './tools/loadWebpage.js';
import preprocessImage from './tools/preprocessImage.js';

function toGeneric<In, Out>(factory: ToolFactory<In, Out>): ToolFactory<unknown, unknown> {
    return factory as ToolFactory<unknown, unknown>;
}

export default function loadTools(): ToolFactory<unknown, unknown>[] {
    return [
        toGeneric(systemInfo),
        toGeneric(webSearch),
        toGeneric(loadWebpage),
        toGeneric(preprocessImage),
    ];
}