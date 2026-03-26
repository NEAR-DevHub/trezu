/**
 * Shared NearConnect mock wallet constants used by trezu-wallet.spec.ts
 * and trezu-wallet-integration.spec.ts.
 *
 * The mock wallet intercepts the NearConnect manifest CDN URLs and serves a
 * custom in-process executor that reads/writes a sandboxed localStorage key
 * instead of talking to a real NEAR wallet.
 */

export const MOCK_MANIFEST_ID = "mock-wallet";

export const MOCK_WALLET_EXECUTOR_JS = `(function() {
  window.selector.ready({
    async signIn({ network }) {
      const a = window.sandboxedLocalStorage.getItem('signedAccountId') || '';
      return a ? [{ accountId: a, publicKey: '' }] : [];
    },
    async signOut() {
      window.sandboxedLocalStorage.removeItem('signedAccountId');
    },
    async getAccounts({ network }) {
      const a = window.sandboxedLocalStorage.getItem('signedAccountId');
      if (!a) return [];
      return [{ accountId: a, publicKey: '' }];
    },
    async verifyOwner() { throw new Error('Not supported'); },
    async signMessage()  { throw new Error('Not supported'); },
    async signAndSendTransaction(p)  { return {}; },
    async signAndSendTransactions(p) { return []; },
    async signDelegateActions(p) {
      return {
        signedDelegateActions: (p.delegateActions || []).map((da, i) => ({
          delegateAction: {
            senderId: window.sandboxedLocalStorage.getItem('signedAccountId') || '',
            receiverId: da.receiverId,
            actions: da.actions,
            nonce: i + 1,
            maxBlockHeight: 999999999,
            publicKey: { keyType: 0, data: Array.from(new Uint8Array(32)) },
          },
          signature: { keyType: 0, data: Array.from(new Uint8Array(64)) },
        })),
      };
    },
  });
})();`;

export const MOCK_MANIFEST = {
    wallets: [
        {
            id: MOCK_MANIFEST_ID,
            name: "Mock Wallet",
            icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
            website: "https://example.com",
            description: "Mock wallet for testing",
            version: "1.0.0",
            type: "sandbox",
            executor: "/_near-connect-test/mock-wallet.js",
            features: { signDelegateActions: true, signInAndSignMessage: true },
            permissions: { allowsOpen: false },
        },
    ],
};
