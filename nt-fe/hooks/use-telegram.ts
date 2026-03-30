import {
    useMutation,
    useQueries,
    useQuery,
    useQueryClient,
} from "@tanstack/react-query";
import {
    connectTreasuries,
    disconnectTreasury,
    getTelegramChatInfo,
    getTelegramStatus,
} from "@/lib/telegram-api";

export function useTelegramChatInfo(
    token: string,
    options?: { enabled?: boolean },
) {
    return useQuery({
        queryKey: ["telegramChatInfo", token],
        queryFn: () => getTelegramChatInfo(token),
        enabled: !!token && (options?.enabled ?? true),
        retry: false,
        staleTime: 60 * 1000,
    });
}

export function useTelegramStatuses(daoIds: string[]) {
    return useQueries({
        queries: daoIds.map((daoId) => ({
            queryKey: ["telegramStatus", daoId],
            queryFn: () => getTelegramStatus(daoId),
            retry: false,
            staleTime: 60 * 1000,
        })),
    });
}

export function useConnectTreasuries(token: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (treasuryIds: string[]) =>
            connectTreasuries(token, treasuryIds),
        onSuccess: () => {
            queryClient.invalidateQueries({
                queryKey: ["telegramChatInfo", token],
            });
        },
    });
}

export function useDisconnectTelegramTreasury() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (daoId: string) => disconnectTreasury(daoId),
        onSuccess: (_data, daoId) => {
            queryClient.invalidateQueries({
                queryKey: ["telegramStatus", daoId],
            });
        },
    });
}
