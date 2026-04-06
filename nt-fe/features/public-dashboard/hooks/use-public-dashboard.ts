import { useQuery } from "@tanstack/react-query";
import { getPublicDashboardAum } from "../api";

export function usePublicDashboard() {
    return useQuery({
        queryKey: ["publicDashboard"],
        queryFn: getPublicDashboardAum,
        // Data is refreshed once daily by the backend, so a long stale window is fine.
        staleTime: 1000 * 60 * 60,
        retry: 2,
    });
}
