"use client";
import { useTranslations } from "next-intl";
import { NearLoader } from "@/components/near-loader";

export function LoadingScreen() {
    const t = useTranslations("common");

    return (
        <div className="flex min-h-screen items-center justify-center bg-page-bg text-foreground">
            <NearLoader />
            <span className="sr-only">{t("loading")}</span>
        </div>
    );
}
