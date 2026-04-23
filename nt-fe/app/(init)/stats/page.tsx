import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PublicDashboardStatsPage } from "@/features/public-dashboard";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("pages.stats");
    return {
        title: t("title"),
        description: t("description"),
    };
}

export default function StatsPage() {
    return <PublicDashboardStatsPage />;
}
