"use client";

import { useState } from "react";
import { PageComponentLayout } from "@/components/page-component-layout";
import { useAssets } from "@/hooks/use-assets";

import Assets from "./components/assets";
import BalanceWithGraph from "./components/balance-with-graph";
import { PendingRequests } from "@/features/proposals/components/pending-requests";
import { RecentActivity } from "@/features/activity";
import { OnboardingProgress } from "@/features/onboarding";
import { DepositModal } from "./components/deposit-modal";
import { InfoBox } from "@/features/onboarding/components/info-box";
import {
    WelcomeTooltip,
    CongratsTooltip,
} from "@/features/onboarding/steps/dashboard";
import { useTreasury } from "@/hooks/use-treasury";
import { CreateBanner } from "@/features/onboarding/components/create-banner";

export default function AppPage() {
    const { treasuryId, isConfidential, isGuestTreasury } = useTreasury();
    const isHidden = isConfidential && isGuestTreasury;
    const { data, isLoading, isPending } = useAssets(treasuryId, {
        enabled: !isHidden,
    });
    const isAssetsLoading = isLoading || isPending;
    const { tokens } = data || {
        tokens: [],
        totalBalanceUSD: 0,
    };
    const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);

    return (
        <PageComponentLayout
            title="Dashboard"
            description="Overview of your treasury assets and activity"
        >
            <div className="flex flex-col lg:flex-row gap-5">
                <div className="flex flex-col gap-5 lg:w-3/5 w-full">
                    <div className="lg:hidden empty:hidden">
                        <CreateBanner />
                    </div>
                    <OnboardingProgress
                        onDepositClick={() => setIsDepositModalOpen(true)}
                    />
                    <BalanceWithGraph
                        tokens={tokens}
                        isHidden={isHidden}
                        onDepositClick={() => setIsDepositModalOpen(true)}
                        isLoading={isAssetsLoading}
                    />
                    <Assets
                        tokens={tokens}
                        state={
                            isHidden
                                ? "hidden"
                                : isAssetsLoading
                                  ? "loading"
                                  : "ready"
                        }
                    />
                    <RecentActivity />
                </div>
                <div className="flex flex-col gap-5 w-full lg:w-2/5">
                    <InfoBox />
                    <PendingRequests />
                </div>
            </div>

            <DepositModal
                isOpen={isDepositModalOpen}
                onClose={() => setIsDepositModalOpen(false)}
            />
            <WelcomeTooltip />
            <CongratsTooltip />
        </PageComponentLayout>
    );
}
