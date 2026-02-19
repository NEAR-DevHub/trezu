"use client";

import { NextStepProvider, NextStep } from "nextstepjs";
import { useNextAdapter } from "nextstepjs/adapters/next";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { TOURS } from "../steps";
import { TourCard } from "./tour-card";

export function TourProvider({ children }: { children: React.ReactNode }) {
    const setLockSelectOutside = useOnboardingStore(
        (state) => state.setLockSelectOutside,
    );

    return (
        <NextStepProvider>
            <NextStep
                steps={TOURS}
                cardComponent={TourCard}
                navigationAdapter={useNextAdapter}
                shadowOpacity="0.5"
                noInViewScroll
                onStart={() => setLockSelectOutside(true)}
                onComplete={() => setLockSelectOutside(false)}
                onSkip={() => setLockSelectOutside(false)}
            >
                {children}
            </NextStep>
        </NextStepProvider>
    );
}
