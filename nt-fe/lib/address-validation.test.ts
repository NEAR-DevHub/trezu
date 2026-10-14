import { describe, expect, it } from "bun:test";
import { isValidAddress } from "./address-validation";

describe("Starknet and EVM-length addresses", () => {
    it("rejects a 40-hex EVM address for Starknet", () => {
        expect(
            isValidAddress(
                "0x28C6c06298d514Db089934071355E5743bf21d60",
                "starknet",
            ),
        ).toBe(false);
    });

    it("accepts 63- and 64-hex Starknet addresses", () => {
        expect(
            isValidAddress(
                "0x0b9d5a2f04d2b0d8d8e42f2b7f4f0e0b06b2c9b7e2c9c0f1a2b3c4d5e6f70819",
                "starknet",
            ),
        ).toBe(true);
        expect(
            isValidAddress(
                "0x5ce53b9b68fb8e9ecab9283a96d97948914733fd6ed8d9a53a276a419497841",
                "starknet",
            ),
        ).toBe(true);
    });

    it("leaves Sui and Aptos 64-hex addresses valid", () => {
        const addr =
            "0x0b9d5a2f04d2b0d8d8e42f2b7f4f0e0b06b2c9b7e2c9c0f1a2b3c4d5e6f70819";
        expect(isValidAddress(addr, "sui")).toBe(true);
        expect(isValidAddress(addr, "aptos")).toBe(true);
    });
});
