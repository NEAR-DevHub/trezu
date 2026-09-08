"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect, useState } from "react";
import { PageComponentLayout } from "@/components/page-component-layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/underline-tabs";
import { useTreasury } from "@/hooks/use-treasury";
import { GeneralTab } from "./components/general-tab";
import { VotingTab } from "./components/voting-tab";

function SettingsPageContent() {
    const t = useTranslations("pages.settings");
    const tTabs = useTranslations("settings.tabs");
    const searchParams = useSearchParams();
    const { treasuryId } = useTreasury();
    const [activeTab, setActiveTab] = useState(() =>
        searchParams.get("tab") === "voting" ? "voting" : "general",
    );

    useEffect(() => {
        if (searchParams.get("tab") === "voting") {
            setActiveTab("voting");
        }
    }, [searchParams]);

    const tabs = [
        { value: "general", label: tTabs("general") },
        { value: "voting", label: tTabs("voting") },
    ];

    return (
        <PageComponentLayout
            title={t("title")}
            backButton={treasuryId ? `/${treasuryId}` : true}
            backKind="section"
            hideMobileShellControls
        >
            <div className="mx-auto w-full max-w-[464px]">
                <Tabs
                    value={activeTab}
                    onValueChange={setActiveTab}
                    className="mb-5"
                >
                    <TabsList className="gap-2">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className="px-1 pt-0.5 pb-3 text-lg font-semibold md:text-lg data-[state=active]:after:h-px data-[state=active]:after:bg-general-bg-primary"
                            >
                                {tab.label}
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
    const { treasuryId } = useTreasury();

    return (
        <Suspense
            fallback={
                <PageComponentLayout
                    title={t("title")}
                    backButton={treasuryId ? `/${treasuryId}` : true}
                    backKind="section"
                    hideMobileShellControls
                >
                    <div className="mx-auto min-h-48 w-full max-w-[464px]" />
                </PageComponentLayout>
            }
        >
            <SettingsPageContent />
        </Suspense>
    );
}
