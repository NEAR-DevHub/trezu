"use client";

import { NextStepProvider, NextStep } from "nextstepjs";
import { useNextAdapter } from "nextstepjs/adapters/next";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { useUiStore } from "@/stores/ui-store";
import { TOURS } from "../steps";
import { TourCard } from "./tour-card";

export function TourProvider({ children }: { children: React.ReactNode }) {
    const setLockSelectOutside = useOnboardingStore(
        (state) => state.setLockSelectOutside,
    );
    const pushOverlay = useUiStore((s) => s.pushOverlay);
    const popOverlay = useUiStore((s) => s.popOverlay);

    return (
        <NextStepProvider>
            <NextStep
                steps={TOURS}
                cardComponent={TourCard}
                navigationAdapter={useNextAdapter}
                shadowOpacity="0.5"
                noInViewScroll
                onStart={() => {
                    setLockSelectOutside(true);
                    pushOverlay();
                }}
                onComplete={() => {
                    setLockSelectOutside(false);
                    popOverlay();
                }}
                onSkip={() => {
                    setLockSelectOutside(false);
                    popOverlay();
                }}
            >
                {children}
            </NextStep>
        </NextStepProvider>
    );
}
