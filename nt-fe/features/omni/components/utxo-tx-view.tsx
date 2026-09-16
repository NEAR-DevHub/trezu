"use client";

import { useTranslations } from "next-intl";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { Pill } from "@/components/pill";
import { WarningAlert } from "@/components/warning-alert";
import {
    explorerAddressUrl,
    explorerTxUrl,
    type ResolvedChain,
} from "../chains";
import { formatBaseUnits } from "../format";
import type { DecodedUtxoTx } from "../utxo/decode";
import { HexValue } from "./hex-value";

interface UtxoTxViewProps {
    tx: DecodedUtxoTx;
    chain: ResolvedChain | null;
}

export function UtxoTxView({ tx, chain }: UtxoTxViewProps) {
    const t = useTranslations("proposals.omni");
    const symbol = chain?.symbol ?? "BTC";
    const decimals = chain?.decimals ?? 8;
    const amount = (sats: bigint) => (
        <span className="flex flex-col items-end">
            <span>
                {formatBaseUnits(sats, decimals)} {symbol}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
                {sats.toString()} sats
            </span>
        </span>
    );

    const items: InfoItem[] = [
        {
            label: t("utxo.inputs"),
            value: tx.inputs.length,
            afterValue: (
                <ul className="flex flex-col gap-1 text-xs">
                    {tx.inputs.map((input, index) => (
                        <li
                            key={`${input.txid}-${input.vout}-${index}`}
                            className="flex items-center justify-between gap-2 flex-wrap rounded-md border p-2"
                        >
                            <span className="flex items-center gap-1">
                                <HexValue
                                    value={input.txid}
                                    href={
                                        chain
                                            ? explorerTxUrl(chain, input.txid)
                                            : null
                                    }
                                />
                                <span className="font-mono">:{input.vout}</span>
                            </span>
                            <span className="font-mono">
                                {input.valueSats !== null
                                    ? `${formatBaseUnits(input.valueSats, decimals)} ${symbol}`
                                    : t("unknown")}
                            </span>
                        </li>
                    ))}
                </ul>
            ),
        },
        {
            label: t("utxo.outputs"),
            value: tx.outputs.length,
            afterValue: (
                <ul className="flex flex-col gap-1 text-xs">
                    {tx.outputs.map((output, index) => (
                        <li
                            key={`${output.scriptPubkeyHex}-${index}`}
                            className="flex items-center justify-between gap-2 flex-wrap rounded-md border p-2"
                        >
                            {output.address ? (
                                <HexValue
                                    value={output.address}
                                    full
                                    href={
                                        chain
                                            ? explorerAddressUrl(
                                                  chain,
                                                  output.address,
                                              )
                                            : null
                                    }
                                />
                            ) : (
                                <span className="font-mono break-all">
                                    {t("utxo.unknownScript")}{" "}
                                    {output.scriptPubkeyHex}
                                </span>
                            )}
                            <span className="flex items-center gap-2 font-mono">
                                {output.isChange && (
                                    <Pill
                                        variant="info"
                                        title={t("utxo.change")}
                                    />
                                )}
                                {formatBaseUnits(output.valueSats, decimals)}{" "}
                                {symbol}
                            </span>
                        </li>
                    ))}
                </ul>
            ),
        },
        {
            label: t("utxo.fee"),
            value:
                tx.feeSats !== null ? (
                    <span className="flex flex-col items-end">
                        {amount(tx.feeSats)}
                        <span className="text-xs text-muted-foreground font-mono">
                            {t("utxo.feeRate", {
                                rate: (
                                    Number(tx.feeSats) / tx.estimatedVbytes
                                ).toFixed(1),
                                vbytes: tx.estimatedVbytes.toFixed(1),
                            })}
                        </span>
                    </span>
                ) : (
                    t("unknown")
                ),
        },
    ];
    if (tx.version !== null) {
        items.push({ label: t("utxo.version"), value: tx.version });
    }
    if (tx.lockTime !== null) {
        items.push({ label: t("utxo.lockTime"), value: tx.lockTime });
    }
    if (tx.senderPublicKeyHex) {
        items.push({
            label: t("utxo.senderPublicKey"),
            value: <HexValue value={tx.senderPublicKeyHex} />,
        });
    }
    return (
        <div className="flex flex-col gap-3">
            <InfoDisplay items={items} />
            {tx.feeSats !== null && tx.feeSats < 0n && (
                <WarningAlert message={t("utxo.negativeFee")} />
            )}
        </div>
    );
}
