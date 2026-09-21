import { describe, expect, test } from "bun:test";
import { AxiosError, type AxiosResponse } from "axios";
import { toAppError } from "./app-error";

function axiosError(
    status: number,
    data: unknown,
    headers: Record<string, string> = {},
): AxiosError {
    const response = { status, data, headers } as unknown as AxiosResponse;
    return new AxiosError("Request failed", "ERR", undefined, null, response);
}

describe("toAppError", () => {
    test("reads the backend envelope and the request id header", () => {
        const error = toAppError(
            axiosError(
                422,
                {
                    error: {
                        code: "TX_FAILED",
                        funds_state: "failed_onchain",
                        retryable: false,
                        details: { tx_hash: "8xQk", reason: "ALREADY_VOTED" },
                    },
                },
                { "x-request-id": "a1b2c3d4e5f6" },
            ),
        );
        expect(error).toEqual({
            code: "TX_FAILED",
            fundsState: "failed_onchain",
            retryable: false,
            requestId: "a1b2c3d4e5f6",
            txHash: "8xQk",
            reason: "ALREADY_VOTED",
        });
    });

    test("keeps an unknown outcome as unknown", () => {
        const error = toAppError(
            axiosError(504, {
                error: {
                    code: "TX_STATUS_UNKNOWN",
                    funds_state: "unknown",
                    retryable: true,
                    details: {},
                },
            }),
        );
        expect(error.code).toBe("TX_STATUS_UNKNOWN");
        expect(error.fundsState).toBe("unknown");
    });

    test("falls back to UNEXPECTED for a code it does not know", () => {
        const error = toAppError(
            axiosError(500, {
                error: {
                    code: "BRAND_NEW",
                    funds_state: "none",
                    retryable: true,
                },
            }),
        );
        expect(error.code).toBe("UNEXPECTED");
        expect(error.fundsState).toBe("none");
    });

    test("does not claim funds are untouched for a legacy 5xx body", () => {
        const error = toAppError(
            axiosError(500, { success: false, error: "Failed to relay" }),
        );
        expect(error.code).toBe("UNEXPECTED");
        expect(error.fundsState).toBe("unknown");
    });

    test("maps a request with no response to SERVICE_UNAVAILABLE", () => {
        const error = toAppError(
            new AxiosError("Network Error", "ERR_NETWORK"),
        );
        expect(error.code).toBe("SERVICE_UNAVAILABLE");
        expect(error.retryable).toBe(true);
    });

    test("separates a wallet cancel from a wallet failure", () => {
        expect(toAppError(new Error("User rejected the request")).code).toBe(
            "WALLET_REJECTED",
        );
        expect(toAppError(new Error("couldnt_parse_arg_tx")).code).toBe(
            "WALLET_FAILED",
        );
    });
});
