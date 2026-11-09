import { isEthImplicitNearAddress } from "@/lib/near-validation";

/**
 * Eth-implicit accounts (`0x` + 40 hex) are valid NEAR recipients, but no
 * sign-in wallet returns that account id, so they cannot act as members.
 * Named accounts, 64-hex implicit accounts, and `0s` wallet-contract
 * accounts stay allowed.
 */
export function isDisallowedMemberAccountId(accountId: string): boolean {
    return isEthImplicitNearAddress(accountId.trim().toLowerCase());
}
