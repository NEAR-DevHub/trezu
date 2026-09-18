"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/button";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { Pill } from "@/components/pill";
import { User } from "@/components/user";
import { WarningAlert } from "@/components/warning-alert";
import { useProposalTransaction } from "@/hooks/use-proposals";
import type { Proposal } from "@/lib/proposals-api";
import type { Policy } from "@/types/policy";
import { decodeAptosTx } from "../aptos/decode";
import { parseAptosUnsignedTx } from "../aptos/recompute";
import { explorerAddressUrl, resolveChain } from "../chains";
import { envelopeSender, senderMatchesDerived } from "../derived-address";
import { parseEvmUnsignedTx } from "../evm/sighash";
import { capText } from "../format";
import {
    useOmniDerivedAccount,
    useOmniDuplicateNonce,
} from "../hooks/use-omni-lookups";
import { decodeSuiTx } from "../sui/decode";
import { parseSuiUnsignedTx } from "../sui/recompute";
import { decodeSvmUnsignedTx } from "../svm/decode";
import { parseTonUnsignedTx, walletAddressForKey } from "../ton/recompute";
import { isOmniFamily, type OmniProposalData } from "../types";
import { decodeUtxoUnsignedTx } from "../utxo/decode";
import { AptosTxView } from "./aptos-tx-view";
import { CliHint } from "./cli-hint";
import { EvmTxView } from "./evm-tx-view";
import { GenericTxView } from "./generic-tx-view";
import { HexValue } from "./hex-value";
import { type AsyncCheckRow, OmniChecklist } from "./omni-checklist";
import { OmniRawSection } from "./omni-raw-section";
import { OmniStatusBanner } from "./omni-status-banner";
import { SuiTxView } from "./sui-tx-view";
import { SvmTxView } from "./svm-tx-view";
import { TonTxView } from "./ton-tx-view";
import { UtxoTxView } from "./utxo-tx-view";

interface OmniExpandedProps {
    proposal: Proposal;
    data: OmniProposalData;
    policy: Policy;
    treasuryId: string | undefined;
    isPending: boolean;
    isExecuted: boolean;
}

export function OmniExpanded({
    proposal,
    data,
    policy,
    treasuryId,
    isPending,
    isExecuted,
}: OmniExpandedProps) {
    const t = useTranslations("proposals.omni");
    const dao = treasuryId ?? "";
    const { parsed, verification, network } = data;
    const envelope = parsed.ok ? parsed.envelope : parsed.partial;
    const family = envelope?.family;
    const chainKey = envelope?.chain;
    const path = envelope?.path;
    const intent = envelope?.intent;
    const unsignedTx = envelope?.unsigned_tx;
    const chain = chainKey ? resolveChain(chainKey, network) : null;
    const knownFamily = isOmniFamily(family) ? family : null;

    // --- async lookups (presentation only; never affect the status) ---------
    const derived = useOmniDerivedAccount(
        dao || undefined,
        path,
        family,
        network,
    );
    const evmTx =
        knownFamily === "evm" && parsed.ok
            ? parseEvmUnsignedTx(unsignedTx)
            : null;
    const duplicateNonceIds = useOmniDuplicateNonce(
        isPending ? dao || undefined : undefined,
        proposal,
        path,
        chainKey,
        evmTx?.ok ? evmTx.tx.nonce : undefined,
    );
    const executionTx = useProposalTransaction(
        dao || undefined,
        proposal,
        policy,
        isExecuted,
    );

    // --- async sender check -------------------------------------------------
    const asyncChecks: AsyncCheckRow[] = [];
    const sender =
        knownFamily && unsignedTx
            ? envelopeSender(knownFamily, unsignedTx)
            : null;
    if (sender) {
        if (derived.data) {
            const matches = senderMatchesDerived(sender, derived.data);
            asyncChecks.push({
                id: "sender",
                state: matches ? "pass" : "fail",
                detail: {
                    sender: sender.value,
                    derived:
                        sender.kind === "address"
                            ? (derived.data.address ?? "")
                            : derived.data.family === "utxo"
                              ? (derived.data.compressedPublicKeyHex ?? "")
                              : derived.data.publicKeyHex,
                },
            });
        } else if (derived.isError) {
            asyncChecks.push({ id: "sender", state: "skip" });
        } else {
            asyncChecks.push({ id: "sender", state: "pending" });
        }
    }

    // --- header -------------------------------------------------------------
    const chainLabel = chain
        ? chain.chainId !== undefined
            ? t("header.chainWithId", {
                  name: chain.displayName,
                  chainId: chain.chainId,
              })
            : chain.displayName
        : (chainKey ?? t("unknown"));

    const header = (
        <div className="flex flex-col gap-2">
            <p
                className="text-xl font-semibold break-words"
                data-testid="omni-intent"
            >
                {intent?.trim() ? intent : t("header.noIntent")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <Pill variant="primary" title={chainLabel} />
                {family && <Pill variant="secondary" title={family} />}
                <Pill
                    variant="secondary"
                    title={t("header.nearNetwork", { network })}
                />
                {path && (
                    <Pill
                        variant="secondary"
                        title={t("header.path", { path })}
                    />
                )}
            </div>
        </div>
    );

    // --- acting account -----------------------------------------------------
    // TON wallet addresses depend on the wallet parameters carried by the
    // envelope, so they are derived here from the MPC key + envelope.
    const tonWalletAddress =
        knownFamily === "ton" && derived.data && parsed.ok
            ? (walletAddressForKey(
                  unsignedTx,
                  derived.data.publicKeyHex,
              )?.toUserFriendly(true, network === "testnet") ?? null)
            : null;
    const actingAddress =
        derived.data?.address ?? tonWalletAddress ?? undefined;
    const actingItems: InfoItem[] = [
        {
            label: t("acting.account"),
            value: derived.data ? (
                derived.data.address || tonWalletAddress ? (
                    <HexValue
                        value={derived.data.address ?? tonWalletAddress ?? ""}
                        full
                        href={
                            chain
                                ? explorerAddressUrl(
                                      chain,
                                      derived.data.address ??
                                          tonWalletAddress ??
                                          "",
                                  )
                                : null
                        }
                    />
                ) : (
                    <HexValue value={derived.data.publicKeyHex} />
                )
            ) : derived.isError ? (
                <span className="flex items-center gap-2 flex-wrap text-muted-foreground">
                    <span>
                        {t("acting.unavailable")}
                        {derived.error instanceof Error &&
                            derived.error.message &&
                            ` (${derived.error.message})`}
                    </span>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => derived.refetch()}
                    >
                        {t("acting.retry")}
                    </Button>
                </span>
            ) : derived.isLoading ? (
                <span className="text-muted-foreground">
                    {t("acting.loading")}
                </span>
            ) : (
                <span className="text-muted-foreground">
                    {t("acting.unavailable")}
                </span>
            ),
            afterValue: (
                <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap min-w-0">
                    {t("acting.controlledBy")}{" "}
                    <User
                        accountId={dao}
                        withLink={false}
                        truncateAddress={dao.length > 40}
                    />
                    {path && (
                        <>
                            {" / "}
                            <code className="font-mono">{path}</code>
                        </>
                    )}
                    {derived.data &&
                        !derived.data.address &&
                        !tonWalletAddress && (
                            <span> · {t("acting.tonNote")}</span>
                        )}
                </div>
            ),
        },
    ];

    // --- decoded transaction ------------------------------------------------
    let txView: React.ReactNode;
    if (!parsed.ok) {
        txView = (
            <WarningAlert
                message={
                    parsed.reason === "missing-fields"
                        ? t("envelopeError.missing-fields", {
                              fields: parsed.missing?.join(", ") ?? "",
                          })
                        : t(`envelopeError.${parsed.reason}`, {
                              size: parsed.sizeBytes,
                          })
                }
            />
        );
    } else if (knownFamily === "evm") {
        if (evmTx?.ok) {
            txView = (
                <EvmTxView
                    tx={evmTx.tx}
                    chain={chain}
                    actingAddress={actingAddress}
                    duplicateNonceIds={duplicateNonceIds}
                    isPending={isPending}
                />
            );
        } else {
            txView = (
                <div className="flex flex-col gap-2">
                    <WarningAlert
                        message={
                            evmTx?.ok === false
                                ? t(`unverifiedReason.${evmTx.reason}`, {
                                      detail: evmTx.detail,
                                  })
                                : t("unknown")
                        }
                    />
                    <GenericTxView
                        family="evm"
                        unsignedTx={unsignedTx}
                        chain={chain}
                    />
                </div>
            );
        }
    } else if (knownFamily === "svm") {
        const decoded = decodeSvmUnsignedTx(unsignedTx);
        txView = decoded ? (
            <SvmTxView tx={decoded} chain={chain} isPending={isPending} />
        ) : (
            <GenericTxView family="svm" unsignedTx={unsignedTx} chain={chain} />
        );
    } else if (knownFamily === "aptos") {
        const parsedAptos = parseAptosUnsignedTx(unsignedTx);
        txView = parsedAptos.ok ? (
            <AptosTxView
                tx={decodeAptosTx(parsedAptos.tx)}
                chain={chain}
                isPending={isPending}
            />
        ) : (
            <div className="flex flex-col gap-2">
                <WarningAlert
                    message={t(`unverifiedReason.${parsedAptos.reason}`, {
                        detail: parsedAptos.detail,
                    })}
                />
                <GenericTxView
                    family="aptos"
                    unsignedTx={unsignedTx}
                    chain={chain}
                />
            </div>
        );
    } else if (knownFamily === "sui") {
        const parsedSui = parseSuiUnsignedTx(unsignedTx);
        txView = parsedSui.ok ? (
            <SuiTxView tx={decodeSuiTx(parsedSui.tx)} chain={chain} />
        ) : (
            <div className="flex flex-col gap-2">
                <WarningAlert
                    message={t(`unverifiedReason.${parsedSui.reason}`, {
                        detail: parsedSui.detail,
                    })}
                />
                <GenericTxView
                    family="sui"
                    unsignedTx={unsignedTx}
                    chain={chain}
                />
            </div>
        );
    } else if (knownFamily === "ton") {
        const parsedTon = parseTonUnsignedTx(unsignedTx);
        txView = parsedTon.ok ? (
            <TonTxView
                tx={parsedTon.tx}
                chain={chain}
                network={network}
                walletAddress={tonWalletAddress}
            />
        ) : (
            <div className="flex flex-col gap-2">
                <WarningAlert
                    message={t(`unverifiedReason.${parsedTon.reason}`, {
                        detail: parsedTon.detail,
                    })}
                />
                <GenericTxView
                    family="ton"
                    unsignedTx={unsignedTx}
                    chain={chain}
                />
            </div>
        );
    } else if (knownFamily === "utxo") {
        const decoded = decodeUtxoUnsignedTx(unsignedTx, network);
        txView = decoded ? (
            <UtxoTxView tx={decoded} chain={chain} />
        ) : (
            <GenericTxView
                family="utxo"
                unsignedTx={unsignedTx}
                chain={chain}
            />
        );
    } else {
        txView = (
            <GenericTxView
                family={family ?? "unknown"}
                unsignedTx={unsignedTx}
                chain={chain}
            />
        );
    }

    // --- broadcast hint after approval --------------------------------------
    // The second CLI argument is the signer of the NEAR transaction that
    // executed the proposal (the deciding act_proposal). The backend only
    // returns the hash today, so the account is left as a placeholder rather
    // than guessed from the vote map.
    const txHash = executionTx.data?.transaction_hash;

    return (
        <div
            className="flex flex-col gap-6 min-w-0 max-w-full overflow-x-hidden whitespace-normal break-words wrap-anywhere"
            data-testid="omni-expanded"
        >
            {header}

            <OmniStatusBanner
                verification={verification}
                dao={dao}
                proposalId={proposal.id}
                network={network}
            />

            <section className="flex flex-col gap-2 min-w-0">
                <h4 className="text-sm font-semibold">{t("acting.title")}</h4>
                <InfoDisplay items={actingItems} />
            </section>

            <section className="flex flex-col gap-2 min-w-0">
                <h4 className="text-sm font-semibold">
                    {t("transaction.title")}
                </h4>
                {txView}
            </section>

            <section className="flex flex-col gap-2 min-w-0">
                <h4 className="text-sm font-semibold">
                    {t("verification.title")}
                </h4>
                <OmniChecklist
                    checks={verification.checks}
                    asyncChecks={asyncChecks}
                    matchedPayloadsHex={
                        verification.status === "verified"
                            ? verification.proposalPayloadsHex
                            : undefined
                    }
                />
            </section>

            {isExecuted && (
                <section className="flex flex-col gap-2 min-w-0">
                    <h4 className="text-sm font-semibold">
                        {t("cli.broadcastTitle")}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                        {t("cli.broadcastHint")} {t("cli.broadcastVoterNote")}
                    </p>
                    <CliHint
                        command={`omni transaction broadcast ${txHash ?? "<NEAR-TX-HASH>"} <voter-account> network-config ${network}`}
                    />
                    {executionTx.data?.nearblocks_url && (
                        <a
                            href={executionTx.data.nearblocks_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs inline-flex items-center gap-1 text-general-info-foreground hover:underline"
                        >
                            {t("cli.executionTx")}
                            <ExternalLink className="h-3 w-3" />
                        </a>
                    )}
                </section>
            )}

            <OmniRawSection
                data={data}
                rawDescription={capText(proposal.description ?? "", 64 * 1024)}
            />
        </div>
    );
}
