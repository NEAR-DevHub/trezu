"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
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

function ConnectorLines() {
    const lines = Array.from({ length: 2 }, (_, index) => (
        <div
            key={index}
            className="h-px w-8 shrink-0 border-t border-dashed border-muted-foreground/40 sm:w-12"
        />
    ));
    return (
        <div className="flex flex-col gap-2" aria-hidden>
            {lines}
        </div>
    );
}

export function TelegramConnectInstructionsModal({
    open,
    onOpenChange,
}: TelegramConnectInstructionsModalProps) {
    const t = useTranslations("telegram.connectInstructions");

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="gap-6 sm:max-w-lg!">
                <DialogHeader className="border-none px-0 pb-0 mx-0 bg-transparent static">
                    <DialogTitle className="sr-only">{t("title")}</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col items-center gap-4 px-0.5">
                    <div className="flex items-center justify-center">
                        <div className="flex size-10 shrink-0 items-center justify-center">
                            <img
                                src="/logo_mark.svg"
                                alt=""
                                width={44}
                                height={44}
                                className="size-10 shrink-0 object-contain"
                                aria-hidden
                                draggable={false}
                            />
                        </div>
                        <ConnectorLines />
                        <img
                            src="/icons/telegram.svg"
                            alt=""
                            width={40}
                            height={40}
                            className="size-10 shrink-0 rounded-lg object-contain"
                            aria-hidden
                            draggable={false}
                        />
                    </div>

                    <div className="flex flex-col items-center text-center">
                        <DialogTitle className="text-xl font-semibold text-foreground">
                            {t("title")}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-muted-foreground">
                            {t("subtitle")}
                        </DialogDescription>
                    </div>

                    <div className="w-full rounded-md border border-border/60 bg-general-tertiary px-2 py-3 text-left text-sm leading-relaxed text-foreground">
                        <ol className="list-decimal space-y-3 pl-5 marker:font-medium marker:text-foreground">
                            <li className="pl-1">
                                {t("step1", { bot: TELEGRAM_BOT_USERNAME })}
                            </li>
                            <li className="pl-1">{t("step2")}</li>
                            <li className="pl-1">{t("step3")}</li>
                        </ol>
                    </div>

                    <div className="text-left text-sm text-muted-foreground">
                        {t("doneHint")}
                    </div>

                    <Button
                        className="h-11 w-full rounded-lg bg-black text-white hover:bg-black/90 dark:bg-black dark:text-white dark:hover:bg-black/90"
                        asChild
                    >
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
                </div>
            </DialogContent>
        </Dialog>
    );
}
