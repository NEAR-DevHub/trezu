"use client";

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
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md! sm:max-w-lg!">
                <DialogHeader>
                    <DialogTitle>Connect Telegram</DialogTitle>
                </DialogHeader>
                <DialogDescription>
                    Follow these steps to link this treasury to your Telegram
                    chat.
                </DialogDescription>
                <ol className="list-decimal pl-5 space-y-4 text-sm text-muted-foreground">
                    <li>
                        <span className="text-foreground inline-flex flex-wrap items-center gap-x-1">
                            Add{" "}
                            <span className="font-semibold">
                                {TELEGRAM_BOT_USERNAME}
                            </span>
                            <CopyButton
                                text={TELEGRAM_BOT_USERNAME}
                                toastMessage="Bot username copied"
                                variant="ghost"
                                size="icon-sm"
                                tooltipContent="Copy bot username"
                            />{" "}
                            to your Telegram group or channel.
                        </span>
                    </li>
                    <li>
                        <span className="text-foreground">
                            In Telegram, tap{" "}
                            <strong className="font-semibold text-foreground">
                                Connect Treasury
                            </strong>{" "}
                            (or use the bot&apos;s connect flow when prompted).
                        </span>
                    </li>
                    <li>
                        <span className="text-foreground">
                            Sign in on the web, then authorize and select which
                            treasuries to connect to this chat—including this
                            one.
                        </span>
                    </li>
                </ol>
                <p className="text-xs text-muted-foreground">
                    You&apos;re done when the browser shows your treasuries
                    linked successfully.
                </p>
                <Button className="w-full" asChild>
                    <a
                        href={TELEGRAM_BOT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Open {TELEGRAM_BOT_USERNAME} in Telegram
                    </a>
                </Button>
            </DialogContent>
        </Dialog>
    );
}
