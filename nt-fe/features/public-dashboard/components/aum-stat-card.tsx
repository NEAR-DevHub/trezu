"use client";

import { formatCurrency } from "@/lib/utils";
import { PageCard } from "@/components/card";
import { Skeleton } from "@/components/ui/skeleton";
import Big from "@/lib/big";

interface AumStatCardProps {
    totalAumUsd: string;
    daoCount: number;
    snapshotDate: string;
}

function formatSnapshotDate(dateStr: string): string {
    const [year, month, day] = dateStr.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

export function AumStatCard({
    totalAumUsd,
    daoCount,
    snapshotDate,
}: AumStatCardProps) {
    const aum = new Big(totalAumUsd || "0");

    return (
        <PageCard>
            <div className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Assets Secured With Sputnik DAO Contract
                </h3>
                <p className="text-3xl font-bold mt-2">{formatCurrency(aum)}</p>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-xs text-muted-foreground">
                <span>
                    Across{" "}
                    <span className="font-semibold text-foreground">
                        {daoCount}
                    </span>{" "}
                    {daoCount === 1 ? "DAO" : "DAOs"}
                </span>
                <span>Updated {formatSnapshotDate(snapshotDate)}</span>
            </div>
        </PageCard>
    );
}

export function AumStatCardSkeleton() {
    return (
        <PageCard>
            <div className="flex justify-around gap-4">
                <div className="flex-1">
                    <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Assets Secured With Sputnik DAO Contract
                    </h3>
                    <Skeleton className="h-9 w-48 mt-2" />
                </div>
            </div>
            <div className="flex gap-6">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-40" />
            </div>
        </PageCard>
    );
}
