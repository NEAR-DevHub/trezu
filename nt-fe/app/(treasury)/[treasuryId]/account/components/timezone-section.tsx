"use client";

import { Time04Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/button";
import { PageCard } from "@/components/card";
import { MenuSelect } from "@/components/menu-select";
import {
    disabledActionClasses,
    SectionIcon,
    SectionText,
    sectionIconAccentClasses,
} from "@/components/settings-section";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
    saveUserPreferences,
    type UserPreferences,
    useUserPreferences,
} from "@/hooks/use-user-preferences";
import { buildTimezoneOptions, detectTimezone } from "@/lib/timezones";
import { cn } from "@/lib/utils";

/** Same 14px secondary label the rest of the section's copy uses. */
function FieldLabel({
    htmlFor,
    children,
}: {
    htmlFor: string;
    children: React.ReactNode;
}) {
    return (
        <Label
            htmlFor={htmlFor}
            className="text-sm font-medium leading-[1.5] text-general-secondary-foreground"
        >
            {children}
        </Label>
    );
}

/**
 * Time format and time zone. Both are browser-local preferences, so the card
 * saves to local storage rather than the treasury backend; `FormattedDate`
 * picks the change up on the same tick.
 */
export function TimezoneSection() {
    const t = useTranslations("account");
    const preferences = useUserPreferences();
    const [draft, setDraft] = useState<UserPreferences>(preferences);

    // `preferences` only changes identity when the stored value does, so this
    // seeds the draft after hydration and re-seeds it after every save.
    useEffect(() => {
        setDraft(preferences);
    }, [preferences]);

    const timeFormatOptions = useMemo(
        () => [
            { value: "12", label: t("timeFormat12") },
            { value: "24", label: t("timeFormat24") },
        ],
        [t],
    );

    // While "automatic" is on the field shows the browser's zone; the pinned
    // one is only revealed once the switch is off.
    const shownTimezone = draft.autoTimezone
        ? detectTimezone()
        : (draft.timezone ?? detectTimezone());
    const timezoneOptions = useMemo(
        () => buildTimezoneOptions(shownTimezone),
        [shownTimezone],
    );

    const isDirty =
        draft.timeFormat !== preferences.timeFormat ||
        draft.autoTimezone !== preferences.autoTimezone ||
        (!draft.autoTimezone && draft.timezone !== preferences.timezone);

    const handleSave = () => {
        saveUserPreferences({
            timeFormat: draft.timeFormat,
            autoTimezone: draft.autoTimezone,
            timezone: draft.autoTimezone ? null : shownTimezone,
        });
        toast.success(t("saveSuccess"));
    };

    return (
        <PageCard className="flex-row gap-3 rounded-3xl">
            <SectionIcon
                icon={Time04Icon}
                className={sectionIconAccentClasses}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="flex flex-col gap-3">
                    <SectionText
                        title={t("timezoneTitle")}
                        description={t("timezoneDescription")}
                    />

                    <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="time-format">
                            {t("timeFormatLabel")}
                        </FieldLabel>
                        <MenuSelect
                            id="time-format"
                            value={draft.timeFormat}
                            options={timeFormatOptions}
                            onValueChange={(value) =>
                                setDraft((current) => ({
                                    ...current,
                                    timeFormat: value === "24" ? "24" : "12",
                                }))
                            }
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="timezone">
                            {t("timezoneLabel")}
                        </FieldLabel>
                        <MenuSelect
                            id="timezone"
                            value={shownTimezone}
                            options={timezoneOptions}
                            disabled={draft.autoTimezone}
                            searchPlaceholder={t("timezoneSearchPlaceholder")}
                            emptyMessage={t("timezoneNoResults")}
                            onValueChange={(value) =>
                                setDraft((current) => ({
                                    ...current,
                                    timezone: value,
                                }))
                            }
                        />
                        <div className="flex items-start gap-2 pt-1">
                            <Switch
                                id="auto-timezone"
                                checked={draft.autoTimezone}
                                onCheckedChange={(checked) =>
                                    setDraft((current) => ({
                                        ...current,
                                        autoTimezone: checked,
                                        // Keep the zone on screen when pinning it,
                                        // so the field doesn't jump on toggle.
                                        timezone: checked
                                            ? current.timezone
                                            : shownTimezone,
                                    }))
                                }
                                className="mt-0.5"
                            />
                            <Label
                                htmlFor="auto-timezone"
                                className="block text-sm font-normal leading-[1.5] tracking-[0.07px] text-general-unofficial-ghost-foreground"
                            >
                                {t("timezoneAuto")}
                            </Label>
                        </div>
                    </div>
                </div>

                <div className="flex items-center">
                    <Button
                        type="button"
                        className={cn(
                            "h-10 px-4 text-sm leading-none",
                            disabledActionClasses,
                        )}
                        onClick={handleSave}
                        disabled={!isDirty}
                    >
                        {t("save")}
                    </Button>
                </div>
            </div>
        </PageCard>
    );
}
