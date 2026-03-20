// API
export {
    getAddressBook,
    createAddressBookEntries,
    createAddressBookEntry,
    deleteAddressBookEntries,
    exportAddressBook,
} from "./api";

// Types
export { recipientSchema } from "./types";
export type {
    RecipientDraft,
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
    useExportAddressBook,
} from "./hooks/use-address-book-mutations";
