import { useQuery } from "@tanstack/react-query";
import { getAddressBook } from "../api";
import { useNear } from "@/stores/near-store";
import { useTreasury } from "@/hooks/use-treasury";

export function useAddressBook(daoId: string | null | undefined) {
    const { accountId } = useNear();
    const { isGuestTreasury } = useTreasury();
    const enabled = !!daoId && !!accountId && !isGuestTreasury;

    return useQuery({
        queryKey: ["address-book", daoId, accountId],
        queryFn: () => getAddressBook(daoId!),
        enabled,
        staleTime: 1000 * 30,
    });
}
