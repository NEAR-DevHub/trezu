"use client";

import { useEffect, useState } from "react";
import {
    isTextEntryElement,
    shouldHideBottomNavForKeyboard,
} from "@/lib/mobile-keyboard";

/**
 * True while the virtual keyboard is up, or a text field is focused on a
 * phone (Android often resizes the layout instead of reporting overlap).
 */
export function useMobileKeyboardOpen(): boolean {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let blurTimer = 0;

        const update = () => {
            const viewport = window.visualViewport;
            const visualOverlapPx = viewport
                ? window.innerHeight - viewport.height - viewport.offsetTop
                : 0;
            setOpen(
                shouldHideBottomNavForKeyboard({
                    textEntryFocused: isTextEntryElement(
                        document.activeElement,
                    ),
                    visualOverlapPx,
                }),
            );
        };

        const onFocusIn = () => {
            window.clearTimeout(blurTimer);
            update();
        };
        const onFocusOut = () => {
            blurTimer = window.setTimeout(update, 50);
        };

        document.addEventListener("focusin", onFocusIn);
        document.addEventListener("focusout", onFocusOut);
        window.addEventListener("resize", update);
        window.visualViewport?.addEventListener("resize", update);
        window.visualViewport?.addEventListener("scroll", update);
        update();

        return () => {
            window.clearTimeout(blurTimer);
            document.removeEventListener("focusin", onFocusIn);
            document.removeEventListener("focusout", onFocusOut);
            window.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("resize", update);
            window.visualViewport?.removeEventListener("scroll", update);
        };
    }, []);

    return open;
}
