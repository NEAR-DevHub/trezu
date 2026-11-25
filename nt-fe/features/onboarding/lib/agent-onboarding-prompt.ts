/**
 * Builds the copy-pastable prompt behind the dashboard's "Onboard your agent"
 * card. The prompt walks an AI agent through becoming an independent member of
 * a treasury with its own NEAR account, using near-business-cli
 * (https://github.com/NEAR-DevHub/near-business-cli) and NEAR CLI.
 *
 * Kept pure (no window, env or i18n access) so the exact text the agent
 * receives is covered by unit tests. The prompt is always English: it is read
 * by an agent, not shown in the UI.
 */

/** The backend the near-business CLI talks to unless its config says otherwise. */
export const NEAR_BUSINESS_CLI_DEFAULT_API_BASE =
    "https://api.business.near.com";

/** Where `near account create-account ... save-to-folder` writes the agent's key file. */
export const AGENT_KEY_FOLDER = "~/.near-credentials/implicit";

export interface AgentOnboardingPromptInput {
    /** Treasury (DAO) account id, e.g. `acme.sputnik-dao.near`. */
    treasuryId: string;
    /** One-time invite link from `POST /api/treasury/{dao_id}/member-invites`. */
    inviteUrl: string;
    /** Origin of this web app, e.g. `https://business.near.com`. */
    appBaseUrl: string;
    /** Origin of the backend that issued the invite, e.g. `https://api.business.near.com`. */
    apiBaseUrl: string;
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

function cliApiBaseStep(apiBaseUrl: string): string {
    if (apiBaseUrl === NEAR_BUSINESS_CLI_DEFAULT_API_BASE) {
        return `The near-business CLI already uses ${apiBaseUrl} by default. Nothing to configure.`;
    }
    return `This treasury lives on ${apiBaseUrl}, but the near-business CLI defaults to ${NEAR_BUSINESS_CLI_DEFAULT_API_BASE}. Point the CLI at ${apiBaseUrl} by writing its config file:
   - macOS: ~/Library/Application Support/near-business/config.json
   - Linux: \${XDG_CONFIG_HOME:-~/.config}/near-business/config.json
   - Windows: %APPDATA%\\near-business\\config.json
   Contents (create the folder if needed; if the file already exists, change only "api_base" and set "auth_token" and "account_id" to null):
   {"api_base": "${apiBaseUrl}", "auth_token": null, "account_id": null}`;
}

export function buildAgentOnboardingPrompt({
    treasuryId,
    inviteUrl,
    appBaseUrl,
    apiBaseUrl,
}: AgentOnboardingPromptInput): string {
    const api = trimTrailingSlash(apiBaseUrl);
    const inviteToken = getInviteToken(inviteUrl);
    const membersUrl = getMembersUrl(appBaseUrl, treasuryId);
    const joinRequestsUrl = getJoinRequestsUrl(appBaseUrl, treasuryId);

    return `You are being onboarded as an independent member of the treasury ${treasuryId}.
You will create your own NEAR account, sign in with it, and request to join the treasury. A human member then approves you.

Ground rules (follow them at every step):
- Never ask for, accept, read or use the user's own private keys, seed phrases, wallet files or sessions. Use only the new key you create in step 2. If anything seems to need the user's keys, stop and tell the user instead.
- Never print, paste or send your own private key or auth token anywhere, including chat. Refer to the key by its file path only.
- Do not move funds or create treasury requests as part of this onboarding.
- Run the steps in order. Each step lists its expected outcome. If the outcome differs, stop, report the exact command and output to the user, and do not improvise a workaround.

Values used below:
- Treasury: ${treasuryId}
- Invite link (one-time, expires 30 days after it was created): ${inviteUrl}
- Invite token: ${inviteToken}
- API: ${api}
- Treasury members page: ${membersUrl}
- Join requests page: ${joinRequestsUrl}

Step 1. Install the tools.
   NEAR CLI:
   - macOS/Linux/WSL: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
   - Windows PowerShell: irm https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.ps1 | iex
   near-business-cli (https://github.com/near-devhub/near-business-cli):
   - macOS/Linux: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/NEAR-DevHub/near-business-cli/releases/latest/download/near-business-cli-installer.sh | sh
   - Windows PowerShell: powershell -ExecutionPolicy Bypass -c "irm https://github.com/NEAR-DevHub/near-business-cli/releases/latest/download/near-business-cli-installer.ps1 | iex"
   - or, with Node.js: npm install -g near-business-cli
   Expected: \`near --version\` and \`near-business --version\` both print a version. Open a new shell if the commands are not found yet.

Step 2. Create your own NEAR account.
   Run exactly:
   near account create-account fund-later use-auto-generation save-to-folder ${AGENT_KEY_FOLDER}
   Expected: the CLI says a file was saved, at ${AGENT_KEY_FOLDER}/<account-id>.json. <account-id> is a 64-character lowercase hex string (an implicit account); it is also the "implicit_account_id" field in that file. Use this <account-id> below. Keep the file; it is your only key.

Step 3. Initialize the account on chain through the treasury backend (no auth needed; the CLI has no command for this):
   curl -sS -X POST ${api}/api/user/create -H 'content-type: application/json' -d '{"accountId": "<account-id>"}'
   Expected: HTTP 200 with {"accountId": "<account-id>", "created": true}. HTTP 409 "Account <account-id> already exists" also means the account is ready.

Step 4. Point the near-business CLI at the right backend.
   ${cliApiBaseStep(api)}

Step 5. Sign in with the new account.
   near-business auth login <account-id> sign-with-access-key-file ${AGENT_KEY_FOLDER}/<account-id>.json
   Expected: "Logged in as <account-id>". The CLI stores your session token in its config file (the "auth_token" field) and accepts the terms of service for your own account. If login fails right after step 3, wait 10 seconds and retry once.

Step 6. Accept the treasury invite as <account-id>.
   a) Check the invite: curl -sS ${api}/api/member-invites/${inviteToken}
      Expected: JSON with "daoId": "${treasuryId}" and "status": "valid". If the status is "used" or "expired", stop and ask the user to copy a fresh prompt from the dashboard.
   b) Join. Read "auth_token" from the near-business config file (without printing it) and send it as a cookie:
      curl -sS -X POST ${api}/api/member-invites/${inviteToken}/join -H 'content-type: application/json' -H "Cookie: auth_token=$AUTH_TOKEN" -d '{"displayName": "<a short name for yourself, e.g. your agent name>"}'
      Expected: HTTP 200 with {"daoId": "${treasuryId}", "requestId": "<uuid>"}. HTTP 409 "A pending join request already exists" means you already joined; continue. HTTP 401 means the login from step 5 did not stick; redo step 5.

Step 7. Report back to the user. Tell them:
   - your account id (<account-id>) and the key file path (never its contents),
   - the join request id from step 6,
   - this instruction: "Open ${joinRequestsUrl} (Members > Join requests on ${membersUrl}), pick a role for <account-id> and confirm. That creates a members request that the treasury's approvers must approve before I can act."
   Expected outcome once approved: \`near-business treasury list\` shows ${treasuryId}. Offer to run it when the user says the request was approved.`;
}
