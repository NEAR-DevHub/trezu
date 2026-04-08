import { Coins } from "lucide-react";
import { AssetsTable, AssetsTableSkeleton } from "@/components/assets-table";
import { PageCard } from "@/components/card";
import { EmptyState } from "@/components/empty-state";
import { StepperHeader } from "@/components/step-wizard";
import { useAggregatedTokens } from "@/hooks/use-assets";
import { ConfidentialState } from "@/components/confidential-state";
import type { TreasuryAsset } from "@/lib/api";
import { getDashboardBucketVisibility } from "@/lib/dashboard-balance-view";

interface Props {
    tokens: TreasuryAsset[];
    state: "loading" | "hidden" | "ready";
}

export default function Assets({ tokens, state }: Props) {
    const aggregatedTokens = useAggregatedTokens(tokens);
    const bucketVisibility = getDashboardBucketVisibility(tokens);
    const hasTabs = bucketVisibility.showLocked || bucketVisibility.showEarning;

    const renderContent = () => {
        if (state === "hidden") {
            return <ConfidentialState skeleton={<AssetsTableSkeleton />} />;
        }

        if (state === "loading") {
            return <AssetsTableSkeleton />;
        }

        if (aggregatedTokens.length === 0) {
            return (
                <EmptyState
                    icon={Coins}
                    title="No assets yet"
                    description="To get started, add assets to your Treasury by making a deposit."
                />
            );
        }

        return <AssetsTable aggregatedTokens={aggregatedTokens} />;
    };

    return (
        <PageCard className="flex flex-col gap-5">
            {!hasTabs && (
                <div className="flex justify-between">
                    <StepperHeader title="Assets" />
                </div>
            )}
            {renderContent()}
        </PageCard>
    );
}
