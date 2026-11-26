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
            `Treasury members page: ${APP}/${TREASURY_ID}/members\n`,
        );
        expect(prompt).toContain(
            `Open ${APP}/${TREASURY_ID}/members/join-requests`,
        );
        expect(prompt).toContain(`"daoId": "${TREASURY_ID}"`);
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
            `Open https://staging.trezu.app/${TREASURY_ID}/members/join-requests`,
        );
        expect(prompt).toContain(
            "~/Library/Application Support/trezu/config.json",
        );
        expect(prompt).not.toContain(`${api}//api`);
    });
});

describe("network check", () => {
    it("probes the backend and FastNear before step 1 and names the allowlist", () => {
        const prompt = build();
        const step0 = prompt.indexOf("Step 0.");
        const step1 = prompt.indexOf("Step 1.");

        expect(step0).toBeGreaterThan(-1);
        expect(step0).toBeLessThan(step1);
        const check = prompt.slice(step0, step1);
        expect(check).toContain(`${DEFAULT_API}/api/health`);
        expect(check).toContain("https://api.fastnear.com/status");
        expect(check).toContain(
            "-X POST https://archival-rpc.mainnet.fastnear.com",
        );
        expect(check).toContain("allowlist *.trezu.app and *.fastnear.com");
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
            'Talk to the user in German (locale "de")',
        );
        expect(build({ locale: "pt" })).toContain(
            "Talk to the user in Portuguese",
        );
        expect(build()).toContain('Talk to the user in English (locale "en")');
    });

    it("falls back to the locale code for unknown locales", () => {
        expect(getLanguageName("not a locale")).toBe("not a locale");
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
