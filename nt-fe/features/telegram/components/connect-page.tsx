"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2Off, MessageCircle, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { CopyButton } from "@/components/copy-button";
import { EmptyState } from "@/components/empty-state";
import { InfoAlert } from "@/components/info-alert";
import Logo from "@/components/logo";
import { PageComponentLayout } from "@/components/page-component-layout";
import { StepperHeader } from "@/components/step-wizard";
import { TreasuryLogo } from "@/components/treasury-info";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
    useConnectTreasuries,
    useTelegramChatInfo,
    useTelegramStatuses,
} from "@/hooks/use-telegram";
import { useTreasury } from "@/hooks/use-treasury";
import { useUserTreasuries } from "@/hooks/use-treasury-queries";
import type { Treasury } from "@/lib/api";
import type { ConnectedTreasury, TelegramStatus } from "@/lib/telegram-api";
import { useNear } from "@/stores/near-store";

function TelegramConnectShell({ children }: { children: React.ReactNode }) {
    return (
        <PageComponentLayout
            title="Connect Treasury"
            description="Link your treasuries to a Telegram chat"
            hideCollapseButton
            hideLogin
            logo={
                <div className="flex items-center gap-2.5">
                    <Link href="/">
                        <Logo size="sm" />
                    </Link>
                    <span className="hidden sm:inline text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                        Telegram
                    </span>
                </div>
            }
        >
            <div className="max-w-3xl mx-auto">{children}</div>
        </PageComponentLayout>
    );
}

function LoadingCard() {
    return (
        <PageCard>
            <div className="flex flex-col gap-1">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-72" />
            </div>
            <div className="flex flex-col gap-2">
                <Skeleton className="h-14 w-full rounded-md" />
                <Skeleton className="h-14 w-full rounded-md" />
                <Skeleton className="h-14 w-full rounded-md" />
            </div>
            <Skeleton className="h-9 w-full rounded-md" />
        </PageCard>
    );
}

function MessageCard({
    title,
    description,
    action,
}: {
    title: string;
    description: string;
    action?: React.ReactNode;
}) {
    return (
        <PageCard>
            <div className="flex flex-col gap-1">
                <StepperHeader title={title} />
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {action}
        </PageCard>
    );
}

function ConnectPageInner() {
    const { lastTreasuryId } = useTreasury();
    const token = useSearchParams().get("token") ?? "";
    const { accountId, isInitializing, connect } = useNear();
    const isAuthorized = !!accountId;
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [didInitializeSelection, setDidInitializeSelection] = useState(false);
    const [didShowSuccessToast, setDidShowSuccessToast] = useState(false);

    const chatInfoQuery = useTelegramChatInfo(token, { enabled: !!token });
    const treasuriesQuery = useUserTreasuries(accountId);
    const connectMutation = useConnectTreasuries(token);

    const chatInfo = chatInfoQuery.data;
    const treasuries = treasuriesQuery.data ?? [];
    const visibleTreasuries = useMemo(
        () =>
            treasuries.filter(
                (treasury) => !(treasury.isSaved && !treasury.isMember),
            ),
        [treasuries],
    );
    const visibleDaoIds = useMemo(
        () => new Set(visibleTreasuries.map((treasury) => treasury.daoId)),
        [visibleTreasuries],
    );
    const connectedSet = useMemo(
        () =>
            new Set(
                chatInfo?.connectedTreasuries.map(
                    (t: ConnectedTreasury) => t.daoId,
                ) ?? [],
            ),
        [chatInfo],
    );

    const unconnectedIds = useMemo(
        () =>
            visibleTreasuries
                .map((treasury) => treasury.daoId)
                .filter((daoId) => !connectedSet.has(daoId)),
        [connectedSet, visibleTreasuries],
    );

    const statusResults = useTelegramStatuses(unconnectedIds);
    const statusMap = useMemo(() => {
        const map: Record<string, TelegramStatus> = {};
        unconnectedIds.forEach((daoId, index) => {
            const status = statusResults[index]?.data;
            if (status?.connected) {
                map[daoId] = status;
            }
        });
        return map;
    }, [statusResults, unconnectedIds]);

    useEffect(() => {
        if (didInitializeSelection) return;
        if (!chatInfo || treasuriesQuery.isLoading) return;
        setSelectedIds(
            new Set(
                Array.from(connectedSet).filter((daoId) =>
                    visibleDaoIds.has(daoId),
                ),
            ),
        );
        setDidInitializeSelection(true);
    }, [
        chatInfo,
        connectedSet,
        didInitializeSelection,
        treasuriesQuery.isLoading,
        visibleDaoIds,
    ]);

    const handleToggle = (daoId: string) => {
        setSelectedIds((prev: Set<string>) => {
            const next = new Set(prev);
            if (next.has(daoId)) {
                next.delete(daoId);
            } else {
                next.add(daoId);
            }
            return next;
        });
    };

    const handleConnect = () => {
        connectMutation.mutate(Array.from(selectedIds));
    };

    const relinkingFromOtherChats = useMemo(
        () =>
            Array.from(selectedIds)
                .map((daoId) => ({ daoId, status: statusMap[daoId] }))
                .filter((entry) => !!entry.status),
        [selectedIds, statusMap],
    );
    const relinkingCount = relinkingFromOtherChats.length;

    const isDataLoading =
        isInitializing ||
        chatInfoQuery.isLoading ||
        (isAuthorized && treasuriesQuery.isLoading);
    const isConnecting = connectMutation.isPending;

    useEffect(() => {
        if (!connectMutation.isSuccess || didShowSuccessToast) return;
        setDidShowSuccessToast(true);
        toast.success("Treasuries connected successfully");
    }, [connectMutation.isSuccess, didShowSuccessToast]);

    if (!token) {
        return (
            <TelegramConnectShell>
                <MessageCard
                    title="Invalid link"
                    description="This Telegram connection link is missing a token. Re-click Connect Treasury in Telegram to generate a fresh link."
                />
            </TelegramConnectShell>
        );
    }

    if (isDataLoading) {
        return (
            <TelegramConnectShell>
                <LoadingCard />
            </TelegramConnectShell>
        );
    }

    if (connectMutation.isSuccess) {
        return (
            <TelegramConnectShell>
                <PageCard className="min-h-[320px] flex items-center justify-center">
                    <div className="w-full max-w-md flex flex-col gap-5">
                        <EmptyState
                            icon={CheckCircle2}
                            title="Connected successfully"
                            description="Treasuries were linked to this Telegram chat."
                            className="py-0"
                        />
                        <Button className="w-full" asChild>
                            <Link
                                href={
                                    lastTreasuryId ? `/${lastTreasuryId}` : "/"
                                }
                            >
                                Go to App
                            </Link>
                        </Button>
                    </div>
                </PageCard>
            </TelegramConnectShell>
        );
    }

    if (chatInfoQuery.error) {
        const status = (
            chatInfoQuery.error as { response?: { status?: number } }
        )?.response?.status;
        if (status === 404 || status === 410) {
            return (
                <TelegramConnectShell>
                    <PageCard className="min-h-[320px] flex items-center justify-center">
                        <div className="w-full max-w-md flex flex-col gap-5">
                            <EmptyState
                                icon={Link2Off}
                                title="Link expired"
                                description="This link has expired or has already been used. In Telegram, type the command below to restart the connect flow."
                                className="py-0"
                            />
                            <div className="rounded-md bg-general-tertiary p-2 flex items-center justify-between gap-2">
                                <code className="text-sm font-medium">
                                    /connect
                                </code>
                                <CopyButton
                                    text="/connect"
                                    toastMessage="Command copied"
                                    variant="secondary"
                                    size="sm"
                                >
                                    Copy
                                </CopyButton>
                            </div>
                        </div>
                    </PageCard>
                </TelegramConnectShell>
            );
        }
        return (
            <TelegramConnectShell>
                <MessageCard
                    title="Unable to load chat"
                    description="The chat details could not be loaded right now. Please retry from Telegram."
                />
            </TelegramConnectShell>
        );
    }

    if (!isAuthorized) {
        return (
            <TelegramConnectShell>
                <PageCard className="min-h-[320px] flex items-center justify-center">
                    <div className="w-full max-w-md flex flex-col gap-5">
                        <EmptyState
                            icon={Wallet}
                            title="Sign in to continue"
                            description="Connect your NEAR wallet first, then choose which treasuries to link to this Telegram chat."
                            className="py-0"
                        />
                        <Button className="w-full" onClick={() => connect()}>
                            Connect Wallet
                        </Button>
                    </div>
                </PageCard>
            </TelegramConnectShell>
        );
    }

    return (
        <TelegramConnectShell>
            <PageCard>
                <div className="flex flex-col gap-1">
                    <StepperHeader
                        title="Select Treasuries"
                        description="Choose which treasuries to connect to this Telegram chat."
                    />
                    {chatInfo && (
                        <div className="mt-1 flex items-center gap-2 rounded-md bg-general-tertiary px-3 py-2">
                            <MessageCircle className="size-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">
                                    Telegram chat
                                </p>
                                <p className="text-sm font-medium truncate">
                                    {chatInfo.chatTitle ||
                                        `Chat #${chatInfo.chatId}`}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {connectMutation.error && (
                    <p className="text-sm text-destructive">
                        {(
                            connectMutation.error as {
                                response?: { data?: string };
                            }
                        )?.response?.data ??
                            "Failed to connect treasuries. Please try again."}
                    </p>
                )}
                {relinkingCount > 0 && (
                    <InfoAlert
                        message={
                            <>
                                {relinkingCount === 1
                                    ? "1 selected treasury is linked to another Telegram chat. Connecting will re-connect it and change its chat ID link to this chat."
                                    : `${relinkingCount} selected treasuries are linked to other Telegram chats. Connecting will re-connect them and change their chat ID links to this chat.`}
                            </>
                        }
                    />
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {visibleTreasuries.map((treasury: Treasury) => {
                        const alreadyHere = connectedSet.has(treasury.daoId);
                        const elsewhereStatus = statusMap[treasury.daoId];
                        const checked = selectedIds.has(treasury.daoId);

                        return (
                            <div
                                key={treasury.daoId}
                                className="grid grid-cols-[auto_1fr] gap-3 items-center rounded-md bg-general-tertiary px-3 py-2"
                            >
                                <Checkbox
                                    id={treasury.daoId}
                                    checked={checked}
                                    disabled={isConnecting}
                                    onCheckedChange={() =>
                                        handleToggle(treasury.daoId)
                                    }
                                    className="self-center"
                                />
                                <label
                                    htmlFor={treasury.daoId}
                                    className="cursor-pointer flex items-center gap-2.5 min-w-0"
                                >
                                    <TreasuryLogo
                                        logo={
                                            treasury.config?.metadata?.flagLogo
                                        }
                                    />
                                    <span className="block min-w-0">
                                        <span className="block text-sm font-medium truncate">
                                            {treasury.config.name ??
                                                treasury.daoId}
                                        </span>
                                        <span className="block text-xs text-muted-foreground truncate">
                                            {treasury.daoId}
                                        </span>
                                        {alreadyHere && (
                                            <span className="inline-block text-xs text-green-600 dark:text-green-400">
                                                Already connected to this chat
                                            </span>
                                        )}
                                        {!alreadyHere && elsewhereStatus && (
                                            <span className="inline-block rounded bg-yellow-100 px-1.5 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                                                Connected to another chat
                                            </span>
                                        )}
                                    </span>
                                </label>
                            </div>
                        );
                    })}
                </div>

                {visibleTreasuries.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        You are not a policy member of any treasuries.
                    </p>
                )}

                <Button
                    type="button"
                    className="w-full"
                    disabled={selectedIds.size === 0 || isConnecting}
                    onClick={handleConnect}
                >
                    {isConnecting ? "Connecting…" : "Connect"}
                </Button>
            </PageCard>
        </TelegramConnectShell>
    );
}

export function TelegramConnectPage() {
    return (
        <Suspense
            fallback={
                <TelegramConnectShell>
                    <LoadingCard />
                </TelegramConnectShell>
            }
        >
            <ConnectPageInner />
        </Suspense>
    );
}
