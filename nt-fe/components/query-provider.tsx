"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
    const [queryClient] = useState(() => {
        const qc = new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: 1000 * 5, // 5 seconds
                    refetchOnWindowFocus: false,
                },
            },
        });
        // Expose queryClient on window for E2E tests to trigger manual refetches
        if (
            typeof window !== "undefined" &&
            process.env.NODE_ENV !== "production"
        ) {
            (window as any).__queryClient = qc;
        }
        return qc;
    });

    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}
