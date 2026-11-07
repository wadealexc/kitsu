/**
 * Opening the on-screen keyboard on iOS without the whole app sliding up.
 *
 * When an input that the keyboard would cover gets focus, iOS slides the entire
 * web view up to keep it visible, then slides it back once the page has resized
 * to fit above the keyboard. Pages can't see or undo that slide (the page's own
 * scroll stays at 0), so the app's top bar flies off screen and back.
 *
 * iOS only slides if the focused element would end up under the keyboard. So
 * for the moment of focusing, the element is moved far above the screen; iOS
 * sees nothing to uncover and doesn't slide. Once the keyboard has opened (the
 * visual viewport shrinks, ~110-130ms on an iPhone 13 mini) it moves back, now
 * inside the smaller layout.
 *
 * So the move isn't seen, a copy of the element stays drawn in its old place
 * meanwhile. With `slide`, the element then glides from there to its new place,
 * riding up with the keyboard the way native inputs do.
 */

/** When the slide should finish, counted from focus: about when the keyboard is fully up. */
const SLIDE_END_MS = 340;
/** Shortest slide, so it still reads as motion rather than a jump. */
const MIN_SLIDE_MS = 160;
/** Eases out like the keyboard, without covering most of the distance in the first frame. */
const SLIDE_EASING = 'cubic-bezier(0.25, 0.75, 0.3, 1)';

/** How long to wait for the keyboard before putting things back anyway. */
const FALLBACK_MS = 700;

export const isIOS = (): boolean =>
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** True while an on-screen keyboard takes up part of the screen. */
export const keyboardOpen = (): boolean => {
    const vv = window.visualViewport;
    return !!vv && vv.height < window.innerHeight - 100;
};

/**
 * Focuses `target`, moving `moved` (the element, or a box around it) out of the
 * way while the keyboard opens. `caret` puts the cursor somewhere particular in
 * an editable element. Resolves once everything is back in place.
 *
 * Elsewhere (desktop, or with the keyboard already open) it just focuses.
 */
export function focusWithoutPan(
    target: HTMLElement,
    options: { moved?: HTMLElement; caret?: Range | null; slide?: boolean } = {}
): Promise<void> {
    const placeCaret = () => {
        if (!options.caret) return;
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(options.caret);
    };

    if (!isIOS() || keyboardOpen() || !window.visualViewport) {
        target.focus({ preventScroll: true });
        placeCaret();
        return Promise.resolve();
    }

    const vv = window.visualViewport;
    const moved = options.moved ?? target;
    const startHeight = vv.height;
    const previous = moved.style.transform;
    // The element may have a CSS transition (e.g. Tailwind's `transition`), which
    // would animate the move away and back; that's switched off meanwhile.
    const previousTransition = moved.style.transition;

    // Already focused without a keyboard (e.g. focused on load): focusing again
    // wouldn't open one
    if (document.activeElement === target) target.blur();

    const tappedAt = performance.now();
    const before = moved.getBoundingClientRect();
    const ghost = drawGhost(moved, before);
    moved.style.transition = 'none';
    moved.style.transform = 'translateY(-3000px)';
    target.focus({ preventScroll: true });
    placeCaret();

    return new Promise((resolve) => {
        let done = false;
        const restore = () => {
            if (done) return;
            done = true;
            vv.removeEventListener('resize', onResize);
            clearTimeout(fallback);
            moved.style.transform = previous;
            void moved.offsetHeight; // settle the layout before measuring

            if (options.slide) {
                // Start where it was (where the ghost is), then glide to its new place
                const after = moved.getBoundingClientRect();
                const from = before.top - after.top;
                ghost.remove();
                if (Math.abs(from) > 1) {
                    const duration = Math.max(MIN_SLIDE_MS, SLIDE_END_MS - (performance.now() - tappedAt));
                    moved.style.transform = `translateY(${from}px)`;
                    void moved.offsetHeight; // apply before animating
                    moved.style.transition = `transform ${Math.round(duration)}ms ${SLIDE_EASING}`;
                    moved.style.transform = previous;
                    setTimeout(() => {
                        moved.style.transition = previousTransition;
                        resolve();
                    }, duration);
                    return;
                }
            } else {
                ghost.remove();
            }
            moved.style.transition = previousTransition;
            resolve();
        };
        const onResize = () => {
            if (vv.height < startHeight - 50) restore();
        };
        vv.addEventListener('resize', onResize);
        const fallback = setTimeout(restore, FALLBACK_MS);
    });
}

/** A non-interactive copy of `el`, drawn at `rect` above the page. */
function drawGhost(el: HTMLElement, rect: DOMRect): HTMLElement {
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    ghost.removeAttribute('id');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, {
        position: 'fixed',
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: '0',
        transform: 'none',
        pointerEvents: 'none',
        zIndex: '60'
    });
    document.body.appendChild(ghost);
    return ghost;
}

/** Where a tap landed in an editable element, as a collapsed range (WebKit). */
export function caretAt(x: number, y: number, within: HTMLElement): Range | null {
    const range = (document as any).caretRangeFromPoint?.(x, y) as Range | null | undefined;
    if (range && within.contains(range.startContainer)) return range;

    // Otherwise the end of the content
    const end = document.createRange();
    end.selectNodeContents(within);
    end.collapse(false);
    return end;
}
