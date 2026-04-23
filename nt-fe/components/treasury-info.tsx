"use client";

import { useEffect, useState } from "react";
import { Database, Shield } from "lucide-react";
import { useAssets } from "@/hooks/use-assets";
import { cn, formatCurrency } from "@/lib/utils";
import { Skeleton } from "./ui/skeleton";

export function TreasuryLogo({
    logo,
    isConfidential,
}: {
    logo?: string;
    isConfidential?: boolean;
}) {
    const [hasImageError, setHasImageError] = useState(false);

    useEffect(() => {
        setHasImageError(false);
    }, [logo]);

    const shouldShowImage = !!logo && !hasImageError;

    const item = shouldShowImage ? (
        <img
            src={logo}
            alt="Treasury Logo"
            className="rounded-md size-7 shrink-0 object-cover"
            onError={() => setHasImageError(true)}
        />
    ) : (
        <div className="flex items-center justify-center size-7 rounded bg-muted shrink-0">
            <Database className="size-5 text-muted-foreground" />
        </div>
    );

    return (
        <div className="relative">
            {item}
            {isConfidential && (
                <div className="absolute right-0 bottom-0">
                    <Shield className="size-4 fill-foreground text-background" />
                </div>
            )}
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
    const totalBalance = data.tokens.reduce((sum, t) => sum + t.balanceUSD, 0);
    return (
        <span className={cn("text-sm text-muted-foreground", className)}>
            {isConfidential ? "••••••" : formatCurrency(totalBalance)}
        </span>
    );
}
