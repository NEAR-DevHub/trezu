"use client";

import { useEffect } from "react";
import Gleap from "gleap";
import { useUiStore } from "@/stores/ui-store";

export function GleapWidget() {
    const overlayOpen = useUiStore((s) => s.overlayCount > 0);

    useEffect(() => {
        Gleap.initialize("linZWdHygUIv7pmrByyph1yJHvx1Kdzw");
        Gleap.showFeedbackButton(true);
    }, []);

    useEffect(() => {
        Gleap.showFeedbackButton(!overlayOpen);
    }, [overlayOpen]);

    return null;
}
