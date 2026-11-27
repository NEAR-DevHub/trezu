/**
 * Builds the copy-pastable prompt behind the dashboard's "Onboard your agent"
 * card. The prompt walks an AI agent through becoming an independent member of
 * a treasury with its own NEAR account, using the Trezu CLI (`nt-cli/` in this
 * repository) and NEAR CLI.
 *
 * Kept pure (no window, env or i18n access) so the exact text the agent
 * receives is covered by unit tests. The prompt is always English: it is read
 * by an agent, not shown in the UI.
 */

/**
 * Trezu CLI release the installers come from. CLI releases are tagged with
 * the bare version, so GitHub's `releases/latest` points at app releases
 * instead; bump this when a new `trezu-cli` is released.
 */
export const TREZU_CLI_VERSION = "0.2.1";

/**
 * The treasury CLI the agent uses. Everything CLI-specific in the prompt comes
 * from here, so a fork that ships a renamed build of the same CLI only swaps
 * this object.
 */
export const AGENT_CLI = {
    /** Executable name. */
    bin: "trezu",
    /** Installer scripts of the pinned release. */
    installerSh: `https://github.com/NEAR-DevHub/trezu/releases/download/${TREZU_CLI_VERSION}/trezu-cli-installer.sh`,
    installerPs1: `https://github.com/NEAR-DevHub/trezu/releases/download/${TREZU_CLI_VERSION}/trezu-cli-installer.ps1`,
    /** Install and usage docs. */
    readmeUrl:
        "https://github.com/NEAR-DevHub/trezu/blob/main/nt-cli/README.md",
    /** Non-interactive command reference for scripts and agents. */
    usageUrl:
        "https://github.com/NEAR-DevHub/trezu/blob/main/nt-cli/README.md#using-from-scripts-and-ai-agents",
    /** How a near.com (NEAR Intents) recipient is written. */
    nearComRecipient: (account: string) => `nearcom:${account}`,
    /** Folder under the OS config dir that holds `config.json`. */
    configDirName: "trezu",
    /** The backend the CLI talks to unless its config says otherwise. */
    defaultApiBase: "https://api.trezu.app",
    /** Domains to allowlist when the agent's sandbox blocks the network. */
    networkAllowlist: ["*.trezu.app", "*.fastnear.com"],
} as const;

/** NEAR RPC (used by NEAR CLI) and FastNear indexer API the agent must reach. */
export const FASTNEAR_RPC_URL = "https://archival-rpc.mainnet.fastnear.com";
export const FASTNEAR_API_URL = "https://api.fastnear.com";

/** Where `near account create-account ... save-to-folder` writes the agent's key file. */
export const AGENT_KEY_FOLDER = "~/.near-credentials/implicit";

export interface AgentOnboardingPromptInput {
    /** Treasury (DAO) account id, e.g. `acme.sputnik-dao.near`. */
    treasuryId: string;
    /** One-time invite link from `POST /api/treasury/{dao_id}/member-invites`. */
    inviteUrl: string;
    /** Origin of this web app, e.g. `https://trezu.app`. */
    appBaseUrl: string;
    /** Origin of the backend that issued the invite, e.g. `https://api.trezu.app`. */
    apiBaseUrl: string;
    /** UI locale the user has the app open in, e.g. `en` or `pt-BR`. */
    locale: string;
}

function trimTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
}

/** The invite token is the last path segment of `<app>/join/<token>`. */
export function getInviteToken(inviteUrl: string): string {
    const segments = new URL(inviteUrl).pathname.split("/").filter(Boolean);
    const token = segments.at(-1);
    if (segments.at(-2) !== "join" || !token) {
        throw new Error(`Not an invite link: ${inviteUrl}`);
    }
    return token;
}

export function getMembersUrl(appBaseUrl: string, treasuryId: string): string {
    return `${trimTrailingSlash(appBaseUrl)}/${treasuryId}/members`;
}

export function getJoinRequestsUrl(
    appBaseUrl: string,
    treasuryId: string,
): string {
    return `${getMembersUrl(appBaseUrl, treasuryId)}/join-requests`;
}

/** English name of a locale's language, e.g. `de` → `German`. */
export function getLanguageName(locale: string): string {
    try {
        return (
            new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ??
            locale
        );
    } catch {
        return locale;
    }
}

function cliConfigPaths(): string {
    const dir = AGENT_CLI.configDirName;
    return `   - macOS: ~/Library/Application Support/${dir}/config.json
   - Linux: \${XDG_CONFIG_HOME:-~/.config}/${dir}/config.json
   - Windows: %APPDATA%\\${dir}\\config.json`;
}

function cliApiBaseStep(apiBaseUrl: string): string {
    if (apiBaseUrl === AGENT_CLI.defaultApiBase) {
        return `The ${AGENT_CLI.bin} CLI already uses ${apiBaseUrl} by default. Nothing to configure.`;
    }
    return `This treasury lives on ${apiBaseUrl}, but the ${AGENT_CLI.bin} CLI defaults to ${AGENT_CLI.defaultApiBase}. Point the CLI at ${apiBaseUrl} by writing its config file:
${cliConfigPaths()}
   Contents (create the folder if needed; if the file already exists, change only "api_base" and set "auth_token" and "account_id" to null):
   {"api_base": "${apiBaseUrl}", "auth_token": null, "account_id": null}`;
}

/**
 * Built-in avatars an agent can pick when it joins (`avatarPreset`). Served
 * from `public/avatars/agents/<preset>.svg`; keep in sync with
 * `AGENT_AVATAR_PRESETS` in nt-be `handlers/member_invites`.
 */
export const AGENT_AVATAR_PRESETS = [
    "agent",
    "chatgpt",
    "claude",
    "cursor",
    "gemini",
    "near-ai",
] as const;

export function buildAgentOnboardingPrompt({
    treasuryId,
    inviteUrl,
    appBaseUrl,
    apiBaseUrl,
    locale,
}: AgentOnboardingPromptInput): string {
    const api = trimTrailingSlash(apiBaseUrl);
    const inviteToken = getInviteToken(inviteUrl);
    const joinRequestsUrl = getJoinRequestsUrl(appBaseUrl, treasuryId);
    const language = getLanguageName(locale);
    const allowlist = AGENT_CLI.networkAllowlist.join(" and ");

    return `You are being onboarded as an independent member of the treasury ${treasuryId}.
You will create your own NEAR account, sign in with it, and request to join the treasury. A member of the treasury then approves you.

How to talk to the user:
- The user is not technical. Write to them in ${language} (locale "${locale}"), the language they have the app open in, in short, plain sentences.
- Say what you are doing in everyday words, e.g. "Installing the tools I need", "Creating my own account", "Asking to join your treasury". Do not show them commands, status codes, JSON, file paths, keys or long ids, unless they ask.
- If something goes wrong, say in one or two plain sentences what happened and what they can do about it. Share the exact command and output only if they ask for it.
- The commands, outputs and expected results below are for you, not for the user.

Ground rules (follow them at every step):
- Never ask for, accept, read or use the user's own private keys, seed phrases, wallet files or sessions. Use only the new key you create in step 3. If anything seems to need the user's keys, stop and tell the user instead.
- Never print, paste or send your own private key or auth token anywhere, including chat.
- During onboarding (steps 1 to 8), do not move funds or create treasury requests. Once the user approves you, the "After you are approved" section below applies instead.
- Run the steps in order. Each step lists its expected result. If the result differs, stop, tell the user (as above), and do not improvise a workaround.

Values used below:
- Treasury: ${treasuryId}
- Invite link (one-time, expires 30 days after it was created): ${inviteUrl}
- Invite token: ${inviteToken}
- API: ${api}
- Join requests page: ${joinRequestsUrl}

Step 1. Check that you can reach the services you need.
   curl -sS -o /dev/null -w '%{http_code}\\n' ${api}/api/health
   curl -sS -o /dev/null -w '%{http_code}\\n' ${FASTNEAR_API_URL}/status
   curl -sS -o /dev/null -w '%{http_code}\\n' -X POST ${FASTNEAR_RPC_URL} -H 'content-type: application/json' -d '{"jsonrpc": "2.0", "id": "probe", "method": "status", "params": []}'
   Expected: each prints 200. If any fails, stop here and tell the user, in plain words, that you can't reach the services you need from where you run, and that they need to allow internet access to ${allowlist} in your settings, then tell you to continue.

Step 2. Install the tools.
   NEAR CLI:
   - macOS/Linux/WSL: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
   - Windows PowerShell: irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex
   ${AGENT_CLI.bin} CLI (install guide: ${AGENT_CLI.readmeUrl}):
   - macOS/Linux/WSL: curl --proto '=https' --tlsv1.2 -LsSf ${AGENT_CLI.installerSh} | sh
   - Windows PowerShell: powershell -ExecutionPolicy Bypass -c "irm ${AGENT_CLI.installerPs1} | iex"
   Expected: \`near --version\` prints a version and \`${AGENT_CLI.bin} --help\` prints the command list. Open a new shell if the commands are not found yet.

Step 3. Create your own NEAR account.
   near account create-account fund-later use-auto-generation save-to-folder ${AGENT_KEY_FOLDER}
   Expected: a key file saved at ${AGENT_KEY_FOLDER}/<account-id>.json. <account-id> is a 64-character lowercase hex string; it is also the "implicit_account_id" field in that file. Use it below. Keep the file: it is your only key.

Step 4. Activate the account through the treasury backend (the CLI has no command for this):
   curl -sS -X POST ${api}/api/user/create -H 'content-type: application/json' -d '{"accountId": "<account-id>"}'
   Expected: HTTP 200, or HTTP 409 "already exists". Both mean the account is ready.

Step 5. Point the ${AGENT_CLI.bin} CLI at the right backend.
   ${cliApiBaseStep(api)}

Step 6. Sign in with the new account.
   ${AGENT_CLI.bin} auth login <account-id> sign-with-access-key-file ${AGENT_KEY_FOLDER}/<account-id>.json
   Expected: "Logged in as <account-id>". The CLI saves your session token in its config file (the "auth_token" field). If sign-in fails right after step 4, wait 10 seconds and retry once.

Step 7. Ask to join the treasury.
   a) Check the invite: curl -sS ${api}/api/member-invites/${inviteToken}
      Expected: "status": "valid". If it is "used" or "expired", stop and ask the user to copy a fresh prompt from the dashboard.
   b) Join. Read "auth_token" from the ${AGENT_CLI.bin} config file (without printing it) and send it as a cookie. The file is at:
${cliConfigPaths().replace(/^ {3}/gm, "      ")}
      curl -sS -X POST ${api}/api/member-invites/${inviteToken}/join -H 'content-type: application/json' -H "Cookie: auth_token=$AUTH_TOKEN" -d '{"displayName": "<your name as the user knows you, e.g. Claude or Codex>", "avatarPreset": "<avatar>"}'
      For <avatar>, pick the one that matches the product you are running in: ${AGENT_AVATAR_PRESETS.filter((p) => p !== "agent").join(", ")}. If none matches or you are not sure, use "agent". No other value is accepted.
      Expected: HTTP 200, or HTTP 409 "A pending join request already exists" (you already asked; continue). HTTP 401 means the sign-in did not stick; redo step 6.

Step 8. Tell the user you are ready and ask them to approve you, in a few plain sentences:
   - you set up your own account and asked to join their treasury, and you never needed their keys;
   - they should open ${joinRequestsUrl}, find the request from <the display name you used>, choose what you are allowed to do, and confirm;
   - other members of the treasury may also need to approve it before you can start.
   Expected once approved: \`${AGENT_CLI.bin} treasury list\` shows ${treasuryId}. When the user says they approved you, check it and tell them you are ready.

${afterApproval(treasuryId)}`;
}

function afterApproval(treasuryId: string): string {
    const cli = AGENT_CLI.bin;
    const keyFile = `${AGENT_KEY_FOLDER}/<account-id>.json`;
    const tail = `network-config mainnet sign-with-access-key-file ${keyFile} send`;
    return `After you are approved (keep this for later requests from the user):
- You are now a treasury member. Act on the user's requests to view the treasury, create payment requests and vote, always as <account-id> with your own key file. Keep talking to the user in plain words, as during onboarding.
- Before creating a payment request, repeat what will be paid, how much and to whom in one plain sentence and wait for a yes. Then create it. A payment request is not a payment yet: no funds move until enough members approve it, so tell the user that and give them the link to it.
- You have no terminal (TTY), so always pass the complete command. A missing argument makes the CLI prompt and fail with "The input device is not a TTY".
- Every command that creates or votes on a request ends with exactly:
  ${tail}
  The CLI builds the DAO proposal itself and the treasury backend relays it and pays the gas: there is no gas or deposit to choose. Do not use submit-as-dao-proposal, sign-later or any other option NEAR CLI offers at that point.
- Read:
  ${cli} treasury info ${treasuryId}
  ${cli} assets ${treasuryId}
  ${cli} members ${treasuryId}
  ${cli} activity ${treasuryId}
  ${cli} requests ${treasuryId} pending
  ${cli} requests ${treasuryId} view <request-id>
- Pay:
  ${cli} payments ${treasuryId} send <token> details <amount> <destination-network> <recipient> '<description>' ${tail}
  - <token>: a symbol from \`${cli} assets\` (NEAR, USDC). If the same symbol is held in several forms, add the form: NEAR@near, USDT@intents, USDT@ft.
  - <amount>: what the recipient receives, in whole tokens (0.1, 250).
  - <destination-network> and <recipient>: "near.com" for a near.com (NEAR Intents) balance, recipient written as ${AGENT_CLI.nearComRecipient("alice.near")}; "near" for a NEAR account, recipient like alice.near; for other chains, the bridge asset id (e.g. nep141:eth.omft.near) and an address on that chain. If the user's wording does not make the network clear, ask.
  - Success prints "Delegate action relayed successfully!" and "View proposal: <url>". Give the user that link.
- Vote:
  ${cli} requests ${treasuryId} approve <request-id> ${tail}
  ${cli} requests ${treasuryId} reject <request-id> ${tail}
- Full reference: ${AGENT_CLI.usageUrl}`;
}
