/**
 * Shared NearConnect mock wallet constants used by E2E tests.
 *
 * The mock wallet intercepts the NearConnect manifest CDN URLs and serves a
 * custom in-process executor. For delegate actions, it calls the sandbox's
 * signing endpoint to produce valid Ed25519 signatures that the relay accepts.
 */

export const MOCK_MANIFEST_ID = "mock-wallet";

/**
 * The sandbox mock server URL for delegate action signing.
 * This runs inside the sandbox-init process on port 4000.
 */
const SANDBOX_MOCK_URL = "http://localhost:4000";

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
      try {
      const accountId = window.sandboxedLocalStorage.getItem('signedAccountId') || '';

      // Fetch current nonce and block hash from sandbox RPC
      const rpcResp = await fetch('http://localhost:3030', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'query',
          params: {
            request_type: 'view_access_key',
            finality: 'final',
            account_id: accountId,
            public_key: 'ed25519:5BGSaf6YjVm7565VzWQHNxoyEjwr3jUpRJSGjREvU9dB',
          },
        }),
      });
      const rpcData = await rpcResp.json();
      const nonce = (rpcData.result?.nonce || 0) + 1;

      // Get current block height for maxBlockHeight
      const blockResp = await fetch('http://localhost:3030', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'status',
          params: [],
        }),
      });
      const blockData = await blockResp.json();
      const currentHeight = blockData.result?.sync_info?.latest_block_height || 999999999;
      const maxBlockHeight = currentHeight + 1000;
      const blockHash = blockData.result?.sync_info?.latest_block_hash || '';

      // Sign each delegate action via the sandbox mock server.
      // Each action gets an incrementing nonce since the relay
      // submits them sequentially and each consumes a nonce.
      const signedDelegateActions = [];
      let currentNonce = nonce;
      for (const da of (p.delegateActions || [])) {
        const actions = (da.actions || []).map(a => {
          if (a.type === 'FunctionCall') {
            const argsStr = typeof a.params.args === 'string'
              ? a.params.args
              : btoa(JSON.stringify(a.params.args));
            return {
              methodName: a.params.methodName,
              args: argsStr,
              gas: String(a.params.gas || '100000000000000'),
              deposit: String(a.params.deposit || '0'),
            };
          }
          return null;
        }).filter(Boolean);

        const resp = await fetch('${SANDBOX_MOCK_URL}/_test/sign-delegate-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderId: accountId,
            receiverId: da.receiverId,
            actions,
            nonce: currentNonce,
            maxBlockHeight,
            blockHash,
          }),
        });
        const result = await resp.json();
        signedDelegateActions.push(result.signedDelegateAction);
        currentNonce += 2; // storage top-up + delegate action = 2 nonces per relay call
      }

      return { signedDelegateActions };
      } catch (err) {
        console.error('[mock-wallet] signDelegateActions error:', err);
        throw err;
      }
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
