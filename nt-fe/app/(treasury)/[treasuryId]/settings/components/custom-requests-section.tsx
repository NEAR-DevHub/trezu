"use client";

import { CodeIcon, LoaderCircleIcon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useNextStep } from "nextstepjs";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { Icon } from "@/components/icon";
import {
    PAGE_TOUR_STORAGE_KEYS,
    REQUEST_TEMPLATES_TOUR_NAME,
} from "@/features/onboarding/steps/page-tours";
import { apiErrorMessage } from "@/features/proposal-templates/api";
import {
    useCustomRequestsEnabled,
    useSetCustomRequestsEnabled,
} from "@/features/proposal-templates/hooks/use-custom-requests-enabled";
import { useTreasury } from "@/hooks/use-treasury";
import { cn } from "@/lib/utils";
import { disabledActionClasses } from "./button-styles";
import { SectionIcon, SectionText } from "./section";

/**
 * Enable/disable Custom Requests. Lives in General because it is the only surface that flips the
 * flag — `custom-templates/guard.tsx` sends an admin here when they hit the subtree with it off.
 */
export function CustomRequestsSection({ canEdit }: { canEdit: boolean }) {
    const t = useTranslations("customTemplates.settingsCard");
    const { treasuryId } = useTreasury();
    const { data: enabled, isLoading } = useCustomRequestsEnabled();
    const setEnabled = useSetCustomRequestsEnabled();
    const { startNextStep, currentTour } = useNextStep();
    // Set when *this user* clicks Enable, so the tour only follows a deliberate action (not merely
    // opening Settings on an already-enabled treasury).
    const [tourRequested, setTourRequested] = useState(false);

    // Show once per treasury, ever. Keyed so each DAO a user enables gets its own hint.
    const tourShownKey = `${PAGE_TOUR_STORAGE_KEYS.REQUEST_TEMPLATES_SHOWN}:${treasuryId}`;
    const fired = useRef(false);

    // Fire the tour off the flag actually flipping true — i.e. once the sidebar has re-rendered the
    // #request-templates-nav anchor — rather than a wall-clock guess, so it can't race the render.
    useEffect(() => {
        if (!tourRequested || !enabled || fired.current) {
            return;
        }
        if (currentTour) {
            return;
        }
        if (
            typeof window !== "undefined" &&
            localStorage.getItem(tourShownKey) === "true"
        ) {
            setTourRequested(false);
            return;
        }
        fired.current = true;
        setTourRequested(false);
        localStorage.setItem(tourShownKey, "true");
        startNextStep(REQUEST_TEMPLATES_TOUR_NAME);
    }, [tourRequested, enabled, currentTour, startNextStep, tourShownKey]);

    function toggle(next: boolean) {
        setEnabled.mutate(next, {
            onSuccess: () => {
                if (next) {
                    setTourRequested(true);
                }
            },
            onError: (error) =>
                toast.error(apiErrorMessage(error, t("errUpdate"))),
        });
    }

    const pending = isLoading || setEnabled.isPending;

    return (
        <PageCard className="flex-row gap-3">
            <SectionIcon
                icon={CodeIcon}
                className="rounded-full bg-general-bg-primary text-green-500"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
                <SectionText
                    title={t("title")}
                    description={t("description")}
                />
                <div className="flex items-center">
                    <Button
                        type="button"
                        variant={enabled ? "neutral" : "default"}
                        className={cn(
                            "h-10 px-4 text-sm leading-none",
                            disabledActionClasses,
                        )}
                        disabled={pending || !canEdit}
                        onClick={() => toggle(!enabled)}
                    >
                        {pending && (
                            <Icon
                                icon={LoaderCircleIcon}
                                className="animate-spin"
                            />
                        )}
                        {enabled ? t("disable") : t("enable")}
                    </Button>
                </div>
            </div>
        </PageCard>
    );
}
