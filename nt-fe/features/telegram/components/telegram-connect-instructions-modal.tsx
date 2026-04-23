"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { TELEGRAM_BOT_URL, TELEGRAM_BOT_USERNAME } from "@/constants/config";

interface TelegramConnectInstructionsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function TelegramConnectInstructionsModal({
    open,
    onOpenChange,
}: TelegramConnectInstructionsModalProps) {
    const t = useTranslations("telegramConnectInstructions");
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md! sm:max-w-lg!">
                <DialogHeader>
                    <DialogTitle>{t("title")}</DialogTitle>
                </DialogHeader>
                <DialogDescription>{t("subtitle")}</DialogDescription>
                <ol className="list-decimal pl-5 space-y-4 text-sm text-muted-foreground">
                    <li>
                        <span className="text-foreground inline-flex flex-wrap items-center gap-x-1">
                            {t.rich("step1", {
                                bot: () => (
                                    <span className="font-semibold">
                                        {TELEGRAM_BOT_USERNAME}
                                    </span>
                                ),
                                copy: () => (
                                    <CopyButton
                                        text={TELEGRAM_BOT_USERNAME}
                                        toastMessage={t("botCopiedToast")}
                                        variant="ghost"
                                        size="icon-sm"
                                        tooltipContent={t("copyBotTooltip")}
                                    />
                                ),
                            })}
                        </span>
                    </li>
                    <li>
                        <span className="text-foreground">
                            {t.rich("step2", {
                                strong: (chunks) => (
                                    <strong className="font-semibold text-foreground">
                                        {chunks}
                                    </strong>
                                ),
                            })}
                        </span>
                    </li>
                    <li>
                        <span className="text-foreground">{t("step3")}</span>
                    </li>
                </ol>
                <p className="text-xs text-muted-foreground">{t("success")}</p>
                <Button className="w-full" asChild>
                    <a
                        href={TELEGRAM_BOT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {t("openInTelegram", {
                            bot: TELEGRAM_BOT_USERNAME,
                        })}
                    </a>
                </Button>
            </DialogContent>
        </Dialog>
    );
}
