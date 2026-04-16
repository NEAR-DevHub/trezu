const Big = require("big.js");

const fs = require("fs");

const accounts = fs
    .readFileSync("users-tr-sinceFeb26.txt", "utf8")
    .split("\n")
    .map((a) => a.trim().replaceAll('"', ""))
    .filter(Boolean);

const SLEEP_MS = 300;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function totalBalance(asset) {
    const balance = asset.balance;

    if (balance.Standard) {
        return new Big(balance.Standard.total);
    }

    if (balance.Staked) {
        return new Big(balance.Staked.stakedBalance).plus(
            balance.Staked.unstakedBalance,
        );
    }

    if (balance.Vested) {
        return new Big(balance.Vested.total);
    }

    return new Big(0);
}

async function fetchAssets(accountId) {
    const url = `https://api.trezu.app/api/user/assets?accountId=${accountId}`;
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    return res.json();
}

async function main() {
    const accountTotals = [];
    let totalAUM = new Big(0);

    const totalAccounts = accounts.length;

    for (let i = 0; i < accounts.length; i++) {
        const accountId = accounts[i];
        const counter = `${i + 1}/${totalAccounts}`;

        try {
            console.log(`[${counter}] Fetching ${accountId}`);

            const assets = await fetchAssets(accountId);

            let accountTotal = new Big(0);

            for (const asset of assets) {
                const balance = totalBalance(asset);

                const decimals = asset.decimals;
                const price = new Big(asset.price || 0);

                const usdValue = balance
                    .div(new Big(10).pow(decimals))
                    .mul(price);

                accountTotal = accountTotal.plus(usdValue);
            }

            totalAUM = totalAUM.plus(accountTotal);

            accountTotals.push({
                accountId,
                total: accountTotal,
            });

            await sleep(SLEEP_MS);
        } catch (e) {
            console.error(`[${counter}] Error for ${accountId}:`, e.message);
        }
    }

    accountTotals.sort((a, b) => b.total.cmp(a.total));

    console.log("\n===== TOP 20 ACCOUNTS BY AUM =====\n");

    const top = accountTotals.slice(0, 20);

    console.table(
        top.map((x, i) => ({
            Rank: i + 1,
            Account: x.accountId,
            AUM_USD: Number(x.total.toFixed(2)),
        })),
    );

    console.log("\nTotal AUM (USD):", totalAUM.toFixed(2));
}

main();
