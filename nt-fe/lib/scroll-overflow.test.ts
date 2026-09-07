import { describe, expect, it } from "bun:test";
import { measureScrollOverflow } from "./scroll-overflow";

describe("measureScrollOverflow", () => {
    it("reports no overflow at the top of a short list", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 0,
                scrollHeight: 200,
                clientHeight: 200,
            }),
        ).toEqual({ hasContentAbove: false, hasContentBelow: false });
    });

    it("ignores sub-pixel scroll at the top", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 1,
                scrollHeight: 400,
                clientHeight: 200,
            }).hasContentAbove,
        ).toBe(false);
    });

    it("marks content above once the list has scrolled", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 2,
                scrollHeight: 400,
                clientHeight: 200,
            }),
        ).toEqual({ hasContentAbove: true, hasContentBelow: true });
    });

    it("marks content below when more list remains", () => {
        expect(
            measureScrollOverflow({
                scrollTop: 0,
                scrollHeight: 400,
                clientHeight: 200,
            }),
        ).toEqual({ hasContentAbove: false, hasContentBelow: true });
    });
});
