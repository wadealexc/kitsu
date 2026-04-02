<script lang="ts">
    import { onDestroy, onMount } from 'svelte';

    import { chatId, mobile, models, settings, showSidebar, selectedModel } from '$lib/stores';
    import { updateUserSettings } from '$lib/apis/users';
    import PinnedModelItem from './PinnedModelItem.svelte';
    import type { Unsubscriber } from 'svelte/store';

    export let selectedChatId: string | null = null;
    export let shiftKey = false;

    let pinnedModels: string[] = [];

    let unsubscribeSettings: Unsubscriber | undefined;

    onMount(() => {
        pinnedModels = $settings.pinnedModels;

        unsubscribeSettings = settings.subscribe((value) => {
            pinnedModels = value.pinnedModels;
        });
    });

    onDestroy(() => {
        if (unsubscribeSettings) {
            unsubscribeSettings();
        }
    });
</script>

<div class="mt-0.5 pb-1.5" id="pinned-models-list">
    {#each pinnedModels as modelId (modelId)}
        {@const model = $models.find((model) => model.id === modelId)}
        {#if model}
            <PinnedModelItem
                {model}
                {shiftKey}
                onClick={() => {
                    selectedModel.set(model);
                    selectedChatId = null;
                    chatId.set('');
                    if ($mobile) {
                        showSidebar.set(false);
                    }
                }}
                onUnpin={$settings.pinnedModels.includes(modelId)
                    ? () => {
                          const pinnedModels = $settings.pinnedModels.filter(
                              (id) => id !== modelId
                          );
                          settings.set({ ...$settings, pinnedModels });
                          updateUserSettings(localStorage.token, { ui: $settings });
                      }
                    : undefined}
            />
        {/if}
    {/each}
</div>
