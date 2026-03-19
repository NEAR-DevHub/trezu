import { useQuery } from "@tanstack/react-query";
import { getAddressBook } from "../api";

export function useAddressBook(daoId: string | null | undefined) {
    return useQuery({
        queryKey: ["address-book", daoId],
        queryFn: () => getAddressBook(daoId!),
        enabled: !!daoId,
        staleTime: 1000 * 30,
    });
}
