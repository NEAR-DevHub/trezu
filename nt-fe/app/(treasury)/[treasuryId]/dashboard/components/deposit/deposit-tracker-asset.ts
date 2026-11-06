import type { TrackedDeposit } from "@/lib/bridge-api";

/**
 * How a tracker tile may present the deposit's asset.
 * - `confirmed`: the provider or the ledger named it; show it as fact.
 * - `confirming`: in flight on a reusable address, labelled with the asset
 *   the address was shown for until the ledger row names the credited one.
 * - `unknown`: failed on a reusable address; no ledger row will ever name
 *   it, so the label is withheld rather than asserted.
 */
export type TrackerAssetState = "confirmed" | "confirming" | "unknown";

export function trackerAssetState(
    deposit: Pick<TrackedDeposit, "status" | "assetConfirmed">,
): TrackerAssetState {
    if (deposit.assetConfirmed) return "confirmed";
    return deposit.status === "failed" ? "unknown" : "confirming";
}
