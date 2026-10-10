import { describe, expect, it } from "bun:test";
import type { Proposal, SwapStatus } from "@/lib/proposals-api";
import type { Policy } from "@/types/policy";
import { getProposalStatus, type UIProposalStatus } from "./proposal-utils";

const approved = { status: "Approved" } as Proposal;
const policy = {} as Policy;

describe("getProposalStatus for an approved request", () => {
    it("is Executed without a swap to wait on", () => {
        expect(getProposalStatus(approved, policy)).toBe("Executed");
        expect(getProposalStatus(approved, policy, null)).toBe("Executed");
    });

    const cases: [SwapStatus, UIProposalStatus][] = [
        ["KNOWN_DEPOSIT_TX", "Processing"],
        ["PENDING_DEPOSIT", "Processing"],
        ["INCOMPLETE_DEPOSIT", "Processing"],
        ["PROCESSING", "Processing"],
        ["SUCCESS", "Executed"],
        ["FAILED", "Failed"],
        ["REFUNDED", "Failed"],
    ];
    for (const [swapStatus, expected] of cases) {
        it(`is ${expected} while the swap is ${swapStatus}`, () => {
            expect(getProposalStatus(approved, policy, swapStatus)).toBe(
                expected,
            );
        });
    }
});
