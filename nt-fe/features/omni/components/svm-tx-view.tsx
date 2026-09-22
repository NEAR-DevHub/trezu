"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/alert";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { Pill } from "@/components/pill";
import { WarningAlert } from "@/components/warning-alert";
import { explorerAddressUrl, type ResolvedChain } from "../chains";
import { formatBaseUnits } from "../format";
import type { DecodedSvmTx } from "../svm/decode";
import { fetchSvmDurableNonce } from "../svm/recompute";
import { HexValue } from "./hex-value";

interface SvmTxViewProps {
    tx: DecodedSvmTx;
    chain: ResolvedChain | null;
    /** Durable-nonce staleness lookup only matters while pending. */
    isPending?: boolean;
}

export function SvmTxView({ tx, chain, isPending = false }: SvmTxViewProps) {
    const t = useTranslations("proposals.omni");
    const link = (address: string) =>
        chain ? explorerAddressUrl(chain, address) : null;
    const nonceAccount = tx.instructions[0]?.isNonceAdvance
        ? (tx.instructions[0].accounts[0]?.address ?? null)
        : null;
    const durableNonce = useQuery<string | null>({
        queryKey: ["omni-svm-nonce", chain?.key, chain?.network, nonceAccount],
        queryFn: () => {
            if (!chain || !nonceAccount)
                throw new Error("nonce lookup not enabled");
            return fetchSvmDurableNonce(chain.rpcUrl, nonceAccount);
        },
        enabled:
            isPending && !!chain && !!nonceAccount && chain.family === "svm",
        staleTime: 30_000,
        retry: 1,
    });
    let nonceState: "current" | "advanced" | "missing" | null = null;
    if (nonceAccount && durableNonce.data !== undefined) {
        nonceState =
            durableNonce.data === null
                ? "missing"
                : durableNonce.data === tx.recentBlockhash
                  ? "current"
                  : "advanced";
    }

    const items: InfoItem[] = [
        {
            label: t("svm.feePayer"),
            value: tx.feePayer ? (
                <HexValue value={tx.feePayer} full href={link(tx.feePayer)} />
            ) : (
                t("unknown")
            ),
        },
        {
            label: t("svm.recentBlockhash"),
            value: tx.recentBlockhash ? (
                <HexValue value={tx.recentBlockhash} />
            ) : (
                t("unknown")
            ),
        },
        {
            label: t("svm.messageVersion"),
            value: tx.version,
        },
        {
            label: t("svm.instructions"),
            value: (
                <span>
                    {t("svm.instructionCount", {
                        count: tx.instructions.length,
                    })}
                </span>
            ),
            afterValue: (
                <ol className="flex flex-col gap-2">
                    {tx.instructions.map((instruction, index) => (
                        <li
                            key={`${instruction.programId}-${index}`}
                            className="rounded-md border p-3 flex flex-col gap-2 text-sm"
                        >
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-muted-foreground">
                                    #{index + 1}
                                </span>
                                <span className="text-muted-foreground">
                                    {t("svm.program")}
                                </span>
                                <HexValue
                                    value={instruction.programId}
                                    href={link(instruction.programId)}
                                />
                                {instruction.isNonceAdvance && (
                                    <Pill
                                        variant="info"
                                        title={t("svm.nonceAdvance")}
                                    />
                                )}
                            </div>
                            {instruction.decoded?.kind ===
                                "system-transfer" && (
                                <p className="text-sm font-medium">
                                    {t("svm.systemTransfer", {
                                        amount: formatBaseUnits(
                                            instruction.decoded.lamports,
                                            chain?.decimals ?? 9,
                                        ),
                                        symbol: chain?.symbol ?? "SOL",
                                        from: instruction.decoded.from,
                                        to: instruction.decoded.to,
                                    })}
                                </p>
                            )}
                            {instruction.decoded?.kind === "spl-transfer" && (
                                <p className="text-sm font-medium">
                                    {t("svm.splTransfer", {
                                        amount:
                                            instruction.decoded.decimals ===
                                            null
                                                ? instruction.decoded.amount.toString()
                                                : formatBaseUnits(
                                                      instruction.decoded
                                                          .amount,
                                                      instruction.decoded
                                                          .decimals,
                                                  ),
                                        source: instruction.decoded.source,
                                        destination:
                                            instruction.decoded.destination,
                                    })}
                                </p>
                            )}
                            {instruction.accounts.length > 0 && (
                                <ul className="flex flex-col gap-1">
                                    {instruction.accounts.map(
                                        (account, accountIndex) => (
                                            <li
                                                key={`${account.address}-${accountIndex}`}
                                                className="flex items-center gap-2 flex-wrap text-xs"
                                            >
                                                {account.fromLookupTable ? (
                                                    <span className="font-mono text-muted-foreground">
                                                        {account.address}
                                                    </span>
                                                ) : (
                                                    <HexValue
                                                        value={account.address}
                                                        href={link(
                                                            account.address,
                                                        )}
                                                    />
                                                )}
                                                {account.isSigner && (
                                                    <Pill
                                                        variant="secondary"
                                                        title={t("svm.signer")}
                                                    />
                                                )}
                                                <Pill
                                                    variant="secondary"
                                                    title={
                                                        account.isWritable
                                                            ? t("svm.writable")
                                                            : t("svm.readonly")
                                                    }
                                                />
                                            </li>
                                        ),
                                    )}
                                </ul>
                            )}
                            <div className="text-xs">
                                <span className="text-muted-foreground">
                                    {t("svm.data")}:{" "}
                                </span>
                                <code className="font-mono break-all">
                                    {instruction.dataHex}
                                </code>
                            </div>
                        </li>
                    ))}
                </ol>
            ),
        },
    ];

    return (
        <div className="flex flex-col gap-3">
            <InfoDisplay items={items} />
            {tx.numRequiredSignatures !== null &&
                tx.numRequiredSignatures !== 1 && (
                    <WarningAlert
                        message={t("svm.signatureCountWarning", {
                            count: tx.numRequiredSignatures,
                        })}
                    />
                )}
            {nonceState === "current" && (
                <p className="text-xs text-general-success-foreground">
                    {t("svm.nonceCurrent")}
                </p>
            )}
            {nonceState === "advanced" && (
                <Alert
                    variant="destructive"
                    role="alert"
                    className="items-start"
                >
                    <AlertDescription>
                        {t("svm.nonceAdvanced")}
                    </AlertDescription>
                </Alert>
            )}
            {nonceState === "missing" && (
                <WarningAlert message={t("svm.nonceAccountMissing")} />
            )}
            {nonceAccount && isPending && durableNonce.isError && (
                <p className="text-xs text-muted-foreground">
                    {t("svm.nonceUnavailable")}
                </p>
            )}
        </div>
    );
}
