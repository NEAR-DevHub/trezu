import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("pages.exchange");
    return { title: t("title") };
}

export default function ExchangeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
