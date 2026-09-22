"use client";

import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/alert";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { Pill } from "@/components/pill";
import { WarningAlert } from "@/components/warning-alert";
import { explorerAddressUrl, type ResolvedChain } from "../chains";
import { formatBaseUnits } from "../format";
import type { DecodedSuiTx } from "../sui/decode";
import { HexValue } from "./hex-value";

interface SuiTxViewProps {
    tx: DecodedSuiTx;
    chain: ResolvedChain | null;
}

export function SuiTxView({ tx, chain }: SuiTxViewProps) {
    const t = useTranslations("proposals.omni");
    const symbol = chain?.symbol ?? "SUI";
    const decimals = chain?.decimals ?? 9;
    const link = (address: string) =>
        chain ? explorerAddressUrl(chain, address) : null;

    const items: InfoItem[] = [];
    if (tx.transfers.length > 0) {
        items.push({
            label: t("aptos.action"),
            value: (
                <span className="flex flex-col items-end gap-0.5">
                    {tx.transfers.map((transfer, index) => (
                        <span
                            key={`${transfer.to}-${index}`}
                            className="font-medium break-all"
                        >
                            {t("sui.transfer", {
                                amount: formatBaseUnits(
                                    transfer.mist,
                                    decimals,
                                ),
                                symbol,
                                to: transfer.to,
                            })}
                        </span>
                    ))}
                </span>
            ),
        });
    }
    items.push(
        {
            label: t("generic.sender"),
            value: <HexValue value={tx.sender} full href={link(tx.sender)} />,
        },
        {
            label: t("generic.commands"),
            value: t("sui.commandCount", { count: tx.commands.length }),
            afterValue: (
                <ol className="flex flex-col gap-1 text-xs font-mono break-all">
                    {tx.commands.map((command, index) => (
                        <li key={`${index}-${command}`}>
                            <span className="text-muted-foreground font-sans">
                                #{index}{" "}
                            </span>
                            {command}
                        </li>
                    ))}
                </ol>
            ),
        },
        {
            label: t("generic.inputs"),
            value: tx.inputs.length,
            afterValue: (
                <ol className="flex flex-col gap-1 text-xs font-mono break-all">
                    {tx.inputs.map((input, index) => (
                        <li key={`${index}-${input}`}>
                            <span className="text-muted-foreground font-sans">
                                #{index}{" "}
                            </span>
                            {input}
                        </li>
                    ))}
                </ol>
            ),
        },
        {
            label: t("generic.gasBudget"),
            value: (
                <span className="flex flex-col items-end">
                    <span>
                        {formatBaseUnits(tx.gasBudget, decimals)} {symbol}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        {t("sui.gasPriceMist", {
                            price: tx.gasPrice.toString(),
                        })}
                    </span>
                </span>
            ),
        },
        {
            label: t("generic.gasPayment"),
            value: (
                <span className="flex items-center gap-1">
                    {tx.gasPayment.length}
                    <Pill variant="secondary" title={t("sui.gasMayBeStale")} />
                </span>
            ),
            afterValue: (
                <ul className="flex flex-col gap-1 text-xs font-mono break-all">
                    {tx.gasPayment.map((payment) => (
                        <li key={payment.objectId}>
                            {payment.objectId} v{payment.version.toString()} ·{" "}
                            {payment.digest}
                        </li>
                    ))}
                </ul>
            ),
        },
        {
            label: t("generic.expiry"),
            value: <span className="font-mono">{tx.expiration}</span>,
        },
    );
    if (tx.gasOwner !== tx.sender) {
        items.push({
            label: t("sui.gasOwner"),
            value: (
                <HexValue value={tx.gasOwner} full href={link(tx.gasOwner)} />
            ),
        });
    }

    return (
        <div className="flex flex-col gap-3">
            <InfoDisplay items={items} />
            {tx.hasSharedObjects && (
                <WarningAlert message={t("sui.sharedObjects")} />
            )}
            {tx.gasOwner !== tx.sender && (
                <Alert
                    variant="destructive"
                    role="alert"
                    className="items-start"
                >
                    <AlertDescription>{t("sui.sponsoredGas")}</AlertDescription>
                </Alert>
            )}
        </div>
    );
}
