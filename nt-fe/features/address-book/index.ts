// API
export {
    getAddressBook,
    createAddressBookEntries,
    createAddressBookEntry,
    deleteAddressBookEntries,
} from "./api";

// Types
export type {
    AddressBookEntry,
    AddressBookEntryInput,
    CreateAddressBookEntriesInput,
    CreateAddressBookEntryInput,
} from "./types";

// Hooks
export { useAddressBook } from "./hooks/use-address-book";
export {
    useCreateAddressBookEntries,
    useCreateAddressBookEntry,
    useDeleteAddressBookEntries,
} from "./hooks/use-address-book-mutations";
