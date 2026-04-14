"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { APP_ACTIVE_TREASURY } from "@/constants/config";
import { trackEvent } from "@/lib/analytics";

interface CreateTreasuryPromptModalProps {
    open: boolean;
    source: "onboarding" | "app";
    onOpenChange: (open: boolean) => void;
    onCreateTreasury: () => void;
}

export function CreateTreasuryPromptModal({
    open,
    source,
    onOpenChange,
    onCreateTreasury,
}: CreateTreasuryPromptModalProps) {
    const pathname = usePathname();
    const isOnboardingPath = pathname === "/";
    const descriptionSuffix = isOnboardingPath
        ? "check out the demo."
        : "keep exploring.";
    const description = `Your wallet is connected, but you haven't created a treasury yet. Create an account to start using Trezu, or ${descriptionSuffix}`;

    const trackClick = (button: string) => {
        trackEvent("create-treasury-prompt-clicked", { button, source });
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) trackClick("dismiss");
                onOpenChange(nextOpen);
            }}
        >
            <DialogContent>
                <DialogHeader className="mb-1">
                    <DialogTitle className="text-left">
                        You're almost set
                    </DialogTitle>
                </DialogHeader>
                <DialogDescription className="text-muted-foreground">
                    {description}
                </DialogDescription>
                <div className="flex flex-col gap-3 mt-2">
                    <Button
                        className="w-full"
                        onClick={() => {
                            trackClick("create_treasury");
                            onCreateTreasury();
                        }}
                    >
                        Create a Treasury
                    </Button>
                    {isOnboardingPath ? (
                        <Button
                            variant="secondary"
                            className="w-full"
                            asChild
                            onClick={() => trackClick("view_demo")}
                        >
                            <Link href={APP_ACTIVE_TREASURY}>View Demo</Link>
                        </Button>
                    ) : (
                        <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => {
                                trackClick("keep_exploring");
                                onOpenChange(false);
                            }}
                        >
                            Keep Exploring
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
