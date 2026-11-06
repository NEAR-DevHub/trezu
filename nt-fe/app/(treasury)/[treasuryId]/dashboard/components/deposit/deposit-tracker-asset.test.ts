import { describe, expect, test } from "bun:test";
import { trackerAssetState } from "./deposit-tracker-asset";

describe("trackerAssetState", () => {
    test("a confirmed asset is shown as fact whatever the status", () => {
        expect(
            trackerAssetState({ status: "failed", assetConfirmed: true }),
        ).toBe("confirmed");
        expect(
            trackerAssetState({ status: "detected", assetConfirmed: true }),
        ).toBe("confirmed");
    });

    test("an unconfirmed asset is confirming while in flight", () => {
        expect(
            trackerAssetState({ status: "detected", assetConfirmed: false }),
        ).toBe("confirming");
        expect(
            trackerAssetState({ status: "finalized", assetConfirmed: false }),
        ).toBe("confirming");
    });

    test("an unconfirmed asset on a failed deposit is unknown for good", () => {
        expect(
            trackerAssetState({ status: "failed", assetConfirmed: false }),
        ).toBe("unknown");
    });
});
