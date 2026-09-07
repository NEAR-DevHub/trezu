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
