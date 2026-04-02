<script lang="ts">
    import { Toaster, toast } from 'svelte-sonner';

    import { onMount, tick, onDestroy } from 'svelte';
    import {
        config,
        configLoaded,
        user,
        settings,
        applySettingsDefaults,
        APP_NAME,
        mobile,
        isLastActiveTab,
        type SessionUser
    } from '$lib/stores';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';
    import { beforeNavigate } from '$app/navigation';
    import { updated } from '$app/state';

    import '../tailwind.css';
    import '../app.css';
    import 'tippy.js/dist/tippy.css';

    import { getBackendConfig } from '$lib/apis/configs';
    import { getSessionUser, userSignOut } from '$lib/apis/auths';

    import { setTextScale } from '$lib/utils/text-scale';

    import Spinner from '$lib/components/common/Spinner.svelte';
    import { getUserSettings } from '$lib/apis/users';

    // handle frontend updates (https://svelte.dev/docs/kit/configuration#version)
    beforeNavigate(async ({ willUnload, to }) => {
        if (updated.current && !willUnload && to?.url) {
            location.href = to.url.href;
        }
    });

    const bc = new BroadcastChannel('active-tab-channel');

    let loaded = false;
    let tokenTimer: NodeJS.Timeout | undefined = undefined;

    const BREAKPOINT = 768;

    const TOKEN_EXPIRY_BUFFER = 60; // seconds
    const checkTokenExpiry = async () => {
        const exp = $user?.expires_at; // token expiry time in unix timestamp
        const now = Math.floor(Date.now() / 1000); // current time in unix timestamp

        if (!exp) {
            // If no expiry time is set, do nothing
            return;
        }

        if (now >= exp - TOKEN_EXPIRY_BUFFER) {
            const res = await userSignOut();
            user.set(undefined);
            localStorage.removeItem('token');

            location.href = res.redirect_url ?? '/auth';
        }
    };

    const loadUserSettings = async () => {
        let userSettings = await getUserSettings(localStorage.token).catch((error) => {
            console.error(error);
            return null;
        });

        if (!userSettings) {
            let localStorageSettings: Record<string, unknown> = {};
            try {
                localStorageSettings = JSON.parse(localStorage.getItem('settings') ?? '{}');
            } catch (e: unknown) {
                console.error('Failed to parse settings from localStorage', e);
            }
            userSettings = { ui: localStorageSettings };
        }

        settings.set(applySettingsDefaults(userSettings.ui));
        setTextScale($settings.textScale);
    };

    const initAsync = async () => {
        // Re-fetch settings and reset the token expiry timer whenever the user changes
        // (e.g. sign out → sign in as a different user).
        user.subscribe(async (value: SessionUser | undefined) => {
            if (value) {
                clearInterval(tokenTimer);
                tokenTimer = setInterval(checkTokenExpiry, 15000);
            }
        });

        let backendConfig;
        try {
            backendConfig = await getBackendConfig();
        } catch (error) {
            console.error('Error loading backend config:', error);
            await goto('/auth');
            return;
        }

        config.set(backendConfig);
        configLoaded.set(true);
        APP_NAME.set(backendConfig.name);

        const currentUrl = `${window.location.pathname}${window.location.search}`;
        const encodedUrl = encodeURIComponent(currentUrl);

        if (localStorage.token) {
            // Get Session User Info
            const sessionUser = await getSessionUser(localStorage.token).catch((error) => {
                toast.error(`${error}`);
                return null;
            });

            if (sessionUser) {
                user.set(sessionUser);
                await loadUserSettings();
            } else {
                // Redirect Invalid Session User to /auth Page
                localStorage.removeItem('token');
                await goto(`/auth?redirect=${encodedUrl}`);
            }
        } else {
            // Don't redirect if we're already on the auth page
            if ($page.url.pathname !== '/auth') {
                await goto(`/auth?redirect=${encodedUrl}`);
            }
        }

        await tick();

        document.getElementById('splash-screen')?.remove();
        loaded = true;
    };

    onMount(() => {
        // Listen for messages on the BroadcastChannel
        bc.onmessage = (event) => {
            if (event.data === 'active') {
                isLastActiveTab.set(false); // Another tab became active
            }
        };

        // Set yourself as the last active tab when this tab is focused
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                isLastActiveTab.set(true); // This tab is now the active tab
                bc.postMessage('active'); // Notify other tabs that this tab is active

                // Check token expiry when the tab becomes active
                checkTokenExpiry();
            }
        };

        // Add event listener for visibility state changes
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Call visibility change handler initially to set state on load
        handleVisibilityChange();

        mobile.set(window.innerWidth < BREAKPOINT);

        const onResize = () => {
            if (window.innerWidth < BREAKPOINT) {
                mobile.set(true);
            } else {
                mobile.set(false);
            }
        };
        window.addEventListener('resize', onResize);

        initAsync();

        return () => {
            window.removeEventListener('resize', onResize);
        };
    });

    onDestroy(() => {
        bc.close();
    });
</script>

<svelte:head>
    <title>{$APP_NAME}</title>
    <link rel="icon" href="/static/favicon.png" />

    <meta name="apple-mobile-web-app-title" content={$APP_NAME} />
    <meta name="description" content={$APP_NAME} />
</svelte:head>

{#if loaded}
    <slot />
{/if}

<Toaster theme="dark" richColors position="top-right" closeButton />
