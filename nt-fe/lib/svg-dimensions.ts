/**
 * Resolves the intrinsic pixel size of an SVG document from its root element:
 * explicit `width`/`height` attributes win, otherwise the `viewBox` size is used.
 * Returns null when neither yields a usable size (e.g. percentage units).
 */
export function getSvgDimensions(
    svgText: string,
): { width: number; height: number } | null {
    const root = svgText.match(/<svg\b[^>]*>/i)?.[0];
    if (!root) return null;

    const attr = (name: string) =>
        root.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
    const px = (value?: string) => {
        const m = value?.trim().match(/^(\d+(?:\.\d+)?)(px)?$/i);
        return m ? Number(m[1]) : null;
    };

    let width = px(attr("width"));
    let height = px(attr("height"));

    if (width === null || height === null) {
        const parts = attr("viewBox")
            ?.trim()
            .split(/[\s,]+/)
            .map(Number);
        if (parts?.length === 4 && parts.every(Number.isFinite)) {
            width ??= parts[2];
            height ??= parts[3];
        }
    }

    return width !== null && height !== null && width > 0 && height > 0
        ? { width, height }
        : null;
}
