"use client";

import { useEffect, useState } from "react";
import {
    isKeyboardOccluding,
    shouldHideBottomNavForKeyboard,
} from "@/lib/mobile-keyboard";

/**
 * True once the virtual keyboard has squeezed the visual viewport.
 * Focus alone is not enough — hiding the tab bar on first tap reflows
 * the page and iOS drops the keyboard.
 * Pass `enabled` so pages that never hide the tab bar skip the listeners.
 */
export function useMobileKeyboardOpen(enabled = true): boolean {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setOpen(false);
            return;
        }

        let blurTimer = 0;

        const update = () => {
            const viewport = window.visualViewport;
            setOpen(
                shouldHideBottomNavForKeyboard({
                    keyboardOccluding: viewport
                        ? isKeyboardOccluding(
                              window.innerHeight,
                              viewport.height,
                              viewport.offsetTop,
                          )
                        : false,
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
    }, [enabled]);

    return enabled && open;
}
