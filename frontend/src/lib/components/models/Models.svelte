<script lang="ts">
    import { toast } from 'svelte-sonner';

    import { onMount, tick } from 'svelte';
    import { goto } from '$app/navigation';
    import { APP_NAME, models as _models, settings, user, type Model } from '$lib/stores';
    import type { ModelResponse } from '@backend/routes/types';
    import { deleteModelById, getBaseModels, toggleModelById, getModels } from '$lib/apis/models';

    import { updateUserSettings } from '$lib/apis/users';

    import EllipsisHorizontal from '../icons/EllipsisHorizontal.svelte';
    import ModelMenu from './ModelMenu.svelte';
    import ModelDeleteConfirmDialog from '../common/ConfirmDialog.svelte';
    import Tooltip from '../common/Tooltip.svelte';
    import Plus from '../icons/Plus.svelte';
    import Switch from '../common/Switch.svelte';
    import Spinner from '../common/Spinner.svelte';
    import ViewSelector from '../common/ViewSelector.svelte';

    let loaded = false;

    let showModelDeleteConfirm = false;

    let selectedModel: Model;

    let viewOption = '';

    let models: Model[] = [];
    let total: number | null = null;

    // Base models (admin only)
    let baseModels: ModelResponse[] = [];

    $: if (viewOption !== undefined) {
        getModelList();
    }

    const getModelList = async () => {
        const res = await getModels(localStorage.token).catch((error) => {
            toast.error(`${error}`);
            return [] as Model[];
        });

        models = res;
        total = res.length;
    };

    const deleteModelHandler = async (model: Model) => {
        const res = await deleteModelById(localStorage.token, model.id).catch((e) => {
            toast.error(`${e}`);
            return false;
        });

        if (res) {
            toast.success(`Deleted ${model.id}`);

            getModelList();
        }

        await _models.set(await getModels(localStorage.token));
    };

    const cloneModelHandler = async (model: Model) => {
        sessionStorage.model = JSON.stringify({
            ...model,
            id: `${model.id}-clone`,
            name: `${model.name} (Clone)`
        });
        goto('/models/create');
    };

    const pinModelHandler = async (modelId: string) => {
        let pinnedModels = $settings.pinnedModels;

        if (pinnedModels.includes(modelId)) {
            pinnedModels = pinnedModels.filter((id) => id !== modelId);
        } else {
            pinnedModels = [...new Set([...pinnedModels, modelId])];
        }

        settings.set({ ...$settings, pinnedModels: pinnedModels });
        await updateUserSettings(localStorage.token, { ui: $settings });
    };

    const createFromBaseModel = (baseModel: ModelResponse) => {
        sessionStorage.model = JSON.stringify({
            baseModelId: baseModel.id,
            name: `${baseModel.name}-custom`,
            params: baseModel.params ?? {},
            meta: { description: '' }
        });
        goto('/models/create');
    };

    const createFromSharedModel = (model: Model) => {
        sessionStorage.model = JSON.stringify({
            baseModelId: model.baseModelId,
            name: `${model.name} (Mine)`,
            params: model.params ?? {},
            meta: { description: '' }
        });
        goto('/models/create');
    };

    onMount(async () => {
        viewOption = '';

        if ($user?.role === 'admin') {
            baseModels = await getBaseModels(localStorage.token).catch(() => []);
        }

        await getModelList();
        loaded = true;
    });
</script>

<svelte:head>
    <title>
        {'Models'} • {$APP_NAME}
    </title>
</svelte:head>

{#if loaded}
    <ModelDeleteConfirmDialog
        bind:show={showModelDeleteConfirm}
        on:confirm={() => {
            deleteModelHandler(selectedModel);
        }}
    />

    <div class="flex flex-col gap-1 px-1 mt-1.5 mb-3">
        <div class="flex justify-between items-center">
            <div class="flex items-center md:self-center text-xl font-medium px-0.5 gap-2 shrink-0">
                <div>
                    {'Models'}
                </div>

                <div class="text-lg font-medium text-gray-500 dark:text-gray-500">
                    {total}
                </div>
            </div>

            <div class="flex w-full justify-end gap-1.5">
                <a
                    class=" px-2 py-1.5 rounded-xl bg-black text-white dark:bg-white dark:text-black transition font-medium text-sm flex items-center"
                    href="/models/create"
                >
                    <Plus className="size-3" strokeWidth="2.5" />
                    <div class=" hidden md:block md:ml-1 text-xs">{'New Model'}</div>
                </a>
            </div>
        </div>
    </div>

    <!-- Base Models (admin only) -->
    {#if $user?.role === 'admin' && baseModels.length > 0}
        <div class="mb-4">
            <div class="px-1 mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {'Base Models'}
            </div>
            <div
                class="py-2 bg-white dark:bg-gray-900 rounded-3xl border border-gray-100/30 dark:border-gray-850/30"
            >
                {#each baseModels as baseModel}
                    <div
                        class="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-850/50 transition rounded-2xl mx-1"
                    >
                        <div class="flex items-center gap-3">
                            <span class="text-sm font-medium">{baseModel.name}</span>
                        </div>
                        <Tooltip content="Create a custom model">
                            <button
                                class="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition"
                                on:click={() => createFromBaseModel(baseModel)}
                            >
                                <Plus className="size-4" strokeWidth="2.5" />
                            </button>
                        </Tooltip>
                    </div>
                {/each}
            </div>
        </div>
    {/if}

    <!-- Custom Models -->
    <div
        class="py-2 bg-white dark:bg-gray-900 rounded-3xl border border-gray-100/30 dark:border-gray-850/30"
    >
        <div
            class="px-3 flex w-full bg-transparent overflow-x-auto scrollbar-none py-1"
            on:wheel={(e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    e.currentTarget.scrollLeft += e.deltaY;
                }
            }}
        >
            <div
                class="flex gap-0.5 w-fit text-center text-sm rounded-full bg-transparent px-0.5 whitespace-nowrap"
            >
                <ViewSelector
                    bind:value={viewOption}
                    onChange={async (value) => {
                        await tick();
                    }}
                />
            </div>
        </div>

        {#if models.length !== 0}
            <div class=" px-3 my-2 gap-1 lg:gap-2 grid lg:grid-cols-2" id="model-list">
                {#each models as model (model.id)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                        class="flex transition rounded-2xl w-full p-2.5 {model.userId === $user?.id
                            ? 'cursor-pointer dark:hover:bg-gray-850/50 hover:bg-gray-50'
                            : 'cursor-default dark:hover:bg-gray-850/50 hover:bg-gray-50'}"
                        id="model-item-{model.id}"
                        on:click={() => {
                            if (model.userId === $user?.id) {
                                goto(`/models/edit?id=${encodeURIComponent(model.id)}`);
                            }
                        }}
                    >
                        <div class="flex group/item gap-3.5 w-full">
                            <div class=" shrink-0 flex w-full min-w-0 flex-1 pr-1 self-center">
                                <div
                                    class="flex h-full w-full flex-1 flex-col justify-start self-center group"
                                >
                                    <div class="flex-1 w-full">
                                        <div class="flex items-center justify-between w-full">
                                            <Tooltip
                                                content={model.name}
                                                className=" w-fit"
                                                placement="top-start"
                                            >
                                                <a
                                                    class=" font-medium line-clamp-1 hover:underline capitalize"
                                                    href={`/?models=${encodeURIComponent(model.id)}`}
                                                >
                                                    {model.name}
                                                </a>
                                            </Tooltip>

                                            <div class="flex items-center gap-1">
                                                {#if model.userId === $user?.id}
                                                    <div
                                                        class="flex {model.isActive
                                                            ? ''
                                                            : 'text-gray-500'}"
                                                    >
                                                        <div class="flex items-center gap-0.5">
                                                            <ModelMenu
                                                                {model}
                                                                editHandler={() => {
                                                                    goto(
                                                                        `/models/edit?id=${encodeURIComponent(model.id)}`
                                                                    );
                                                                }}
                                                                cloneHandler={() => {
                                                                    cloneModelHandler(model);
                                                                }}
                                                                pinModelHandler={() => {
                                                                    pinModelHandler(model.id);
                                                                }}
                                                                deleteHandler={() => {
                                                                    selectedModel = model;
                                                                    showModelDeleteConfirm = true;
                                                                }}
                                                                onClose={() => {}}
                                                            >
                                                                <div
                                                                    class="self-center w-fit p-1 text-sm dark:text-white hover:bg-black/5 dark:hover:bg-white/5 rounded-xl"
                                                                >
                                                                    <EllipsisHorizontal
                                                                        className="size-5"
                                                                    />
                                                                </div>
                                                            </ModelMenu>

                                                            <button
                                                                on:click={(e) => {
                                                                    e.stopPropagation();
                                                                }}
                                                            >
                                                                <Tooltip
                                                                    content={model.isActive
                                                                        ? 'Enabled'
                                                                        : 'Disabled'}
                                                                >
                                                                    <Switch
                                                                        bind:state={model.isActive}
                                                                        on:change={async () => {
                                                                            toggleModelById(
                                                                                localStorage.token,
                                                                                model.id
                                                                            );
                                                                            _models.set(
                                                                                await getModels(
                                                                                    localStorage.token
                                                                                )
                                                                            );
                                                                        }}
                                                                    />
                                                                </Tooltip>
                                                            </button>
                                                        </div>
                                                    </div>
                                                {:else}
                                                    <Tooltip content="Create my own version">
                                                        <button
                                                            class="p-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition"
                                                            on:click={(e) => {
                                                                e.stopPropagation();
                                                                createFromSharedModel(model);
                                                            }}
                                                        >
                                                            <Plus
                                                                className="size-4"
                                                                strokeWidth="2.5"
                                                            />
                                                        </button>
                                                    </Tooltip>
                                                {/if}
                                            </div>
                                        </div>

                                        <div class=" flex gap-1 pr-2 -mt-1 items-center">
                                            <Tooltip
                                                content={model.baseModelId}
                                                className=" w-fit text-left"
                                                placement="top-start"
                                            >
                                                <div class="flex gap-1 text-xs overflow-hidden">
                                                    <div class="line-clamp-1">
                                                        {model.baseModelId}
                                                    </div>
                                                </div>
                                            </Tooltip>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {:else}
            <div class=" w-full h-full flex flex-col justify-center items-center my-16 mb-24">
                <div class="max-w-md text-center">
                    <div class=" text-3xl mb-3">😕</div>
                    <div class=" text-lg font-medium mb-1">{'No models found'}</div>
                    <div class=" text-gray-500 text-center text-xs">
                        {'Create a custom model to get started.'}
                    </div>
                </div>
            </div>
        {/if}
    </div>
{:else}
    <div class="w-full h-full flex justify-center items-center">
        <Spinner className="size-5" />
    </div>
{/if}
