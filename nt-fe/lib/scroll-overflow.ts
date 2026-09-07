/** Same 1px slack the request-details side sheet uses to ignore sub-pixel noise. */
const OVERFLOW_SLACK_PX = 1;

/** Whether a scrollport is hiding content above and/or below its visible box. */
export function measureScrollOverflow(viewport: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
}): { hasContentAbove: boolean; hasContentBelow: boolean } {
    return {
        hasContentAbove: viewport.scrollTop > OVERFLOW_SLACK_PX,
        hasContentBelow:
            viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight >
            OVERFLOW_SLACK_PX,
    };
}

/**
 * Re-runs `measure` on scroll, box resize, and in-place child swaps
 * (skeleton / empty list → fetched rows) so overflow hairlines update
 * without waiting for the next user scroll.
 */
export function watchScrollOverflow(
    viewport: HTMLElement,
    measure: () => void,
): () => void {
    const resizeObserver = new ResizeObserver(measure);
    const observeSizes = () => {
        resizeObserver.disconnect();
        resizeObserver.observe(viewport);
        const content = viewport.firstElementChild;
        if (content) resizeObserver.observe(content);
    };

    measure();
    observeSizes();
    viewport.addEventListener("scroll", measure, { passive: true });
    const mutationObserver = new MutationObserver(() => {
        observeSizes();
        measure();
    });
    mutationObserver.observe(viewport, { childList: true, subtree: true });

    return () => {
        viewport.removeEventListener("scroll", measure);
        resizeObserver.disconnect();
        mutationObserver.disconnect();
    };
}
