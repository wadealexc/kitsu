<script lang="ts">
    import { tick, createEventDispatcher, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { isEditingMessage, mobile } from '$lib/stores';
    import { focusWithoutPan } from '$lib/utils/iosKeyboard';

    export let content: string = '';
    export let primaryLabel: string = 'Save';
    export let secondaryLabel: string = '';
    export let containerClass: string = 'bg-gray-50 dark:bg-gray-800 rounded-3xl px-5 py-3 my-2';
    export let scrollContainer: boolean = false;
    export let textareaClass: string = '';

    const dispatch = createEventDispatcher<{
        confirm: { content: string };
        secondary: { content: string };
        cancel: void;
    }>();

    let editedContent: string = content;
    let textAreaElement: HTMLTextAreaElement;
    let buttonBarElement: HTMLDivElement;
    let containerElement: HTMLDivElement;
    let scrollWrapperElement: HTMLDivElement;

    const endEdit = () => isEditingMessage.set(false);
    onDestroy(endEdit);

    $: isDirty = editedContent !== content;

    /** Scroll the editor into view: show as much content as possible while
     *  keeping the save/cancel buttons visible. Uses manual scroll math
     *  instead of scrollIntoView to avoid issues with nested scroll
     *  containers and to account for floating UI that overlaps the
     *  scroll area (e.g. the scroll-to-bottom button above MessageInput).
     */
    function scrollEditorIntoView(): void {
        if (!containerElement || !buttonBarElement) return;

        const scrollParent = containerElement.closest('#messages-container');
        if (!scrollParent) return;

        const scrollRect = scrollParent.getBoundingClientRect();
        const containerRect = containerElement.getBoundingClientRect();
        const buttonRect = buttonBarElement.getBoundingClientRect();

        // The scroll-to-bottom FAB floats ~48px above MessageInput into the
        // messages area.  Reserve clearance so buttons aren't hidden behind it.
        // On mobile, the FAB is hidden during editing, so use smaller clearance.
        const BOTTOM_CLEARANCE = get(mobile) ? 8 : 56;
        const TOP_PAD = 8;

        const visibleTop = scrollRect.top;
        const visibleBottom = scrollRect.bottom - BOTTOM_CLEARANCE;
        const visibleHeight = visibleBottom - visibleTop;

        // Positions relative to the visible area's top edge
        const editorTop = containerRect.top - visibleTop;
        const buttonBottom = buttonRect.bottom - visibleTop;

        let scrollDelta = 0;

        if (containerRect.height <= visibleHeight) {
            // Editor fits entirely in the effective visible area.
            if (editorTop < 0) {
                // Top is above visible area — scroll up to reveal it
                scrollDelta = editorTop - TOP_PAD;
            } else if (buttonBottom > visibleHeight) {
                // Buttons are below effective visible bottom — scroll down
                scrollDelta = buttonBottom - visibleHeight + TOP_PAD;
            }
        } else {
            // Editor is taller than the visible area.
            // Priority: keep save/cancel buttons visible at the bottom.
            scrollDelta = buttonBottom - visibleHeight + TOP_PAD;
        }

        if (Math.abs(scrollDelta) > 1) {
            scrollParent.scrollBy({ top: scrollDelta, behavior: 'instant' });
        }
    }

    export async function activate(initialContent?: string) {
        isEditingMessage.set(true);
        editedContent = initialContent ?? content;
        await tick();
        if (textAreaElement) {
            textAreaElement.style.height = '';
            textAreaElement.style.height = `${textAreaElement.scrollHeight}px`;
            // On iOS, waits for the keyboard: the editor is moved aside while it opens
            // so the app doesn't slide, then scrolled into view in the smaller space.
            await focusWithoutPan(textAreaElement, { moved: containerElement });
        }
        if (scrollWrapperElement) {
            scrollWrapperElement.scrollTop = scrollWrapperElement.scrollHeight;
        }

        // Scroll immediately so the editor is visible (handles desktop and
        // cases where the mobile keyboard is already open).
        await tick();
        scrollEditorIntoView();

        // On mobile, the keyboard opens after focus and resizes the viewport.
        // Debounce: wait for the keyboard animation to finish and layout to
        // settle before re-scrolling.
        if (window.visualViewport) {
            let resizeTimer: NodeJS.Timeout;
            const onResize = () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
                    if (scrollWrapperElement) {
                        scrollWrapperElement.scrollTop = scrollWrapperElement.scrollHeight;
                    }
                    scrollEditorIntoView();
                }, 150);
            };
            window.visualViewport.addEventListener('resize', onResize);
            // Stop listening after 1.5s (keyboard animation is ~400ms)
            setTimeout(() => {
                window.visualViewport?.removeEventListener('resize', onResize);
                clearTimeout(resizeTimer);
            }, 1500);
        }
    }

    function handleInput(e: Event) {
        const t = e.target as HTMLTextAreaElement;
        t.style.height = '';
        t.style.height = `${t.scrollHeight}px`;
        if (
            scrollWrapperElement &&
            scrollWrapperElement.scrollHeight > scrollWrapperElement.clientHeight
        ) {
            scrollWrapperElement.scrollTop = scrollWrapperElement.scrollHeight;
        }
        scrollEditorIntoView();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            dispatch('cancel');
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isDirty) {
            dispatch('confirm', { content: editedContent });
        }
    }
</script>

<div bind:this={containerElement} class={containerClass}>
    <slot name="files" />

    {#if scrollContainer}
        <div
            bind:this={scrollWrapperElement}
            class="overflow-auto"
            style="max-height: min(24rem, calc(var(--app-height, 100dvh) - 8rem));"
        >
            <textarea
                bind:this={textAreaElement}
                class="bg-transparent outline-hidden w-full resize-none {textareaClass}"
                bind:value={editedContent}
                on:input={handleInput}
                on:keydown={handleKeydown}
            ></textarea>
        </div>
    {:else}
        <textarea
            bind:this={textAreaElement}
            class="bg-transparent outline-hidden w-full resize-none {textareaClass}"
            bind:value={editedContent}
            on:input={handleInput}
            on:keydown={handleKeydown}
        ></textarea>
    {/if}

    <div
        bind:this={buttonBarElement}
        class="mt-2 mb-1 flex {secondaryLabel
            ? 'justify-between'
            : 'justify-end'} text-sm font-medium"
    >
        {#if secondaryLabel}
            <div>
                <button
                    class="px-3.5 py-1.5 bg-gray-50 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 border border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200 transition rounded-3xl disabled:opacity-40 disabled:cursor-not-allowed"
                    on:click={() => dispatch('secondary', { content: editedContent })}
                    disabled={!isDirty}
                >
                    {secondaryLabel}
                </button>
            </div>
        {/if}

        <div class="flex space-x-1.5">
            <button
                class="px-3.5 py-1.5 bg-white dark:bg-gray-900 hover:bg-gray-100 text-gray-800 dark:text-gray-100 transition rounded-3xl"
                on:click={() => dispatch('cancel')}
            >
                {'Cancel'}
            </button>

            <button
                class="px-3.5 py-1.5 bg-gray-900 dark:bg-white hover:bg-gray-850 text-gray-100 dark:text-gray-800 transition rounded-3xl disabled:opacity-40 disabled:cursor-not-allowed"
                on:click={() => dispatch('confirm', { content: editedContent })}
                disabled={!isDirty}
            >
                {primaryLabel}
            </button>
        </div>
    </div>
</div>
