<script lang="ts">
    import { onDestroy, onMount } from 'svelte';
    import { fade } from 'svelte/transition';

    import { flyAndScale } from '$lib/utils/transitions';
    import * as FocusTrap from 'focus-trap';

    type ModalSize = 'full' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';

    export let show = true;
    export let size: ModalSize = 'md';
    export let containerClassName: string = 'p-3';
    export let className: string = 'bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm rounded-xl';

    let modalElement: HTMLDivElement | null = null;
    // Create focus trap to trap user tabs inside modal
    // https://www.w3.org/WAI/WCAG21/Understanding/focus-order.html
    // https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html
    let focusTrap: FocusTrap.FocusTrap | null = null;

    const sizeWidths: Record<ModalSize, string> = {
        full: 'w-full',
        xs: 'w-[16rem]',
        sm: 'w-[30rem]',
        md: 'w-[42rem]',
        lg: 'w-[56rem]',
        xl: 'w-[70rem]',
        '2xl': 'w-[84rem]',
        '3xl': 'w-[100rem]'
    };

    const sizeToWidth = (s: ModalSize) => sizeWidths[s] ?? 'w-[56rem]';

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && isTopModal()) {
            show = false;
        }
    };

    const isTopModal = () => {
        const modals = document.getElementsByClassName('modal');
        return modals.length && modals[modals.length - 1] === modalElement;
    };

    $: if (show && modalElement) {
        document.body.appendChild(modalElement);
        focusTrap = FocusTrap.createFocusTrap(modalElement, {
            allowOutsideClick: (e) => {
                const target = e.target as Element;
                return (
                    target.closest('[data-sonner-toast]') !== null ||
                    target.closest('.modal-content') === null
                );
            }
        });
        focusTrap.activate();
        window.addEventListener('keydown', handleKeyDown);
        document.body.style.overflow = 'hidden';
    } else if (modalElement) {
        focusTrap?.deactivate();
        window.removeEventListener('keydown', handleKeyDown);
        document.body.removeChild(modalElement);
        document.body.style.overflow = 'unset';
    }

    onDestroy(() => {
        show = false;
        if (focusTrap) {
            focusTrap.deactivate();
        }
        if (modalElement) {
            document.body.removeChild(modalElement);
        }
    });
</script>

{#if show}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        bind:this={modalElement}
        aria-modal="true"
        role="dialog"
        tabindex="-1"
        class="modal fixed top-0 right-0 left-0 bottom-0 bg-black/30 dark:bg-black/60 w-full h-screen max-h-[100dvh] {containerClassName}  flex justify-center z-9999 overflow-y-auto overscroll-contain"
        style="scrollbar-gutter: stable;"
        in:fade={{ duration: 10 }}
        on:mousedown={() => {
            show = false;
        }}
    >
        <div
            class="m-auto max-w-full {sizeToWidth(size)} {size !== 'full'
                ? 'mx-2'
                : ''} shadow-3xl min-h-fit scrollbar-hidden {className} border border-white dark:border-gray-850"
            in:flyAndScale
            on:mousedown={(e) => {
                e.stopPropagation();
            }}
        >
            <slot />
        </div>
    </div>
{/if}

<style>
    @keyframes scaleUp {
        from {
            transform: scale(0.985);
            opacity: 0;
        }
        to {
            transform: scale(1);
            opacity: 1;
        }
    }
</style>
