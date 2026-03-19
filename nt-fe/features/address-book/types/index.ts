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
