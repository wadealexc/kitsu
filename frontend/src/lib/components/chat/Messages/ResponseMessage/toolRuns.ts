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
