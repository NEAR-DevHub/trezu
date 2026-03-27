"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
    type ChatInfo,
    type ConnectedTreasury,
    type TelegramStatus,
    connectTreasuries,
    getTelegramChatInfo,
    getTelegramStatus,
} from "@/lib/telegram-api";
import { getUserTreasuries, type Treasury } from "@/lib/api";
import { useNearStore } from "@/stores/near-store";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type PageState =
    | { kind: "loading" }
    | { kind: "needs-auth" }
    | { kind: "fetching-chat" }
    | { kind: "token-expired" }
    | { kind: "select-treasuries"; chatInfo: ChatInfo; treasuries: Treasury[]; statusMap: Record<string, TelegramStatus> }
    | { kind: "confirming"; chatInfo: ChatInfo; selectedIds: string[] }
    | { kind: "done" }
    | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Inner component (uses useSearchParams, must be inside Suspense)
// ---------------------------------------------------------------------------

function ConnectPageInner() {
    const token = useSearchParams().get("token") ?? "";

    const {
        isAuthenticated,
        hasAcceptedTerms,
        isInitializing,
        walletAccountId,
        checkAuth,
        connect,
        init,
    } = useNearStore();

    const [state, setState] = useState<PageState>({ kind: "loading" });
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [connectError, setConnectError] = useState<string | null>(null);

    // Step 1: init near store, then check auth
    useEffect(() => {
        if (isInitializing) return;

        const run = async () => {
            await init();
            await checkAuth();
        };
        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Step 2: react to auth state changes
    useEffect(() => {
        if (isInitializing) return;

        if (state.kind === "loading") {
            if (isAuthenticated && hasAcceptedTerms) {
                setState({ kind: "fetching-chat" });
            } else {
                setState({ kind: "needs-auth" });
            }
        }

        if (state.kind === "needs-auth" && isAuthenticated && hasAcceptedTerms) {
            setState({ kind: "fetching-chat" });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, hasAcceptedTerms, isInitializing]);

    // Step 3: fetch chat info once authenticated
    const fetchChat = useCallback(async () => {
        if (!token) {
            setState({ kind: "token-expired" });
            return;
        }

        try {
            const chatInfo = await getTelegramChatInfo(token);

            // Fetch user's member treasuries
            const accountId = walletAccountId ?? "";
            const treasuries = await getUserTreasuries(accountId, { includeHidden: false });

            // Pre-select treasuries already connected to this chat
            const alreadyConnected = new Set(
                chatInfo.connectedTreasuries.map((t) => t.daoId),
            );
            setSelectedIds(alreadyConnected);

            // Fetch status for treasuries not already connected to this chat
            const statusMap: Record<string, TelegramStatus> = {};
            await Promise.all(
                treasuries
                    .filter((t) => !alreadyConnected.has(t.daoId))
                    .map(async (t) => {
                        try {
                            const status = await getTelegramStatus(t.daoId);
                            if (status.connected) {
                                statusMap[t.daoId] = status;
                            }
                        } catch {
                            // non-fatal
                        }
                    }),
            );

            setState({ kind: "select-treasuries", chatInfo, treasuries, statusMap });
        } catch (err: unknown) {
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 404 || status === 410) {
                setState({ kind: "token-expired" });
            } else {
                setState({ kind: "error", message: "Failed to load chat info. Please try again." });
            }
        }
    }, [token, walletAccountId]);

    useEffect(() => {
        if (state.kind === "fetching-chat") {
            fetchChat();
        }
    }, [state.kind, fetchChat]);

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

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

    const handleConnect = async () => {
        if (state.kind !== "select-treasuries") return;
        const savedState = state;
        const ids: string[] = Array.from(selectedIds);
        setState({ kind: "confirming", chatInfo: state.chatInfo, selectedIds: ids });
        setConnectError(null);

        try {
            await connectTreasuries(token, ids);
            setState({ kind: "done" });
        } catch (err: unknown) {
            const message =
                (err as { response?: { data?: string } })?.response?.data ??
                "Failed to connect treasuries. Please try again.";
            setConnectError(typeof message === "string" ? message : "An error occurred.");
            setState(savedState);
        }
    };

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    if (state.kind === "loading" || state.kind === "fetching-chat") {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <p className="text-muted-foreground">Loading…</p>
            </main>
        );
    }

    if (state.kind === "token-expired") {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm">
                    <h1 className="text-xl font-semibold mb-2">Link expired</h1>
                    <p className="text-muted-foreground">
                        This link has expired or has already been used. Re-click
                        &ldquo;Connect Treasury&rdquo; in Telegram to get a new link.
                    </p>
                </div>
            </main>
        );
    }

    if (state.kind === "done") {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm">
                    <h1 className="text-xl font-semibold mb-2">Connected!</h1>
                    <p className="text-muted-foreground">
                        Treasuries connected successfully. You can close this tab.
                    </p>
                </div>
            </main>
        );
    }

    if (state.kind === "error") {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm">
                    <h1 className="text-xl font-semibold mb-2">Error</h1>
                    <p className="text-muted-foreground">{state.message}</p>
                </div>
            </main>
        );
    }

    if (state.kind === "needs-auth") {
        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="text-center max-w-sm space-y-4">
                    <h1 className="text-xl font-semibold">Sign in to connect</h1>
                    <p className="text-muted-foreground">
                        Connect your NEAR wallet to link treasuries to this Telegram chat.
                    </p>
                    <button
                        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        onClick={() => connect()}
                    >
                        Connect Wallet
                    </button>
                </div>
            </main>
        );
    }

    if (state.kind === "select-treasuries" || state.kind === "confirming") {
        const { chatInfo, treasuries, statusMap } =
            state.kind === "select-treasuries"
                ? state
                : { chatInfo: state.chatInfo, treasuries: [] as Treasury[], statusMap: {} };

        const isConfirming = state.kind === "confirming";
        const connectedSet = new Set(chatInfo.connectedTreasuries.map((t: ConnectedTreasury) => t.daoId));

        return (
            <main className="flex min-h-screen items-center justify-center p-6">
                <div className="w-full max-w-md space-y-4">
                    <div>
                        <h1 className="text-xl font-semibold">Connect Treasury</h1>
                        {chatInfo.chatTitle && (
                            <p className="text-sm text-muted-foreground mt-1">
                                Chat: <span className="font-medium">{chatInfo.chatTitle}</span>
                            </p>
                        )}
                    </div>

                    <p className="text-sm text-muted-foreground">
                        Select the treasuries you want to connect to this Telegram chat.
                    </p>

                    {connectError && (
                        <p className="text-sm text-destructive">{connectError}</p>
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
                                        disabled={isConfirming}
                                        onChange={() => handleToggle(treasury.daoId)}
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
                        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        disabled={selectedIds.size === 0 || isConfirming}
                        onClick={handleConnect}
                    >
                        {isConfirming ? "Connecting…" : "Connect"}
                    </button>
                </div>
            </main>
        );
    }

    return null;
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
