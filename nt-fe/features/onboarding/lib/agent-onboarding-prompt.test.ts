import { describe, expect, it } from "bun:test";
import {
    AGENT_KEY_FOLDER,
    buildAgentOnboardingPrompt,
    getInviteToken,
    NEAR_BUSINESS_CLI_DEFAULT_API_BASE,
} from "./agent-onboarding-prompt";

const TREASURY_ID = "acme.sputnik-dao.near";
const TOKEN = "3f2b8c1e-7a4d-4e9b-9c0a-1d2e3f4a5b6c";
const APP = "https://business.near.com";
const INVITE_URL = `${APP}/join/${TOKEN}`;

function build(
    overrides: Partial<Parameters<typeof buildAgentOnboardingPrompt>[0]> = {},
) {
    return buildAgentOnboardingPrompt({
        treasuryId: TREASURY_ID,
        inviteUrl: INVITE_URL,
        appBaseUrl: APP,
        apiBaseUrl: NEAR_BUSINESS_CLI_DEFAULT_API_BASE,
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
            `curl -sS ${NEAR_BUSINESS_CLI_DEFAULT_API_BASE}/api/member-invites/${TOKEN}\n`,
        );
        expect(prompt).toContain(
            `curl -sS -X POST ${NEAR_BUSINESS_CLI_DEFAULT_API_BASE}/api/member-invites/${TOKEN}/join`,
        );
    });

    it("gives the exact account creation, initialization and login commands", () => {
        const prompt = build();

        expect(prompt).toContain(
            `near account create-account fund-later use-auto-generation save-to-folder ${AGENT_KEY_FOLDER}\n`,
        );
        expect(prompt).toContain(
            `curl -sS -X POST https://api.business.near.com/api/user/create -H 'content-type: application/json' -d '{"accountId": "<account-id>"}'`,
        );
        expect(prompt).toContain(
            `near-business auth login <account-id> sign-with-access-key-file ${AGENT_KEY_FOLDER}/<account-id>.json`,
        );
        expect(prompt).toContain("near-business-cli-installer.sh | sh");
        expect(prompt).toContain("near-cli-rs-installer.sh | sh");
    });

    it("forbids handling the user's keys", () => {
        expect(build()).toContain(
            "Never ask for, accept, read or use the user's own private keys",
        );
    });

    it("needs no CLI config change on the default backend", () => {
        const prompt = build();

        expect(prompt).toContain("already uses https://api.business.near.com");
        expect(prompt).not.toContain('"api_base"');
    });

    it("points the CLI at a non-default backend and uses it everywhere", () => {
        const api = "https://api.trezu.app";
        const prompt = build({
            apiBaseUrl: `${api}/`,
            appBaseUrl: "https://trezu.app/",
            inviteUrl: `https://trezu.app/join/${TOKEN}`,
        });

        expect(prompt).toContain(`{"api_base": "${api}", "auth_token": null`);
        expect(prompt).toContain(`curl -sS -X POST ${api}/api/user/create`);
        expect(prompt).toContain(`${api}/api/member-invites/${TOKEN}/join`);
        expect(prompt).toContain(
            `Open https://trezu.app/${TREASURY_ID}/members/join-requests`,
        );
        expect(prompt).not.toContain(`${api}//api`);
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
