"use client";

import { LineChart, Line, XAxis, YAxis, Area, AreaChart } from "recharts";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig,
} from "@/components/ui/chart";
import { formatCurrency } from "@/lib/utils";
import { ChartSpline } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

interface ChartDataPoint {
    name: string;
    usdValue?: number;
    balanceValue?: number;
}

type TimePeriod = "1W" | "1M" | "3M" | "1Y";

interface BalanceChartProps {
    data?: ChartDataPoint[];
    symbol?: string;
    timePeriod?: TimePeriod;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
}

const chartConfig = {
    usdValue: {
        label: "USD Value",
        color: "var(--color-foreground)",
    },
    balanceValue: {
        label: "Token Balance",
        color: "var(--muted-foreground)",
    },
} satisfies ChartConfig;

export default function BalanceChart({
    data = [],
    symbol,
    timePeriod,
    onMouseEnter,
    onMouseLeave,
}: BalanceChartProps) {
    if (data.length === 0) {
        return (
            <div className="h-[180px]">
                <EmptyState
                    icon={ChartSpline}
                    title="Loading your balance history"
                    description="Your balance history is on the way. This might take some time."
                />
            </div>
        );
    }

    const averageUSDValue =
        data.reduce((acc, item) => acc + (item.usdValue || 0), 0) / data.length;
    const averageBalanceValue =
        data.reduce((acc, item) => acc + (item.balanceValue || 0), 0) /
        data.length;

    // Calculate optimal tick interval based on time period.
    // The interval value tells Recharts how many ticks to skip between
    // visible labels (0 = show every label, 6 = show every 7th label).
    const isMobile =
        typeof window !== "undefined" && window.innerWidth < 768;

    const calculateInterval = (
        length: number,
        period?: TimePeriod,
    ): number => {
        if (period) {
            switch (period) {
                case "1W":
                    return 0; // 7 daily points → show all
                case "1M":
                    return 3; // 30 daily points → ~8 labels, ~4-day gaps
                case "3M":
                    // Mobile: biweekly (7 labels), Desktop: weekly (13 labels)
                    return isMobile ? 12 : 6;
                case "1Y":
                    return 3; // 53 weekly points → ~13 labels, ~monthly gaps
            }
        }
        // Fallback for unknown period
        if (length <= 8) return 0;
        if (length <= 15) return 1;
        return Math.floor(length / 7);
    };

    const tickInterval = calculateInterval(data.length, timePeriod);

    return (
        <ChartContainer
            config={chartConfig}
            className="h-56"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <AreaChart data={data}>
                <defs>
                    <linearGradient
                        id="fillValue"
                        x1="0"
                        y1="0"
                        x2="100%"
                        y2="100%"
                    >
                        <stop
                            offset="0%"
                            stopOpacity={0.1}
                            stopColor="var(--color-chart-area-fill)"
                        />
                        <stop
                            offset="100%"
                            stopOpacity={0}
                            stopColor="var(--color-chart-area-fill)"
                        />
                    </linearGradient>
                </defs>
                <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    interval={tickInterval}
                    padding={{ left: 20, right: 20 }}
                />
                <YAxis
                    yAxisId="usd"
                    hide
                    domain={[
                        `dataMin - ${averageUSDValue * 0.5}`,
                        `dataMax + ${averageUSDValue * 0.5}`,
                    ]}
                />
                <YAxis
                    yAxisId="balance"
                    hide
                    orientation="right"
                    domain={[
                        `dataMin - ${averageBalanceValue * 0.5}`,
                        `dataMax + ${averageBalanceValue * 0.5}`,
                    ]}
                />
                <ChartTooltip
                    content={
                        <ChartTooltipContent
                            className="bg-card text-foreground border-border shadow-md"
                            formatter={(value, name) => {
                                const num = Number(value);
                                const color =
                                    name === "usdValue"
                                        ? "var(--color-foreground)"
                                        : "var(--muted-foreground)";
                                const formatted =
                                    name === "usdValue"
                                        ? formatCurrency(num)
                                        : `${num.toLocaleString(undefined, {
                                              minimumFractionDigits: 2,
                                              maximumFractionDigits: 6,
                                          })}${symbol ? ` ${symbol.toUpperCase()}` : ""}`;

                                return (
                                    <>
                                        <div
                                            className="h-2.5 w-2.5 shrink-0 rounded"
                                            style={{ backgroundColor: color }}
                                        />
                                        <div className="flex flex-1 justify-between items-center leading-none">
                                            <span className="font-medium text-xs text-foreground">
                                                {formatted}
                                            </span>
                                        </div>
                                    </>
                                );
                            }}
                        />
                    }
                />
                <Area
                    type="monotone"
                    dataKey="usdValue"
                    yAxisId="usd"
                    stroke="var(--color-foreground)"
                    strokeWidth={2}
                    fill="url(#fillValue)"
                    dot={false}
                    activeDot={{
                        r: 5,
                        fill: "var(--color-foreground)",
                        stroke: "white",
                        strokeWidth: 2,
                    }}
                />
                <Area
                    type="monotone"
                    dataKey="balanceValue"
                    yAxisId="balance"
                    stroke="var(--muted-foreground)"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    fill="url(#fillValue)"
                    dot={false}
                    activeDot={{
                        r: 5,
                        fill: "var(--color-foreground)",
                        stroke: "white",
                        strokeWidth: 2,
                    }}
                />
            </AreaChart>
        </ChartContainer>
    );
}
