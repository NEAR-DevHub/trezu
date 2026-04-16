import { ensureTreasury } from "./helpers/create-treasury";

async function globalSetup() {
    const account = "test.near";

    await ensureTreasury({
        name: "Onboarding E2E Test Treasury",
        accountId: "onboarding-e2e-test.sputnik-dao.near",
        governors: [account],
        financiers: [account],
        requestors: [account],
        isConfidential: false,
    });

    await ensureTreasury({
        name: "Requests E2E Test Treasury",
        accountId: "requests-e2e-test.sputnik-dao.near",
        governors: [account],
        financiers: [account],
        requestors: [account],
        isConfidential: false,
    });

    await ensureTreasury({
        name: "WebAssembly Music Treasury",
        accountId: "webassemblymusic-treasury.sputnik-dao.near",
        governors: [account],
        financiers: [account],
        requestors: [account],
        isConfidential: false,
    });

    await ensureTreasury({
        name: "Romakqa Testing Treasury",
        accountId: "romakqatesting.sputnik-dao.near",
        governors: [account],
        financiers: [account],
        requestors: [account],
        isConfidential: false,
    });
}

export default globalSetup;
