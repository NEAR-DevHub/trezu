"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { StepperHeader } from "@/components/step-wizard";
import { Skeleton } from "@/components/ui/skeleton";
import {
    useDisconnectTelegramTreasury,
    useTelegramStatuses,
} from "@/hooks/use-telegram";
import { useTreasury } from "@/hooks/use-treasury";
import { TelegramConnectInstructionsModal } from "./telegram-connect-instructions-modal";

export function TelegramSettingsIntegration() {
    const { treasuryId } = useTreasury();
    const [connectModalOpen, setConnectModalOpen] = useState(false);
    const disconnectMutation = useDisconnectTelegramTreasury();

    const statusQueries = useTelegramStatuses(treasuryId ? [treasuryId] : []);
    const statusResult =
        treasuryId && statusQueries.length > 0 ? statusQueries[0] : undefined;
    const telegramStatus = statusResult?.data;
    const isLoadingStatus =
        !!treasuryId && !!(statusResult?.isLoading || statusResult?.isPending);

    const chatLabel =
        telegramStatus?.chatTitle?.trim() ||
        (telegramStatus?.chatId != null
            ? `Chat #${telegramStatus.chatId}`
            : null);
    const connectedChatDisplay = chatLabel ?? "a Telegram chat";

    const handleDisconnect = () => {
        if (!treasuryId) return;
        disconnectMutation.mutate(treasuryId, {
            onSuccess: () => {
                toast.success("Telegram disconnected for this treasury");
            },
            onError: () => {
                toast.error("Could not disconnect Telegram. Try again.");
            },
        });
    };

    return (
        <>
            <PageCard>
                {telegramStatus?.connected && treasuryId && !isLoadingStatus ? (
                    <div className="flex justify-between items-center gap-4 w-full">
                        <div className="min-w-0">
                            <StepperHeader
                                title="Telegram"
                                description={`Connected to ${connectedChatDisplay}`}
                            />
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            className="shrink-0 self-center"
                            disabled={disconnectMutation.isPending}
                            onClick={handleDisconnect}
                        >
                            {disconnectMutation.isPending && (
                                <Loader2 className="size-4 animate-spin" />
                            )}
                            Disconnect
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 w-full">
                        {!treasuryId ? (
                            <>
                                <StepperHeader
                                    title="Telegram"
                                    description="Link your treasuries to a Telegram chat."
                                />
                                <p className="text-sm text-muted-foreground">
                                    Open settings from a treasury to manage
                                    integrations.
                                </p>
                            </>
                        ) : isLoadingStatus ? (
                            <div className="flex flex-col gap-2">
                                <Skeleton className="h-4 w-full max-w-md" />
                                <Skeleton className="h-9 w-32" />
                            </div>
                        ) : (
                            <div className="flex justify-between items-center gap-4 w-full">
                                <div className="min-w-0">
                                    <StepperHeader
                                        title="Telegram"
                                        description="Link your treasury to a Telegram chat to receive notifications."
                                    />
                                </div>
                                <Button
                                    type="button"
                                    className="shrink-0 self-center"
                                    onClick={() => setConnectModalOpen(true)}
                                >
                                    Connect
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </PageCard>

            <TelegramConnectInstructionsModal
                open={connectModalOpen}
                onOpenChange={setConnectModalOpen}
            />
        </>
    );
}
