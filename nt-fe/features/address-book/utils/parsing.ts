import { parseCsv } from "@/lib/csv-utils";
import { getCompatibleChains } from "../compatible-chains";
import { buildNetworkLookup, resolveNetworkName } from "./resolve-network";
import type { ChainInfo } from "../chains";

export interface ParsedRecipient {
    name: string;
    address: string;
    networks: string[];
    note?: string;
}

export interface ParseResult {
    recipients: ParsedRecipient[];
    errors: Array<{ row: number; message: string }>;
}

/**
 * Header keywords for each column
 */
const NAME_KEYWORDS = ["name", "recipient name", "recipient"];
const ADDRESS_KEYWORDS = ["address", "recipient address", "wallet"];
const NETWORK_KEYWORDS = ["network", "chain", "blockchain"];
const NOTE_KEYWORDS = ["note", "notes", "memo", "comment"];

/**
 * Detect header row and return column indices.
 */
function detectHeaderAndGetConfig(rows: string[][]): {
    hasHeader: boolean;
    startRow: number;
    nameIdx: number;
    addressIdx: number;
    networkIdx: number;
    noteIdx: number;
} {
    if (rows.length === 0) {
        return {
            hasHeader: false,
            startRow: 0,
            nameIdx: 0,
            addressIdx: 1,
            networkIdx: 2,
            noteIdx: 3,
        };
    }

    const firstRow = rows[0];

    const findCol = (keywords: string[]) =>
        firstRow.findIndex((cell) => {
            const lower = (cell || "").trim().toLowerCase();
            return keywords.some((kw) => lower.includes(kw));
        });

    const nameIdx = findCol(NAME_KEYWORDS);
    const addressIdx = findCol(ADDRESS_KEYWORDS);

    // Consider it a header if we find at least name and address columns
    const hasHeader = nameIdx !== -1 && addressIdx !== -1;

    if (hasHeader) {
        const networkIdx = findCol(NETWORK_KEYWORDS);
        const noteIdx = findCol(NOTE_KEYWORDS);
        return {
            hasHeader: true,
            startRow: 1,
            nameIdx,
            addressIdx,
            networkIdx: networkIdx !== -1 ? networkIdx : -1,
            noteIdx: noteIdx !== -1 ? noteIdx : -1,
        };
    }

    // No header detected — assume column order: name, address, network, note
    return {
        hasHeader: false,
        startRow: 0,
        nameIdx: 0,
        addressIdx: 1,
        networkIdx: 2,
        noteIdx: 3,
    };
}

/**
 * Parse and validate address book data rows
 */
function parseAddressBookData(
    rows: string[][],
    config: ReturnType<typeof detectHeaderAndGetConfig>,
    chains: ChainInfo[],
): ParseResult {
    const { startRow, nameIdx, addressIdx, networkIdx, noteIdx } = config;
    const errors: Array<{ row: number; message: string }> = [];
    const recipients: ParsedRecipient[] = [];
    const networkLookup = buildNetworkLookup(chains);

    const dataRows = rows.slice(startRow);

    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const rowNum = i + startRow + 1; // 1-indexed for user display

        // Skip empty rows
        if (row.every((cell) => !cell || !cell.trim())) {
            continue;
        }

        const name = (row[nameIdx] || "").trim();
        const address = (row[addressIdx] || "").trim();
        const networkRaw =
            networkIdx >= 0 ? (row[networkIdx] || "").trim() : "";
        const note = noteIdx >= 0 ? (row[noteIdx] || "").trim() : "";

        // Validate name
        if (!name) {
            errors.push({
                row: rowNum,
                message: `Row ${rowNum}: Missing recipient name. Please add a name.`,
            });
            continue;
        }

        // Validate address
        if (!address) {
            errors.push({
                row: rowNum,
                message: `Row ${rowNum}: Missing recipient address. Please add a wallet address.`,
            });
            continue;
        }

        // Check address is compatible with any known chain
        const compatibleChains = getCompatibleChains(address, chains);
        if (compatibleChains.length === 0) {
            errors.push({
                row: rowNum,
                message: `Row ${rowNum}: The address "${address}" is not a valid format for any supported network.`,
            });
            continue;
        }

        // Resolve network
        let networks: string[];

        if (networkRaw) {
            // Handle multiple networks separated by semicolons or pipes
            const networkInputs = networkRaw
                .split(/[;|]/)
                .map((n) => n.trim())
                .filter(Boolean);

            const resolvedNetworks: string[] = [];
            let hasError = false;

            for (const input of networkInputs) {
                const chainKey = resolveNetworkName(input, networkLookup);
                if (!chainKey) {
                    const available = chains
                        .map((c) => c.name)
                        .slice(0, 10)
                        .join(", ");
                    errors.push({
                        row: rowNum,
                        message: `Row ${rowNum}: Unknown network "${input}". Supported networks include: ${available}.`,
                    });
                    hasError = true;
                    break;
                }

                // Verify address is compatible with the specified network
                const isCompatible = compatibleChains.some(
                    (c) => c.key === chainKey,
                );
                if (!isCompatible) {
                    const compatibleNames = compatibleChains
                        .map((c) => c.name)
                        .join(", ");
                    errors.push({
                        row: rowNum,
                        message: `Row ${rowNum}: The address "${address}" is not compatible with ${input}. Compatible networks: ${compatibleNames}.`,
                    });
                    hasError = true;
                    break;
                }

                resolvedNetworks.push(chainKey);
            }

            if (hasError) continue;
            networks = resolvedNetworks;
        } else {
            // Auto-detect: use all compatible chains
            networks = compatibleChains.map((c) => c.key);
        }

        recipients.push({
            name,
            address,
            networks,
            note: note || undefined,
        });
    }

    if (errors.length > 0) {
        return { recipients: [], errors };
    }

    if (recipients.length === 0) {
        return {
            recipients: [],
            errors: [
                {
                    row: 0,
                    message:
                        "No data found. Please add recipients in this format: Name, Address, Network, Note",
                },
            ],
        };
    }

    return { recipients, errors: [] };
}

/**
 * Parse and validate address book CSV data
 */
export function parseAndValidateAddressBookCsv(
    csvData: string,
    chains: ChainInfo[],
): ParseResult {
    try {
        const rows = parseCsv(csvData);

        if (rows.length === 0) {
            return {
                recipients: [],
                errors: [
                    {
                        row: 0,
                        message:
                            "No data found. Please add recipients in this format: Name, Address, Network, Note",
                    },
                ],
            };
        }

        const config = detectHeaderAndGetConfig(rows);

        if (
            config.hasHeader &&
            (config.nameIdx === -1 || config.addressIdx === -1)
        ) {
            return {
                recipients: [],
                errors: [
                    {
                        row: 1,
                        message:
                            "We detected a header row, but couldn't find the 'Name' and 'Address' columns. Please use these column names, or remove the header row.",
                    },
                ],
            };
        }

        return parseAddressBookData(rows, config, chains);
    } catch (error) {
        return {
            recipients: [],
            errors: [
                {
                    row: 0,
                    message:
                        error instanceof Error
                            ? error.message
                            : "Failed to parse CSV data",
                },
            ],
        };
    }
}

/**
 * Parse and validate address book paste data
 */
export function parseAndValidateAddressBookPaste(
    pasteData: string,
    chains: ChainInfo[],
): ParseResult {
    const normalizedInput = pasteData.replace(/\\n/g, "\n").trim();
    return parseAndValidateAddressBookCsv(normalizedInput, chains);
}
