"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { PageComponentLayout } from "@/components/page-component-layout";
import { TabGroup } from "@/components/tab-group";
import { features } from "@/constants/features";
import { GeneralTab } from "./components/general-tab";
import { IntegrationsTab } from "./components/integrations-tab";
import { PreferencesTab } from "./components/preferences-tab";
import { VotingTab } from "./components/voting-tab";

export default function SettingsPage() {
    const t = useTranslations("pages.settings");
    const tTabs = useTranslations("settings.tabs");
    const [activeTab, setActiveTab] = useState("general");

    const tabs = [
        { value: "general", label: tTabs("general") },
        { value: "voting", label: tTabs("voting") },
        { value: "preferences", label: tTabs("preferences") },
        ...(features.integrations
            ? [{ value: "integrations", label: tTabs("integrations") }]
            : []),
    ];

    return (
        <PageComponentLayout title={t("title")} description={t("description")}>
            <div className="w-full max-w-4xl mx-auto">
                <div className="flex mb-6">
                    <TabGroup
                        tabs={tabs}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                    />
                </div>

                {activeTab === "general" && <GeneralTab />}
                {activeTab === "voting" && <VotingTab />}
                {activeTab === "preferences" && <PreferencesTab />}
                {activeTab === "integrations" && features.integrations && (
                    <IntegrationsTab />
                )}
            </div>
        </PageComponentLayout>
    );
}
