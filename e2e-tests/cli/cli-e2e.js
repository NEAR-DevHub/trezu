/**
 * End-to-End Test: trezu CLI against local sandbox
 *
 * Exercises every top-level CLI command non-interactively by invoking the
 * compiled `trezu` binary as a child process. Sandbox + nt-be backend must
 * already be running (see ../bulk-payment/README.md for setup).
 *
 * What it covers:
 *   - auth login / whoami / logout (sign-with-private-key)
 *   - treasury list / info
 *   - assets / activity / members
 *   - address-book add / list / remove
 *   - payments send (delegate action -> Trezu relay -> DAO proposal)
 *   - requests list / pending / view / approve / reject
 *
 * Configuration via env vars (defaults match the docker sandbox):
 *   SANDBOX_RPC_URL    - default http://localhost:3030
 *   API_URL            - default http://localhost:8080
 *   TREZU_BIN          - default ../../nt-cli/target/debug/trezu
 *   DAO_FACTORY_ID     - default sputnik-dao.near
 *   GENESIS_ACCOUNT_ID - default test.near
 *   GENESIS_PRIVATE_KEY- default sandbox genesis key
 *   DAO_NAME           - default cli-e2e-<timestamp>
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, utils } = nearAPI;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG = {
  SANDBOX_RPC_URL: process.env.SANDBOX_RPC_URL || 'http://localhost:3030',
  API_URL: process.env.API_URL || 'http://localhost:8080',
  TREZU_BIN:
    process.env.TREZU_BIN ||
    path.resolve(__dirname, '../../nt-cli/target/debug/trezu'),
  DAO_FACTORY_ID: process.env.DAO_FACTORY_ID || 'sputnik-dao.near',
  GENESIS_ACCOUNT_ID: process.env.GENESIS_ACCOUNT_ID || 'test.near',
  GENESIS_PRIVATE_KEY:
    process.env.GENESIS_PRIVATE_KEY ||
    'ed25519:3tgdk2wPraJzT4nsTuf86UX41xgPNk3MHnq8epARMdBNs29AFEztAuaQ7iHddDfXG9F2RzV1XNQYgJyAyoW51UBB',
  DAO_NAME: process.env.DAO_NAME || `cli-e2e-${Date.now().toString(36)}`,
};

// Isolated XDG_CONFIG_HOME so the test never clobbers the user's real config.
const XDG_HOME = mkdtempSync(path.join(tmpdir(), 'trezu-cli-e2e-'));
mkdirSync(path.join(XDG_HOME, 'trezu'), { recursive: true });

// near-cli-rs config dir (used by sign-with-keychain et al.)
const NEAR_HOME = mkdtempSync(path.join(tmpdir(), 'trezu-near-'));

const CLI_ENV = {
  ...process.env,
  XDG_CONFIG_HOME: XDG_HOME,
  HOME: NEAR_HOME, // used as fallback for near-cli-rs credentials dir
  // Disable color so output is easier to grep
  NO_COLOR: '1',
  TERM: 'dumb',
  TREZU_DEBUG_AUTH: '1',
};

process.on('exit', () => {
  try { rmSync(XDG_HOME, { recursive: true, force: true }); } catch {}
  try { rmSync(NEAR_HOME, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Trezu config + CLI runner
// ---------------------------------------------------------------------------

function writeTrezuConfig(extra = {}) {
  const cfg = {
    api_base: CONFIG.API_URL,
    auth_token: null,
    account_id: null,
    ...extra,
  };
  writeFileSync(
    path.join(XDG_HOME, 'trezu', 'config.json'),
    JSON.stringify(cfg, null, 2),
  );
}

function readTrezuConfig() {
  const p = path.join(XDG_HOME, 'trezu', 'config.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/**
 * Run the trezu binary with the given argv.
 * Resolves with { code, stdout, stderr }. Never rejects; assertion is the
 * caller's responsibility so we can also test error paths.
 */
function runCli(args, { input, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(CONFIG.TREZU_BIN, args, {
      env: CLI_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: -1, stdout, stderr: stderr + '\n[TIMEOUT]' });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function expectOk(args, { contains } = {}) {
  const res = await runCli(args);
  const out = `${res.stdout}\n${res.stderr}`;
  if (res.code !== 0) {
    console.error(`\n[FAIL] trezu ${args.join(' ')}\n${out}`);
    throw new Error(`Expected exit 0, got ${res.code}`);
  }
  if (contains) {
    for (const needle of [].concat(contains)) {
      if (!out.includes(needle)) {
        console.error(`\n[FAIL] expected output to contain ${JSON.stringify(needle)}\n${out}`);
        throw new Error(`Missing expected substring: ${needle}`);
      }
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// NEAR + DAO setup (reused pattern from bulk-payment tests)
// ---------------------------------------------------------------------------

async function setupNear() {
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(CONFIG.GENESIS_PRIVATE_KEY);
  await keyStore.setKey('sandbox', CONFIG.GENESIS_ACCOUNT_ID, keyPair);
  const near = await connect({
    networkId: 'sandbox',
    keyStore,
    nodeUrl: CONFIG.SANDBOX_RPC_URL,
  });
  const account = await near.account(CONFIG.GENESIS_ACCOUNT_ID);
  return { near, account, keyStore, keyPair };
}

async function createDao(account, daoName) {
  const daoAccountId = `${daoName}.${CONFIG.DAO_FACTORY_ID}`;
  const args = {
    name: daoName,
    args: Buffer.from(JSON.stringify({
      config: { name: daoName, purpose: 'cli-e2e', metadata: '' },
      policy: {
        roles: [{
          kind: { Group: [account.accountId] },
          name: 'council',
          permissions: ['*:*'],
          vote_policy: {},
        }],
        default_vote_policy: { weight_kind: 'RoleWeight', quorum: '0', threshold: [1, 2] },
        proposal_bond: '100000000000000000000000',
        proposal_period: '604800000000000',
        bounty_bond: '100000000000000000000000',
        bounty_forgiveness_period: '604800000000000',
      },
    })).toString('base64'),
  };
  try {
    await account.functionCall({
      contractId: CONFIG.DAO_FACTORY_ID,
      methodName: 'create',
      args,
      gas: '300000000000000',
      attachedDeposit: utils.format.parseNearAmount('100'),
    });
    console.log(`✅ DAO created: ${daoAccountId}`);
  } catch (e) {
    if (!String(e.message || '').includes('already exists')) throw e;
    console.log(`ℹ️  DAO ${daoAccountId} already exists, reusing`);
  }
  // Top up so it can pay for proposals.
  await account.sendMoney(daoAccountId, BigInt(utils.format.parseNearAmount('50')));
  return daoAccountId;
}

async function ensureDaoMember(accountId, daoAccountId) {
  // Nudge the backend to pick up DAO membership so authorized endpoints work.
  await fetch(`${CONFIG.API_URL}/api/user/treasuries/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, daoId: daoAccountId }),
  }).catch(() => {});
  await fetch(`${CONFIG.API_URL}/api/dao/mark-dirty`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ daoId: daoAccountId }),
  }).catch(() => {});

  for (let i = 0; i < 30; i++) {
    const r = await fetch(
      `${CONFIG.API_URL}/api/user/treasuries?accountId=${encodeURIComponent(accountId)}`,
    ).catch(() => null);
    if (r?.ok) {
      const list = await r.json();
      if (Array.isArray(list) && list.some(t =>
        (t.daoId === daoAccountId || t.dao_id === daoAccountId) &&
        (t.isMember === true || t.is_member === true))) {
        return;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.warn(`⚠️  DAO membership for ${daoAccountId} did not sync — read commands may still work but write commands may fail.`);
}

async function getLastProposalId(account, daoAccountId) {
  const next = await account.viewFunction({
    contractId: daoAccountId, methodName: 'get_last_proposal_id', args: {},
  });
  return next - 1;
}

// ---------------------------------------------------------------------------
// Sign-with-private-key suffix used by every command that signs a tx
// ---------------------------------------------------------------------------

const SIGN_SUFFIX = [
  'network-config', 'sandbox',
  'sign-with-private-key',
  '--signer-public-key', KeyPair.fromString(CONFIG.GENESIS_PRIVATE_KEY).getPublicKey().toString(),
  '--signer-private-key', CONFIG.GENESIS_PRIVATE_KEY,
  'send',
];

// For NEP-413 (login) — no network-config / send suffix.
const NEP413_SIGN_SUFFIX = [
  'sign-with-plaintext-private-key',
  CONFIG.GENESIS_PRIVATE_KEY,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== trezu CLI e2e ===');
  console.log('Binary:', CONFIG.TREZU_BIN);
  console.log('Sandbox:', CONFIG.SANDBOX_RPC_URL);
  console.log('API:', CONFIG.API_URL);
  console.log('XDG_CONFIG_HOME:', XDG_HOME);

  if (!existsSync(CONFIG.TREZU_BIN)) {
    throw new Error(`trezu binary not found at ${CONFIG.TREZU_BIN}. Build it with: cd nt-cli && cargo build`);
  }

  // 0. Sandbox / backend reachability
  const health = await fetch(`${CONFIG.API_URL}/api/health`).catch(() => null);
  assert.ok(health?.ok, `nt-be health check failed at ${CONFIG.API_URL}/api/health`);

  // 1. Spin up DAO on sandbox
  const { account } = await setupNear();
  const daoAccountId = await createDao(account, CONFIG.DAO_NAME);

  // 2. Configure trezu pointing to local backend, then login.
  writeTrezuConfig();

  console.log('\n--- auth login ---');
  await expectOk(
    ['auth', 'login', CONFIG.GENESIS_ACCOUNT_ID, ...NEP413_SIGN_SUFFIX],
    { contains: 'Logged in' },
  );

  const cfgAfterLogin = readTrezuConfig();
  assert.equal(cfgAfterLogin.account_id, CONFIG.GENESIS_ACCOUNT_ID);
  assert.ok(cfgAfterLogin.auth_token, 'auth_token should be persisted in config');

  // Backend needs DAO membership recorded before authorized endpoints work.
  await ensureDaoMember(CONFIG.GENESIS_ACCOUNT_ID, daoAccountId);

  console.log('\n--- auth whoami ---');
  await expectOk(['auth', 'whoami'], { contains: CONFIG.GENESIS_ACCOUNT_ID });

  // 3. Treasury read commands
  console.log('\n--- treasury list ---');
  await expectOk(['treasury', 'list'], { contains: daoAccountId });

  console.log('\n--- treasury info ---');
  await expectOk(['treasury', 'info', daoAccountId]);

  console.log('\n--- assets ---');
  await expectOk(['assets', daoAccountId]);

  console.log('\n--- activity ---');
  await expectOk(['activity', daoAccountId]);

  console.log('\n--- members ---');
  await expectOk(['members', daoAccountId], { contains: CONFIG.GENESIS_ACCOUNT_ID });

  // 4. Address book CRUD
  console.log('\n--- address-book add ---');
  const abName = `friend-${Date.now()}`;
  await expectOk([
    'address-book', daoAccountId, 'add',
    '--name', abName,
    '--address', 'frol.near',
    '--networks', 'near',
    '--note', 'cli-e2e',
  ]);

  console.log('\n--- address-book list ---');
  const abList = await expectOk(['address-book', daoAccountId, 'list'], { contains: abName });
  // Best-effort: pull entry id out of the table for removal
  const idMatch = abList.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  if (idMatch) {
    console.log('\n--- address-book remove ---');
    await expectOk(['address-book', daoAccountId, 'remove', idMatch[0]]);
  }

  // 5. Requests (start with empty list)
  console.log('\n--- requests list ---');
  await expectOk(['requests', daoAccountId, 'list']);

  console.log('\n--- requests pending ---');
  await expectOk(['requests', daoAccountId, 'pending']);

  // 6. Payment proposal — exercises the full delegate-action -> relay path
  console.log('\n--- payments send ---');
  const beforeId = await getLastProposalId(account, daoAccountId).catch(() => -1);
  await expectOk([
    'payments', daoAccountId, 'send',
    'NEAR', '0.01', 'frol.near', 'cli-e2e payment',
    ...SIGN_SUFFIX,
  ], { contains: 'trezu.app' }); // proposal link is printed on success

  // Wait for indexer to pick up the new proposal.
  let newId = beforeId;
  for (let i = 0; i < 30; i++) {
    newId = await getLastProposalId(account, daoAccountId).catch(() => beforeId);
    if (newId > beforeId) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(newId > beforeId, `expected a new proposal id after payments send (was ${beforeId}, got ${newId})`);

  console.log(`✅ proposal #${newId} created via CLI`);

  console.log('\n--- requests view ---');
  await expectOk(['requests', daoAccountId, 'view', String(newId)]);

  // Wait until the backend indexer surfaces the proposal so approve can find it.
  for (let i = 0; i < 30; i++) {
    const r = await runCli(['requests', daoAccountId, 'list']);
    if (`${r.stdout}${r.stderr}`.includes(`#${newId}`) ||
        `${r.stdout}${r.stderr}`.includes(` ${newId} `)) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('\n--- requests approve ---');
  await expectOk([
    'requests', daoAccountId, 'approve', String(newId),
    ...SIGN_SUFFIX,
  ], { contains: 'trezu.app' });

  // 7. Create a second proposal and reject it
  console.log('\n--- payments send (for reject test) ---');
  const beforeId2 = await getLastProposalId(account, daoAccountId);
  await expectOk([
    'payments', daoAccountId, 'send',
    'NEAR', '0.01', 'frol.near', 'cli-e2e to reject',
    ...SIGN_SUFFIX,
  ]);
  let rejectId = beforeId2;
  for (let i = 0; i < 30; i++) {
    rejectId = await getLastProposalId(account, daoAccountId);
    if (rejectId > beforeId2) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  assert.ok(rejectId > beforeId2);

  console.log('\n--- requests reject ---');
  await expectOk([
    'requests', daoAccountId, 'reject', String(rejectId),
    ...SIGN_SUFFIX,
  ], { contains: 'trezu.app' });

  // 8. Logout
  console.log('\n--- auth logout ---');
  await expectOk(['auth', 'logout'], { contains: 'Logged out' });
  const cfgAfterLogout = readTrezuConfig();
  assert.equal(cfgAfterLogout.auth_token, null);
  assert.equal(cfgAfterLogout.account_id, null);

  // 9. Negative: commands requiring auth should now fail cleanly
  console.log('\n--- treasury list (unauthenticated, should fail) ---');
  const unauth = await runCli(['treasury', 'list']);
  assert.notEqual(unauth.code, 0, 'expected non-zero exit when not logged in');

  console.log('\n🎉 All CLI e2e tests passed');
}

main().catch((err) => {
  console.error('\n❌ CLI e2e failed:', err);
  process.exit(1);
});
