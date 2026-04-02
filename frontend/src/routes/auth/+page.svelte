<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { onMount, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores';

    import { userSignIn, userSignUp, updateUserTimezone } from '$lib/apis/auths';

    import { APP_NAME, config, user } from '$lib/stores';

    import { getUserTimezone } from '$lib/utils';

    import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';
    import type { SessionUserResponse } from '@backend/routes/types';

    let loaded = false;

    let mode = 'signin';

    let username = '';
    let password = '';

    const setSessionUser = async (
        sessionUser: SessionUserResponse | null,
        redirectPath: string | null = null
    ) => {
        if (sessionUser) {
            toast.success(`You're now logged in.`);
            if (sessionUser.token) {
                localStorage.token = sessionUser.token;
            }

            user.set(sessionUser);

            // Update user timezone
            const timezone = getUserTimezone();
            if (sessionUser.token && timezone) {
                updateUserTimezone(sessionUser.token, timezone);
            }

            if (!redirectPath) {
                redirectPath = $page.url.searchParams.get('redirect') || '/';
            }

            goto(redirectPath);
        }
    };

    const signInHandler = async () => {
        const sessionUser = await userSignIn(username, password).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        await setSessionUser(sessionUser);
    };

    const signUpHandler = async () => {
        const sessionUser = await userSignUp(username, password).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        await setSessionUser(sessionUser);
    };

    const submitHandler = async () => {
        if (mode === 'signin') {
            await signInHandler();
        } else {
            await signUpHandler();
        }
    };

    onMount(async () => {
        const redirectPath = $page.url.searchParams.get('redirect');
        if ($user !== undefined) {
            goto(redirectPath || '/');
        }

        const error = $page.url.searchParams.get('error');
        if (error) {
            toast.error(error);
        }

        loaded = true;
    });
</script>

<svelte:head>
    <title>
        {`${$APP_NAME}`}
    </title>
</svelte:head>

<div class="w-full h-screen max-h-[100dvh] text-white relative" id="auth-page">
    <div class="w-full h-full absolute top-0 left-0 bg-white dark:bg-black"></div>

    {#if loaded}
        <div
            class="fixed bg-transparent min-h-screen w-full flex justify-center font-primary z-50 text-black dark:text-white"
            id="auth-container"
        >
            <div class="w-full px-10 min-h-screen flex flex-col text-center">
                <div class="my-auto flex flex-col justify-center items-center">
                    <div class=" sm:max-w-md my-auto pb-10 w-full dark:text-gray-100">
                        <form
                            class=" flex flex-col justify-center"
                            on:submit={(e) => {
                                e.preventDefault();
                                submitHandler();
                            }}
                        >
                            <div class="mb-1">
                                <div class=" text-2xl font-medium">
                                    {#if mode === 'signin'}
                                        {`Sign in to ${$APP_NAME}`}
                                    {:else}
                                        {`Sign up to ${$APP_NAME}`}
                                    {/if}
                                </div>
                            </div>

                            <div class="flex flex-col mt-4">
                                <div class="mb-2">
                                    <label
                                        for="username"
                                        class="text-sm font-medium text-left mb-1 block"
                                        >{'Username'}</label
                                    >
                                    <input
                                        bind:value={username}
                                        type="text"
                                        id="username"
                                        class="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
                                        autocomplete="username"
                                        name="username"
                                        placeholder="Enter Your Username"
                                        required
                                    />
                                </div>

                                <div>
                                    <label
                                        for="password"
                                        class="text-sm font-medium text-left mb-1 block"
                                        >{'Password'}</label
                                    >
                                    <SensitiveInput
                                        bind:value={password}
                                        type="password"
                                        id="password"
                                        className="my-0.5 w-full text-sm outline-hidden bg-transparent placeholder:text-gray-300 dark:placeholder:text-gray-600"
                                        placeholder="Enter Your Password"
                                        autocomplete={mode === 'signup'
                                            ? 'new-password'
                                            : 'current-password'}
                                        required
                                    />
                                </div>
                            </div>
                            <div class="mt-5">
                                <button
                                    class="bg-gray-700/5 hover:bg-gray-700/10 dark:bg-gray-100/5 dark:hover:bg-gray-100/10 dark:text-gray-300 dark:hover:text-white transition w-full rounded-full font-medium text-sm py-2.5"
                                    type="submit"
                                >
                                    {mode === 'signin' ? 'Sign in' : 'Create Account'}
                                </button>

                                {#if $config.features.enableSignup}
                                    <div class=" mt-4 text-sm text-center">
                                        {mode === 'signin'
                                            ? "Don't have an account?"
                                            : 'Already have an account?'}

                                        <button
                                            class=" font-medium underline"
                                            type="button"
                                            on:click={() => {
                                                if (mode === 'signin') {
                                                    mode = 'signup';
                                                } else {
                                                    mode = 'signin';
                                                }
                                            }}
                                        >
                                            {mode === 'signin' ? 'Sign up' : 'Sign in'}
                                        </button>
                                    </div>
                                {/if}
                            </div>
                        </form>
                    </div>
                </div>
            </div>
        </div>

        <div class="fixed m-10 z-50">
            <div class="flex space-x-2">
                <div class=" self-center">
                    <img id="logo" src="/static/favicon.png" class=" w-6 rounded-full" alt="" />
                </div>
            </div>
        </div>
    {/if}
</div>
