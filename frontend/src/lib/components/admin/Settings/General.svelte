<script lang="ts">
    import { getAdminConfig, updateAdminConfig } from '$lib/apis/auths';
    import Switch from '$lib/components/common/Switch.svelte';
    import { onMount } from 'svelte';
    import { toast } from 'svelte-sonner';
    import type { AdminConfig } from '@backend/routes/types';

    export let saveHandler: Function;

    let adminConfig: AdminConfig | null = null;

    const updateHandler = async () => {
        if (!adminConfig) return;

        const res = await updateAdminConfig(localStorage.token, adminConfig);
        if (res) {
            saveHandler();
        } else {
            toast.error('Failed to update settings');
        }
    };

    onMount(async () => {
        adminConfig = await getAdminConfig(localStorage.token);
    });
</script>

<form
    class="flex flex-col h-full justify-between space-y-3 text-sm"
    on:submit|preventDefault={async () => {
        updateHandler();
    }}
>
    <div class="space-y-3 overflow-y-scroll scrollbar-hidden h-full">
        {#if adminConfig !== null}
            <div class="">
                <div class="mb-3">
                    <div class=" mt-0.5 mb-2.5 text-base font-medium">{'Authentication'}</div>

                    <hr class=" border-gray-100/30 dark:border-gray-850/30 my-2" />

                    <div class="  mb-2.5 flex w-full justify-between">
                        <div class=" self-center text-xs font-medium">{'Default User Role'}</div>
                        <div class="flex items-center relative">
                            <select
                                class="dark:bg-gray-900 w-fit pr-8 rounded-sm px-2 text-xs bg-transparent outline-hidden text-right"
                                bind:value={adminConfig.DEFAULT_USER_ROLE}
                                placeholder="Select a role"
                            >
                                <option value="pending">{'pending'}</option>
                                <option value="user">{'user'}</option>
                                <option value="admin">{'admin'}</option>
                            </select>
                        </div>
                    </div>

                    <div class=" mb-2.5 flex w-full justify-between pr-2">
                        <div class=" self-center text-xs font-medium">{'Enable New Sign Ups'}</div>

                        <Switch bind:state={adminConfig.ENABLE_SIGNUP} />
                    </div>

                    <div class=" mb-2.5 w-full justify-between">
                        <div class="flex w-full justify-between">
                            <div class=" self-center text-xs font-medium">{'JWT Expiration'}</div>
                        </div>

                        <div class="flex mt-2 space-x-2">
                            <input
                                class="w-full rounded-lg py-2 px-4 text-sm bg-gray-50 dark:text-gray-300 dark:bg-gray-850 outline-hidden"
                                type="text"
                                placeholder={`e.g.) "30m","1h", "10d". `}
                                bind:value={adminConfig.JWT_EXPIRES_IN}
                            />
                        </div>

                        <div class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                            {'Valid time units:'}
                            <span class=" text-gray-300 font-medium"
                                >{"'s', 'm', 'h', 'd', 'w' or '-1' for no expiration."}</span
                            >
                        </div>

                        {#if adminConfig.JWT_EXPIRES_IN === '-1'}
                            <div class="mt-2 text-xs">
                                <div
                                    class=" bg-yellow-500/20 text-yellow-700 dark:text-yellow-200 rounded-lg px-3 py-2"
                                >
                                    <div>
                                        <span class=" font-medium">
                                            {'Warning'}: {'No expiration can pose security risks.'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="mb-2.5 w-full justify-between">
                        <div class="flex w-full justify-between">
                            <div class=" self-center text-xs font-medium">{'App URL'}</div>
                        </div>

                        <div class="flex mt-2 space-x-2">
                            <input
                                class="w-full rounded-lg py-2 px-4 text-sm bg-gray-50 dark:text-gray-300 dark:bg-gray-850 outline-hidden"
                                type="text"
                                placeholder={`e.g.) "http://localhost:3000"`}
                                bind:value={adminConfig.APP_URL}
                            />
                        </div>

                        <div class="mt-2 text-xs text-gray-400 dark:text-gray-500">
                            {'Enter the public URL of your app. This URL will be used to generate links in the notifications.'}
                        </div>
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <div class="flex justify-end pt-3 text-sm font-medium">
        <button
            class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
            type="submit"
        >
            {'Save'}
        </button>
    </div>
</form>
