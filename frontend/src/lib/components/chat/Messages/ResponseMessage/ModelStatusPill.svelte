<script lang="ts">
    import Spinner from '$lib/components/common/Spinner.svelte';

    export let status: 'waiting' | 'queued' | 'loading';
    export let modelName: string = '';
</script>

<div class="flex items-center gap-2 py-1">
    {#if status === 'queued'}
        <Spinner className="size-4 text-orange-500" />
        <span class="text-sm text-orange-500">Waiting for another model to finish...</span>
    {:else if status === 'loading'}
        <Spinner className="size-4 text-yellow-500" />
        <span class="text-sm text-yellow-500">{modelName} is waking up...</span>
    {:else}
        <Spinner className="size-4 text-cyan-500" />
        <span class="text-sm text-cyan-500">Waiting for backend response...</span>
    {/if}
</div>
