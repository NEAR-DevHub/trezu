import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("pages.payments");
    return { title: t("title") };
}

export default function PaymentsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
