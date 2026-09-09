"use client";

import Gleap from "gleap";
import { useEffect } from "react";

interface GleapWidgetProps {
    apiKey: string;
    /** Hide the floating feedback button; `Gleap.open()` still works. */
    hideLauncher: boolean;
}

export function GleapWidget({ apiKey, hideLauncher }: GleapWidgetProps) {
    useEffect(() => {
        Gleap.initialize(apiKey);
    }, [apiKey]);

    useEffect(() => {
        Gleap.showFeedbackButton(!hideLauncher);
    }, [hideLauncher]);

    return null;
}
