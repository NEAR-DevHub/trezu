import { describe, expect, it } from "bun:test";
import Big from "./big";
import { sanitizeAmountInput } from "./sanitize-amount-input";

describe("sanitizeAmountInput", () => {
    it("drops a second decimal separator", () => {
        expect(sanitizeAmountInput("0.5.")).toBe("0.5");
        expect(sanitizeAmountInput("1.2.3")).toBe("1.23");
        expect(sanitizeAmountInput("..")).toBe(".");
    });

    it("keeps a single trailing dot so a decimal can be typed", () => {
        expect(sanitizeAmountInput("0.")).toBe("0.");
        expect(sanitizeAmountInput("0.5")).toBe("0.5");
        expect(sanitizeAmountInput(".")).toBe(".");
        expect(sanitizeAmountInput("0.50")).toBe("0.50");
    });

    it("strips other characters and leading zeros", () => {
        expect(sanitizeAmountInput("$10.5")).toBe("10.5");
        expect(sanitizeAmountInput("0010")).toBe("10");
        expect(sanitizeAmountInput("abc")).toBe("");
        expect(sanitizeAmountInput("1,234.56")).toBe("1234.56");
    });

    it("leaves a value Big can parse", () => {
        expect(Big(sanitizeAmountInput("0.5.")).toString()).toBe("0.5");
        expect(Big(sanitizeAmountInput("1.2.3")).toString()).toBe("1.23");
    });
});
