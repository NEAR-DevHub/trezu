"use client";

import { ChartSpline } from "lucide-react";
import { QueryProvider } from "@/components/query-provider";
import { PageComponentLayout } from "@/components/page-component-layout";
import { PageCard } from "@/components/card";
import Logo from "@/components/icons/logo";
import { usePublicDashboard } from "../hooks/use-public-dashboard";
import { AumStatCard, AumStatCardSkeleton } from "./aum-stat-card";
import { TopTokensTable, TopTokensTableSkeleton } from "./top-tokens-table";
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";

function DashboardContent() {
    const { data, isLoading, isError } = usePublicDashboard();

    if (isLoading) {
        return (
            <div className="flex flex-col gap-5">
                <AumStatCardSkeleton />
                <TopTokensTableSkeleton />
            </div>
        );
    }

    if (isError || !data) {
        return (
            <PageCard>
                <div className="flex flex-col items-center justify-center gap-2 py-12">
                    <EmptyState
                        icon={ChartSpline}
                        title="No data yet"
                        description="Stats will appear after the first daily snapshot is computed."
                    />
                </div>
            </PageCard>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <AumStatCard
                totalAumUsd={data.totalAumUsd}
                daoCount={data.daoCount}
                snapshotDate={data.snapshotDate}
            />
            <TopTokensTable tokens={data.topTokens} />
        </div>
    );
}

export function PublicDashboardStatsPage() {
    return (
        <QueryProvider>
            <PageComponentLayout
                title="Stats"
                hideCollapseButton
                hideLogin
                logo={
                    <div className="flex items-center gap-2.5">
                        <Link href="/">
                            <Logo size="sm" />
                        </Link>
                        <span className="hidden sm:inline text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                            Updates daily
                        </span>
                    </div>
                }
            >
                <div className="max-w-3xl mx-auto">
                    <DashboardContent />
                </div>
            </PageComponentLayout>
        </QueryProvider>
    );
}
