"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/modal";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ALL_CONSENT, type ConsentPreferences } from "@/lib/cookie-consent";
import { useCookieConsentStore } from "@/stores/cookie-consent-store";

interface ConsentRowProps {
    id: string;
    title: string;
    body: string;
    checked: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean) => void;
}

function ConsentRow({
    id,
    title,
    body,
    checked,
    disabled,
    onCheckedChange,
}: ConsentRowProps) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
                <Label htmlFor={id} className="text-sm font-semibold">
                    {title}
                </Label>
                <p className="text-sm text-muted-foreground">{body}</p>
            </div>
            <Switch
                id={id}
                checked={checked}
                disabled={disabled}
                onCheckedChange={onCheckedChange}
                className="mt-0.5 shrink-0"
            />
        </div>
    );
}

export function CookiePreferencesDialog() {
    const t = useTranslations("cookieConsent");
    const open = useCookieConsentStore((s) => s.preferencesOpen);
    const preferences = useCookieConsentStore((s) => s.preferences);
    const save = useCookieConsentStore((s) => s.save);
    const closePreferences = useCookieConsentStore((s) => s.closePreferences);
    const [draft, setDraft] = useState<ConsentPreferences>(ALL_CONSENT);

    useEffect(() => {
        if (open) setDraft(preferences ?? ALL_CONSENT);
    }, [open, preferences]);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) closePreferences();
            }}
        >
            <DialogContent className="sm:max-w-md!">
                <DialogHeader>
                    <DialogTitle className="text-left">
                        {t("title")}
                    </DialogTitle>
                </DialogHeader>

                <DialogDescription className="text-sm text-muted-foreground">
                    {t("intro")}
                </DialogDescription>

                <div className="space-y-5">
                    <ConsentRow
                        id="cookie-consent-essential"
                        title={t("essentialTitle")}
                        body={t("essentialBody")}
                        checked
                        disabled
                    />
                    <ConsentRow
                        id="cookie-consent-personalization"
                        title={t("personalizationTitle")}
                        body={t("personalizationBody")}
                        checked={draft.personalization}
                        onCheckedChange={(personalization) =>
                            setDraft((d) => ({ ...d, personalization }))
                        }
                    />
                    <ConsentRow
                        id="cookie-consent-analytics"
                        title={t("analyticsTitle")}
                        body={t("analyticsBody")}
                        checked={draft.analytics}
                        onCheckedChange={(analytics) =>
                            setDraft((d) => ({ ...d, analytics }))
                        }
                    />
                </div>

                <DialogFooter>
                    <Button
                        className="w-full text-[14px] leading-none"
                        onClick={() => save(draft)}
                    >
                        {t("save")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
