"use client";

import { create } from "zustand";

type UiStore = {
    overlayCount: number;
    pushOverlay: () => void;
    popOverlay: () => void;
};

export const useUiStore = create<UiStore>()((set) => ({
    overlayCount: 0,
    pushOverlay: () => set((s) => ({ overlayCount: s.overlayCount + 1 })),
    popOverlay: () =>
        set((s) => ({ overlayCount: Math.max(0, s.overlayCount - 1) })),
}));
