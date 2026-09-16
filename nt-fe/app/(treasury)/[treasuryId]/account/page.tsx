"use client";

import { useTranslations } from "next-intl";
import { PageCard } from "@/components/card";
import { PageComponentLayout } from "@/components/page-component-layout";
import { useHideMobileBottomNav } from "@/hooks/use-hide-mobile-bottom-nav";
import { useTreasury } from "@/hooks/use-treasury";
import { useNear } from "@/stores/near-store";
import { ProfileSections } from "./components/profile-sections";
import { TimezoneSection } from "./components/timezone-section";

/** Matches the settings page: keeps the layout from shifting as cards load. */
const STABLE_SCROLL_GUTTER = "[scrollbar-gutter:stable_both-edges]";

export default function AccountPage() {
    const t = useTranslations("account");
    const tPages = useTranslations("pages.account");
    const { accountId, isAuthenticated } = useNear();
    const { treasuryId } = useTreasury();

    useHideMobileBottomNav();

    return (
        <PageComponentLayout
            title={tPages("title")}
            backButton={treasuryId ? `/${treasuryId}` : true}
            backKind="mobile"
            hideMobileShellControls
            mainClassName={STABLE_SCROLL_GUTTER}
        >
            <div className="mx-auto flex w-full max-w-[464px] flex-col gap-5">
                {accountId && isAuthenticated ? (
                    <ProfileSections accountId={accountId} />
                ) : (
                    <PageCard className="rounded-3xl">
                        <p className="text-sm text-muted-foreground">
                            {t("signInRequired")}
                        </p>
                    </PageCard>
                )}
                <TimezoneSection />
            </div>
        </PageComponentLayout>
    );
}
