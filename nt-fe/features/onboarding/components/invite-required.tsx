"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/button";
import { NearBusinessLogo } from "@/components/icons/near-business-logo";
import { EarlyAccessModal } from "@/features/landing/components/early-access";
import { useNear } from "@/stores/near-store";
import { ConnectedAccountCard } from "./connected-account-card";

/**
 * Shown on `/create` when the deployment is invite-only and the visitor holds
 * no accepted invite. Login and existing treasuries stay reachable.
 */
export function InviteRequired() {
    const t = useTranslations("inviteRequired");
    const { accountId } = useNear();
    const router = useRouter();
    const [isRequestOpen, setIsRequestOpen] = useState(false);

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
                    onClick={() => setIsRequestOpen(true)}
                    className="mt-3 w-full max-w-60 rounded-xl bg-general-bg-primary hover:bg-general-bg-primary/90"
                >
                    {t("cta")}
                </Button>
            </div>
            {accountId && (
                <div className="w-full max-w-[448px]">
                    <ConnectedAccountCard
                        accountId={accountId}
                        onDisconnected={() => router.replace("/login")}
                    />
                </div>
            )}
            <EarlyAccessModal
                open={isRequestOpen}
                onOpenChange={setIsRequestOpen}
            />
        </main>
    );
}
