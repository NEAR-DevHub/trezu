import { persistAddressBookAddress } from "./find-entry";

/** Indexes whose address is already saved, or repeats an earlier row. */
export function duplicateRecipientIndexes(
    recipients: ReadonlyArray<{
        address?: string | null;
        networks?: readonly string[];
    }>,
    existingAddresses: ReadonlySet<string>,
): number[] {
    const seen = new Set<string>();
    const duplicates: number[] = [];

    for (let index = 0; index < recipients.length; index++) {
        const recipient = recipients[index];
        const raw = recipient?.address?.trim();
        if (!raw) continue;
        // Compare the stored shape. near.com contacts persist as `nearcom:`.
        const address = persistAddressBookAddress({
            address: raw,
            networks: recipient?.networks,
        });
        if (existingAddresses.has(address) || seen.has(address)) {
            duplicates.push(index);
        } else {
            seen.add(address);
        }
    }

    return duplicates;
}
