import { describe, expect, it } from "bun:test";
import {
    AGENT_CLI,
    AGENT_KEY_FOLDER,
    buildAgentOnboardingPrompt,
    getInviteToken,
    getLanguageName,
} from "./agent-onboarding-prompt";

const DEFAULT_API = AGENT_CLI.defaultApiBase;

const TREASURY_ID = "acme.sputnik-dao.near";
const TOKEN = "3f2b8c1e-7a4d-4e9b-9c0a-1d2e3f4a5b6c";
const APP = "https://trezu.app";
const INVITE_URL = `${APP}/join/${TOKEN}`;

function build(
    overrides: Partial<Parameters<typeof buildAgentOnboardingPrompt>[0]> = {},
) {
    return buildAgentOnboardingPrompt({
        treasuryId: TREASURY_ID,
        inviteUrl: INVITE_URL,
        appBaseUrl: APP,
        apiBaseUrl: DEFAULT_API,
        locale: "en",
        ...overrides,
    });
}

describe("buildAgentOnboardingPrompt", () => {
    it("embeds the treasury id, invite link and members URLs", () => {
        const prompt = build();

        expect(prompt).toContain(
            `independent member of the treasury ${TREASURY_ID}`,
        );
        expect(prompt).toContain(`Invite link (one-time`);
        expect(prompt).toContain(INVITE_URL);
        expect(prompt).toContain(
            `open ${APP}/${TREASURY_ID}/members/join-requests`,
        );
        expect(prompt).toContain(`- Treasury: ${TREASURY_ID}\n`);
    });

    it("uses the invite token in the invite API calls", () => {
        const prompt = build();

        expect(prompt).toContain(
            `curl -sS ${DEFAULT_API}/api/member-invites/${TOKEN}\n`,
        );
        expect(prompt).toContain(
            `curl -sS -X POST ${DEFAULT_API}/api/member-invites/${TOKEN}/join`,
        );
    });

    it("gives the exact account creation, initialization and login commands", () => {
        const prompt = build();

        expect(prompt).toContain(
            `near account create-account fund-later use-auto-generation save-to-folder ${AGENT_KEY_FOLDER}\n`,
        );
        expect(prompt).toContain(
            `curl -sS -X POST ${DEFAULT_API}/api/user/create -H 'content-type: application/json' -d '{"accountId": "<account-id>"}'`,
        );
        expect(prompt).toContain(
            `trezu auth login <account-id> sign-with-access-key-file ${AGENT_KEY_FOLDER}/<account-id>.json`,
        );
        expect(prompt).toContain("near-cli-rs-installer.sh | sh");
        expect(prompt).toContain(
            "releases/download/0.2.1/trezu-cli-installer.sh | sh",
        );
        expect(prompt).toContain(
            "releases/download/0.2.1/trezu-cli-installer.ps1 | iex",
        );
        expect(prompt).not.toContain("npm install");
        expect(prompt).not.toContain("cargo install");
        expect(prompt).toContain(
            "https://github.com/NEAR-DevHub/trezu/blob/main/nt-cli/README.md",
        );
        expect(prompt).toContain("`trezu treasury list`");
        expect(prompt).not.toContain("near-business");
    });

    it("forbids handling the user's keys", () => {
        expect(build()).toContain(
            "Never ask for, accept, read or use the user's own private keys",
        );
    });

    it("needs no CLI config change on the default backend", () => {
        const prompt = build();

        expect(prompt).toContain("already uses https://api.trezu.app");
        expect(prompt).not.toContain('"api_base"');
    });

    it("points the CLI at a non-default backend and uses it everywhere", () => {
        const api = "https://staging-api.trezu.app";
        const prompt = build({
            apiBaseUrl: `${api}/`,
            appBaseUrl: "https://staging.trezu.app/",
            inviteUrl: `https://staging.trezu.app/join/${TOKEN}`,
        });

        expect(prompt).toContain(`{"api_base": "${api}", "auth_token": null`);
        expect(prompt).toContain(`curl -sS -X POST ${api}/api/user/create`);
        expect(prompt).toContain(`${api}/api/member-invites/${TOKEN}/join`);
        expect(prompt).toContain(
            `open https://staging.trezu.app/${TREASURY_ID}/members/join-requests`,
        );
        expect(prompt).toContain(
            "~/Library/Application Support/trezu/config.json",
        );
        expect(prompt).not.toContain(`${api}//api`);
    });
});

describe("network check", () => {
    it("probes the backend and FastNear first and names the allowlist", () => {
        const prompt = build();
        const step1 = prompt.indexOf("Step 1.");
        const step2 = prompt.indexOf("Step 2.");

        expect(prompt).not.toContain("Step 0.");
        expect(step1).toBeGreaterThan(-1);
        expect(step1).toBeLessThan(step2);
        expect(prompt.slice(step2)).toContain("Install the tools");
        const check = prompt.slice(step1, step2);
        expect(check).toContain(`${DEFAULT_API}/api/health`);
        expect(check).toContain("https://api.fastnear.com/status");
        expect(check).toContain(
            "-X POST https://archival-rpc.mainnet.fastnear.com",
        );
        expect(check).toContain(
            "allow internet access to *.trezu.app and *.fastnear.com",
        );
    });

    it("probes the backend that issued the invite", () => {
        expect(build({ apiBaseUrl: "http://localhost:8888" })).toContain(
            "curl -sS -o /dev/null -w '%{http_code}\\n' http://localhost:8888/api/health",
        );
    });
});

describe("reply language", () => {
    it("asks the agent to talk in the app's language", () => {
        expect(build({ locale: "de" })).toContain(
            'Write to them in German (locale "de")',
        );
        expect(build({ locale: "pt" })).toContain(
            "Write to them in Portuguese",
        );
        expect(build()).toContain('Write to them in English (locale "en")');
    });

    it("falls back to the locale code for unknown locales", () => {
        expect(getLanguageName("not a locale")).toBe("not a locale");
    });
});

describe("plain language", () => {
    it("keeps technical details away from the user", () => {
        const prompt = build();
        expect(prompt).toContain("The user is not technical.");
        expect(prompt).toContain(
            "Do not show them commands, status codes, JSON, file paths, keys or long ids, unless they ask.",
        );
        expect(prompt).toContain(
            "The commands, outputs and expected results below are for you, not for the user.",
        );
        expect(prompt).not.toContain("report the exact command and output");
    });

    it("numbers the steps 1 to 8 and ends with a plain approval request", () => {
        const prompt = build();
        for (let step = 1; step <= 8; step++) {
            expect(prompt).toContain(`\nStep ${step}. `);
        }
        expect(prompt).not.toContain("Step 9.");
        const report = prompt.slice(prompt.indexOf("Step 8."));
        expect(report).toContain("ask them to approve you");
        expect(report).not.toContain("request id");
    });
});

describe("after approval", () => {
    const KEY = `${AGENT_KEY_FOLDER}/<account-id>.json`;
    const TAIL = `network-config mainnet sign-with-access-key-file ${KEY} send`;

    it("scopes the no-funds rule to onboarding", () => {
        const prompt = build();
        expect(prompt).toContain(
            "During onboarding (steps 1 to 8), do not move funds",
        );
        expect(prompt).not.toContain("as part of this onboarding");
    });

    it("gives complete payment and vote commands with the relay tail", () => {
        const prompt = build();
        const after = prompt.slice(prompt.indexOf("After you are approved"));

        expect(after).toContain(
            `trezu payments ${TREASURY_ID} send <token> details <amount> <destination-network> <recipient> '<description>' ${TAIL}`,
        );
        expect(after).toContain(
            `trezu requests ${TREASURY_ID} approve <request-id> ${TAIL}`,
        );
        expect(after).toContain(
            `trezu requests ${TREASURY_ID} reject <request-id> ${TAIL}`,
        );
        expect(after).toContain("Do not use submit-as-dao-proposal");
        expect(after).toContain("no gas or deposit to choose");
        expect(after).toContain('"The input device is not a TTY"');
    });

    it("explains near.com recipients and links the full reference", () => {
        const after = build().slice(build().indexOf("After you are approved"));
        expect(after).toContain("recipient written as nearcom:alice.near");
        expect(after).toContain(
            "https://github.com/NEAR-DevHub/trezu/blob/main/nt-cli/README.md#using-from-scripts-and-ai-agents",
        );
    });
});

describe("getInviteToken", () => {
    it("reads the token from a join link", () => {
        expect(getInviteToken(INVITE_URL)).toBe(TOKEN);
        expect(getInviteToken(`${INVITE_URL}/`)).toBe(TOKEN);
    });

    it("rejects links that are not invite links", () => {
        expect(() => getInviteToken(`${APP}/${TREASURY_ID}`)).toThrow(
            "Not an invite link",
        );
    });
});
