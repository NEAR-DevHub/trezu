"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { prettyJson } from "../format";
import type { OmniProposalData } from "../types";
import { JsonBlock } from "./json-tree";
import { PAYLOAD_CODE_CLASS } from "./omni-checklist";

interface OmniRawSectionProps {
    data: OmniProposalData;
    rawDescription: string;
    /** Start expanded (used by static render tests). */
    defaultOpen?: boolean;
}

function RawBlock({
    title,
    text,
    children,
}: {
    title: string;
    text: string;
    children: React.ReactNode;
}) {
    const t = useTranslations("proposals.omni");
    return (
        <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{title}</span>
                <CopyButton
                    text={text}
                    toastMessage={t("raw.copied")}
                    variant="ghost"
                    size="icon-sm"
                    className="h-7 w-7"
                    iconClassName="h-3.5 w-3.5"
                />
            </div>
            {children}
        </div>
    );
}

export function OmniRawSection({
    data,
    rawDescription,
    defaultOpen = false,
}: OmniRawSectionProps) {
    const t = useTranslations("proposals.omni");
    const [open, setOpen] = useState(defaultOpen);
    const envelopeJson = data.parsed.ok
        ? prettyJson(data.parsed.envelope)
        : rawDescription;
    const builderVersion = data.parsed.ok
        ? data.parsed.envelope.meta.builder_version
        : data.parsed.partial?.meta?.builder_version;

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger
                className={cn(
                    "w-full flex justify-between items-center p-3 border rounded-lg text-sm",
                    open && "rounded-b-none",
                )}
                data-testid="omni-raw-toggle"
            >
                <span className="flex gap-2 items-center font-medium">
                    <ChevronDown
                        className={cn("w-4 h-4", open && "rotate-180")}
                    />
                    {t("raw.title")}
                </span>
                <span className="text-xs text-muted-foreground">
                    {t("raw.sizeBytes", { size: data.descriptionBytes })}
                    {builderVersion &&
                        ` · ${t("raw.builderVersion")} ${builderVersion}`}
                </span>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="flex flex-col gap-4 border border-t-0 rounded-b-lg p-3 min-w-0 max-w-full">
                    <RawBlock title={t("raw.envelope")} text={envelopeJson}>
                        {data.parsed.ok ? (
                            <JsonBlock value={data.parsed.envelope} />
                        ) : (
                            <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-all max-h-[420px]">
                                {rawDescription}
                            </pre>
                        )}
                    </RawBlock>
                    {data.actions.map((action) => (
                        <RawBlock
                            key={action.index}
                            title={t("raw.signArgs", {
                                index: action.index + 1,
                            })}
                            text={prettyJson(action.rawArgs)}
                        >
                            {action.argsDecodeError ? (
                                <p className="text-xs text-red-600">
                                    {t("raw.argsDecodeError")}
                                </p>
                            ) : (
                                <JsonBlock value={action.rawArgs} />
                            )}
                        </RawBlock>
                    ))}
                    {data.verification.proposalPayloadsHex.map(
                        (payload, index) => (
                            <RawBlock
                                key={payload}
                                title={
                                    data.verification.proposalPayloadsHex
                                        .length > 1
                                        ? `${t("raw.payload")} #${index + 1}`
                                        : t("raw.payload")
                                }
                                text={payload}
                            >
                                <code
                                    className={cn(
                                        PAYLOAD_CODE_CLASS,
                                        "rounded-md bg-muted/50 p-3",
                                    )}
                                    data-testid="omni-payload-hex"
                                >
                                    {payload}
                                </code>
                            </RawBlock>
                        ),
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
