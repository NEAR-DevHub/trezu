"use client";

import { useEffect, useState } from "react";
import {
    isInsideDialog,
    isKeyboardOccluding,
    isTextEntryElement,
    shouldHideBottomNavForKeyboard,
} from "@/lib/mobile-keyboard";

/**
 * True while an on-page field is focused (Send amount) or the keyboard
 * has squeezed the viewport. Dialog fields are ignored so the address
 * picker can raise the keyboard on the first tap.
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
            const active = document.activeElement;
            const viewport = window.visualViewport;
            setOpen(
                shouldHideBottomNavForKeyboard({
                    pageTextEntryFocused:
                        isTextEntryElement(active) && !isInsideDialog(active),
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
