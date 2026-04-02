<script lang="ts">
    import { toast } from 'svelte-sonner';
    import { goto } from '$app/navigation';

    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { models } from '$lib/stores';

    import { getModelById, updateModelById, getModels } from '$lib/apis/models';
    import ModelEditor from '$lib/components/models/ModelEditor.svelte';
    import type { ModelAccessResponse, ModelForm } from '@backend/routes/types';

    let model: ModelAccessResponse | null = null;

    onMount(async () => {
        const _id = $page.url.searchParams.get('id');
        if (_id) {
            model = await getModelById(localStorage.token, _id).catch((e) => {
                return null;
            });

            if (!model) {
                goto('/models');
            }

            if (!model?.write_access) {
                toast.error('You do not have permission to edit this model');
                goto('/models');
            }
        } else {
            goto('/models');
        }
    });

    const onSubmit = async (modelInfo: ModelForm) => {
        const res = await updateModelById(localStorage.token, modelInfo.id, modelInfo);

        if (res) {
            models.set(await getModels(localStorage.token));
            toast.success('Model updated successfully');
            await goto('/models');
        }
    };
</script>

{#if model}
    <ModelEditor edit={true} {model} {onSubmit} />
{/if}
