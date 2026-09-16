import { describe, expect, it } from "bun:test";
import { decodeCalldataBuiltin, splitCalldata } from "./calldata";

describe("built-in selector table", () => {
    it("decodes an ERC-20 transfer with a checksummed address argument", () => {
        const input =
            "0xa9059cbb000000000000000000000000d025b38762b4a4e36f0cde483b86cb13ea00d98900000000000000000000000000000000000000000000000000000000000f4240" as const;
        const decoded = decodeCalldataBuiltin(input);
        expect(decoded?.signature).toBe("transfer(address,uint256)");
        expect(decoded?.source).toBe("built-in selector table");
        expect(decoded?.args).toEqual([
            {
                name: "to",
                type: "address",
                value: "0xd025b38762B4A4E36F0Cde483b86CB13ea00D989",
            },
            { name: "amount", type: "uint256", value: "1000000" },
        ]);
    });

    it("returns null for an unknown selector and splits calldata", () => {
        expect(decodeCalldataBuiltin("0x31f57d22")).toBeNull();
        expect(decodeCalldataBuiltin("0x8456cb59")).toEqual({
            functionName: "pause",
            signature: "pause()",
            args: [],
            source: "built-in selector table",
        });
        expect(splitCalldata("0x31f57d2200")).toEqual({
            selector: "0x31f57d22",
            args: "0x00",
            byteLength: 5,
        });
        expect(splitCalldata("0x")).toEqual({
            selector: null,
            args: null,
            byteLength: 0,
        });
    });
});
