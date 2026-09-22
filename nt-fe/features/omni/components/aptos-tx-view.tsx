"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { WarningAlert } from "@/components/warning-alert";
import { type DecodedAptosTx, fetchAptosSequenceNumber } from "../aptos/decode";
import { explorerAddressUrl, type ResolvedChain } from "../chains";
import { formatBaseUnits } from "../format";
import { HexValue } from "./hex-value";
import { JsonBlock } from "./json-tree";

interface AptosTxViewProps {
    tx: DecodedAptosTx;
    chain: ResolvedChain | null;
    /** Sequence-number staleness lookup only matters while pending. */
    isPending: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function AptosTxView({ tx, chain, isPending }: AptosTxViewProps) {
    const t = useTranslations("proposals.omni");
    const symbol = chain?.symbol ?? "APT";
    const decimals = chain?.decimals ?? 8;
    const link = (address: string) =>
        chain ? explorerAddressUrl(chain, address) : null;

    const sequence = useQuery<bigint>({
        queryKey: [
            "omni-aptos-sequence",
            chain?.key,
            chain?.network,
            tx.sender,
        ],
        queryFn: () => {
            if (!chain) throw new Error("sequence lookup not enabled");
            return fetchAptosSequenceNumber(chain.rpcUrl, tx.sender);
        },
        enabled: isPending && !!chain && chain.family === "aptos",
        staleTime: 30_000,
        retry: 1,
    });

    const expiryMs = Number(tx.expirationTimestampSecs) * 1000;
    const expiryDate = new Date(expiryMs);
    const daysLeft = Math.floor((expiryMs - Date.now()) / DAY_MS);
    const expired = expiryMs <= Date.now();

    let summary: string | null = null;
    switch (tx.known?.kind) {
        case "apt-transfer":
            summary = t("aptos.aptTransfer", {
                amount: formatBaseUnits(tx.known.octas, decimals),
                symbol,
                to: tx.known.to,
            });
            break;
        case "coin-transfer":
            summary = tx.known.isApt
                ? t("aptos.aptTransfer", {
                      amount: formatBaseUnits(tx.known.amount, decimals),
                      symbol,
                      to: tx.known.to,
                  })
                : t("aptos.coinTransfer", {
                      amount: tx.known.amount.toString(),
                      coinType: tx.known.coinType,
                      to: tx.known.to,
                  });
            break;
        case "fa-transfer":
            summary = tx.known.isApt
                ? t("aptos.aptTransfer", {
                      amount: formatBaseUnits(tx.known.amount, decimals),
                      symbol,
                      to: tx.known.to,
                  })
                : t("aptos.faTransfer", {
                      amount: tx.known.amount.toString(),
                      metadata: tx.known.metadata,
                      to: tx.known.to,
                  });
            break;
        default:
            summary = null;
    }

    const items: InfoItem[] = [];
    if (summary) {
        items.push({
            label: t("aptos.action"),
            value: <span className="font-medium break-all">{summary}</span>,
        });
    }
    items.push(
        {
            label: t("generic.sender"),
            value: <HexValue value={tx.sender} full href={link(tx.sender)} />,
        },
        {
            label: t("generic.function"),
            value: (
                <code className="font-mono text-sm break-all">
                    {tx.functionId}
                    {tx.tyArgs.length > 0 && `<${tx.tyArgs.join(", ")}>`}
                </code>
            ),
        },
    );
    if (tx.args.length > 0) {
        items.push({
            label: t("generic.args"),
            value: t("aptos.argCount", { count: tx.args.length }),
            afterValue: (
                <ol className="flex flex-col gap-1 text-xs font-mono break-all wrap-anywhere">
                    {tx.args.map((arg, index) => {
                        const detail = tx.argDetails[index];
                        return (
                            <li key={`${index}-${arg}`}>
                                <span className="text-muted-foreground font-sans">
                                    #{index}{" "}
                                </span>
                                {arg}
                                {detail && (
                                    <span className="text-muted-foreground">
                                        {" · "}
                                        {detail.type}
                                        {detail.value !== arg &&
                                            ` ${detail.value}`}
                                        {detail.note && ` (${detail.note})`}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ol>
            ),
        });
    }
    items.push(
        {
            label: t("generic.sequenceNumber"),
            value: (
                <span className="font-mono">
                    {tx.sequenceNumber.toString()}
                </span>
            ),
        },
        {
            label: t("aptos.maxGas"),
            info: t("aptos.maxGasInfo"),
            value: (
                <span className="flex flex-col items-end">
                    <span>
                        {formatBaseUnits(tx.maxGasOctas, decimals)} {symbol}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        {tx.maxGasAmount.toString()} ×{" "}
                        {tx.gasUnitPrice.toString()} octas
                    </span>
                </span>
            ),
        },
        {
            label: t("generic.expiry"),
            value: (
                <span className={expired ? "text-red-600 font-semibold" : ""}>
                    {expiryDate.toISOString().replace("T", " ").slice(0, 19)}{" "}
                    UTC
                    {" · "}
                    {expired
                        ? t("aptos.expired")
                        : t("aptos.expiresIn", { days: Math.max(daysLeft, 0) })}
                </span>
            ),
        },
        {
            label: t("generic.chainId"),
            value: <span className="font-mono">{tx.chainId}</span>,
        },
    );

    let sequenceState: "used" | "gap" | "current" | null = null;
    if (isPending && sequence.data !== undefined) {
        sequenceState =
            sequence.data > tx.sequenceNumber
                ? "used"
                : sequence.data < tx.sequenceNumber
                  ? "gap"
                  : "current";
    }

    return (
        <div className="flex flex-col gap-3">
            <InfoDisplay items={items} />
            {isPending && (
                <p className="text-xs text-muted-foreground">
                    {t("aptos.assumesSequence", {
                        sequence: tx.sequenceNumber.toString(),
                    })}
                    {" · "}
                    {sequence.data !== undefined
                        ? t("aptos.currentSequence", {
                              sequence: sequence.data.toString(),
                          })
                        : sequence.isError
                          ? t("aptos.sequenceUnavailable")
                          : t("aptos.sequenceLoading")}
                </p>
            )}
            {sequenceState === "used" && (
                <WarningAlert
                    message={t("aptos.sequenceUsed", {
                        sequence: tx.sequenceNumber.toString(),
                    })}
                />
            )}
            {sequenceState === "gap" && sequence.data !== undefined && (
                <WarningAlert
                    message={t("aptos.sequenceAhead", {
                        sequence: tx.sequenceNumber.toString(),
                        current: sequence.data.toString(),
                    })}
                />
            )}
            {expired && <WarningAlert message={t("aptos.expiredWarning")} />}
            <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">
                    {t("generic.rawFields")}
                </summary>
                <JsonBlock
                    value={{
                        sender: tx.sender,
                        sequence_number: tx.sequenceNumber,
                        function: tx.functionId,
                        ty_args: tx.tyArgs,
                        args: tx.args,
                        max_gas_amount: tx.maxGasAmount,
                        gas_unit_price: tx.gasUnitPrice,
                        expiration_timestamp_secs: tx.expirationTimestampSecs,
                        chain_id: tx.chainId,
                    }}
                />
            </details>
        </div>
    );
}
