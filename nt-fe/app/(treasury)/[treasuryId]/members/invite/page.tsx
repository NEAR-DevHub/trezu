"use client";

import { Icon } from "@/components/icon";
import {
    InformationCircleIcon,
    LinkIcon,
    ReloadIcon,
    VoteIcon,
    CheckIcon,
    UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { CopyButton } from "@/components/copy-button";
import { PageComponentLayout } from "@/components/page-component-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateMemberInvite } from "@/hooks/use-member-invites";
import { useTreasury } from "@/hooks/use-treasury";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";
import { useMemberPolicyGate } from "../hooks/use-member-policy-gate";

function displayInviteUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
}

function InviteTimeline({
    items,
}: {
    items: Array<{
        title: string;
        description: string;
        icon: ReactNode;
        iconClassName: string;
    }>;
}) {
    return (
        <div className="flex flex-col">
            {items.map((item, index) => {
                const isLast = index === items.length - 1;
                return (
                    <div key={item.title} className="flex items-start gap-4">
                        <div className="flex w-10 shrink-0 flex-col items-center self-stretch">
                            <div
                                className={cn(
                                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                                    item.iconClassName,
                                )}
                            >
                                {item.icon}
                            </div>
                            {isLast ? null : (
                                <div className="my-1 w-px flex-1 bg-general-border" />
                            )}
                        </div>
                        <div
                            className={cn("min-w-0 flex-1", !isLast && "pb-6")}
                        >
                            <p className="text-base font-semibold leading-[1.2] text-general-foreground">
                                {item.title}
                            </p>
                            <p className="mt-1 text-sm font-medium leading-normal text-general-secondary-foreground">
                                {item.description}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export default function InviteMemberPage() {
    const tInvite = useTranslations("members.invite");
    const { treasuryId } = useTreasury();
    const router = useRouter();
    const { isLoadingPolicy, canAddMember } = useMemberPolicyGate(treasuryId);
    const createInvite = useCreateMemberInvite(treasuryId);

    const [step, setStep] = useState(0);
    const [inviteUrl, setInviteUrl] = useState<string | null>(null);

    // Invite links do not create a ChangePolicy proposal, so they stay available
    // while a policy change is pending. Only permission gates this page.
    useEffect(() => {
        if (!isLoadingPolicy && !canAddMember && treasuryId) {
            router.replace(`/${treasuryId}/members`);
        }
    }, [isLoadingPolicy, canAddMember, router, treasuryId]);

    const isGenerating = createInvite.isPending;
    const showLinkStep = step === 1 || isGenerating;

    const handleGenerate = useCallback(async () => {
        const isFirstGenerate = !inviteUrl;
        if (isFirstGenerate) setStep(1);

        try {
            const result = await createInvite.mutateAsync();
            setInviteUrl(result.url);
            setStep(1);
        } catch (error) {
            reportError(error, "Failed to create invite");
            toast.error(tInvite("generateFailed"));
            if (isFirstGenerate) setStep(0);
        }
    }, [createInvite, inviteUrl, tInvite]);

    const howItWorksIconClassName =
        "border border-general-border bg-general-bg-secondary text-general-secondary-foreground";
    const howItWorks = [
        {
            icon: <Icon icon={LinkIcon} className="size-5 rotate-130" />,
            iconClassName: howItWorksIconClassName,
            title: tInvite("howItWorks.generateTitle"),
            description: tInvite("howItWorks.generateDescription"),
        },
        {
            icon: <Icon icon={UserAdd01Icon} className="size-5" />,
            iconClassName: howItWorksIconClassName,
            title: tInvite("howItWorks.joinTitle"),
            description: tInvite("howItWorks.joinDescription"),
        },
        {
            icon: <Icon icon={VoteIcon} className="size-5" />,
            iconClassName: howItWorksIconClassName,
            title: tInvite("howItWorks.voteTitle"),
            description: tInvite("howItWorks.voteDescription"),
        },
    ];

    const readyItems = [
        {
            icon: (
                <Icon
                    icon={CheckIcon}
                    className="size-5 text-general-success-foreground"
                />
            ),
            iconClassName:
                "border border-general-success-border bg-general-success-background-faded",
            title: tInvite("readyTitle"),
            description: tInvite("readyDescription"),
        },
        {
            icon: (
                <Icon
                    icon={InformationCircleIcon}
                    className="size-5 text-general-info-foreground"
                />
            ),
            iconClassName:
                "border border-general-info-border bg-general-info-background-faded",
            title: tInvite("onceTitle"),
            description: tInvite("onceDescription"),
        },
    ];

    return (
        <PageComponentLayout
            title={tInvite("title")}
            backButton={treasuryId ? `/${treasuryId}/members` : true}
            hideMobileShellControls
            reserveHeaderSpace
        >
            <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
                <h2 className="text-base font-semibold">
                    {showLinkStep
                        ? tInvite("linkTitle")
                        : tInvite("howItWorks.title")}
                </h2>

                {isLoadingPolicy ? (
                    <PageCard className="rounded-3xl">
                        <div className="h-40 animate-pulse rounded-lg bg-general-unofficial-accent-0" />
                    </PageCard>
                ) : showLinkStep ? (
                    <>
                        <PageCard className="gap-6 rounded-3xl p-5">
                            <InviteTimeline items={readyItems} />
                            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-general-border bg-general-bg-tertiary px-3 py-2">
                                <Icon
                                    icon={LinkIcon}
                                    className="size-5 shrink-0 rotate-130 text-general-secondary-foreground"
                                />
                                {isGenerating || !inviteUrl ? (
                                    <Skeleton className="h-5 min-w-0 flex-1 rounded-md" />
                                ) : (
                                    <input
                                        type="text"
                                        readOnly
                                        value={displayInviteUrl(inviteUrl)}
                                        aria-label={tInvite("linkTitle")}
                                        className="h-5 min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-sm font-medium leading-5 text-foreground outline-none select-all"
                                    />
                                )}
                                {inviteUrl && !isGenerating ? (
                                    <CopyButton
                                        text={inviteUrl}
                                        size="icon"
                                        aria-label={tInvite("copyLink")}
                                        className="size-9 shrink-0 rounded-lg"
                                    />
                                ) : (
                                    <div
                                        className="size-9 shrink-0"
                                        aria-hidden
                                    />
                                )}
                            </div>
                        </PageCard>
                        <Button
                            type="button"
                            variant="ghost"
                            className="self-center text-center text-base font-bold leading-4 text-general-unofficial-ghost-foreground hover:text-general-unofficial-ghost-foreground"
                            onClick={() => void handleGenerate()}
                            disabled={isGenerating}
                        >
                            <Icon
                                icon={ReloadIcon}
                                className="h-[0.78213rem] w-[0.679rem] text-general-unofficial-ghost-foreground"
                            />
                            {isGenerating
                                ? tInvite("generatingNewLink")
                                : tInvite("generateNewLink")}
                        </Button>
                    </>
                ) : (
                    <>
                        <PageCard className="gap-6 rounded-3xl p-5">
                            <InviteTimeline items={howItWorks} />
                        </PageCard>
                        <Button
                            type="button"
                            className="h-10 w-full"
                            onClick={() => void handleGenerate()}
                            disabled={isGenerating}
                        >
                            {tInvite("generateLink")}
                        </Button>
                    </>
                )}
            </div>
        </PageComponentLayout>
    );
}
