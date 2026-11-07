<script lang="ts">
    import { onMount, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    import { getModels } from '$lib/apis/models';
    import { getToolServers } from '$lib/apis/mcp';

    import { user, models, toolServers, showSettings, temporaryChatEnabled, showSidebar } from '$lib/stores';

    import Sidebar from '$lib/components/Sidebar.svelte';
    import SettingsModal from '$lib/components/chat/SettingsModal.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';

    let loaded = false;

    const clearChatInputStorage = () => {
        const chatInputKeys = Object.keys(localStorage).filter((key) =>
            key.startsWith('chat-input')
        );
        chatInputKeys.forEach((key) => localStorage.removeItem(key));
    };

    // CSS 100dvh does NOT account for the virtual keyboard on iOS.
    // Use visualViewport.height via a CSS variable instead.
    // Also track visualViewport.offsetTop — iOS pushes the web view when
    // the keyboard opens, and we compensate with a transform rather than
    // fighting it with scrollTo.  Both vars MUST update together on every
    // event to avoid frames where one is stale.
    let prevVvHeight: number | undefined;

    const syncViewport = () => {
        const vv = window.visualViewport;
        if (!vv) return;
        const heightChanged = prevVvHeight !== undefined && Math.abs(vv.height - prevVvHeight) > 1;
        prevVvHeight = vv.height;

        document.documentElement.style.setProperty('--app-height', `${vv.height}px`);
        // iOS pushes the web view when the keyboard opens, ignoring
        // overflow:hidden.  Counter-scroll to keep content at the top.
        if (window.scrollY !== 0) {
            window.scrollTo(0, 0);
        }
        // When the keyboard opens/closes (height change), ensure focused
        // inputs outside the chat container remain visible.
        // Skip on pure scroll events to avoid resetting scroll position.
        if (heightChanged) {
            const active = document.activeElement;
            if (
                active &&
                (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
                !active.closest('#chat-container')
            ) {
                requestAnimationFrame(() => {
                    active.scrollIntoView({ block: 'nearest', behavior: 'instant' });
                });
            }
        }
    };

    onMount(async () => {
        if ($user === undefined || $user === null) {
            await goto('/auth');
            return;
        }
        if (!['user', 'admin'].includes($user?.role)) {
            return;
        }

        clearChatInputStorage();
        models.set(await getModels(localStorage.token));
        toolServers.set(await getToolServers(localStorage.token).catch(() => []));

        if ($page.url.searchParams.get('temporary-chat') === 'true') {
            temporaryChatEnabled.set(true);
        }

        await tick();

        loaded = true;

        syncViewport();
        window.visualViewport?.addEventListener('resize', syncViewport);
        window.visualViewport?.addEventListener('scroll', syncViewport);
        // Also sync on window scroll — may fire earlier than visualViewport
        // events, giving tighter tracking of iOS's viewport push.
        window.addEventListener('scroll', syncViewport, true);
    });

    $: if ($user && !['user', 'admin'].includes($user.role)) goto('/auth');
</script>

<SettingsModal bind:show={$showSettings} />

{#if $user}
    <div class="app relative">
        <div
            class=" text-gray-700 dark:text-gray-100 bg-white dark:bg-gray-900 overflow-hidden flex flex-row justify-end"
            style="height: var(--app-height, 100dvh);"
        >
            <Sidebar />

            {#if loaded}
                <slot />
            {:else}
                <div
                    class="w-full flex-1 h-full flex items-center justify-center {$showSidebar
                        ? '  md:max-w-[calc(100%-var(--sidebar-width))]'
                        : ' '}"
                >
                    <Spinner className="size-5" />
                </div>
            {/if}
        </div>
    </div>
{/if}
