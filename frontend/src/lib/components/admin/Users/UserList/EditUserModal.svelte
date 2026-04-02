<script lang="ts">
    import { toast } from 'svelte-sonner';
    import dayjs from 'dayjs';
    import { createEventDispatcher } from 'svelte';
    import { updateUserById } from '$lib/apis/users';
    import type { SessionUserResponse, User } from '@backend/routes/types';

    import Modal from '$lib/components/common/Modal.svelte';
    import localizedFormat from 'dayjs/plugin/localizedFormat';
    import XMark from '$lib/components/icons/XMark.svelte';

    const dispatch = createEventDispatcher();
    dayjs.extend(localizedFormat);

    export let show = false;
    export let selectedUser: User;
    export let sessionUser: SessionUserResponse;

    $: if (show) {
        init();
    }

    const init = () => {
        if (selectedUser) {
            _user = { ...selectedUser };
        }
    };

    let _user: User = { ...selectedUser };

    const submitHandler = async () => {
        const res = await updateUserById(localStorage.token, selectedUser.id, _user).catch(
            (error) => {
                toast.error(`${error}`);
            }
        );

        if (res) {
            dispatch('save');
            show = false;
        }
    };
</script>

<Modal size="sm" bind:show>
    <div>
        <div class=" flex justify-between dark:text-gray-300 px-5 pt-4 pb-2">
            <div class=" text-lg font-medium self-center">{'Edit User'}</div>
            <button
                class="self-center"
                on:click={() => {
                    show = false;
                }}
            >
                <XMark className="size-5" />
            </button>
        </div>

        <div class="flex flex-col md:flex-row w-full md:space-x-4 dark:text-gray-200">
            <div class=" flex flex-col w-full sm:flex-row sm:justify-center sm:space-x-6">
                <form
                    class="flex flex-col w-full"
                    on:submit|preventDefault={() => {
                        submitHandler();
                    }}
                >
                    <div class=" px-5 pt-3 pb-5 w-full">
                        <div class="flex self-center w-full">
                            <div class=" flex-1">
                                <div class="overflow-hidden w-ful mb-2">
                                    <div class=" self-center capitalize font-medium truncate">
                                        {selectedUser.username}
                                    </div>

                                    <div class="text-xs text-gray-500">
                                        {'Created at'}
                                        {dayjs(selectedUser.createdAt * 1000).format('LL')}
                                    </div>
                                </div>

                                <div class=" flex flex-col space-y-1.5">
                                    <div class="flex flex-col w-full">
                                        <div class=" mb-1 text-xs text-gray-500">{'Role'}</div>

                                        <div class="flex-1">
                                            <select
                                                class="w-full dark:bg-gray-900 text-sm bg-transparent disabled:text-gray-500 dark:disabled:text-gray-500 outline-hidden"
                                                bind:value={_user.role}
                                                disabled={_user.id == sessionUser.id}
                                                required
                                            >
                                                <option value="admin">{'Admin'}</option>
                                                <option value="user">{'User'}</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div class="flex flex-col w-full">
                                        <div class=" mb-1 text-xs text-gray-500">{'Username'}</div>

                                        <div class="flex-1">
                                            <input
                                                class="w-full text-sm bg-transparent outline-hidden"
                                                type="text"
                                                bind:value={_user.username}
                                                placeholder="Enter Your Username"
                                                autocomplete="off"
                                                required
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="flex justify-end pt-3 text-sm font-medium">
                            <button
                                class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full flex flex-row space-x-1 items-center"
                                type="submit"
                            >
                                {'Save'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    </div>
</Modal>

<style>
    input::-webkit-outer-spin-button,
    input::-webkit-inner-spin-button {
        /* display: none; <- Crashes Chrome on hover */
        -webkit-appearance: none;
        appearance: none;
        margin: 0; /* <-- Apparently some margin are still there even though it's hidden */
    }
</style>
