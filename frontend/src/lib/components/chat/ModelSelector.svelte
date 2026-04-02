<script lang="ts">
    import { models, settings, selectedModel } from '$lib/stores';
    import { onMount } from 'svelte';
    import Selector from './ModelSelector/Selector.svelte';

    import { updateUserSettings } from '$lib/apis/users';

    // Local string value for the Selector component
    let value: string = $selectedModel?.id ?? '';

    // Store → local
    $: value = $selectedModel?.id ?? '';

    // Local → store
    $: {
        const model = $models.find((m) => m.id === value) ?? null;
        selectedModel.set(model);
    }

    let initialized = false;
    onMount(() => {
        initialized = true;
    });

    // Auto-save default model when user selects a new one
    $: if (initialized && value !== '') {
        const newSettings = { ...$settings, model: value };
        settings.set(newSettings);
        updateUserSettings(localStorage.token, { ui: newSettings });
    }

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

    $: if ($models.length > 0) {
        if (value !== '' && !$models.map((m) => m.id).includes(value)) {
            value = '';
        }
    }
</script>

<div class="flex flex-col w-full items-start">
    <div class="flex w-full max-w-fit">
        <div class="overflow-hidden w-full">
            <div class="max-w-full mr-1">
                <Selector id="0" placeholder="Select a model" {pinModelHandler} bind:value />
            </div>
        </div>
    </div>
</div>
