"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { PageComponentLayout } from "@/components/page-component-layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/underline-tabs";
import { GeneralTab } from "./components/general-tab";
import { VotingTab } from "./components/voting-tab";

/** The only tabs this page serves; also the single source of truth for `?tab=`. */
const SETTINGS_TABS = ["general", "voting"] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * General fits the viewport while Voting scrolls, so the scroller's bar would
 * come and go with the tab and shunt the centred column sideways. Reserving the
 * gutter on both edges keeps it put (and is a no-op with overlay scrollbars).
 */
const STABLE_SCROLL_GUTTER = "[scrollbar-gutter:stable_both-edges]";

function isSettingsTab(value: string | null): value is SettingsTab {
    return SETTINGS_TABS.some((tab) => tab === value);
}

function SettingsPageContent() {
    const t = useTranslations("pages.settings");
    const tTabs = useTranslations("settings.tabs");
    const searchParams = useSearchParams();
    const pathname = usePathname();
    const router = useRouter();
    const tabParam = searchParams.get("tab");
    const [activeTab, setActiveTab] = useState<SettingsTab>(() =>
        isSettingsTab(tabParam) ? tabParam : "general",
    );

    useEffect(() => {
        if (isSettingsTab(tabParam)) {
            setActiveTab(tabParam);
            return;
        }
        // A link to a tab this page no longer serves would otherwise leave the URL
        // advertising a tab nobody is on; drop it so the address matches General.
        if (tabParam !== null) {
            router.replace(pathname, { scroll: false });
        }
    }, [tabParam, pathname, router]);

    return (
        <PageComponentLayout
            title={t("title")}
            hideMobileShellControls
            mainClassName={STABLE_SCROLL_GUTTER}
        >
            <div className="mx-auto w-full max-w-[464px]">
                <Tabs
                    value={activeTab}
                    onValueChange={(value) => {
                        if (isSettingsTab(value)) {
                            setActiveTab(value);
                        }
                    }}
                    className="mb-5"
                >
                    <TabsList className="gap-2">
                        {SETTINGS_TABS.map((tab) => (
                            <TabsTrigger
                                key={tab}
                                value={tab}
                                className="px-1 pt-0.5 pb-3 text-lg font-semibold md:text-lg data-[state=active]:after:h-px data-[state=active]:after:bg-general-bg-primary"
                            >
                                {tTabs(tab)}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                {activeTab === "general" ? <GeneralTab /> : <VotingTab />}
            </div>
        </PageComponentLayout>
    );
}

export default function SettingsPage() {
    const t = useTranslations("pages.settings");

    return (
        <Suspense
            fallback={
                <PageComponentLayout
                    title={t("title")}
                    hideMobileShellControls
                    mainClassName={STABLE_SCROLL_GUTTER}
                >
                    <div className="mx-auto min-h-48 w-full max-w-[464px]" />
                </PageComponentLayout>
            }
        >
            <SettingsPageContent />
        </Suspense>
    );
}
