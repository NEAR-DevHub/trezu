import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("pages.manageTreasuries");
    return { title: t("title") };
}

export default function ManageTreasuriesLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
