<script lang="ts">
    import { DropdownMenu } from 'bits-ui';
    import { tick } from 'svelte';
    import { fade } from 'svelte/transition';

    import { userSignOut } from '$lib/apis/auths';

    import { showSettings, mobile, showSidebar, user } from '$lib/stores';

    import Settings from '$lib/components/icons/Settings.svelte';
    import SignOut from '$lib/components/icons/SignOut.svelte';

    export let show = false;

    export let className = 'max-w-[240px]';
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<DropdownMenu.Root bind:open={show}>
    <DropdownMenu.Trigger>
        <slot />
    </DropdownMenu.Trigger>

    <slot name="content">
        <DropdownMenu.Content
            class="w-full {className}  rounded-2xl px-1 py-1  border border-gray-100  dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg text-sm"
            sideOffset={4}
            side="top"
            align="end"
            transition={(e) => fade(e, { duration: 100 })}
        >
            <DropdownMenu.Item
                class="flex rounded-xl py-1.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800 transition cursor-pointer"
                on:click={async () => {
                    show = false;

                    await showSettings.set(true);

                    if ($mobile) {
                        await tick();
                        showSidebar.set(false);
                    }
                }}
            >
                <div class=" self-center mr-3">
                    <Settings className="w-5 h-5" strokeWidth="1.5" />
                </div>
                <div class=" self-center truncate">{'Settings'}</div>
            </DropdownMenu.Item>

            <hr class=" border-gray-50/30 dark:border-gray-800/30 my-1 p-0" />

            <DropdownMenu.Item
                class="flex rounded-xl py-1.5 px-3 w-full hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                on:click={async () => {
                    const res = await userSignOut();
                    user.set(undefined);
                    localStorage.removeItem('token');

                    location.href = res?.redirectUrl ?? '/auth';
                    show = false;
                }}
            >
                <div class=" self-center mr-3">
                    <SignOut className="w-5 h-5" strokeWidth="1.5" />
                </div>
                <div class=" self-center truncate">{'Sign Out'}</div>
            </DropdownMenu.Item>
        </DropdownMenu.Content>
    </slot>
</DropdownMenu.Root>
