import { describe, expect, it } from "bun:test";
import { getTransactionExplorerLink } from "./blockchain-utils";

describe("getTransactionExplorerLink", () => {
    it("links outgoing NEAR transactions to Nearblocks despite foreign token metadata", () => {
        // PublicSent rows from yurtur-treasury: no swap or quote deposit address.
        const rows = [
            [
                "Bitcoin",
                "FuZqsTWcPp8VxVkk6ktTmtF5moFE8npTeoiMiGeZ9Fxu",
                "B8x54EhKFpof7oEt7dDn8ZN8pRS9kPeWApD9tZQXbRS9",
            ],
            [
                "Solana",
                "8ohWG2DcLSSC6rzhzgLbvVpsKW5hBxLvwCRUH26nvneE",
                "9qZ6CNVnsJVLYqHwaDgkCE9NWJ8vHc9HWXquQFexKQU2",
            ],
            [
                "Ethereum",
                "Kt2bESZWeNLmJ68Cp91G5uHhYM39LhHV923YRbEVZNu",
                "2UywKvNsqRYyA3eisECoPPX78mb1BfjbmqLcXf2c8VDh",
            ],
            [
                "Ethereum",
                "3dCVWqncBh2njChuz8xEX15QTSavZfTckQgae1Np9EM9",
                "FgEwTkmqw7BZmGn5HpJZPrFDcems2AS6QMLKMr74VG83",
            ],
            [
                "BNB Smart Chain",
                "GyLkH34SvZDkyMuqDC1LmtgoYKFEDKiX49aLHHXLV8Xr",
                "12mBjGP67pHFBhjSuvYpzzb2ot284KZaMWTQKkVMoRvQ",
            ],
        ];
        for (const [chainName, transactionHash, receiptId] of rows) {
            expect(
                getTransactionExplorerLink({
                    chainName,
                    transactionHash,
                    receiptIds: [receiptId],
                }),
            ).toEqual({
                url: `https://nearblocks.io/txns/${transactionHash}`,
                source: "chain",
            });
        }
    });

    it("links NEAR swaps to Nearblocks regardless of token origin", () => {
        for (const chainName of ["ethereum", "solana", "bitcoin"]) {
            expect(
                getTransactionExplorerLink({
                    transactionHash: "near-swap-hash",
                    chainName,
                    isExchange: true,
                }),
            ).toEqual({
                url: "https://nearblocks.io/txns/near-swap-hash",
                source: "chain",
            });
        }
    });

    it("preserves destination explorer links for external transfers", () => {
        expect(
            getTransactionExplorerLink({
                transactionHash: "external-hash",
                chainName: "ethereum",
                receiptIds: [],
            }),
        ).toEqual({
            url: "https://etherscan.io/tx/external-hash",
            source: "chain",
        });
    });

    it("keeps the Intents link when a quote deposit address is available", () => {
        expect(
            getTransactionExplorerLink({
                depositAddress: "deposit-address",
                receiptIds: ["near-receipt"],
                transactionHash: "near-swap-hash",
                chainName: "ethereum",
                isExchange: true,
            }),
        ).toEqual({
            url: "https://explorer.near-intents.org/transactions/deposit-address",
            source: "intents",
        });
    });
});
