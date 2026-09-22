"use client";

import { useTranslations } from "next-intl";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { Pill } from "@/components/pill";
import { WarningAlert } from "@/components/warning-alert";
import { explorerAddressUrl, type ResolvedChain } from "../chains";
import { formatBaseUnits } from "../format";
import type { TonTransaction } from "../ton/recompute";
import type { NearNetwork } from "../types";
import { HexValue } from "./hex-value";

interface TonTxViewProps {
    tx: TonTransaction;
    chain: ResolvedChain | null;
    network: NearNetwork;
    /** Wallet address derived from the MPC key with the envelope's wallet
     * parameters, when the derived key has been fetched. */
    walletAddress: string | null;
}

/** Text comment body: opcode 0 (32 bits) followed by UTF-8. */
function commentFromBody(
    body: TonTransaction["messages"][number]["body"],
): string | null {
    if (
        !body ||
        body.bitLen < 32 ||
        body.bitLen % 8 !== 0 ||
        body.refs.length > 0
    )
        return null;
    if (body.readUint(0, 32) !== 0n) return null;
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(
            body.data.slice(4),
        );
    } catch {
        return null;
    }
}

export function TonTxView({
    tx,
    chain,
    network,
    walletAddress,
}: TonTxViewProps) {
    const t = useTranslations("proposals.omni");
    const symbol = chain?.symbol ?? "TON";
    const decimals = chain?.decimals ?? 9;
    const testnet = network === "testnet";
    const validUntilMs = tx.validUntil * 1000;
    const expired = validUntilMs <= Date.now();
    const total = tx.messages.reduce((sum, m) => sum + m.valueNanotons, 0n);

    const items: InfoItem[] = [
        {
            label: t("ton.messages"),
            value: t("ton.messageCount", { count: tx.messages.length }),
            afterValue: (
                <ol className="flex flex-col gap-2">
                    {tx.messages.map((message, index) => {
                        const bounceable = message.dest.toUserFriendly(
                            true,
                            testnet,
                        );
                        const nonBounceable = message.dest.toUserFriendly(
                            false,
                            testnet,
                        );
                        const comment = commentFromBody(message.body);
                        return (
                            <li
                                key={`${message.destText}-${index}`}
                                className="rounded-md border p-3 flex flex-col gap-1.5 text-sm"
                            >
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="font-medium">
                                        {formatBaseUnits(
                                            message.valueNanotons,
                                            decimals,
                                        )}{" "}
                                        {symbol}
                                    </span>
                                    <span className="flex items-center gap-1">
                                        <Pill
                                            variant="secondary"
                                            title={
                                                message.bounce
                                                    ? t("ton.bounceable")
                                                    : t("ton.nonBounceable")
                                            }
                                        />
                                        <Pill
                                            variant="secondary"
                                            title={t("ton.mode", {
                                                mode: message.mode,
                                            })}
                                        />
                                    </span>
                                </div>
                                <div className="flex flex-col gap-0.5 text-xs">
                                    <span className="text-muted-foreground">
                                        {t("generic.to")}
                                    </span>
                                    <HexValue
                                        value={bounceable}
                                        full
                                        href={
                                            chain
                                                ? explorerAddressUrl(
                                                      chain,
                                                      bounceable,
                                                  )
                                                : null
                                        }
                                    />
                                    <span className="text-muted-foreground font-mono break-all">
                                        {t("ton.nonBounceableForm")}:{" "}
                                        {nonBounceable}
                                    </span>
                                </div>
                                <div className="text-xs">
                                    <span className="text-muted-foreground">
                                        {t("ton.body")}:{" "}
                                    </span>
                                    {message.body === null ? (
                                        <span>{t("ton.noBody")}</span>
                                    ) : comment !== null ? (
                                        <span className="break-words">
                                            {t("ton.comment")} “{comment}”
                                        </span>
                                    ) : (
                                        <span className="font-mono">
                                            {t("ton.binaryBody", {
                                                bits: message.body.bitLen,
                                                refs: message.body.refs.length,
                                            })}
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            ),
        },
        {
            label: t("ton.total"),
            value: (
                <span>
                    {formatBaseUnits(total, decimals)} {symbol}
                </span>
            ),
        },
        {
            label: t("ton.wallet"),
            value: (
                <span className="font-mono">
                    {tx.walletVersion} · {t("ton.walletId")} {tx.walletId} · wc{" "}
                    {tx.workchain}
                </span>
            ),
        },
        {
            label: t("ton.seqno"),
            value: <span className="font-mono">{tx.seqno}</span>,
        },
        {
            label: t("ton.validUntil"),
            value: (
                <span className={expired ? "text-red-600 font-semibold" : ""}>
                    {new Date(validUntilMs)
                        .toISOString()
                        .replace("T", " ")
                        .slice(0, 19)}{" "}
                    UTC
                    {expired && ` · ${t("aptos.expired")}`}
                </span>
            ),
        },
        {
            label: t("ton.deploy"),
            value: tx.deploy ? t("ton.deployYes") : t("ton.deployNo"),
        },
    ];
    if (walletAddress) {
        items.push({
            label: t("ton.walletAddress"),
            value: (
                <HexValue
                    value={walletAddress}
                    full
                    href={
                        chain ? explorerAddressUrl(chain, walletAddress) : null
                    }
                />
            ),
        });
    }

    return (
        <div className="flex flex-col gap-3">
            <InfoDisplay items={items} />
            {expired && <WarningAlert message={t("ton.expiredWarning")} />}
            {tx.deploy && tx.seqno !== 0 && (
                <WarningAlert message={t("ton.deployRedundant")} />
            )}
            {!tx.deploy && tx.seqno === 0 && (
                <WarningAlert message={t("ton.deployMissing")} />
            )}
        </div>
    );
}
