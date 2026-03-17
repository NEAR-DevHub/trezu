"use client";

import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/underline-tabs";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface TabItem {
    value: string;
    label: React.ReactNode;
    /** Extra content rendered only in the tab trigger on desktop (e.g. badge). Hidden in select. */
    trigger?: React.ReactNode;
    /** Plain-text label override used in the mobile Select (e.g. "Pending 3"). Falls back to label. */
    selectLabel?: string;
}

interface ResponsiveTabsProps {
    tabs: TabItem[];
    value: string;
    onValueChange: (value: string) => void;
    children?: React.ReactNode;
    /** Extra content placed to the right of the tabs/select (e.g. search + filter buttons) */
    actions?: React.ReactNode;
    /** When true, hides the tabs/actions header row */
    hideHeader?: boolean;
    className?: string;

    alignSelect?: "start" | "end";
}

/**
 * On md+ screens renders standard underline Tabs.
 * On small screens replaces the tab list with a Select dropdown.
 * `actions` is always rendered beside the tabs/select.
 */
export function ResponsiveTabs({
    tabs,
    value,
    onValueChange,
    children,
    actions,
    hideHeader,
    className,
}: ResponsiveTabsProps) {
    const currentTab = tabs.find((t) => t.value === value);
    const currentLabel = currentTab?.label ?? value;
    const currentTrigger = currentTab?.trigger;

    return (
        <Tabs
            value={value}
            onValueChange={onValueChange}
            className={cn("gap-0", className)}
        >
            <div
                className={cn(
                    "relative flex flex-row items-center justify-between border-b px-5 py-3.5 gap-2",
                    hideHeader && "hidden",
                )}
            >
                {/* Mobile: Select dropdown */}
                <div className="flex md:hidden shrink-0">
                    <Select value={value} onValueChange={onValueChange}>
                        <SelectTrigger className="border-0 h-auto gap-1.5 font-medium text-sm focus:ring-0 w-auto">
                            <span className="flex items-center gap-1.5">
                                {currentLabel}
                            </span>
                        </SelectTrigger>
                        <SelectContent align="start">
                            {tabs.map((tab) => (
                                <SelectItem key={tab.value} value={tab.value}>
                                    <span className="flex items-center gap-1.5">
                                        {tab.selectLabel ?? tab.label}
                                        {tab.value !== value && tab.trigger}
                                    </span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Desktop: Underline tab list */}
                <div className="hidden md:flex w-full">
                    <TabsList className="border-none">
                        {tabs.map((tab) => (
                            <TabsTrigger
                                key={tab.value}
                                value={tab.value}
                                className="flex gap-2.5"
                            >
                                {tab.label}
                                {tab.trigger}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                {actions && (
                    <div className="flex justify-end w-full gap-2 min-w-0">
                        {actions}
                    </div>
                )}
            </div>

            {children}
        </Tabs>
    );
}

export { TabsContent };
