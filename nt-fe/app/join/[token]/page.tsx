"use client";

import { Icon } from "@/components/icon";
import {
    CheckIcon,
    InformationCircleIcon,
    LogoutSquare01Icon,
    User02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { ConnectWalletSelector } from "@/components/connect-wallet-selector";
import NearBusinessLogo from "@/components/icons/near-business-logo";
import { PageComponentLayout } from "@/components/page-component-layout";
import { ProfileAvatarChip } from "@/components/profile-avatar-chip";
import { selectorTriggerClassName } from "@/components/selector-field";
import { Skeleton } from "@/components/ui/skeleton";
import { useJoinViaInvite, useMemberInvite } from "@/hooks/use-member-invites";
import { useProfile, useUserTreasuries } from "@/hooks/use-treasury-queries";
import { formatShortAddress } from "@/lib/format-short-address";
import { resolveProfileImageUrl } from "@/lib/profile-image";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";
import { useNear } from "@/stores/near-store";

const ALREADY_MEMBER_ERROR = "Account is already a treasury member";

function StatusCard({
    icon,
    iconClassName,
    title,
    description,
    action,
}: {
    icon: ReactNode;
    iconClassName: string;
    title: string;
    description: ReactNode;
    action?: ReactNode;
}) {
    return (
        <PageCard className="items-center gap-4 px-6 py-10 text-center">
            <div
                className={cn(
                    "flex size-10 items-center justify-center rounded-full",
                    iconClassName,
                )}
            >
                {icon}
            </div>
            <div className="space-y-2">
                <h2 className="text-xl font-semibold leading-[1.2] tracking-[-0.025rem]">
                    {title}
                </h2>
                <p className="whitespace-pre-line text-sm leading-normal text-general-secondary-foreground">
                    {description}
                </p>
            </div>
            {action}
        </PageCard>
    );
}

export default function JoinInvitePage() {
    const t = useTranslations("members.join");
    const tSignIn = useTranslations("signIn");
    const params = useParams<{ token: string }>();
    const token = params.token;
    const router = useRouter();
    const { accountId, isInitializing, isAuthenticating, connect, disconnect } =
        useNear();
    const { data: invite, isLoading, isError } = useMemberInvite(token);
    const joinMutation = useJoinViaInvite();
    const { data: profile, isLoading: isProfileLoading } =
        useProfile(accountId);
    const { data: treasuries, isLoading: isTreasuriesLoading } =
        useUserTreasuries(accountId);

    const existingName = profile?.name?.trim() || "";
    const hasExistingName = existingName.length > 0;

    const [displayName, setDisplayName] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [joinedDaoId, setJoinedDaoId] = useState<string | null>(null);
    const [alreadyMemberFromJoin, setAlreadyMemberFromJoin] = useState(false);

    const viewerStatus = invite?.viewerStatus;
    const isAlreadyMember =
        alreadyMemberFromJoin ||
        viewerStatus === "member" ||
        Boolean(
            invite &&
                accountId &&
                treasuries?.some(
                    (treasury) =>
                        treasury.daoId === invite.daoId && treasury.isMember,
                ),
        );
    const hasPendingRequest =
        viewerStatus === "pending" || (submitted && !!joinedDaoId);
    const treasuryDaoId = invite?.daoId;
    const pendingDaoId =
        joinedDaoId || (viewerStatus === "pending" ? invite?.daoId : null);

    const handleAskJoin = async () => {
        if (!token) return;
        try {
            const result = await joinMutation.mutateAsync({
                token,
                // Only send a name when the user entered one; existing profile
                // names are already available via useProfile / User.
                ...(hasExistingName
                    ? {}
                    : { displayName: displayName.trim() || undefined }),
            });
            setJoinedDaoId(result.daoId);
            setSubmitted(true);
        } catch (err: unknown) {
            const message = (err as { response?: { data?: string } })?.response
                ?.data;
            if (
                typeof message === "string" &&
                message.includes(ALREADY_MEMBER_ERROR)
            ) {
                setAlreadyMemberFromJoin(true);
                return;
            }
            reportError(err, "Failed to join via invite");
            toast.error(
                typeof message === "string" ? message : t("joinFailed"),
            );
        }
    };

    const treasuryName =
        invite?.treasuryName?.trim() ||
        invite?.daoId ||
        t("treasuryFallback");
    const showLogin =
        !accountId &&
        invite?.status === "valid" &&
        !hasPendingRequest &&
        !isAlreadyMember;

    const successIcon = (
        <Icon icon={CheckIcon} className="size-5 text-emerald-600" />
    );
    const infoIcon = (
        <Icon
            icon={InformationCircleIcon}
            className="size-5 text-general-orange-foreground"
        />
    );

    const alreadyMemberCard = treasuryDaoId ? (
        <StatusCard
            icon={successIcon}
            iconClassName="bg-emerald-500/15"
            title={t("alreadyMemberTitle")}
            description={t("alreadyMemberDescription", {
                treasury: treasuryName,
            })}
            action={
                <Button
                    className="mt-2 h-11 w-full rounded-2xl"
                    onClick={() => router.push(`/${treasuryDaoId}`)}
                >
                    {t("goToTreasury")}
                </Button>
            }
        />
    ) : null;

    const pendingSuccessCard = pendingDaoId ? (
        <StatusCard
            icon={successIcon}
            iconClassName="bg-emerald-500/15"
            title={t("successTitle")}
            description={t("successDescription")}
        />
    ) : null;

    const isBootstrapping =
        isLoading ||
        isInitializing ||
        (Boolean(accountId) &&
            (isProfileLoading ||
                (isTreasuriesLoading && viewerStatus == null)));
    const isStatusScreen =
        !isBootstrapping &&
        !showLogin &&
        (isError ||
            !invite ||
            isAlreadyMember ||
            hasPendingRequest ||
            invite.status !== "valid");

    const pageBody = isBootstrapping ? (
        <PageCard className="gap-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-18 w-full" />
            <Skeleton className="h-11 w-full" />
        </PageCard>
    ) : isError || !invite ? (
        <StatusCard
            icon={infoIcon}
            iconClassName="bg-general-orange-background-faded"
            title={t("invalidTitle")}
            description={t("invalidDescription")}
        />
    ) : isAlreadyMember && alreadyMemberCard ? (
        alreadyMemberCard
    ) : hasPendingRequest && pendingSuccessCard ? (
        pendingSuccessCard
    ) : invite.status !== "valid" ? (
        <StatusCard
            icon={infoIcon}
            iconClassName="bg-general-orange-background-faded"
            title={
                invite.status === "used" ? t("usedTitle") : t("expiredTitle")
            }
            description={
                invite.status === "used"
                    ? t("usedDescription", { treasury: treasuryName })
                    : t("expiredDescription")
            }
        />
    ) : !accountId ? (
        <ConnectWalletSelector
            source={`/join/${token}`}
            connectFlow="within_treasury"
            isConnectingWallet={isAuthenticating}
            onConnectSupported={connect}
        />
    ) : (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-bold leading-[1.2] text-general-foreground">
                    {t("askTitle", { treasury: treasuryName })}
                </h1>
                <p className="text-sm font-medium leading-normal text-general-secondary-foreground">
                    {t("askDescription")}
                </p>
            </div>

            <div className="flex flex-col gap-2">
                <p className="text-sm text-general-secondary-foreground">
                    {t("walletConnected")}
                </p>
                <div
                    className={cn(
                        selectorTriggerClassName,
                        "cursor-default hover:opacity-100",
                    )}
                >
                    <ProfileAvatarChip
                        imageUrl={resolveProfileImageUrl(profile?.image)}
                        name={existingName || accountId}
                        className="rounded-lg"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                        {hasExistingName ? (
                            <>
                                <span className="truncate text-base font-semibold text-foreground">
                                    {existingName}
                                </span>
                                <span className="truncate text-sm text-general-secondary-foreground">
                                    {formatShortAddress(accountId)}
                                </span>
                            </>
                        ) : (
                            <span className="truncate text-base font-medium text-general-secondary-foreground">
                                {formatShortAddress(accountId)}
                            </span>
                        )}
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-general-unofficial-ghost-foreground"
                        aria-label={tSignIn("disconnect")}
                        onClick={() => void disconnect()}
                    >
                        <Icon icon={LogoutSquare01Icon} />
                    </Button>
                </div>
            </div>

            {hasExistingName ? null : (
                <label className={cn(selectorTriggerClassName, "cursor-text")}>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-general-border bg-muted">
                        <Icon
                            icon={User02Icon}
                            className="size-5 text-muted-foreground"
                        />
                    </span>
                    <input
                        autoComplete="name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        placeholder={t("namePlaceholder")}
                        className="min-w-0 flex-1 bg-transparent text-base font-medium text-foreground outline-none placeholder:text-muted-foreground"
                    />
                </label>
            )}

            <Button
                className="h-11 w-full rounded-2xl"
                onClick={() => void handleAskJoin()}
                disabled={joinMutation.isPending}
            >
                {joinMutation.isPending ? t("submitting") : t("askJoin")}
            </Button>
        </div>
    );

    return (
        <PageComponentLayout
            title={t("pageTitle")}
            hideLogin
            hideCollapseButton
            hideAppWarningBanner
            transparentHeader
            hideHeaderBottomBorder
            hideHeaderContent={!isStatusScreen}
            hideHeaderControls
            logo={
                isStatusScreen ? (
                    <Link href="/" className="inline-flex">
                        <NearBusinessLogo className="h-7" />
                    </Link>
                ) : undefined
            }
            mainClassName={cn(
                "flex flex-col bg-general-bg-tertiary",
                isStatusScreen ? "max-md:pt-0" : "pt-1",
            )}
        >
            <div
                className={cn(
                    "mx-auto w-full",
                    showLogin ? "max-w-md md:mt-3" : "max-w-lg",
                    isStatusScreen
                        ? "flex max-md:min-h-full max-md:flex-1 max-md:flex-col max-md:justify-center md:space-y-6"
                        : "space-y-6",
                )}
            >
                {showLogin || isBootstrapping || isStatusScreen ? null : (
                    <Link href="/" className="inline-flex">
                        <NearBusinessLogo className="h-7" />
                    </Link>
                )}
                {pageBody}
            </div>
        </PageComponentLayout>
    );
}
