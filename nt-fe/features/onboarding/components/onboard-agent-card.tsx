"use client";

import { Copy, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useCopyAgentPrompt } from "../hooks/use-copy-agent-prompt";
import { LOCAL_STORAGE_KEYS } from "../steps/dashboard";
import { ClaudeLogo, CursorLogo, OpenAILogo } from "./agent-logos";

const ONBOARD_AGENT_CLOSED_KEY = LOCAL_STORAGE_KEYS.ONBOARD_AGENT_DISMISSED;

const AGENT_LOGOS = [
    { name: "openai", Logo: OpenAILogo },
    { name: "claude", Logo: ClaudeLogo },
    { name: "cursor", Logo: CursorLogo },
];

export function OnboardAgentCard() {
    const t = useTranslations("onboarding.onboardAgent");
    const { canCopy, copy, isCopying } = useCopyAgentPrompt();
    const [isClosed, setIsClosed] = useState(true);

    useEffect(() => {
        setIsClosed(localStorage.getItem(ONBOARD_AGENT_CLOSED_KEY) === "true");
    }, []);

    const handleClose = () => {
        localStorage.setItem(ONBOARD_AGENT_CLOSED_KEY, "true");
        setIsClosed(true);
    };

    if (isClosed || !canCopy) {
        return null;
    }

    return (
        <div className="@container relative w-full overflow-hidden rounded-[14px] border border-emerald-500/25 bg-card p-5 flex flex-col gap-5">
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-emerald-400/70 to-transparent"
            />
            <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                    <h2 className="font-semibold text-lg">{t("title")}</h2>
                    <p className="text-sm text-muted-foreground">
                        {t("description")}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleClose}
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    aria-label={t("close")}
                >
                    <X className="size-4" />
                </button>
            </div>
            <button
                type="button"
                onClick={() => void copy()}
                disabled={isCopying}
                className="flex w-full items-center gap-3 rounded-full border border-border bg-card p-2 text-left transition-colors hover:bg-muted/60 cursor-pointer disabled:cursor-wait disabled:opacity-80"
            >
                <span className="hidden shrink-0 -space-x-2 @[21rem]:flex">
                    {AGENT_LOGOS.map(({ name, Logo }) => (
                        <span
                            key={name}
                            className="flex size-9 items-center justify-center rounded-full border border-border bg-card text-foreground"
                        >
                            <Logo className="size-4.5" />
                        </span>
                    ))}
                </span>
                <span className="min-w-0 flex-1 truncate pl-2 font-medium @[21rem]:pl-0">
                    {isCopying ? t("copying") : t("copyPrompt")}
                </span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                    {isCopying ? (
                        <Loader2 className="size-4 animate-spin" />
                    ) : (
                        <Copy className="size-4" />
                    )}
                </span>
            </button>
        </div>
    );
}
