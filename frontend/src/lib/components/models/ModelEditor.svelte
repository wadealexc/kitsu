<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { onMount, tick } from 'svelte';
    import { user } from '$lib/stores';
    import { getBaseModels } from '$lib/apis/models';

    import AdvancedParams from '$lib/components/chat/Settings/Advanced/AdvancedParams.svelte';
    import Textarea from '$lib/components/common/Textarea.svelte';
    import Spinner from '$lib/components/common/Spinner.svelte';
    import type { ModelAccessResponse, ModelForm, ModelResponse } from '@backend/routes/types';

    export let onSubmit: Function;
    export let onBack: Function | null = null;

    export let model: ModelAccessResponse | null = null;
    export let edit = false;

    let loading = false;
    let loaded = false;

    let baseModels: ModelResponse[] = [];

    let showAdvanced = false;

    let initialInfoJson = '';
    $: hasChanges = !edit || JSON.stringify(info) !== initialInfoJson;

    let info: ModelForm = {
        id: '',
        base_model_id: '',
        name: '',
        meta: {
            description: undefined
        },
        params: {
            system: ''
        },
        isPublic: true,
        is_active: true
    };

    $: if (!edit) {
        if (info.name) {
            info.id = info.name
                .replace(/\s+/g, '-')
                .replace(/[^a-zA-Z0-9-]/g, '')
                .toLowerCase();
        }
    }

    const submitHandler = async () => {
        loading = true;

        if (info.id === '') {
            toast.error('Model ID is required.');
            loading = false;
            return;
        }

        if (info.name === '') {
            toast.error('Model Name is required.');
            loading = false;
            return;
        }

        info.params.system = info.params.system?.trim() === '' ? undefined : info.params.system;
        // stop is kept as a comma-separated string by AdvancedParams; convert to array for the API
        const stopRaw = info.params.stop;
        info.params.stop =
            typeof stopRaw === 'string' ? stopRaw.split(',').filter((s) => s.trim()) : stopRaw;
        const params = info.params as Record<string, any>;
        Object.keys(params).forEach((key) => {
            if (params[key] === '' || params[key] === null) {
                delete params[key];
            }
        });

        await onSubmit(info);

        loading = false;
    };

    onMount(async () => {
        // Scroll to top 'models-container' element
        const modelsContainer = document.getElementById('models-container');
        if (modelsContainer) {
            modelsContainer.scrollTop = 0;
        }

        // Fetch base models for admin dropdown
        if ($user?.role === 'admin') {
            baseModels = await getBaseModels(localStorage.token).catch(() => []);
        }

        if (model) {
            info = JSON.parse(JSON.stringify(model));

            // Convert stop array to comma-separated string for the text input in AdvancedParams
            if (Array.isArray(info.params.stop)) {
                info.params.stop = info.params.stop.join(',');
            }

            await tick();
        }

        initialInfoJson = JSON.stringify(info);
        loaded = true;
    });
</script>

{#if loaded}
    {#if onBack}
        <button
            class="flex space-x-1"
            on:click={() => {
                onBack();
            }}
        >
            <div class=" self-center">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    class="h-4 w-4"
                >
                    <path
                        fill-rule="evenodd"
                        d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
                        clip-rule="evenodd"
                    />
                </svg>
            </div>
            <div class=" self-center text-sm font-medium">{'Back'}</div>
        </button>
    {/if}

    <div class="w-full max-h-full flex justify-center">
        {#if !edit || (edit && model)}
            <form
                class="flex flex-col md:flex-row w-full gap-3 md:gap-6"
                on:submit|preventDefault={() => {
                    submitHandler();
                }}
            >
                <div class="w-full px-1">
                    <div class="flex flex-col md:flex-row gap-4 w-full">
                        <div class="flex flex-col w-full flex-1">
                            <div class="flex flex-col my-2">
                                <div class="flex-1 w-full">
                                    <input
                                        class="text-4xl font-medium w-full bg-transparent outline-hidden"
                                        placeholder="Model Name"
                                        bind:value={info.name}
                                        required
                                    />
                                </div>

                                <div class="flex-1 w-full">
                                    <input
                                        class="text-xs w-full bg-transparent outline-hidden"
                                        placeholder="Model ID"
                                        bind:value={info.id}
                                        disabled={edit}
                                        required
                                    />
                                </div>

                                <div class="flex items-center gap-2 mt-2">
                                    <span class="text-xs text-gray-500 dark:text-gray-400"
                                        >Access:</span
                                    >
                                    <select
                                        class="bg-gray-50 dark:bg-gray-850 rounded-lg px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 outline-hidden min-w-[7rem]"
                                        bind:value={info.isPublic}
                                    >
                                        <option value={true}>Everyone</option>
                                        <option value={false}>Only Me</option>
                                    </select>
                                </div>
                            </div>

                            <div class="mb-1">
                                <div class=" text-xs font-medium mb-1 text-gray-500">
                                    {'Base Model (From)'}
                                </div>

                                {#if $user?.role === 'admin'}
                                    <div>
                                        <select
                                            class="dark:bg-gray-900 text-sm w-full bg-transparent outline-hidden"
                                            bind:value={info.base_model_id}
                                            required
                                        >
                                            <option value={null} class=" text-gray-900"
                                                >{'Select a base model'}</option
                                            >
                                            {#each baseModels as bm}
                                                <option value={bm.id} class=" text-gray-900"
                                                    >{bm.name}</option
                                                >
                                            {/each}
                                        </select>
                                    </div>
                                {:else}
                                    <div class="text-sm text-gray-600 dark:text-gray-400">
                                        {info.base_model_id ?? '—'}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>

                    <div class="my-2">
                        <div class="flex w-full justify-between">
                            <div class=" self-center text-xs font-medium text-gray-500">
                                {'Model Params'}
                            </div>
                        </div>

                        <div class="mt-2">
                            <div class="my-1">
                                <div class=" text-xs font-medium mb-2">{'System Prompt'}</div>
                                <div>
                                    <Textarea
                                        className=" text-sm w-full bg-transparent outline-hidden resize-none overflow-y-hidden "
                                        placeholder={'Write your model system prompt content here\ne.g.) You are Mario from Super Mario Bros, acting as an assistant.'}
                                        rows={4}
                                        bind:value={info.params.system}
                                    />
                                </div>
                            </div>

                            <div class="flex w-full justify-between">
                                <div class=" self-center text-xs font-medium">
                                    {'Advanced Params'}
                                </div>

                                <button
                                    class="p-1 px-3 text-xs flex rounded-sm transition"
                                    type="button"
                                    on:click={() => {
                                        showAdvanced = !showAdvanced;
                                    }}
                                >
                                    {#if showAdvanced}
                                        <span class="ml-2 self-center">{'Hide'}</span>
                                    {:else}
                                        <span class="ml-2 self-center">{'Show'}</span>
                                    {/if}
                                </button>
                            </div>

                            {#if showAdvanced}
                                <div class="my-2">
                                    <AdvancedParams bind:params={info.params} />
                                </div>
                            {/if}
                        </div>
                    </div>

                    <hr class=" border-gray-100/30 dark:border-gray-850/30 my-2" />

                    <div class="my-2">
                        <hr class=" border-gray-100/30 dark:border-gray-850/30 my-2" />

                        <div class="my-2 flex justify-end">
                            <button
                                class=" text-sm px-3 py-2 transition rounded-lg {!hasChanges ||
                                loading
                                    ? 'cursor-not-allowed opacity-50 bg-black text-white dark:bg-white dark:text-black'
                                    : 'bg-black hover:bg-gray-900 text-white dark:bg-white dark:hover:bg-gray-100 dark:text-black'} flex w-full justify-center"
                                type="submit"
                                disabled={!hasChanges || loading}
                            >
                                <div class=" self-center font-medium">
                                    {#if edit}
                                        {'Save & Update'}
                                    {:else}
                                        {'Save & Create'}
                                    {/if}
                                </div>

                                {#if loading}
                                    <div class="ml-1.5 self-center">
                                        <Spinner />
                                    </div>
                                {/if}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        {/if}
    </div>
{/if}
