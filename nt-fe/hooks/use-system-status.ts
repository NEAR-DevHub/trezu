import { useQuery } from "@tanstack/react-query";
import axios from "axios";

const BACKEND_API_BASE = `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/api`;

export interface SystemStatusPost {
    id: string;
    title: string;
    message: string;
    post_type: "maintenance" | "incident";
}

interface SystemStatusResponse {
    posts: SystemStatusPost[];
}

async function fetchSystemStatus(): Promise<SystemStatusPost[]> {
    const { data } = await axios.get<SystemStatusResponse>(
        `${BACKEND_API_BASE}/intents/status`,
    );
    return data.posts;
}

export function useSystemStatus() {
    return useQuery({
        queryKey: ["systemStatus"],
        queryFn: fetchSystemStatus,
        staleTime: 60 * 1000,
        refetchInterval: 60 * 1000,
        retry: 2,
    });
}
