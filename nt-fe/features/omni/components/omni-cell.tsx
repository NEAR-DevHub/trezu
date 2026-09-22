"use client";

import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/tooltip";
import { TitleSubtitleCell } from "@/features/proposals/components/transaction-cell/title-subtitle-cell";
import { cn } from "@/lib/utils";
import { resolveChain } from "../chains";
import { parseEvmUnsignedTx } from "../evm/sighash";
import { capText, formatBaseUnits, truncateMiddle } from "../format";
import { decodeSvmUnsignedTx } from "../svm/decode";
import type { OmniProposalData, VerificationStatus } from "../types";
import { decodeUtxoUnsignedTx } from "../utxo/decode";

interface OmniCellProps {
    data: OmniProposalData;
    timestamp?: string;
    textOnly?: boolean;
}

const DOT_CLASSES: Record<VerificationStatus, string> = {
    verified: "bg-general-success-foreground",
    mismatch: "bg-red-600",
    unverified: "bg-general-warning-foreground",
};

export function OmniVerificationDot({
    status,
    className,
}: {
    status: VerificationStatus;
    className?: string;
}) {
    const t = useTranslations("proposals.omni");
    return (
        <Tooltip content={t(`status.${status}`)}>
            <span
                role="img"
                data-testid={`omni-dot-${status}`}
                className={cn(
                    "inline-block h-2.5 w-2.5 rounded-full shrink-0",
                    DOT_CLASSES[status],
                    className,
                )}
                aria-label={t(`status.${status}`)}
            />
        </Tooltip>
    );
}

/**
 * One-line list summary: verification dot, chain badge, intent, target and
 * value. Sync only: everything here comes from the proposal itself.
 */
export function OmniCell({ data, timestamp, textOnly = false }: OmniCellProps) {
    const t = useTranslations("proposals.omni");
    const { parsed, verification, network } = data;
    const envelope = parsed.ok ? parsed.envelope : parsed.partial;
    const chain = envelope?.chain
        ? resolveChain(envelope.chain, network)
        : null;
    const chainLabel = chain?.displayName ?? envelope?.chain ?? t("unknown");
    const intent = envelope?.intent?.trim()
        ? capText(envelope.intent.trim(), 200)
        : t("header.noIntent");

    const summaryParts: string[] = [];
    if (parsed.ok) {
        const family = parsed.envelope.family;
        const unsignedTx = parsed.envelope.unsigned_tx;
        if (family === "evm") {
            const tx = parseEvmUnsignedTx(unsignedTx);
            if (tx.ok) {
                summaryParts.push(
                    t("cell.to", { to: truncateMiddle(tx.tx.to) }),
                );
                if (tx.tx.value > 0n) {
                    summaryParts.push(
                        `${formatBaseUnits(tx.tx.value, chain?.decimals ?? 18)} ${chain?.symbol ?? "ETH"}`,
                    );
                }
            }
        } else if (family === "svm") {
            const decoded = decodeSvmUnsignedTx(unsignedTx);
            if (decoded) {
                summaryParts.push(
                    t("svm.instructionCount", {
                        count: decoded.instructions.length,
                    }),
                );
            }
        } else if (family === "utxo") {
            const decoded = decodeUtxoUnsignedTx(unsignedTx, network);
            if (decoded) {
                summaryParts.push(
                    `${formatBaseUnits(decoded.totalOutSats, chain?.decimals ?? 8)} ${chain?.symbol ?? "BTC"}`,
                );
            }
        }
    }

    const title = (
        <span className="flex items-center gap-2 min-w-0">
            {!textOnly && <OmniVerificationDot status={verification.status} />}
            <span className="truncate">{intent}</span>
        </span>
    );
    const subtitleText = [chainLabel, ...summaryParts].join(" · ");
    // Colour alone is not accessible: a MISMATCH is also spelled out, in
    // both the rich and the text-only cell.
    const subtitle =
        verification.status === "mismatch" ? (
            textOnly ? (
                `${t("status.mismatch")} · ${subtitleText}`
            ) : (
                <span className="flex items-center gap-1.5 min-w-0">
                    <span
                        className="shrink-0 rounded px-1.5 py-px text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white"
                        data-testid="omni-cell-mismatch"
                    >
                        {t("status.mismatch")}
                    </span>
                    <span className="truncate">{subtitleText}</span>
                </span>
            )
        ) : (
            subtitleText
        );

    return (
        <TitleSubtitleCell
            title={title}
            subtitle={subtitle}
            timestamp={timestamp}
        />
    );
}
