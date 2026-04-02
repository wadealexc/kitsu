<script>
    export let title = '';
    export let content = '';
</script>

<div class="px-3">
    <div class="text-center dark:text-white text-2xl font-medium z-50">
        {#if title}
            {title}
        {:else}
            {'Add Files'}
        {/if}
    </div>

    <slot
        ><div class="px-2 mt-2 text-center text-gray-700 dark:text-gray-200 w-full">
            {#if content}
                {content}
            {:else}
                {'Drop any files here to upload'}
            {/if}
        </div>
    </slot>
</div>
