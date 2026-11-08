<script lang="ts">
    /** One tool call: sandbox tools have their own display, others the general one. */
    import { toolServers } from '$lib/stores';
    import type { ToolCallBlock } from '@backend/routes/types';
    import type { ToolProgressState } from '$lib/apis/completions';
    import SandboxToolCall from './SandboxToolCall.svelte';
    import ToolBlock from './ToolBlock.svelte';

    export let block: ToolCallBlock;
    export let progress: ToolProgressState | undefined = undefined;

    const SANDBOX_TOOLS = ['bash', 'read', 'write', 'edit'];
    $: isSandbox =
        SANDBOX_TOOLS.includes(block.name) && $toolServers.some((s) => s.sandbox && s.name === block.server);
</script>

{#if isSandbox}
    <SandboxToolCall {block} {progress} />
{:else}
    <ToolBlock {block} {progress} />
{/if}
