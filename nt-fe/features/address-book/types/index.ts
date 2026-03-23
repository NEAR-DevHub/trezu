import { z } from "zod";

export const RECIPIENT_NAME_MAX_LENGTH = 64;

export const recipientSchema = z.object({
    name: z
        .string()
        .min(1, "Name is required")
        .max(
            RECIPIENT_NAME_MAX_LENGTH,
            `Recipient must be less than ${RECIPIENT_NAME_MAX_LENGTH} characters`,
        ),
    address: z.string().min(1, "Address is required"),
    networks: z.array(z.string()).min(1, "Select at least one network"),
});

export type RecipientDraft = z.infer<typeof recipientSchema>;

export interface AddressBookEntry {
    id: string;
    daoId: string;
    name: string;
    networks: string[];
    address: string;
    note?: string;
    createdBy?: string;
    createdAt: string;
}

export interface AddressBookEntryInput {
    name: string;
    networks: string[];
    address: string;
    note?: string;
}

export interface CreateAddressBookEntriesInput {
    daoId: string;
    entries: AddressBookEntryInput[];
}

/** @deprecated Use CreateAddressBookEntriesInput */
export type CreateAddressBookEntryInput = CreateAddressBookEntriesInput;
