<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { goto } from '$app/navigation';
    import { models } from '$lib/stores';

    import { onMount } from 'svelte';
    import { createNewModel, getModels } from '$lib/apis/models';

    import ModelEditor from '$lib/components/models/ModelEditor.svelte';
    import type { ModelAccessResponse, ModelForm } from '@backend/routes/types';

    const onSubmit = async (modelInfo: ModelForm) => {
        if ($models.find((m) => m.id === modelInfo.id)) {
            toast.error(
                `Error: A model with the ID '${modelInfo.id}' already exists. Please select a different ID to proceed.`
            );
            return;
        }

        if (modelInfo.id === '') {
            toast.error('Error: Model ID cannot be empty. Please enter a valid ID to proceed.');
            return;
        }

        const res = await createNewModel(localStorage.token, modelInfo).catch((error) => {
            toast.error(`${error}`);
            return null;
        });

        if (res) {
            models.set(await getModels(localStorage.token));
            toast.success('Model created successfully!');
            await goto('/models');
        }
    };

    let model: ModelAccessResponse | null = null;

    onMount(async () => {
        if (sessionStorage.model) {
            model = JSON.parse(sessionStorage.model);
            sessionStorage.removeItem('model');
        }
    });
</script>

{#key model}
    <ModelEditor {model} {onSubmit} />
{/key}
