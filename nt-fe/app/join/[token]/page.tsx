"use client";

import { Icon } from "@/components/icon";
import {
    CheckIcon,
    InformationCircleIcon,
    LogoutSquare01Icon,
    UserIcon,
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
import { NameField } from "@/components/name-field";
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

function JoinHomeLogo({ className }: { className?: string }) {
    return (
        <Link
            href="/"
            className={cn("inline-flex", className)}
            aria-label="Home"
        >
            <NearBusinessLogo className="h-7" />
        </Link>
    );
}

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
        <PageCard className="items-center gap-4 rounded-3xl px-6 py-10 text-center">
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
        invite?.treasuryName?.trim() || invite?.daoId || t("treasuryFallback");
    const showLogin =
        !accountId &&
        invite?.status === "valid" &&
        !hasPendingRequest &&
        !isAlreadyMember;

    const successIcon = (
        <Icon
            icon={CheckIcon}
            className="size-5 text-general-success-foreground"
        />
    );
    const infoIcon = (
        <Icon
            icon={InformationCircleIcon}
            className="size-5 text-general-orange-foreground"
        />
    );
    const successIconClassName =
        "border border-general-success-border bg-general-success-background-faded";
    const warningIconClassName =
        "border border-general-orange-border bg-general-orange-background-faded";

    const alreadyMemberCard = treasuryDaoId ? (
        <StatusCard
            icon={successIcon}
            iconClassName={successIconClassName}
            title={t("alreadyMemberTitle")}
            description={t("alreadyMemberDescription", {
                treasury: treasuryName,
            })}
            action={
                <Button
                    className="mt-2 h-10 w-full"
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
            iconClassName={successIconClassName}
            title={t("successTitle")}
            description={t("successDescription")}
        />
    ) : null;

    const isBootstrapping =
        isLoading ||
        isInitializing ||
        (Boolean(accountId) &&
            (isProfileLoading ||
                (isTreasuriesLoading && viewerStatus === undefined)));
    // Ask-to-join form + status cards share the same chrome. Connect-wallet
    // stays on the login layout.
    const isFramedScreen = !isBootstrapping && !showLogin;

    const pageBody = isBootstrapping ? (
        <PageCard className="gap-4 rounded-3xl">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
            <Skeleton className="h-18 w-full" />
            <Skeleton className="h-11 w-full" />
        </PageCard>
    ) : isError || !invite ? (
        <StatusCard
            icon={infoIcon}
            iconClassName={warningIconClassName}
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
            iconClassName={warningIconClassName}
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
        <div className="flex flex-col gap-4">
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
                <NameField
                    icon={UserIcon}
                    autoComplete="name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    onClear={() => setDisplayName("")}
                    placeholder={t("namePlaceholder")}
                    clearLabel={t("clearName")}
                />
            )}

            <Button
                className="h-10 w-full mt-3"
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
            hideHeaderContent={!isFramedScreen}
            hideHeaderControls
            headerClassName={isFramedScreen ? "md:hidden" : undefined}
            logo={isFramedScreen ? <JoinHomeLogo /> : undefined}
            mainClassName={cn(
                "flex flex-col bg-general-bg-tertiary",
                isFramedScreen ? "pt-0" : "pt-1",
            )}
        >
            <div
                className={cn(
                    "mx-auto w-full",
                    showLogin ? "max-w-md md:mt-3" : "max-w-lg",
                    isFramedScreen
                        ? "flex max-md:flex-1 max-md:flex-col max-md:items-center max-md:justify-center md:flex-col md:items-start md:gap-6 md:pt-20"
                        : "space-y-6",
                )}
            >
                {isFramedScreen ? (
                    <JoinHomeLogo className="hidden md:inline-flex" />
                ) : null}
                <div className={cn(isFramedScreen && "w-full")}>{pageBody}</div>
            </div>
        </PageComponentLayout>
    );
}
