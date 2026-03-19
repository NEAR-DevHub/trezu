import axios from "axios";
import type {
    AddressBookEntry,
    AddressBookEntryInput,
    CreateAddressBookEntriesInput,
} from "./types";

const BACKEND_API_BASE = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/api`;

export async function getAddressBook(
    daoId: string,
): Promise<AddressBookEntry[]> {
    const response = await axios.get<AddressBookEntry[]>(
        `${BACKEND_API_BASE}/address-book`,
        { params: { daoId }, withCredentials: true },
    );
    return response.data;
}

export async function createAddressBookEntries(
    input: CreateAddressBookEntriesInput,
): Promise<AddressBookEntry[]> {
    const response = await axios.post<AddressBookEntry[]>(
        `${BACKEND_API_BASE}/address-book`,
        input,
        { withCredentials: true },
    );
    return response.data;
}

/** Convenience wrapper for creating a single entry */
export async function createAddressBookEntry(
    daoId: string,
    entry: AddressBookEntryInput,
): Promise<AddressBookEntry> {
    const [created] = await createAddressBookEntries({
        daoId,
        entries: [entry],
    });
    return created;
}

export async function deleteAddressBookEntries(ids: string[]): Promise<void> {
    await axios.delete(`${BACKEND_API_BASE}/address-book`, {
        data: { ids },
        withCredentials: true,
    });
}
