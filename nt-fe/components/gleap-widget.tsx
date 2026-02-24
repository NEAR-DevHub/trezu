"use client";

import { useEffect } from "react";
import Gleap from "gleap";

export function GleapWidget() {
    useEffect(() => {
        Gleap.initialize("linZWdHygUIv7pmrByyph1yJHvx1Kdzw");
        Gleap.showFeedbackButton(true);
    }, []);

    return null;
}
