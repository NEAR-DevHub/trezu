import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("pages.requests");
    return { title: t("title") };
}

export default function RequestsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
