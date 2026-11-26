"use client";

import { Copy, Loader2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCreateMemberInvite } from "@/hooks/use-member-invites";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { hasPermission } from "@/lib/config-utils";
import { reportError } from "@/lib/report-error";
import { useNear } from "@/stores/near-store";
import { buildAgentOnboardingPrompt } from "../lib/agent-onboarding-prompt";
import { LOCAL_STORAGE_KEYS } from "../steps/dashboard";
import { ClaudeLogo, CursorLogo, OpenAILogo } from "./agent-logos";

const ONBOARD_AGENT_CLOSED_KEY = LOCAL_STORAGE_KEYS.ONBOARD_AGENT_DISMISSED;

const AGENT_LOGOS = [
    { name: "openai", Logo: OpenAILogo },
    { name: "claude", Logo: ClaudeLogo },
    { name: "cursor", Logo: CursorLogo },
];

function backendApiBaseUrl(): string {
    const configured = process.env.NEXT_PUBLIC_BACKEND_API_BASE || "/";
    return new URL(configured, window.location.origin).href;
}

/**
 * Safari only lets an async click handler write to the clipboard when the
 * write starts inside the gesture, so hand it a ClipboardItem backed by the
 * pending prompt instead of awaiting the invite first.
 */
async function copyPendingText(text: Promise<string>): Promise<void> {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/plain": text.then(
                    (value) => new Blob([value], { type: "text/plain" }),
                ),
            }),
        ]);
        return;
    }
    await navigator.clipboard.writeText(await text);
}

export function OnboardAgentCard() {
    const t = useTranslations("onboarding.onboardAgent");
    const tCopy = useTranslations("copyButton");
    const locale = useLocale();
    const { treasuryId } = useTreasury();
    const { accountId } = useNear();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const createInvite = useCreateMemberInvite(treasuryId);
    const [isClosed, setIsClosed] = useState(true);

    // Same gate as the members invite page: only members who can propose
    // policy changes can bring a new member in.
    const canAddMember = useMemo(
        () =>
            !!accountId &&
            hasPermission(policy, accountId, "policy", "AddProposal"),
        [policy, accountId],
    );

    useEffect(() => {
        setIsClosed(localStorage.getItem(ONBOARD_AGENT_CLOSED_KEY) === "true");
    }, []);

    const handleClose = () => {
        localStorage.setItem(ONBOARD_AGENT_CLOSED_KEY, "true");
        setIsClosed(true);
    };

    const handleCopy = async () => {
        if (!treasuryId) return;
        // Each copy mints a fresh one-time invite, so a pasted prompt never
        // carries a link someone else already consumed.
        const prompt = createInvite.mutateAsync().then(({ url }) =>
            buildAgentOnboardingPrompt({
                treasuryId,
                inviteUrl: url,
                appBaseUrl: window.location.origin,
                apiBaseUrl: backendApiBaseUrl(),
                locale,
            }),
        );
        try {
            await Promise.all([prompt, copyPendingText(prompt)]);
            toast.success(t("copied"));
        } catch (error) {
            const inviteFailed = await prompt.then(
                () => false,
                () => true,
            );
            if (inviteFailed) {
                reportError(error, "Failed to create agent invite");
                toast.error(t("inviteFailed"));
            } else {
                reportError(error, "Failed to copy agent onboarding prompt");
                toast.error(tCopy("failed"));
            }
        }
    };

    if (isClosed || !canAddMember) {
        return null;
    }

    const isCopying = createInvite.isPending;

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
                onClick={() => void handleCopy()}
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
