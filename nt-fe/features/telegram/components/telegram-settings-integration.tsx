"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
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
    const t = useTranslations("telegramSettings");
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
            ? t("chatNumber", { id: telegramStatus.chatId })
            : null);
    const connectedChatDisplay = chatLabel ?? t("fallbackChat");

    const handleDisconnect = () => {
        if (!treasuryId) return;
        disconnectMutation.mutate(treasuryId, {
            onSuccess: () => {
                toast.success(t("disconnectedToast"));
            },
            onError: () => {
                toast.error(t("disconnectFailedToast"));
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
                                title={t("title")}
                                description={t("connectedTo", {
                                    chat: connectedChatDisplay,
                                })}
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
                            {t("disconnect")}
                        </Button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 w-full">
                        {!treasuryId ? (
                            <>
                                <StepperHeader
                                    title={t("title")}
                                    description={t("noTreasuryDescription")}
                                />
                                <p className="text-sm text-muted-foreground">
                                    {t("openSettingsHint")}
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
                                        title={t("title")}
                                        description={t("connectDescription")}
                                    />
                                </div>
                                <Button
                                    type="button"
                                    className="shrink-0 self-center"
                                    onClick={() => setConnectModalOpen(true)}
                                >
                                    {t("connect")}
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
