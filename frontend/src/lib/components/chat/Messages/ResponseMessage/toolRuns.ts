import type { MessageBlock, ReasoningBlock, ToolCallBlock } from '@backend/routes/types';

export type RunBlock = ReasoningBlock | ToolCallBlock;

export type BlockGroup =
    | { kind: 'single'; key: string; block: MessageBlock; index: number }
    | { kind: 'run'; key: string; blocks: RunBlock[] };

/**
 * Finds the runs of reasoning and condensed tool calls in a reply. Anything the
 * model says to the user ends a run, as does a tool that isn't condensed. Reasoning
 * with no condensed tool call next to it stays as it always was.
 */
export function groupBlocks(blocks: MessageBlock[], condensedServers: Set<string>): BlockGroup[] {
    const singleKey = (block: MessageBlock, index: number) => (block.type === 'tool_call' ? block.id : `block-${index}`);
    const groups: BlockGroup[] = [];
    let run: { block: RunBlock; index: number }[] = [];

    const endRun = () => {
        if (run.some((r) => r.block.type === 'tool_call')) {
            groups.push({ kind: 'run', key: `run-${run[0]!.index}`, blocks: run.map((r) => r.block) });
        } else {
            for (const { block, index } of run) groups.push({ kind: 'single', key: singleKey(block, index), block, index });
        }
        run = [];
    };

    blocks.forEach((block, index) => {
        if (block.type === 'reasoning' || (block.type === 'tool_call' && !!block.server && condensedServers.has(block.server))) {
            run.push({ block, index });
        } else {
            endRun();
            groups.push({ kind: 'single', key: singleKey(block, index), block, index });
        }
    });
    endRun();
    return groups;
}

/** A sandbox path as the user thinks of it: relative to the workspace, when it's inside it. */
export function displayPath(path: string): string {
    return path.replace(/^(\/workspace\/+|(\.\/+)+)/, '');
}

export type CallTitle = { verb: string; target: string; after: string };

/** A tool call in a few words, for the header of a run with only that call. */
export function singleCallTitle(block: ToolCallBlock): CallTitle {
    let args: Record<string, unknown> = {};
    try {
        args = JSON.parse(block.arguments || '{}') ?? {};
    } catch {
        // Falls through to the plain title
    }
    const path = typeof args.path === 'string' ? displayPath(args.path) : '';
    const command = typeof args.command === 'string' ? (args.command.split('\n').find((l) => l.trim()) ?? '') : '';
    const running = block.result === undefined && !block.done;

    if (block.name === 'bash' && command) {
        const after = !running && block.duration ? `in ${block.duration} second${block.duration === 1 ? '' : 's'}` : '';
        return { verb: running ? 'Running' : 'Ran', target: command.trim(), after };
    }

    const verbs: Record<string, [string, string, string]> = {
        read: ['Reading', 'Read', 'read'],
        write: ['Writing', 'Wrote', 'write'],
        edit: ['Editing', 'Edited', 'edit'],
    };
    const verb = verbs[block.name];
    if (verb && path) {
        return { verb: running ? verb[0] : block.failed ? `Couldn't ${verb[2]}` : verb[1], target: path, after: '' };
    }
    return { verb: running ? 'Running' : 'Used', target: block.name, after: '' };
}
