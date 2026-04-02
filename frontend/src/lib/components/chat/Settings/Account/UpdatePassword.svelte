<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { updateUserPassword } from '$lib/apis/auths';
    import SensitiveInput from '$lib/components/common/SensitiveInput.svelte';

    let show = false;
    let currentPassword = '';
    let newPassword = '';
    let newPasswordConfirm = '';

    const updatePasswordHandler = async () => {
        if (newPassword === newPasswordConfirm) {
            const res = await updateUserPassword(
                localStorage.token,
                currentPassword,
                newPassword
            ).catch((error) => {
                toast.error(`${error}`);
                return null;
            });

            if (res) {
                toast.success('Successfully updated.');
            }

            currentPassword = '';
            newPassword = '';
            newPasswordConfirm = '';
        } else {
            toast.error(
                "The passwords you entered don't quite match. Please double-check and try again."
            );
            newPassword = '';
            newPasswordConfirm = '';
        }
    };
</script>

<form
    class="flex flex-col text-sm"
    on:submit|preventDefault={() => {
        updatePasswordHandler();
    }}
>
    <div class="flex justify-between items-center text-sm">
        <div class="  font-medium">{'Change Password'}</div>
        <button
            class=" text-xs font-medium text-gray-500"
            type="button"
            on:click={() => {
                show = !show;
            }}>{show ? 'Hide' : 'Show'}</button
        >
    </div>

    {#if show}
        <div class=" py-2.5 space-y-1.5">
            <div class="flex flex-col w-full">
                <div class=" mb-1 text-xs text-gray-500">{'Current Password'}</div>

                <div class="flex-1">
                    <SensitiveInput
                        className="w-full bg-transparent text-sm dark:text-gray-300 outline-hidden placeholder:opacity-30"
                        type="password"
                        bind:value={currentPassword}
                        placeholder="Enter your current password"
                        required
                    />
                </div>
            </div>

            <div class="flex flex-col w-full">
                <div class=" mb-1 text-xs text-gray-500">{'New Password'}</div>

                <div class="flex-1">
                    <SensitiveInput
                        className="w-full bg-transparent text-sm dark:text-gray-300 outline-hidden placeholder:opacity-30"
                        type="password"
                        bind:value={newPassword}
                        placeholder="Enter your new password"
                        required
                    />
                </div>
            </div>

            <div class="flex flex-col w-full">
                <div class=" mb-1 text-xs text-gray-500">{'Confirm Password'}</div>

                <div class="flex-1">
                    <SensitiveInput
                        className="w-full bg-transparent text-sm dark:text-gray-300 outline-hidden placeholder:opacity-30"
                        type="password"
                        bind:value={newPasswordConfirm}
                        placeholder="Confirm your new password"
                        required
                    />
                </div>
            </div>
        </div>

        <div class="mt-3 flex justify-end">
            <button
                class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
            >
                {'Update password'}
            </button>
        </div>
    {/if}
</form>
