/** Indexes whose address is already saved, or repeats an earlier row. */
export function duplicateRecipientIndexes(
    recipients: ReadonlyArray<{ address?: string | null }>,
    existingAddresses: ReadonlySet<string>,
): number[] {
    const seen = new Set<string>();
    const duplicates: number[] = [];

    for (let index = 0; index < recipients.length; index++) {
        const address = recipients[index]?.address?.trim();
        if (!address) continue;
        if (existingAddresses.has(address) || seen.has(address)) {
            duplicates.push(index);
        } else {
            seen.add(address);
        }
    }

    return duplicates;
}
