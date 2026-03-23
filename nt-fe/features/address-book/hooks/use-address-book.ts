import { useQuery } from "@tanstack/react-query";
import { getAddressBook } from "../api";
import { useNear } from "@/stores/near-store";

export function useAddressBook(daoId: string | null | undefined) {
    const { accountId } = useNear();
    const enabled = !!daoId && !!accountId;

    return useQuery({
        queryKey: ["address-book", daoId, accountId],
        queryFn: () => getAddressBook(daoId!),
        enabled,
        staleTime: 1000 * 30,
    });
}
