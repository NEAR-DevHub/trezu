"use client";

import { useTranslations } from "next-intl";
import { InfoDisplay, type InfoItem } from "@/components/info-display";
import { explorerAddressUrl, type ResolvedChain } from "../chains";
import { prettyJson } from "../format";
import type { OmniFamily } from "../types";
import { HexValue } from "./hex-value";
import { JsonBlock } from "./json-tree";

interface GenericTxViewProps {
    family: OmniFamily | string;
    unsignedTx: unknown;
    chain: ResolvedChain | null;
}

function get(value: unknown, path: string[]): unknown {
    let current: unknown = value;
    for (const key of path) {
        if (typeof current !== "object" || current === null) return undefined;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function scalar(value: unknown): string | null {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "bigint")
        return String(value);
    if (typeof value === "boolean") return value ? "true" : "false";
    return null;
}

/**
 * Field picker for aptos / sui / ton envelopes (rendered, not verified in
 * the browser): sender, target function, args, gas fields, expiry, plus
 * the full JSON for everything else.
 */
export function GenericTxView({
    family,
    unsignedTx,
    chain,
}: GenericTxViewProps) {
    const t = useTranslations("proposals.omni");
    const items: InfoItem[] = [];
    const link = (address: string) =>
        chain ? explorerAddressUrl(chain, address) : null;

    const pushAddress = (label: string, value: unknown) => {
        const text = scalar(value);
        if (text) {
            items.push({
                label,
                value: <HexValue value={text} full href={link(text)} />,
            });
        }
    };
    const pushScalar = (label: string, value: unknown, suffix = "") => {
        const text = scalar(value);
        if (text !== null) {
            items.push({
                label,
                value: (
                    <span className="font-mono">
                        {text}
                        {suffix}
                    </span>
                ),
            });
        }
    };
    const pushJson = (label: string, value: unknown) => {
        if (value !== undefined) {
            items.push({
                label,
                value: null,
                afterValue: <JsonBlock value={value} />,
            });
        }
    };

    switch (family) {
        case "aptos": {
            const tx = get(unsignedTx, ["tx"]);
            pushAddress(t("generic.sender"), get(tx, ["sender"]));
            pushScalar(
                t("generic.sequenceNumber"),
                get(tx, ["sequence_number"]),
            );
            const entry = get(tx, ["payload", "EntryFunction"]);
            if (entry) {
                const moduleAddress = scalar(get(entry, ["module", "address"]));
                const moduleName = scalar(get(entry, ["module", "name"]));
                const fn = scalar(get(entry, ["function"]));
                pushScalar(
                    t("generic.function"),
                    `${moduleAddress ?? "?"}::${moduleName ?? "?"}::${fn ?? "?"}`,
                );
                pushJson(t("generic.typeArgs"), get(entry, ["ty_args"]));
                pushJson(t("generic.args"), get(entry, ["args"]));
            } else {
                pushJson(t("generic.payload"), get(tx, ["payload"]));
            }
            pushScalar(t("generic.maxGas"), get(tx, ["max_gas_amount"]));
            pushScalar(t("generic.gasUnitPrice"), get(tx, ["gas_unit_price"]));
            const expiry = get(tx, ["expiration_timestamp_secs"]);
            if (typeof expiry === "number") {
                items.push({
                    label: t("generic.expiry"),
                    value: new Date(expiry * 1000).toISOString(),
                });
            }
            pushScalar(t("generic.chainId"), get(tx, ["chain_id"]));
            pushAddress(
                t("generic.senderPublicKey"),
                get(unsignedTx, ["sender_public_key"]),
            );
            break;
        }
        case "sui": {
            const tx = get(unsignedTx, ["tx"]);
            pushAddress(t("generic.sender"), get(tx, ["sender"]));
            const programmable = get(tx, ["kind", "ProgrammableTransaction"]);
            if (programmable) {
                const commands = get(programmable, ["commands"]);
                if (Array.isArray(commands)) {
                    for (const command of commands) {
                        const moveCall = get(command, ["MoveCall"]);
                        if (moveCall) {
                            pushScalar(
                                t("generic.function"),
                                `${scalar(get(moveCall, ["package"])) ?? "?"}::${scalar(get(moveCall, ["module"])) ?? "?"}::${scalar(get(moveCall, ["function"])) ?? "?"}`,
                            );
                        }
                    }
                }
                pushJson(t("generic.inputs"), get(programmable, ["inputs"]));
                pushJson(t("generic.commands"), commands);
            } else {
                pushJson(t("generic.kind"), get(tx, ["kind"]));
            }
            pushScalar(t("generic.gasBudget"), get(tx, ["gas_data", "budget"]));
            pushScalar(t("generic.gasPrice"), get(tx, ["gas_data", "price"]));
            pushJson(t("generic.gasPayment"), get(tx, ["gas_data", "payment"]));
            const expiration = get(tx, ["expiration"]);
            if (expiration !== undefined) {
                pushScalar(
                    t("generic.expiry"),
                    scalar(expiration) ?? prettyJson(expiration),
                );
            }
            pushAddress(
                t("generic.senderPublicKey"),
                get(unsignedTx, ["sender_public_key"]),
            );
            break;
        }
        case "ton": {
            pushScalar(
                t("generic.walletVersion"),
                get(unsignedTx, ["wallet_version"]),
            );
            pushScalar(t("generic.workchain"), get(unsignedTx, ["workchain"]));
            pushScalar(t("generic.walletId"), get(unsignedTx, ["wallet_id"]));
            pushScalar(t("generic.seqno"), get(unsignedTx, ["seqno"]));
            const validUntil = get(unsignedTx, ["valid_until"]);
            if (typeof validUntil === "number") {
                items.push({
                    label: t("generic.expiry"),
                    value: new Date(validUntil * 1000).toISOString(),
                });
            }
            const messages = get(unsignedTx, ["messages"]);
            if (Array.isArray(messages)) {
                items.push({
                    label: t("generic.messages"),
                    value: messages.length,
                    afterValue: (
                        <ul className="flex flex-col gap-2">
                            {messages.map((message) => {
                                const dest = scalar(get(message, ["dest"]));
                                const value = scalar(get(message, ["value"]));
                                return (
                                    <li
                                        key={prettyJson(message)}
                                        className="rounded-md border p-3 flex flex-col gap-1 text-sm"
                                    >
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-muted-foreground">
                                                {t("generic.to")}
                                            </span>
                                            {dest ? (
                                                <HexValue
                                                    value={dest}
                                                    full
                                                    href={link(dest)}
                                                />
                                            ) : (
                                                t("unknown")
                                            )}
                                        </div>
                                        {value && (
                                            <div>
                                                <span className="text-muted-foreground">
                                                    {t("generic.value")}:{" "}
                                                </span>
                                                <span className="font-mono">
                                                    {value} nanotons
                                                </span>
                                            </div>
                                        )}
                                        {get(message, ["body"]) !== undefined &&
                                            get(message, ["body"]) !== null && (
                                                <JsonBlock
                                                    value={get(message, [
                                                        "body",
                                                    ])}
                                                />
                                            )}
                                    </li>
                                );
                            })}
                        </ul>
                    ),
                });
            }
            pushScalar(t("generic.deploy"), get(unsignedTx, ["deploy"]));
            break;
        }
        default:
            break;
    }

    items.push({
        label: t("generic.rawFields"),
        value: null,
        afterValue: <JsonBlock value={unsignedTx} />,
    });

    return <InfoDisplay items={items} />;
}
