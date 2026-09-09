"use client";

import { useTranslations } from "next-intl";
import { AssetsTable, AssetsTableSkeleton } from "@/components/assets-table";
import { PageCard } from "@/components/card";
import { ConfidentialState } from "@/components/confidential-state";
import { EmptyState } from "@/components/empty-state";
import { useIsHistoryRefreshing } from "@/features/activity";
import { useAggregatedTokens } from "@/hooks/use-assets";
import type { TreasuryAsset } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
    tokens: TreasuryAsset[];
    state: "loading" | "hidden" | "ready";
}

export default function Assets({ tokens, state }: Props) {
    const t = useTranslations("assetsPage");
    const isHistoryRefreshing = useIsHistoryRefreshing();
    const aggregatedTokens = useAggregatedTokens(tokens);

    const isEmpty =
        state === "ready" &&
        !isHistoryRefreshing &&
        aggregatedTokens.length === 0;

    const renderContent = () => {
        if (state === "hidden") {
            return (
                <div className="px-1 pb-1">
                    <ConfidentialState skeleton={<AssetsTableSkeleton />} />
                </div>
            );
        }

        if (state === "loading" || isHistoryRefreshing) {
            return (
                <div className="px-1 pb-1">
                    <AssetsTableSkeleton />
                </div>
            );
        }

        if (isEmpty) {
            return (
                <div className="px-1 pb-1">
                    <AssetsTableSkeleton
                        overlay={
                            <EmptyState
                                title={t("noAssetsTitle")}
                                description={t("noAssetsDescription")}
                                className="py-0"
                            />
                        }
                    />
                </div>
            );
        }

        return <AssetsTable aggregatedTokens={aggregatedTokens} />;
    };

    return (
        <PageCard
            className={cn(
                "flex flex-col gap-0 overflow-hidden border-gray-200 p-0 dark:border-general-border",
                // Empty state mirrors the "No recent transaction yet" card:
                // faded skeleton rows straight on the card, no inset fill.
                isEmpty ? "bg-card" : "bg-gray-50 dark:bg-gray-900",
            )}
        >
            {renderContent()}
        </PageCard>
    );
}
