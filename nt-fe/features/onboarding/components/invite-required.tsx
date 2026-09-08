"use client";

import { useTranslations } from "next-intl";
import { NearBusinessLogo } from "@/components/icons/near-business-logo";
import { Button } from "@/components/button";

/**
 * Shown on `/create` when the deployment is invite-only and the visitor holds
 * no accepted invite. Login and existing treasuries stay reachable.
 */
export function InviteRequired({ landingUrl }: { landingUrl: string }) {
    const t = useTranslations("inviteRequired");

    return (
        <main className="flex min-h-screen flex-col items-center px-4 py-12 sm:px-8">
            <NearBusinessLogo className="h-8 w-auto" />
            <div className="flex w-full max-w-140 flex-1 flex-col items-center justify-center gap-6 text-center">
                <div className="flex flex-col gap-3">
                    <h1 className="text-[30px] font-semibold tracking-[-0.3px] text-general-foreground">
                        {t("title")}
                    </h1>
                    <p className="max-w-115 text-lg leading-[1.33] text-muted-foreground">
                        {t("description")}
                    </p>
                </div>
                <Button
                    asChild
                    size="xl"
                    className="mt-3 w-full max-w-60 rounded-full text-base font-bold leading-none"
                >
                    <a href={landingUrl}>{t("cta")}</a>
                </Button>
            </div>
        </main>
    );
}
