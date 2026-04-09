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

interface CreateTreasuryPromptModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreateTreasury: () => void;
}

export function CreateTreasuryPromptModal({
    open,
    onOpenChange,
    onCreateTreasury,
}: CreateTreasuryPromptModalProps) {
    const pathname = usePathname();
    const isOnboardingPath = pathname === "/";
    const descriptionSuffix = isOnboardingPath
        ? "check out the demo."
        : "keep exploring.";
    const description = `Your wallet is connected, but you haven't created a treasury yet. Create an account to start using Trezu, or ${descriptionSuffix}`;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
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
                    <Button className="w-full" onClick={onCreateTreasury}>
                        Create a Treasury
                    </Button>
                    {isOnboardingPath ? (
                        <Button variant="secondary" className="w-full" asChild>
                            <Link href={APP_ACTIVE_TREASURY}>View Demo</Link>
                        </Button>
                    ) : (
                        <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => onOpenChange(false)}
                        >
                            Keep Exploring
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
