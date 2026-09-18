/**
 * Whether a backend chart bucket belongs to a calendar day before the one
 * the request ended on, in the viewer's timezone.
 *
 * The backend grid ends with a bucket at the exact request end time, and
 * east of UTC today's midnight bucket also formats as today's date. Both
 * would render under today's label next to the live "Now" point, so the
 * dashboard charts today once, as "Now", and keeps only earlier days.
 */
export function precedesLocalDay(timestamp: string, endTime: Date): boolean {
    const at = new Date(timestamp);
    if (at.getFullYear() !== endTime.getFullYear()) {
        return at.getFullYear() < endTime.getFullYear();
    }
    if (at.getMonth() !== endTime.getMonth()) {
        return at.getMonth() < endTime.getMonth();
    }
    return at.getDate() < endTime.getDate();
}
