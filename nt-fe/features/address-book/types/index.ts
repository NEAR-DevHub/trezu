import { z } from "zod";

export const RECIPIENT_NAME_MAX_LENGTH = 64;

export function buildRecipientSchema(messages: {
    nameRequired: string;
    nameMax: string;
    addressRequired: string;
    networksRequired: string;
}) {
    return z.object({
        name: z
            .string()
            .min(1, messages.nameRequired)
            .max(RECIPIENT_NAME_MAX_LENGTH, messages.nameMax),
        address: z.string().min(1, messages.addressRequired),
        networks: z.array(z.string()).min(1, messages.networksRequired),
    });
}

const _recipientSchemaForType = buildRecipientSchema({
    nameRequired: "",
    nameMax: "",
    addressRequired: "",
    networksRequired: "",
});

export type RecipientDraft = z.infer<typeof _recipientSchemaForType>;

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
