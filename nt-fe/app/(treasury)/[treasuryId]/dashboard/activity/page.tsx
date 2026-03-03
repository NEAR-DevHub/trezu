"use client";

import { PageComponentLayout } from "@/components/page-component-layout";
import { PageCard } from "@/components/card";
import { TabsContent } from "@/components/responsive-tabs";
import { useRecentActivity } from "@/hooks/use-treasury-queries";
import { useSubscription } from "@/hooks/use-subscription";
import { useTreasury } from "@/hooks/use-treasury";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { ActivityTable } from "@/features/activity";
import {
    ProposalFilters as GenericFilters,
    FilterOption,
} from "@/features/proposals/components/proposal-filters";
import { Button } from "@/components/button";
import { ListFilter } from "lucide-react";
import { MemberOnlyExportButton } from "@/components/member-only-export-button";
import { getHistoryDescription } from "@/features/activity";
import { subMonths } from "date-fns";
import { ResponsiveTabs, TabItem } from "@/components/responsive-tabs";

// Constants
const PAGE_SIZE = 15;
const FILTER_PANEL_MAX_HEIGHT = "500px";

function ActivityList({ status }: { status?: "incoming" | "outgoing" }) {
    const { treasuryId } = useTreasury();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();

    const page = parseInt(searchParams.get("page") || "0", 10);

    const updatePage = useCallback(
        (newPage: number) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("page", newPage.toString());
            router.push(`${pathname}?${params.toString()}`);
        },
        [searchParams, router, pathname],
    );

    // Parse filter parameters
    const minUsdValue = searchParams.get("min_usd_value")
        ? parseFloat(searchParams.get("min_usd_value")!)
        : undefined;

    // Parse date filter
    const createdDateFilter = searchParams.get("created_date");
    let startDate: string | undefined;
    let endDate: string | undefined;

    if (createdDateFilter) {
        try {
            const parsed = JSON.parse(createdDateFilter);
            if (parsed.dateRange) {
                startDate = parsed.dateRange.from;
                endDate = parsed.dateRange.to;
            }
        } catch (e) {
            console.error("Failed to parse created_date filter:", e);
        }
    }

    // Parse token filter
    const tokenFilter = searchParams.get("token");
    let tokenSymbol: string | undefined;
    let tokenSymbolNot: string | undefined;

    if (tokenFilter) {
        try {
            const parsed = JSON.parse(tokenFilter);
            // The token filter stores data as: { operation: "Is" | "Is Not", token: { id, symbol, name, icon } }
            if (parsed.token) {
                const symbol = parsed.token.symbol;

                if (!symbol) {
                    console.error(
                        "Token filter is missing 'symbol' field:",
                        parsed.token,
                    );
                } else {
                    if (parsed.operation === "Is") {
                        tokenSymbol = symbol;
                    } else if (parsed.operation === "Is Not") {
                        tokenSymbolNot = symbol;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to parse token filter:", e);
        }
    }

    const { data, isLoading } = useRecentActivity(
        treasuryId,
        PAGE_SIZE,
        page * PAGE_SIZE,
        minUsdValue,
        status,
        tokenSymbol,
        tokenSymbolNot,
        startDate,
        endDate,
    );

    return (
        <ActivityTable
            activities={data?.data ?? []}
            isLoading={isLoading}
            pageIndex={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onPageChange={updatePage}
        />
    );
}

export default function ActivityPage() {
    const { treasuryId } = useTreasury();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const { data: subscriptionData } = useSubscription(treasuryId);
    const [isFiltersOpen, setIsFiltersOpen] = useState(false);

    const currentTab = searchParams.get("tab") || "all";

    // Calculate filter options with date restrictions based on plan
    const activityFilterOptions: FilterOption[] = useMemo(() => {
        const minDate = subscriptionData?.planConfig?.limits
            ?.historyLookupMonths
            ? subMonths(
                  new Date(),
                  subscriptionData.planConfig.limits.historyLookupMonths,
              )
            : undefined;

        return [
            {
                id: "created_date",
                label: "Created Date",
                minDate,
                maxDate: new Date(),
            },
            {
                id: "token",
                label: "Token",
                hideAmount: true,
            },
        ];
    }, [subscriptionData?.planConfig?.limits?.historyLookupMonths]);

    const handleTabChange = useCallback(
        (value: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("tab", value);
            params.delete("page"); // Reset page when changing tabs
            router.push(`${pathname}?${params.toString()}`);
        },
        [searchParams, router, pathname],
    );

    // Check if any filters are active
    const hasActiveFilters = useMemo(() => {
        const filterParams = ["created_date", "token", "min_usd_value"];
        return filterParams.some((param) => searchParams.has(param));
    }, [searchParams]);

    const tabs: TabItem[] = [
        { value: "all", label: "All" },
        { value: "outgoing", label: "Sent" },
        { value: "incoming", label: "Received" },
    ];

    const actions = (
        <div className="flex items-center justify-end gap-2">
            <Button
                variant="secondary"
                size="icon"
                className="relative md:w-auto md:px-3 md:gap-1.5"
                onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                aria-label={hasActiveFilters ? "Filter (active)" : "Filter"}
            >
                <ListFilter className="size-4" />
                <span className="hidden md:inline">Filter</span>
                {hasActiveFilters && (
                    <span
                        className="absolute top-1 right-1.5 size-2 rounded-full bg-general-info-foreground"
                        aria-hidden="true"
                    />
                )}
            </Button>
            <MemberOnlyExportButton />
        </div>
    );

    const filterPanel = (
        <div
            className="overflow-hidden transition-all duration-500 ease-in-out"
            style={{
                maxHeight: isFiltersOpen ? FILTER_PANEL_MAX_HEIGHT : "0px",
                opacity: isFiltersOpen ? 1 : 0,
            }}
        >
            <div className="py-3 px-4">
                <GenericFilters filterOptions={activityFilterOptions} />
            </div>
        </div>
    );

    const tabContents = tabs.map(({ value }) => (
        <TabsContent key={value} value={value}>
            <ActivityList
                status={
                    value === "all"
                        ? undefined
                        : (value as "incoming" | "outgoing")
                }
            />
        </TabsContent>
    ));

    return (
        <PageComponentLayout
            title="Recent Transactions"
            description={getHistoryDescription(
                subscriptionData?.planConfig?.limits?.historyLookupMonths,
            )}
            backButton={`/${treasuryId}/dashboard`}
        >
            <PageCard className="p-0">
                <ResponsiveTabs
                    tabs={tabs}
                    value={currentTab}
                    onValueChange={handleTabChange}
                    actions={actions}
                >
                    {filterPanel}
                    {tabContents}
                </ResponsiveTabs>
            </PageCard>
        </PageComponentLayout>
    );
}
