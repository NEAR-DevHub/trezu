"use client";

import { useLayoutEffect } from "react";
import { useMobileShellStore } from "@/stores/mobile-shell-store";

/** Hides the small-screen tab bar while `enabled` is true. */
export function useHideMobileBottomNav(enabled = true) {
    const setHideBottomNav = useMobileShellStore(
        (state) => state.setHideBottomNav,
    );

    useLayoutEffect(() => {
        if (!enabled) return;
        setHideBottomNav(true);
        return () => setHideBottomNav(false);
    }, [enabled, setHideBottomNav]);
}
