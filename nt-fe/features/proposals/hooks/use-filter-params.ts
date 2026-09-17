"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { useTreasury } from "@/hooks/use-treasury";
import { trackEvent } from "@/lib/analytics";
import { hasFilterValue } from "../types/filter-types";

/**
 * Filters live in the URL so they survive reloads and can be shared. Every
 * write resets pagination, since page 3 of the old result set is meaningless
 * once the set changes. A `null` value drops the parameter entirely.
 *
 * `filterEventName` is the analytics event fired once per filter that is
 * written with a real value (adding an empty pill or removing one is silent).
 */
export function useFilterParams(filterEventName?: string) {
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const { treasuryId } = useTreasury();

    const setFilters = useCallback(
        (updates: Record<string, string | null>) => {
            const params = new URLSearchParams(searchParams.toString());
            Object.entries(updates).forEach(([key, value]) => {
                if (value === null) {
                    params.delete(key);
                } else {
                    params.set(key, value);
                    if (filterEventName && hasFilterValue(value)) {
                        trackEvent(filterEventName, {
                            filter_type: key,
                            treasury_id: treasuryId,
                        });
                    }
                }
            });
            params.delete("page");
            router.push(`${pathname}?${params.toString()}`);
        },
        [searchParams, router, pathname, filterEventName, treasuryId],
    );

    return { searchParams, setFilters };
}
