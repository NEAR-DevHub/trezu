"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/alert";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { WarningAlert } from "@/components/warning-alert";
import { explorerAddressUrl, type ResolvedChain } from "../chains";
import { splitCalldata } from "../evm/calldata";
import { formatBaseUnits, formatGwei } from "../format";
import {
    useOmniDecodedCalldata,
    useOmniEvmHasCode,
    useOmniEvmNonce,
} from "../hooks/use-omni-lookups";
import type { EvmUnsignedTx } from "../types";
import { HexValue } from "./hex-value";

interface EvmTxViewProps {
    tx: EvmUnsignedTx;
    chain: ResolvedChain | null;
    /** Derived acting address, when resolved (for the nonce lookup). */
    actingAddress: string | undefined;
    /** Other open proposals that reuse this nonce. */
    duplicateNonceIds: number[];
    /** Only pending proposals need the staleness lookup. */
    isPending: boolean;
}

export function EvmTxView({
    tx,
    chain,
    actingAddress,
    duplicateNonceIds,
    isPending,
}: EvmTxViewProps) {
    const t = useTranslations("proposals.omni");
    const symbol = chain?.symbol ?? "ETH";
    const decimals = chain?.decimals ?? 18;
    const calldata = splitCalldata(tx.input);
    const chainId = chain?.chainId ?? Number(tx.chainId);

    const decoded = useOmniDecodedCalldata(
        chainId,
        tx.to,
        calldata.selector ? tx.input : undefined,
    );
    const nonce = useOmniEvmNonce(chain, actingAddress, isPending);
    const targetHasCode = useOmniEvmHasCode(
        chain,
        tx.to,
        calldata.byteLength > 0,
    );
    const decodedCall = decoded.data?.decoded ?? null;

    const maxCost = tx.gasLimit * tx.maxFeePerGas;

    const items: InfoItem[] = [
        {
            label: t("evm.to"),
            value: (
                <HexValue
                    value={tx.to}
                    full
                    href={chain ? explorerAddressUrl(chain, tx.to) : null}
                />
            ),
        },
        {
            label: t("evm.value"),
            value: (
                <span className="flex flex-col items-end">
                    <span>
                        {formatBaseUnits(tx.value, decimals)} {symbol}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                        {tx.value.toString()} wei
                    </span>
                </span>
            ),
        },
        {
            label: t("evm.nonce"),
            value: <span className="font-mono">{tx.nonce.toString()}</span>,
        },
        {
            label: t("evm.gasLimit"),
            value: <span className="font-mono">{tx.gasLimit.toString()}</span>,
        },
        {
            label: t("evm.maxFeePerGas"),
            value: <span>{formatGwei(tx.maxFeePerGas)} gwei</span>,
        },
        {
            label: t("evm.priorityFee"),
            value: <span>{formatGwei(tx.maxPriorityFeePerGas)} gwei</span>,
        },
        {
            label: t("evm.maxGasCost"),
            info: t("evm.maxGasCostInfo"),
            value: (
                <span>
                    {formatBaseUnits(maxCost, decimals)} {symbol}
                </span>
            ),
        },
    ];

    if (calldata.byteLength === 0) {
        items.push({ label: t("evm.calldata"), value: t("evm.noCalldata") });
    } else {
        items.push({
            label: t("evm.calldata"),
            value: (
                <span className="text-xs text-muted-foreground">
                    {t("evm.bytes", { count: calldata.byteLength })}
                </span>
            ),
            afterValue: (
                <div className="flex flex-col gap-2">
                    {decodedCall && (
                        <div className="rounded-md border p-3 flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <code className="font-mono text-sm font-semibold break-all">
                                    {decodedCall.signature}
                                </code>
                                <span className="text-xs text-muted-foreground">
                                    {t("evm.decodedVia", {
                                        source: decodedCall.source,
                                    })}
                                </span>
                            </div>
                            {decodedCall.args.length > 0 && (
                                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                                    {decodedCall.args.map((arg, index) => (
                                        <div
                                            key={`${arg.name}-${index}`}
                                            className="contents"
                                        >
                                            <dt className="text-muted-foreground font-mono">
                                                {arg.name}
                                                <span className="opacity-60">
                                                    {" "}
                                                    {arg.type}
                                                </span>
                                            </dt>
                                            <dd className="font-mono break-all">
                                                {arg.value}
                                            </dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                        </div>
                    )}
                    {!decodedCall && (
                        <p className="text-xs text-muted-foreground">
                            {decoded.isLoading
                                ? t("evm.abiLoading")
                                : decoded.isError ||
                                    decoded.data?.sourcifyFailed
                                  ? t("evm.abiLookupFailed")
                                  : t("evm.abiUnavailable")}
                        </p>
                    )}
                    {decodedCall && decoded.data?.sourcifyFailed && (
                        <p className="text-xs text-muted-foreground">
                            {t("evm.abiSourcifyDown")}
                        </p>
                    )}
                    <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs font-mono break-all whitespace-pre-wrap">
                        <span className="text-general-info-foreground font-semibold">
                            {calldata.selector}
                        </span>
                        <span className="text-foreground/80">
                            {calldata.args?.slice(2)}
                        </span>
                    </pre>
                    <p className="text-xs text-muted-foreground">
                        {t("evm.selector")}:{" "}
                        <code className="font-mono">{calldata.selector}</code>
                    </p>
                </div>
            ),
        });
    }

    // Staleness: used nonce is fatal (red), a gap is a delay (yellow), equal
    // is current (green). Only evaluated for pending proposals with a known
    // on-chain nonce; lookups never affect the verification status.
    let nonceState: "used" | "gap" | "current" | null = null;
    if (isPending && nonce.data !== undefined) {
        nonceState =
            nonce.data > tx.nonce
                ? "used"
                : nonce.data < tx.nonce
                  ? "gap"
                  : "current";
    }
    const duplicateWarning =
        duplicateNonceIds.length > 0
            ? t("staleness.duplicateNonce", {
                  ids: duplicateNonceIds.map((id) => `#${id}`).join(", "),
                  nonce: tx.nonce.toString(),
              })
            : null;

    return (
        <div className="flex flex-col gap-3">
            <InfoDisplay items={items} />
            <p className="text-xs text-muted-foreground">
                {t("staleness.assumesNonce", { nonce: tx.nonce.toString() })}
                {isPending && actingAddress && (
                    <>
                        {" · "}
                        {nonce.data !== undefined
                            ? t("staleness.currentNonce", {
                                  nonce: nonce.data.toString(),
                              })
                            : nonce.isError
                              ? t("staleness.nonceUnavailable")
                              : t("staleness.nonceLoading")}
                    </>
                )}
            </p>
            {nonceState === "used" && (
                <Alert
                    variant="destructive"
                    role="alert"
                    data-testid="omni-nonce-used"
                    className="items-start"
                >
                    <TriangleAlert className="h-4 w-4 shrink-0" />
                    <AlertDescription>
                        {t("staleness.nonceUsed", {
                            nonce: tx.nonce.toString(),
                        })}
                    </AlertDescription>
                </Alert>
            )}
            {nonceState === "gap" && nonce.data !== undefined && (
                <WarningAlert
                    message={t("staleness.nonceAhead", {
                        nonce: tx.nonce.toString(),
                        current: nonce.data.toString(),
                    })}
                />
            )}
            {nonceState === "current" && (
                <p
                    className="text-xs text-general-success-foreground inline-flex items-center gap-1"
                    data-testid="omni-nonce-current"
                >
                    <CircleCheck className="h-3.5 w-3.5" />
                    {t("staleness.nonceCurrent", {
                        nonce: tx.nonce.toString(),
                    })}
                </p>
            )}
            {duplicateWarning && <WarningAlert message={duplicateWarning} />}
            {calldata.byteLength > 0 && targetHasCode.data === false && (
                <WarningAlert
                    message={t("evm.targetNoCode")}
                    className="w-full"
                />
            )}
        </div>
    );
}
