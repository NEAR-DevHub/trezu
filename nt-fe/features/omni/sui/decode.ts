import { bytesToHex } from "../bcs";
import {
    formatSuiTypeTag,
    type SuiArgument,
    type SuiCallArg,
    type SuiTransaction,
} from "./recompute";

/** Presentation-only view of a Sui programmable transaction. */
export interface DecodedSuiTx {
    sender: string;
    gasBudget: bigint;
    gasPrice: bigint;
    gasOwner: string;
    gasPayment: Array<{ objectId: string; version: bigint; digest: string }>;
    expiration: string;
    inputs: string[];
    /** One human line per command. */
    commands: string[];
    /** Detected simple SUI transfers: SplitCoins(GasCoin, [Pure u64]) + TransferObjects(Result, Pure address). */
    transfers: Array<{ mist: bigint; to: string }>;
    hasSharedObjects: boolean;
}

function hex(bytes: Uint8Array): string {
    return `0x${bytesToHex(bytes)}`;
}

function readU64LE(bytes: Uint8Array): bigint | null {
    if (bytes.length !== 8) return null;
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
    return v;
}

function argText(arg: SuiArgument): string {
    switch (arg.kind) {
        case "GasCoin":
            return "GasCoin";
        case "Input":
            return `Input(${arg.index})`;
        case "Result":
            return `Result(${arg.index})`;
        case "NestedResult":
            return `NestedResult(${arg.command}, ${arg.result})`;
    }
}

function inputText(input: SuiCallArg): string {
    switch (input.kind) {
        case "Pure":
            return `Pure ${hex(input.bytes)}`;
        case "ImmOrOwnedObject":
            return `Object ${hex(input.ref.objectId)} v${input.ref.version}`;
        case "SharedObject":
            return `SharedObject ${hex(input.id)} (${input.mutable ? "mutable" : "read-only"})`;
        case "Receiving":
            return `Receiving ${hex(input.ref.objectId)} v${input.ref.version}`;
    }
}

function pureInput(tx: SuiTransaction, arg: SuiArgument): Uint8Array | null {
    if (arg.kind !== "Input") return null;
    const input = tx.inputs[arg.index];
    return input && input.kind === "Pure" ? input.bytes : null;
}

export function decodeSuiTx(tx: SuiTransaction): DecodedSuiTx {
    const commands: string[] = [];
    const transfers: DecodedSuiTx["transfers"] = [];
    // SplitCoins results by command index, so a following TransferObjects
    // of Result(i) can be matched to the amounts.
    const splitAmounts = new Map<number, bigint[]>();
    tx.commands.forEach((command, index) => {
        switch (command.kind) {
            case "MoveCall": {
                const pkg = `0x${bytesToHex(command.pkg).replace(/^0+(?=.)/, "")}`;
                const generics = command.typeArguments.length
                    ? `<${command.typeArguments.map(formatSuiTypeTag).join(", ")}>`
                    : "";
                commands.push(
                    `${pkg}::${command.module}::${command.fn}${generics}(${command.arguments.map(argText).join(", ")})`,
                );
                break;
            }
            case "SplitCoins": {
                const amounts = command.amounts.map((a) => {
                    const bytes = pureInput(tx, a);
                    return bytes ? readU64LE(bytes) : null;
                });
                if (amounts.every((a): a is bigint => a !== null))
                    splitAmounts.set(index, amounts);
                commands.push(
                    `SplitCoins ${argText(command.coin)} -> [${amounts.map((a, i) => (a === null ? argText(command.amounts[i]) : `${a} MIST`)).join(", ")}]`,
                );
                break;
            }
            case "TransferObjects": {
                const toBytes = pureInput(tx, command.address);
                const to =
                    toBytes && toBytes.length === 32
                        ? hex(toBytes)
                        : argText(command.address);
                commands.push(
                    `TransferObjects [${command.objects.map(argText).join(", ")}] -> ${to}`,
                );
                if (toBytes && toBytes.length === 32) {
                    for (const object of command.objects) {
                        if (object.kind === "Result") {
                            const amounts = splitAmounts.get(object.index);
                            if (amounts)
                                for (const mist of amounts)
                                    transfers.push({ mist, to });
                        }
                        if (object.kind === "NestedResult") {
                            const amounts = splitAmounts.get(object.command);
                            const mist = amounts?.[object.result];
                            if (mist !== undefined)
                                transfers.push({ mist, to });
                        }
                    }
                }
                break;
            }
            case "MergeCoins":
                commands.push(
                    `MergeCoins ${argText(command.coin)} <- [${command.coinsToMerge.map(argText).join(", ")}]`,
                );
                break;
            case "MakeMoveVec":
                commands.push(
                    `MakeMoveVec${command.typeTag ? `<${formatSuiTypeTag(command.typeTag)}>` : ""} [${command.elements.map(argText).join(", ")}]`,
                );
                break;
        }
    });
    return {
        sender: hex(tx.sender),
        gasBudget: tx.gas.budget,
        gasPrice: tx.gas.price,
        gasOwner: hex(tx.gas.owner),
        gasPayment: tx.gas.payment.map((p) => ({
            objectId: hex(p.objectId),
            version: p.version,
            digest: p.digestText,
        })),
        expiration:
            tx.expiration.kind === "None"
                ? "None"
                : `Epoch ${tx.expiration.epoch}`,
        inputs: tx.inputs.map(inputText),
        commands,
        transfers,
        hasSharedObjects: tx.inputs.some((i) => i.kind === "SharedObject"),
    };
}
