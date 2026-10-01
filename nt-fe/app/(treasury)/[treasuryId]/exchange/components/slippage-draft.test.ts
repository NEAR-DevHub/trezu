import { describe, expect, it } from "bun:test";
import { sanitizeSlippageDraft, slippageFromDraft } from "./slippage-draft";

describe("sanitizeSlippageDraft", () => {
    it("keeps a partial decimal so 0.5 can be typed", () => {
        expect(sanitizeSlippageDraft("0")).toBe("0");
        expect(sanitizeSlippageDraft("0.")).toBe("0.");
        expect(sanitizeSlippageDraft("0.5")).toBe("0.5");
        expect(sanitizeSlippageDraft("1.")).toBe("1.");
        expect(sanitizeSlippageDraft("1.5")).toBe("1.5");
    });

    it("drops a second decimal separator", () => {
        expect(sanitizeSlippageDraft("0.5.")).toBe("0.5");
        expect(sanitizeSlippageDraft("1.2.3")).toBe("1.23");
    });

    it("treats a comma as a decimal point", () => {
        expect(sanitizeSlippageDraft("0,5")).toBe("0.5");
        expect(sanitizeSlippageDraft("0,")).toBe("0.");
    });

    it("caps the fraction at 2 digits", () => {
        expect(sanitizeSlippageDraft("0.555")).toBe("0.55");
        expect(sanitizeSlippageDraft("0.50")).toBe("0.50");
    });

    it("strips leading zeros without touching 0.", () => {
        expect(sanitizeSlippageDraft("00.5")).toBe("0.5");
        expect(sanitizeSlippageDraft("007")).toBe("7");
    });
});

describe("slippageFromDraft", () => {
    it("parses a finished draft and leaves incomplete ones at 0", () => {
        expect(slippageFromDraft("")).toBe(0);
        expect(slippageFromDraft(".")).toBe(0);
        expect(slippageFromDraft("0.")).toBe(0);
        expect(slippageFromDraft("0.5")).toBe(0.5);
        expect(slippageFromDraft("0.50")).toBe(0.5);
        expect(slippageFromDraft("1.25")).toBe(1.25);
    });

    it("matches the basis points the quote sends", () => {
        for (const draft of ["0.01", "0.07", "0.29", "0.5", "1.13", "100"]) {
            const slippage = slippageFromDraft(draft);
            expect(Math.round(slippage * 100)).toBe(
                Math.round(Number(draft) * 100),
            );
        }
    });
});
