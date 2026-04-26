"use client";

import { Check, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALE_COOKIE, type Locale, locales } from "@/i18n/config";
import { cn } from "@/lib/utils";

const labelKeyByLocale: Record<Locale, string> = {
    en: "english",
    es: "spanish",
    uk: "ukrainian",
    he: "hebrew",
    de: "german",
    fr: "french",
    vi: "vietnamese",
    zh: "chinese",
    tr: "turkish",
    id: "indonesian",
    pt: "portuguese",
    ja: "japanese",
    ko: "korean",
};

interface LanguageSwitcherProps {
    align?: "start" | "end" | "center";
    className?: string;
    variant?: "ghost" | "outline";
}

export function LanguageSwitcher({
    align = "end",
    className,
    variant = "ghost",
}: LanguageSwitcherProps) {
    const locale = useLocale() as Locale;
    const t = useTranslations("languageSwitcher");
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const handleSelect = (next: Locale) => {
        if (next === locale) return;
        const maxAge = 60 * 60 * 24 * 365;
        const isSecure =
            typeof window !== "undefined" &&
            window.location.protocol === "https:";
        const secureAttr = isSecure ? "; Secure" : "";
        // biome-ignore lint/suspicious/noDocumentCookie: locale cookie is read synchronously by the Next.js request config on the next navigation, so a client-side cookie write is the simplest path
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${maxAge}; samesite=lax${secureAttr}`;
        startTransition(() => {
            router.refresh();
        });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant={variant}
                    size="icon"
                    aria-label={t("select")}
                    disabled={isPending}
                    className={cn(
                        "h-9 w-9 hover:bg-muted text-muted-foreground hover:text-foreground",
                        className,
                    )}
                >
                    <Languages className="h-5 w-5" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="min-w-[160px]">
                {locales.map((code) => (
                    <DropdownMenuItem
                        key={code}
                        onSelect={() => handleSelect(code)}
                        className="flex items-center justify-between gap-2"
                    >
                        <span>{t(labelKeyByLocale[code])}</span>
                        {code === locale && <Check className="h-4 w-4" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
