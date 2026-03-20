import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
    createAddressBookEntries,
    createAddressBookEntry,
    deleteAddressBookEntries,
    exportAddressBook,
} from "../api";
import type {
    AddressBookEntryInput,
    CreateAddressBookEntriesInput,
} from "../types";

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
            await queryClient.invalidateQueries({
                queryKey: ["address-book", daoId],
            });
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
        onSuccess: async () => {
            toast.success("Recipient added");
            await queryClient.invalidateQueries({
                queryKey: ["address-book", daoId],
            });
        },
        onError: () => {
            toast.error("Failed to add recipient");
        },
    });
}

export function useDeleteAddressBookEntries(daoId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (ids: string[]) => deleteAddressBookEntries(ids),
        onSuccess: async (_, ids) => {
            toast.success(
                ids.length === 1
                    ? "Recipient removed"
                    : `${ids.length} recipients removed`,
            );
            await queryClient.invalidateQueries({
                queryKey: ["address-book", daoId],
            });
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
