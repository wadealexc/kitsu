<script>
    import { onMount } from 'svelte';
    import { models } from '$lib/stores';
    import { getModels } from '$lib/apis/models';
    import Models from '$lib/components/models/Models.svelte';

    onMount(async () => {
        models.set(await getModels(localStorage.token));
    });
</script>

{#if $models !== null}
    <Models />
{/if}
