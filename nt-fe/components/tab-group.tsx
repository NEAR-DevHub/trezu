"use client";

import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Pill } from "@/components/pill";

interface Tab {
    value: string;
    label: string;
    count?: number;
    /** Renders the same “New” info pill as sidebar nav (e.g. address book). */
    showNewPill?: boolean;
}

interface TabGroupProps {
    tabs: Tab[];
    activeTab: string;
    onTabChange: (value: string) => void;
}

const toggleGroupItemStyle =
    "min-h-8 h-auto py-1 !rounded-lg px-3 text-sm font-medium transition-all data-[state=off]:bg-transparent data-[state=off]:text-foreground data-[state=off]:hover:text-foreground/80 data-[state=off]:hover:bg-muted data-[state=on]:!bg-primary data-[state=on]:!text-primary-foreground data-[state=on]:shadow-none data-[state=on]:!rounded-lg";

export function TabGroup({ tabs, activeTab, onTabChange }: TabGroupProps) {
    const tNew = useTranslations("newBadge");

    return (
        <div className="inline-flex items-center gap-1 rounded-lg bg-card border shadow-sm p-1">
            <ToggleGroup
                type="single"
                value={activeTab}
                onValueChange={(value) => value && onTabChange(value)}
                className="flex gap-1"
            >
                {tabs.map((tab) => (
                    <ToggleGroupItem
                        key={tab.value}
                        value={tab.value}
                        className={toggleGroupItemStyle}
                    >
                        <span className="inline-flex items-center gap-1.5">
                            <span>{tab.label}</span>
                            {tab.showNewPill && (
                                <Pill
                                    variant="info"
                                    title={tNew("label")}
                                    className="px-1.5 py-0.5 text-xs shrink-0 pointer-events-none"
                                />
                            )}
                        </span>
                        {tab.count !== undefined && (
                            <>
                                {" "}
                                <span
                                    className={`px-2 py-0.5 rounded-lg text-xs ${
                                        activeTab === tab.value
                                            ? "bg-background/30 dark:bg-background/30"
                                            : "bg-black/20 dark:bg-white/30"
                                    }`}
                                >
                                    {tab.count}
                                </span>
                            </>
                        )}
                    </ToggleGroupItem>
                ))}
            </ToggleGroup>
        </div>
    );
}
