"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";
import { truncateMiddle } from "../format";

interface HexValueProps {
    value: string;
    /** Show the full value instead of the truncated middle form. */
    full?: boolean;
    href?: string | null;
    className?: string;
    head?: number;
    tail?: number;
}

/** Monospace identifier with copy button and optional explorer link. */
export function HexValue({
    value,
    full = false,
    href,
    className,
    head = 8,
    tail = 6,
}: HexValueProps) {
    const t = useTranslations("proposals.omni");
    const text = full ? value : truncateMiddle(value, head, tail);
    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 min-w-0 max-w-full",
                className,
            )}
        >
            <span
                className={cn(
                    "font-mono text-sm min-w-0",
                    full && "whitespace-normal break-all wrap-anywhere",
                )}
                title={value}
            >
                {text}
            </span>
            <CopyButton
                text={value}
                toastMessage={t("raw.copied")}
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 shrink-0"
                iconClassName="h-3 w-3"
            />
            {href && (
                <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label={t("openInExplorer")}
                >
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
            )}
        </span>
    );
}
