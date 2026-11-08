<script lang="ts">
    import { onMount } from 'svelte';
    import { toast } from 'svelte-sonner';

    import { toolServers } from '$lib/stores';
    import {
        createToolServer,
        deleteToolServer,
        getToolServers,
        refreshToolServer,
        updateToolServer,
        type ToolServer
    } from '$lib/apis/mcp';
    import Switch from '$lib/components/common/Switch.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import ToolServerIcon, { TOOL_SERVER_ICONS } from '$lib/components/chat/ToolServerIcon.svelte';

    let servers: ToolServer[] = [];
    let loading = true;
    let busy: Record<string, boolean> = {};

    // Add form
    let adding = false;
    let name = '';
    let url = '';
    let token = '';

    // Token being replaced, by server id
    let newToken: Record<string, string> = {};
    let editingToken: string | null = null;

    const load = async () => {
        servers = await getToolServers(localStorage.token);
        toolServers.set(servers);
    };

    onMount(async () => {
        try {
            await load();
        } catch (err) {
            toast.error(`${err}`);
        }
        loading = false;
    });

    const run = async (id: string, action: () => Promise<unknown>) => {
        busy = { ...busy, [id]: true };
        try {
            await action();
            await load();
        } catch (err) {
            toast.error(`${err}`);
        }
        busy = { ...busy, [id]: false };
    };

    const add = async () => {
        if (!name.trim() || !url.trim()) return;
        await run('new', async () => {
            const created = await createToolServer(localStorage.token, {
                name: name.trim(),
                url: url.trim(),
                ...(token.trim() ? { token: token.trim() } : {})
            });
            if (created.state === 'error') toast.error(`Added, but couldn't connect: ${created.error}`);
            name = '';
            url = '';
            token = '';
            adding = false;
        });
    };

    const remove = async (server: ToolServer) => {
        if (!confirm(`Remove ${server.name}? Its tools will no longer be offered to models.`)) return;
        await run(server.id, () => deleteToolServer(localStorage.token, server.id));
    };

    const saveToken = async (server: ToolServer) => {
        await run(server.id, () =>
            updateToolServer(localStorage.token, server.id, { token: newToken[server.id]?.trim() || null })
        );
        newToken = { ...newToken, [server.id]: '' };
        editingToken = null;
    };

    const stateLabel: Record<ToolServer['state'], string> = {
        connected: 'Connected',
        connecting: 'Connecting',
        error: 'Unreachable',
        disabled: 'Off'
    };

    const stateClass: Record<ToolServer['state'], string> = {
        connected: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
        connecting: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        error: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300',
        disabled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
    };

    const inputClass =
        'w-full rounded-lg py-2 px-3 text-base sm:text-sm bg-gray-50 dark:text-gray-300 dark:bg-gray-850 outline-hidden';
</script>

<div class="flex flex-col h-full text-sm">
    <div class="overflow-y-scroll scrollbar-hidden h-full">
        <div class="mt-0.5 mb-1 text-base font-medium">{'Tools'}</div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mb-2.5">
            {'MCP servers whose tools models can call. Users turn each one on or off per chat.'}
        </div>

        <hr class="border-gray-100/30 dark:border-gray-850/30 my-2" />

        {#if loading}
            <div class="flex justify-center py-6"><Spinner className="size-5" /></div>
        {:else}
            {#if servers.length === 0 && !adding}
                <div class="text-xs text-gray-500 dark:text-gray-400 py-3">{'No servers yet.'}</div>
            {/if}

            <div class="flex flex-col gap-2">
                {#each servers as server (server.id)}
                    <div class="rounded-xl border border-gray-100 dark:border-gray-850 px-3 py-2.5 flex flex-col gap-1.5">
                        <div class="flex items-center gap-2 min-w-0">
                            <div class="font-medium truncate">{server.name}</div>
                            <span class="shrink-0 text-[11px] rounded px-1.5 py-0.5 font-medium {stateClass[server.state]}">
                                {stateLabel[server.state]}
                            </span>
                            {#if busy[server.id]}<Spinner className="size-3.5" />{/if}
                            <div class="ml-auto flex items-center gap-2 shrink-0">
                                <Switch
                                    state={server.enabled}
                                    on:change={(e) =>
                                        run(server.id, () =>
                                            updateToolServer(localStorage.token, server.id, { enabled: e.detail })
                                        )}
                                />
                            </div>
                        </div>

                        <div class="text-xs text-gray-500 dark:text-gray-400 truncate" title={server.url}>
                            {server.url}
                        </div>

                        <div class="flex flex-wrap gap-0.5" role="group" aria-label={`Icon for ${server.name}`}>
                            {#each TOOL_SERVER_ICONS as icon (icon)}
                                <button
                                    type="button"
                                    aria-label={icon}
                                    aria-pressed={server.icon === icon}
                                    title={icon}
                                    class="p-1.5 rounded-md {server.icon === icon
                                        ? 'text-sky-500 dark:text-sky-300 bg-sky-50 dark:bg-sky-400/10'
                                        : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}"
                                    on:click={() => run(server.id, () => updateToolServer(localStorage.token, server.id, { icon }))}
                                >
                                    <ToolServerIcon {icon} />
                                </button>
                            {/each}
                        </div>

                        {#if server.state === 'error' && server.error}
                            <div class="text-xs text-red-600 dark:text-red-300 break-words">{server.error}</div>
                        {/if}

                        {#if server.tools.length > 0}
                            <div class="flex flex-wrap gap-1">
                                {#each server.tools as tool (tool.name)}
                                    <span
                                        class="text-[11px] font-mono rounded px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300"
                                        title={tool.description}>{tool.name}</span
                                    >
                                {/each}
                            </div>
                        {/if}

                        {#if editingToken === server.id}
                            <div class="flex gap-2 items-center">
                                <input
                                    class={inputClass}
                                    type="password"
                                    autocomplete="off"
                                    placeholder={'New token (leave empty to remove)'}
                                    bind:value={newToken[server.id]}
                                />
                                <button
                                    class="shrink-0 text-xs font-medium px-3 py-1.5 rounded-full bg-black text-white dark:bg-white dark:text-black"
                                    on:click={() => saveToken(server)}>{'Save'}</button
                                >
                                <button
                                    class="shrink-0 text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
                                    on:click={() => (editingToken = null)}>{'Cancel'}</button
                                >
                            </div>
                        {/if}

                        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
                            <span>{server.hasToken ? 'Token set' : 'No token'}</span>
                            <button class="hover:text-gray-800 dark:hover:text-gray-200 hover:underline" on:click={() => (editingToken = server.id)}
                                >{server.hasToken ? 'Change token' : 'Add token'}</button
                            >
                            {#if server.enabled}
                                <button
                                    class="hover:text-gray-800 dark:hover:text-gray-200 hover:underline"
                                    on:click={() => run(server.id, () => refreshToolServer(localStorage.token, server.id))}
                                    >{'Reconnect'}</button
                                >
                            {/if}
                            <button class="ml-auto text-red-500 hover:text-red-700 hover:underline" on:click={() => remove(server)}
                                >{'Remove'}</button
                            >
                        </div>
                    </div>
                {/each}
            </div>

            {#if adding}
                <form
                    class="mt-3 rounded-xl border border-gray-100 dark:border-gray-850 px-3 py-3 flex flex-col gap-2"
                    on:submit|preventDefault={add}
                >
                    <input class={inputClass} placeholder={'Name, e.g. Web'} bind:value={name} required />
                    <input class={inputClass} placeholder={'URL, e.g. http://host:8787/mcp'} bind:value={url} required />
                    <input
                        class={inputClass}
                        type="password"
                        autocomplete="off"
                        placeholder={'Bearer token (optional)'}
                        bind:value={token}
                    />
                    <div class="flex justify-end gap-3 items-center">
                        <button type="button" class="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200" on:click={() => (adding = false)}
                            >{'Cancel'}</button
                        >
                        <button
                            type="submit"
                            disabled={busy.new}
                            class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full disabled:opacity-50"
                            >{'Add'}</button
                        >
                    </div>
                </form>
            {:else}
                <div class="flex justify-end pt-3">
                    <button
                        class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
                        on:click={() => (adding = true)}>{'Add server'}</button
                    >
                </div>
            {/if}
        {/if}
    </div>
</div>
