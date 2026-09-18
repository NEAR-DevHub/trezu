"use client";

import { useTranslations } from "next-intl";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

interface CliHintProps {
    command: string;
    className?: string;
}

/** A shell command in a code block with a copy button. */
export function CliHint({ command, className }: CliHintProps) {
    const t = useTranslations("proposals.omni");
    return (
        <div
            className={cn(
                "flex items-center gap-2 rounded-md bg-black/80 text-white dark:bg-black/60 px-3 py-2",
                className,
            )}
        >
            <code className="text-xs font-mono break-all flex-1 select-all">
                {command}
            </code>
            <CopyButton
                text={command}
                toastMessage={t("raw.copied")}
                variant="ghost"
                size="icon-sm"
                className="text-white hover:text-white hover:bg-white/10 shrink-0"
            />
        </div>
    );
}
