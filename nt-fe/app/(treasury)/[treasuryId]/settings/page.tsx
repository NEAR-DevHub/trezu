"use client";

import { useState } from "react";
import { PageComponentLayout } from "@/components/page-component-layout";
import { TabGroup } from "@/components/tab-group";
import { GeneralTab } from "./components/general-tab";
import { IntegrationsTab } from "./components/integrations-tab";
import { PreferencesTab } from "./components/preferences-tab";
import { VotingTab } from "./components/voting-tab";

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("general");

    const tabs = [
        { value: "general", label: "General" },
        { value: "voting", label: "Voting" },
        { value: "preferences", label: "Preferences" },
        { value: "integrations", label: "Integrations" },
    ];

    return (
        <PageComponentLayout
            title="Settings"
            description="Adjust your application settings"
        >
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
                {activeTab === "integrations" && <IntegrationsTab />}
            </div>
        </PageComponentLayout>
    );
}
