import { describe, expect, it } from "bun:test";
import { walletAddressAutofillUnlock } from "./wallet-address-input-props";

describe("walletAddressAutofillUnlock", () => {
    it("unlocks and asks for a second focus on the first focus", () => {
        expect(walletAddressAutofillUnlock(true)).toEqual({
            readOnly: false,
            refocus: true,
        });
    });

    it("does not steal focus again after the first focus", () => {
        expect(walletAddressAutofillUnlock(false)).toEqual({
            readOnly: false,
            refocus: false,
        });
    });
});
