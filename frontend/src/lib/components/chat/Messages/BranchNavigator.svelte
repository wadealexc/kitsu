<script lang="ts">
    import type { ChatMessage } from '@backend/routes/types';

    export let message: ChatMessage;
    export let siblings: string[];
    export let goToSibling: (message: ChatMessage, idx: number) => void;
</script>

{#if siblings.length > 1}
    <div class="flex self-center min-w-fit">
        <button
            aria-label="Previous message"
            class="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 dark:hover:text-white hover:text-black rounded-md transition"
            on:click={() => goToSibling(message, siblings.indexOf(message.id) - 1)}
        >
            <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
                class="size-3.5"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M15.75 19.5 8.25 12l7.5-7.5"
                />
            </svg>
        </button>

        <div class="text-sm tracking-widest font-semibold self-center dark:text-gray-100 min-w-fit">
            {siblings.indexOf(message.id) + 1}/{siblings.length}
        </div>

        <button
            aria-label="Next message"
            class="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 dark:hover:text-white hover:text-black rounded-md transition"
            on:click={() => goToSibling(message, siblings.indexOf(message.id) + 1)}
        >
            <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
                class="size-3.5"
            >
                <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="m8.25 4.5 7.5 7.5-7.5 7.5"
                />
            </svg>
        </button>
    </div>
{/if}
