import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("pages.settings");
    return { title: t("title") };
}

export default function SettingsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
