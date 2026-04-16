const fs = require("fs");

const accounts = fs
    .readFileSync("nt.txt", "utf8")
    .split("\n")
    .map((a) => a.trim())
    .filter((a) => a.endsWith(".sputnik-dao.near"));

const BASE_URL = process.env.API_URL || "https://api.trezu.app";
const SLEEP_MS = 300;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerAccount(accountId) {
    const res = await fetch(`${BASE_URL}/api/monitored-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
    }

    return res.json();
}

async function main() {
    const total = accounts.length;
    let registered = 0;
    let alreadyExisted = 0;
    let failed = 0;

    console.log(`Registering ${total} sputnik-dao accounts...\n`);

    for (let i = 0; i < accounts.length; i++) {
        const accountId = accounts[i];
        const counter = `${i + 1}/${total}`;

        try {
            const result = await registerAccount(accountId);

            if (result.isNewRegistration) {
                registered++;
                console.log(`[${counter}] NEW      ${accountId}`);
            } else {
                alreadyExisted++;
                console.log(`[${counter}] EXISTS   ${accountId}`);
            }

            await sleep(SLEEP_MS);
        } catch (e) {
            failed++;
            console.error(`[${counter}] ERROR    ${accountId}: ${e.message}`);
        }
    }

    console.log("\n===== SUMMARY =====");
    console.log(`Total:          ${total}`);
    console.log(`Newly registered: ${registered}`);
    console.log(`Already existed:  ${alreadyExisted}`);
    console.log(`Failed:           ${failed}`);
}

main();
