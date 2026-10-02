import { useEffect, useState } from "react";

/**
 * Returns true only once `flag` has stayed true for `delayMs`. Use it to avoid
 * flashing a loading indicator for loads that finish almost immediately.
 */
export function useDelayedFlag(flag: boolean, delayMs = 250): boolean {
    const [delayed, setDelayed] = useState(false);

    useEffect(() => {
        if (!flag) {
            setDelayed(false);
            return;
        }
        const timer = setTimeout(() => setDelayed(true), delayMs);
        return () => clearTimeout(timer);
    }, [flag, delayMs]);

    return flag && delayed;
}
