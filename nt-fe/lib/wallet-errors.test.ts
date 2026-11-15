import { describe, expect, it } from "bun:test";
import { isUserRejection } from "./wallet-errors";

describe("isUserRejection", () => {
    it("treats a dismissed or closed wallet as the user's choice", () => {
        for (const error of [
            new Error("Action was cancelled"),
            new Error("Action was canceled"),
            new Error("Wallet closed"),
            "User rejected the request",
            { message: "Popup closed" },
        ]) {
            expect(isUserRejection(error)).toBe(true);
        }
    });

    it("keeps real wallet failures", () => {
        for (const error of [
            new Error("Invalid credential"),
            new Error("No result from wallet"),
            "Method not found",
            undefined,
        ]) {
            expect(isUserRejection(error)).toBe(false);
        }
    });
});
