import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { getAddressBook } from "../api";
import { useNear } from "@/stores/near-store";

export function useAddressBook(daoId: string | null | undefined) {
    const { accountId } = useNear();
    const enabled = !!daoId && !!accountId;

    return useQuery({
        queryKey: ["address-book", daoId, accountId],
        queryFn: async () => {
            try {
                return await getAddressBook(daoId!);
            } catch (error) {
                if (axios.isAxiosError(error) && error.response?.status === 403) {
                    return [];
                }
                throw error;
            }
        },
        enabled,
        staleTime: 1000 * 30,
        retry: (failureCount, error) => {
            if (axios.isAxiosError(error) && error.response?.status === 403) {
                return false;
            }
            return failureCount < 3;
        },
    });
}
