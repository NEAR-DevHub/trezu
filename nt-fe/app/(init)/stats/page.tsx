import type { Metadata } from "next";
import { PublicDashboardStatsPage } from "@/features/public-dashboard";

export const metadata: Metadata = {
    title: "Stats",
    description:
        "Real-time assets under management across all sputnik DAOs treasuries.",
};

export default function StatsPage() {
    return <PublicDashboardStatsPage />;
}
