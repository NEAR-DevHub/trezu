import { useQuery } from "@tanstack/react-query";
import axios from "axios";

interface InstatusUpdate {
    id: string;
    message: string;
    reported_at: number;
}

interface InstatusPost {
    id: string;
    title: string;
    post_type: "maintenance" | "incident";
    starts_at: number | null;
    ends_at: number | null;
    latest_update: InstatusUpdate | null;
}

export interface SystemStatusPost {
    id: string;
    title: string;
    message: string;
    post_type: "maintenance" | "incident";
}

interface InstatusResponse {
    posts: InstatusPost[];
}

const STATUS_API_URL =
    "https://status.near-intents.org/api/posts?is_featured=true";

async function fetchSystemStatus(): Promise<SystemStatusPost[]> {
    const { data } = await axios.get<InstatusResponse>(STATUS_API_URL);

    const now = Date.now();
    return data.posts
        .filter((post) => {
            if (post.post_type === "incident") return true;
            if (post.starts_at && post.ends_at) {
                return now >= post.starts_at && now <= post.ends_at;
            }
            return post.starts_at ? now >= post.starts_at : true;
        })
        .map((post) => ({
            id: post.id,
            title: post.title,
            message: post.latest_update?.message ?? post.title,
            post_type: post.post_type,
        }));
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
