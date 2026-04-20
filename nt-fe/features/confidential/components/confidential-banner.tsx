"use client";

import { ChevronDown, ChevronUp, Shield } from "lucide-react";
import { useState, useEffect } from "react";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useTreasury } from "@/hooks/use-treasury";
import { Tooltip } from "@/components/tooltip";
import { cn } from "@/lib/utils";

const CONFIDENTIAL_BANNER_COLLAPSED_KEY = "confidential-banner-collapsed";
export const DESCRIPTION =
    "Balances, activity, and transfers are visible only to your team — not the public blockchain.";

export function ConfidentialBanner({
    type,
    className,
}: {
    type?: "default" | "mini";
    className?: string;
}) {
    const { isConfidential, isLoading, isGuestTreasury } = useTreasury();
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const stored = localStorage.getItem(CONFIDENTIAL_BANNER_COLLAPSED_KEY);
        if (stored !== null) {
            setIsOpen(stored === "true");
        }
    }, []);

    if (isLoading || !isConfidential || isGuestTreasury) {
        return null;
    }

    if (type === "mini") {
        return (
            <Tooltip
                content={DESCRIPTION}
                triggerProps={{
                    asChild: false,
                    className: cn("size-4", className),
                }}
            >
                <Shield className="fill-foreground w-full h-full" />
            </Tooltip>
        );
    }

    const handleOpenChange = (open: boolean) => {
        localStorage.setItem(CONFIDENTIAL_BANNER_COLLAPSED_KEY, String(open));
        setIsOpen(open);
    };

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={handleOpenChange}
            className={cn(
                "w-full min-w-0 bg-secondary rounded-lg p-3",
                className,
            )}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Shield className="fill-foreground size-6" />
                    <span className="text-sm font-medium text-foreground">
                        Confidential
                    </span>
                </div>
                <CollapsibleTrigger className="text-muted-foreground hover:text-foreground transition-colors">
                    {isOpen ? (
                        <ChevronUp className="size-3.5" />
                    ) : (
                        <ChevronDown className="size-3.5" />
                    )}
                </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
                <p className="text-xs text-muted-foreground pt-3">
                    {DESCRIPTION}
                </p>
            </CollapsibleContent>
        </Collapsible>
    );
}
