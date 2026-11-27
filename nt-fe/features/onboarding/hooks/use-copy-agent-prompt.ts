"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useCreateMemberInvite } from "@/hooks/use-member-invites";
import { useTreasury } from "@/hooks/use-treasury";
import { useTreasuryPolicy } from "@/hooks/use-treasury-queries";
import { hasPermission } from "@/lib/config-utils";
import { reportError } from "@/lib/report-error";
import { useNear } from "@/stores/near-store";
import { buildAgentOnboardingPrompt } from "../lib/agent-onboarding-prompt";

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

/**
 * Copies the agent onboarding prompt for the current treasury, shared by the
 * Home card and the account menu so both copy the same text and show the same
 * toasts. Call `copy` straight from the click handler (see `copyPendingText`).
 */
export function useCopyAgentPrompt() {
    const t = useTranslations("onboarding.onboardAgent");
    const tCopy = useTranslations("copyButton");
    const locale = useLocale();
    const { treasuryId } = useTreasury();
    const { accountId } = useNear();
    const { data: policy } = useTreasuryPolicy(treasuryId);
    const createInvite = useCreateMemberInvite(treasuryId);

    // Same gate as the members invite page: only members who can propose
    // policy changes can bring a new member in.
    const canCopy = useMemo(
        () =>
            !!treasuryId &&
            !!accountId &&
            hasPermission(policy, accountId, "policy", "AddProposal"),
        [policy, accountId, treasuryId],
    );

    const { mutateAsync } = createInvite;
    const copy = useCallback(async () => {
        if (!treasuryId) return;
        // Each copy mints a fresh one-time invite, so a pasted prompt never
        // carries a link someone else already consumed.
        const prompt = mutateAsync().then(({ url }) =>
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
            toast.success(t("copiedTitle"), {
                description: t("copiedDescription"),
            });
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
    }, [mutateAsync, treasuryId, locale, t, tCopy]);

    return { canCopy, copy, isCopying: createInvite.isPending };
}
