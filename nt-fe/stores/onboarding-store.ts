"use client";

import { create } from "zustand";

type OnboardingStore = {
    lockSelectOutside: boolean;
    setLockSelectOutside: (lock: boolean) => void;
    createTreasuryPromptOpenRequestId: number;
    requestCreateTreasuryPromptOpen: () => void;
};

export const useOnboardingStore = create<OnboardingStore>()((set) => ({
    lockSelectOutside: false,
    setLockSelectOutside: (lock) => set({ lockSelectOutside: lock }),
    createTreasuryPromptOpenRequestId: 0,
    requestCreateTreasuryPromptOpen: () =>
        set((state) => ({
            createTreasuryPromptOpenRequestId:
                state.createTreasuryPromptOpenRequestId + 1,
        })),
}));
