<script lang="ts">
    /** The last few lines of reasoning, while the model is reasoning. */
    export let text: string;

    // Only the end is ever visible, so there's no need to lay out all of it each token.
    $: tail = text.slice(-1200);
</script>

<div
    class="mt-1.5 border-s-2 border-dotted border-s-gray-100 dark:border-gray-800 ps-3 h-[3.75rem] overflow-hidden flex flex-col justify-end [mask-image:linear-gradient(to_bottom,transparent,black_1.25rem)]"
>
    <div class="text-xs leading-5 text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words">{tail}</div>
</div>
