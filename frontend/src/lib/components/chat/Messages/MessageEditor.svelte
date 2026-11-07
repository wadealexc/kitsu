<script lang="ts">
    import { tick, createEventDispatcher, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { isEditingMessage, mobile } from '$lib/stores';
    import { expectedKeyboardViewportHeight, focusWithoutPan, isIOS, keyboardOpen } from '$lib/utils/iosKeyboard';
    import { portal } from '$lib/utils/portal';
    import { clearEditDraft, saveEditDraft } from '$lib/utils/editDraft';

    export let content: string = '';
    export let primaryLabel: string = 'Save';
    export let secondaryLabel: string = '';
    export let containerClass: string = 'bg-gray-50 dark:bg-gray-800 rounded-3xl px-5 py-3 my-2';
    export let scrollContainer: boolean = false;
    export let textareaClass: string = '';
    /** The message being edited: lets the edit survive iOS discarding the app. */
    export let messageId: string | null = null;

    const dispatch = createEventDispatcher<{
        confirm: { content: string };
        secondary: { content: string };
        cancel: void;
    }>();

    let editedContent: string = content;
    let textAreaElement: HTMLTextAreaElement;
    let buttonBarElement: HTMLDivElement;
    let containerElement: HTMLDivElement;
    let sheetElement: HTMLDivElement;

    /**
     * On phones the editor is a full-screen sheet rather than part of the message
     * list: inside a long scrolling list, iOS scrolls the list to "reveal" the
     * cursor when the keyboard opens and lands far from the editor. Nothing
     * around the sheet scrolls, so there's nothing for it to move.
     */
    const sheet = get(mobile);

    // If the app is hidden mid-edit, keep the edit so it can reopen after a restart
    const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden' && messageId && get(isEditingMessage)) {
            saveEditDraft(messageId, editedContent);
        }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Closing the editor (save, cancel, leaving the chat) ends the edit for good
    const endEdit = () => {
        isEditingMessage.set(false);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        if (messageId && document.visibilityState === 'visible') clearEditDraft(messageId);
    };
    onDestroy(endEdit);

    $: isDirty = editedContent !== content;

    /** Scroll the editor into view: show as much content as possible while
     *  keeping the save/cancel buttons visible. Uses manual scroll math
     *  instead of scrollIntoView to avoid issues with nested scroll
     *  containers and to account for floating UI that overlaps the
     *  scroll area (e.g. the scroll-to-bottom button above MessageInput).
     */
    function scrollEditorIntoView(visibleBottomLimit?: number): void {
        if (!containerElement || !buttonBarElement) return;

        const scrollParent = containerElement.closest('#messages-container');
        if (!scrollParent) return;

        const parentRect = scrollParent.getBoundingClientRect();
        const scrollRect = {
            top: parentRect.top,
            bottom: Math.min(parentRect.bottom, visibleBottomLimit ?? Infinity)
        };
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

    /** On iOS before the keyboard opens: the visible height once it has. */
    let keyboardHeightGuess: number | undefined;

    $: maxHeight = `min(24rem, calc(${keyboardHeightGuess ? `${keyboardHeightGuess}px` : 'var(--app-height, 100dvh)'} - 8rem))`;

    /** Grow the textarea with its text, up to the maximum height, and show the end. */
    function fitTextarea(): void {
        if (!textAreaElement) return;
        textAreaElement.style.height = '';
        textAreaElement.style.height = `${textAreaElement.scrollHeight}px`;
        textAreaElement.scrollTop = textAreaElement.scrollHeight;
    }

    /**
     * Opens the editor. `focus: false` shows it without focusing, e.g. when
     * reopening an edit after a restart, where iOS wouldn't open a keyboard anyway.
     */
    export async function activate(initialContent?: string, options: { focus?: boolean } = {}) {
        isEditingMessage.set(true);
        editedContent = initialContent ?? content;

        if (sheet) {
            // The cursor at the end. That's below where the keyboard will be, so the
            // sheet is moved aside while it opens (iosKeyboard.ts); nothing around
            // the sheet scrolls, so that's safe here.
            await tick();
            if (!textAreaElement) return;
            const end = textAreaElement.value.length;
            textAreaElement.setSelectionRange(end, end);
            textAreaElement.scrollTop = textAreaElement.scrollHeight;
            if (options.focus === false) return;
            await focusWithoutPan(textAreaElement, { moved: sheetElement });
            textAreaElement.setSelectionRange(end, end);
            textAreaElement.scrollTop = textAreaElement.scrollHeight;
            return;
        }

        // iOS scrolls the message list to reveal the cursor when the keyboard opens,
        // often far from the editor. So before focusing, fit the editor into the space
        // that will be left above the keyboard and show the cursor there: then there's
        // nothing for iOS to reveal.
        keyboardHeightGuess = isIOS() && !keyboardOpen() ? expectedKeyboardViewportHeight() : undefined;
        await tick();

        if (textAreaElement) {
            fitTextarea();
            // The cursor at the end, which is the part of the text shown
            const end = textAreaElement.value.length;
            textAreaElement.setSelectionRange(end, end);
        }

        await tick();
        scrollEditorIntoView(keyboardHeightGuess);
        textAreaElement?.focus({ preventScroll: true });

        // Once the keyboard is up (mobile), settle the editor into the final space.
        if (window.visualViewport) {
            let resizeTimer: ReturnType<typeof setTimeout>;
            const onResize = () => {
                clearTimeout(resizeTimer);
                resizeTimer = setTimeout(() => {
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

    function handleInput() {
        if (!textAreaElement) return;
        // Keep the cursor's scroll position while typing: only regrow the box
        const scrollTop = textAreaElement.scrollTop;
        textAreaElement.style.height = '';
        textAreaElement.style.height = `${textAreaElement.scrollHeight}px`;
        textAreaElement.scrollTop = scrollTop;
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

{#if sheet}
    <div
        use:portal
        bind:this={sheetElement}
        class="fixed inset-x-0 top-0 z-[60] flex flex-col bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100"
        style="height: var(--app-height, 100dvh); padding-top: env(safe-area-inset-top);"
        role="dialog"
        aria-label="Edit message"
    >
        <div class="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 text-sm font-medium">
            <button
                class="px-3 py-1.5 rounded-3xl text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                on:click={() => dispatch('cancel')}>{'Cancel'}</button
            >
            <div class="flex-1"></div>
            {#if secondaryLabel}
                <button
                    class="px-3.5 py-1.5 border border-gray-200 dark:border-gray-700 rounded-3xl disabled:opacity-40"
                    on:click={() => dispatch('secondary', { content: editedContent })}
                    disabled={!isDirty}>{secondaryLabel}</button
                >
            {/if}
            <button
                class="px-3.5 py-1.5 bg-gray-900 dark:bg-white text-gray-100 dark:text-gray-800 rounded-3xl disabled:opacity-40"
                on:click={() => dispatch('confirm', { content: editedContent })}
                disabled={!isDirty}>{primaryLabel}</button
            >
        </div>

        <div class="px-4"><slot name="files" /></div>

        <!-- 16px text: smaller makes iOS zoom the page on focus -->
        <textarea
            bind:this={textAreaElement}
            class="flex-1 min-h-0 w-full resize-none overflow-y-auto bg-transparent outline-hidden px-4 py-3 text-base leading-relaxed"
            bind:value={editedContent}
            on:keydown={handleKeydown}
        ></textarea>
    </div>
{:else}
<div bind:this={containerElement} class={containerClass}>
    <slot name="files" />

    <!-- With scrollContainer, the textarea scrolls itself past a maximum height.
         (Not a scrolling box around a full-height textarea: iOS keeps the cursor in
         view by scrolling the wrong containers then.) -->
    <textarea
        bind:this={textAreaElement}
        class="bg-transparent outline-hidden w-full resize-none {scrollContainer ? 'overflow-y-auto' : ''} {textareaClass}"
        style:max-height={scrollContainer ? maxHeight : null}
        bind:value={editedContent}
        on:input={handleInput}
        on:keydown={handleKeydown}
    ></textarea>

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
{/if}
