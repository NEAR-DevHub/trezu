"use client";

import { Database } from "lucide-react";
import { useAssets } from "@/hooks/use-assets";
import { cn, formatCurrency } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";
import { TreasuryTypeIcon } from "./icons/shield";

export function TreasuryLogo({
    logo,
    isConfidential,
}: {
    logo?: string;
    isConfidential?: boolean;
}) {
    const item = logo ? (
        <img
            src={logo}
            alt="Treasury Logo"
            className="rounded-md size-7 shrink-0 object-cover"
        />
    ) : (
        <div className="flex items-center justify-center size-7 rounded bg-muted shrink-0">
            <Database className="size-5 text-muted-foreground" />
        </div>
    );

    return (
        <div className="relative">
            {item}
            <div className="absolute right-0 bottom-0">
                <TreasuryTypeIcon
                    type={isConfidential ? "confidential" : "public"}
                    size={"sm"}
                />
            </div>
        </div>
    );
}

export function TreasuryBalance({
    daoId,
    isConfidential,
    className,
    skeletonClassName,
}: {
    daoId: string;
    isConfidential?: boolean;
    className?: string;
    skeletonClassName?: string;
}) {
    const { data, isLoading } = useAssets(daoId, { enabled: !isConfidential });
    if (isLoading)
        return <Skeleton className={skeletonClassName ?? "h-4 w-16"} />;
    if (!data?.tokens) return null;
    const balanceExcludingLockup = data.tokens
        .filter((t) => t.residency !== "Lockup")
        .reduce((sum, t) => sum + t.balanceUSD, 0);
    return (
        <span className={cn("text-sm text-muted-foreground", className)}>
            {isConfidential ? "••••••" : formatCurrency(balanceExcludingLockup)}
        </span>
    );
}
