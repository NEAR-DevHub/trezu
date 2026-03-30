"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import {
    useConnectTreasuries,
    useTelegramChatInfo,
    useTelegramStatuses,
} from "@/hooks/use-telegram";
import { useUserTreasuries } from "@/hooks/use-treasury-queries";
import type { Treasury } from "@/lib/api";
import type { ConnectedTreasury } from "@/lib/telegram-api";
import { useNear } from "@/stores/near-store";

// ---------------------------------------------------------------------------
// Inner component (uses useSearchParams, must be inside Suspense)
// ---------------------------------------------------------------------------

function ConnectPageInner() {
    const token = useSearchParams().get("token") ?? "";

    const { accountId, isInitializing, connect } = useNear();

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Data fetching via hooks
    const chatInfoQuery = useTelegramChatInfo(token, { enabled: !!accountId });
    const treasuriesQuery = useUserTreasuries(accountId);
    const connectMutation = useConnectTreasuries(token);

    const chatInfo = chatInfoQuery.data;
    const treasuries = treasuriesQuery.data ?? [];

    // IDs already connected to this chat
    const connectedSet = new Set(
        chatInfo?.connectedTreasuries.map((t: ConnectedTreasury) => t.daoId) ??
            [],
    );

    // Fetch status for treasuries not yet connected to this chat
    const unconnectedIds = treasuries
        .map((t) => t.daoId)
        .filter((id) => !connectedSet.has(id));

    const statusResults = useTelegramStatuses(unconnectedIds);

    const statusMap = Object.fromEntries(
        unconnectedIds
            .map((id, i) => [id, statusResults[i]?.data])
            .filter(([, s]) => s?.connected),
    );

    // Pre-select already-connected treasuries when chat info loads
    // (only set once when data first arrives)
    if (chatInfo && selectedIds.size === 0 && connectedSet.size > 0) {
        setSelectedIds(new Set(connectedSet));
    }

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

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    if (isInitializing) {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <p className="text-muted-foreground">Loading…</p>
            </main>
        );
    }

    if (!accountId) {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm space-y-4">
                    <h1 className="text-xl font-semibold">
                        Sign in to connect
                    </h1>
                    <p className="text-muted-foreground">
                        Connect your NEAR wallet to link treasuries to this
                        Telegram chat.
                    </p>
                    <button
                        type="button"
                        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        onClick={() => connect()}
                    >
                        Connect Wallet
                    </button>
                </div>
            </main>
        );
    }

    if (chatInfoQuery.isLoading || treasuriesQuery.isLoading) {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <p className="text-muted-foreground">Loading…</p>
            </main>
        );
    }

    if (chatInfoQuery.error) {
        const status = (
            chatInfoQuery.error as { response?: { status?: number } }
        )?.response?.status;
        if (status === 404 || status === 410) {
            return (
                <main className="flex min-h-screen items-center justify-center p-6">
                    <div className="text-center max-w-sm">
                        <h1 className="text-xl font-semibold mb-2">
                            Link expired
                        </h1>
                        <p className="text-muted-foreground">
                            This link has expired or has already been used.
                            Re-click &ldquo;Connect Treasury&rdquo; in Telegram
                            to get a new link.
                        </p>
                    </div>
                </main>
            );
        }
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm">
                    <h1 className="text-xl font-semibold mb-2">Error</h1>
                    <p className="text-muted-foreground">
                        Failed to load chat info. Please try again.
                    </p>
                </div>
            </main>
        );
    }

    if (connectMutation.isSuccess) {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm">
                    <h1 className="text-xl font-semibold mb-2">Connected!</h1>
                    <p className="text-muted-foreground">
                        Treasuries connected successfully. You can close this
                        tab.
                    </p>
                </div>
            </main>
        );
    }

    const isConnecting = connectMutation.isPending;

    return (
        <main className="flex min-h-screen items-center justify-center p-6">
            <div className="w-full max-w-md space-y-4">
                <div>
                    <h1 className="text-xl font-semibold">Connect Treasury</h1>
                    {chatInfo?.chatTitle && (
                        <p className="text-sm text-muted-foreground mt-1">
                            Chat:{" "}
                            <span className="font-medium">
                                {chatInfo.chatTitle}
                            </span>
                        </p>
                    )}
                </div>

                <p className="text-sm text-muted-foreground">
                    Select the treasuries you want to connect to this Telegram
                    chat.
                </p>

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

                <ul className="space-y-2">
                    {treasuries.map((treasury: Treasury) => {
                        const alreadyHere = connectedSet.has(treasury.daoId);
                        const elsewhereStatus = statusMap[treasury.daoId];
                        const checked = selectedIds.has(treasury.daoId);

                        return (
                            <li
                                key={treasury.daoId}
                                className="flex items-start gap-3 rounded-md border p-3"
                            >
                                <input
                                    type="checkbox"
                                    id={treasury.daoId}
                                    checked={checked}
                                    disabled={isConnecting}
                                    onChange={() =>
                                        handleToggle(treasury.daoId)
                                    }
                                    className="mt-0.5"
                                />
                                <label
                                    htmlFor={treasury.daoId}
                                    className="flex-1 cursor-pointer space-y-0.5"
                                >
                                    <span className="block text-sm font-medium">
                                        {treasury.config.name ?? treasury.daoId}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
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
                                            {elsewhereStatus.chatTitle
                                                ? `: ${elsewhereStatus.chatTitle}`
                                                : ""}
                                        </span>
                                    )}
                                </label>
                            </li>
                        );
                    })}
                </ul>

                {treasuries.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                        You are not a policy member of any treasuries.
                    </p>
                )}

                <button
                    type="button"
                    className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    disabled={selectedIds.size === 0 || isConnecting}
                    onClick={handleConnect}
                >
                    {isConnecting ? "Connecting…" : "Connect"}
                </button>
            </div>
        </main>
    );
}

// ---------------------------------------------------------------------------
// Page export — wrapped in Suspense for useSearchParams
// ---------------------------------------------------------------------------

export default function TelegramConnectPage() {
    return (
        <Suspense
            fallback={
                <main className="flex min-h-screen items-center justify-center p-6">
                    <p className="text-muted-foreground">Loading…</p>
                </main>
            }
        >
            <ConnectPageInner />
        </Suspense>
    );
}
