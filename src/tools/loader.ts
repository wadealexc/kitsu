import type { Tool, ToolFactory } from './types.js';

import webSearch from './webSearch.js';
import systemInfo from './systemInfo.js';
import loadWebpage from './loadWebpage.js';

function toGeneric<In, Out>(factory: ToolFactory<In, Out>): ToolFactory<unknown, unknown> {
    return factory as ToolFactory<unknown, unknown>;
}

export default function loadTools(): ToolFactory<unknown, unknown>[] {
    return [
        toGeneric(systemInfo),
        toGeneric(webSearch),
        toGeneric(loadWebpage),
    ];
}