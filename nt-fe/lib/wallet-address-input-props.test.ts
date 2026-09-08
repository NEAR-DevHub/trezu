import { describe, expect, it } from "bun:test";
import { shouldPreventMobileDialogAutoFocus } from "./wallet-address-input-props";

describe("shouldPreventMobileDialogAutoFocus", () => {
    it("blocks programmatic focus on phones so the first tap can raise the keyboard", () => {
        expect(shouldPreventMobileDialogAutoFocus(375)).toBe(true);
        expect(shouldPreventMobileDialogAutoFocus(1023)).toBe(true);
    });

    it("lets desktop keep dialog auto-focus", () => {
        expect(shouldPreventMobileDialogAutoFocus(1024)).toBe(false);
    });
});
