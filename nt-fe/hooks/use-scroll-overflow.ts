"use client";

import { useEffect, useState } from "react";
import { measureScrollOverflow } from "@/lib/scroll-overflow";

/**
 * Tracks whether a scrollport is hiding content above/below — the same
 * overflow hairline request details uses on its side-sheet header.
 *
 * `viewportRef` is a callback ref so it rebinds when the list mounts
 * (e.g. after a loading skeleton).
 */
export function useScrollOverflow() {
    const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
    const [hasContentAbove, setHasContentAbove] = useState(false);
    const [hasContentBelow, setHasContentBelow] = useState(false);

    useEffect(() => {
        if (!viewport) {
            setHasContentAbove(false);
            setHasContentBelow(false);
            return;
        }

        const measure = () => {
            const next = measureScrollOverflow(viewport);
            setHasContentAbove((prev) =>
                prev === next.hasContentAbove ? prev : next.hasContentAbove,
            );
            setHasContentBelow((prev) =>
                prev === next.hasContentBelow ? prev : next.hasContentBelow,
            );
        };

        measure();
        viewport.addEventListener("scroll", measure, { passive: true });
        const observer = new ResizeObserver(measure);
        observer.observe(viewport);
        const content = viewport.firstElementChild;
        if (content) observer.observe(content);

        return () => {
            viewport.removeEventListener("scroll", measure);
            observer.disconnect();
        };
    }, [viewport]);

    return { viewportRef: setViewport, hasContentAbove, hasContentBelow };
}
