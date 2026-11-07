/** Svelte action: moves the element to document.body, out of clipping or scrolling ancestors. */
export function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
        destroy() {
            node.parentNode?.removeChild(node);
        }
    };
}
