import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    createAddressBookEntries,
    createAddressBookEntry,
    deleteAddressBookEntries,
    exportAddressBook,
} from "../api";
import type {
    AddressBookEntry,
    AddressBookEntryInput,
    CreateAddressBookEntriesInput,
} from "../types";

async function invalidateProfilesForAddresses(
    queryClient: ReturnType<typeof useQueryClient>,
    daoId: string | null | undefined,
    addresses: string[],
) {
    if (!daoId || addresses.length === 0) return;

    const uniqueAddresses = [...new Set(addresses.filter(Boolean))];

    await Promise.all(
        uniqueAddresses.map((address) =>
            queryClient.invalidateQueries({
                queryKey: ["profile", address, daoId],
            }),
        ),
    );
}

export function useCreateAddressBookEntries(daoId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: CreateAddressBookEntriesInput) =>
            createAddressBookEntries(input),
        onSuccess: async (created) => {
            toast.success(
                created.length === 1
                    ? "Recipient added"
                    : `${created.length} recipients added`,
            );
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["address-book", daoId],
                }),
                invalidateProfilesForAddresses(
                    queryClient,
                    daoId,
                    created.map((entry) => entry.address),
                ),
            ]);
        },
        onError: () => {
            toast.error("Failed to add recipients");
        },
    });
}

export function useCreateAddressBookEntry(daoId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            daoId: inputDaoId,
            entry,
        }: {
            daoId: string;
            entry: AddressBookEntryInput;
        }) => createAddressBookEntry(inputDaoId, entry),
        onSuccess: async (created) => {
            toast.success("Recipient added");
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["address-book", daoId],
                }),
                invalidateProfilesForAddresses(queryClient, daoId, [
                    created.address,
                ]),
            ]);
        },
        onError: () => {
            toast.error("Failed to add recipient");
        },
    });
}

export function useDeleteAddressBookEntries(daoId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        onMutate: (ids) => {
            const cachedLists = queryClient.getQueriesData<AddressBookEntry[]>({
                queryKey: ["address-book", daoId],
            });
            const deletedAddresses = new Set<string>();

            for (const [, entries] of cachedLists) {
                if (!entries) continue;

                for (const entry of entries) {
                    if (ids.includes(entry.id)) {
                        deletedAddresses.add(entry.address);
                    }
                }
            }

            return { deletedAddresses: [...deletedAddresses] };
        },
        mutationFn: (ids: string[]) => deleteAddressBookEntries(ids),
        onSuccess: async (_, ids, context) => {
            toast.success(
                ids.length === 1
                    ? "Recipient removed"
                    : `${ids.length} recipients removed`,
            );
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["address-book", daoId],
                }),
                invalidateProfilesForAddresses(
                    queryClient,
                    daoId,
                    context?.deletedAddresses ?? [],
                ),
            ]);
        },
        onError: () => {
            toast.error("Failed to remove recipients");
        },
    });
}

export function useExportAddressBook(daoId: string | null | undefined) {
    return useMutation({
        mutationFn: (ids?: string[]) => {
            if (!daoId)
                return Promise.reject(new Error("No treasury selected"));
            return exportAddressBook(daoId, ids);
        },
        onError: () => {
            toast.error("Failed to export recipients");
        },
    });
}
