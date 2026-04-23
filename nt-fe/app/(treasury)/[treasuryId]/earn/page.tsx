import { getTranslations } from "next-intl/server";
import { PageComponentLayout } from "@/components/page-component-layout";

export default async function EarnPage() {
    const t = await getTranslations("pages.earn");
    return (
        <PageComponentLayout title={t("title")} description={t("description")}>
            <div className="rounded-lg border bg-card p-6">
                <p className="text-muted-foreground">{t("placeholder")}</p>
            </div>
        </PageComponentLayout>
    );
}
