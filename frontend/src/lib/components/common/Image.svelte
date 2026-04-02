<script lang="ts">
    import { settings } from '$lib/stores';
    import ImagePreview from './ImagePreview.svelte';
    import XMark from '$lib/components/icons/XMark.svelte';
    export let src = '';
    export let alt = '';

    export let className = 'w-full outline-hidden focus:outline-hidden';

    export let imageClassName = 'rounded-lg';

    export let dismissible = false;
    export let onDismiss = () => {};

    let _src = '';
    $: _src = src;

    let showImagePreview = false;
</script>

<ImagePreview bind:show={showImagePreview} src={_src} {alt} />

<div class=" relative group w-fit flex items-center">
    <button
        class={className}
        on:click={() => {
            showImagePreview = true;
        }}
        aria-label="Show image preview"
        type="button"
    >
        <img src={_src} {alt} class={imageClassName} draggable="false" data-cy="image" />
    </button>

    {#if dismissible}
        <div class=" absolute -top-1 -right-1">
            <button
                aria-label="Remove image"
                class=" bg-white text-black border border-white rounded-full group-hover:visible invisible transition"
                type="button"
                on:click={() => {
                    onDismiss();
                }}
            >
                <XMark className="size-4" />
            </button>
        </div>
    {/if}
</div>
