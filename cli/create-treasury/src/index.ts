#!/usr/bin/env node
import { spawn } from "child_process";
import {
  select,
  input,
  number,
  confirm,
} from "@inquirer/prompts";

const DAO_FACTORY_ID = "sputnik-dao.near";
const DEPOSIT = "0.09NEAR";
const GAS = "300Tgas";

interface TreasuryConfig {
  network: "testnet" | "mainnet";
  name: string;
  accountId: string;
  paymentThreshold: number;
  governanceThreshold: number;
  governors: string[];
  financiers: string[];
  requestors: string[];
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseAccountIds(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildPolicy(config: TreasuryConfig) {
  const oneRequiredVote = {
    weight_kind: "RoleWeight",
    quorum: "0",
    threshold: "1",
  };

  const governanceThreshold = {
    weight_kind: "RoleWeight",
    quorum: "0",
    threshold: config.governanceThreshold.toString(),
  };

  const paymentThreshold = {
    weight_kind: "RoleWeight",
    quorum: "0",
    threshold: config.paymentThreshold.toString(),
  };

  return {
    roles: [
      {
        kind: { Group: config.requestors },
        name: "Requestor",
        permissions: [
          "call:AddProposal",
          "transfer:AddProposal",
          "call:VoteRemove",
          "transfer:VoteRemove",
        ],
        vote_policy: {
          transfer: oneRequiredVote,
          call: oneRequiredVote,
        },
      },
      {
        kind: { Group: config.governors },
        name: "Admin",
        permissions: [
          "config:*",
          "policy:*",
          "add_member_to_role:*",
          "remove_member_from_role:*",
          "upgrade_self:*",
          "upgrade_remote:*",
          "set_vote_token:*",
          "add_bounty:*",
          "bounty_done:*",
          "factory_info_update:*",
          "policy_add_or_update_role:*",
          "policy_remove_role:*",
          "policy_update_default_vote_policy:*",
          "policy_update_parameters:*",
        ],
        vote_policy: {
          config: governanceThreshold,
          policy: governanceThreshold,
          add_member_to_role: governanceThreshold,
          remove_member_from_role: governanceThreshold,
          upgrade_self: governanceThreshold,
          upgrade_remote: governanceThreshold,
          set_vote_token: governanceThreshold,
          add_bounty: governanceThreshold,
          bounty_done: governanceThreshold,
          factory_info_update: governanceThreshold,
          policy_add_or_update_role: governanceThreshold,
          policy_remove_role: governanceThreshold,
          policy_update_default_vote_policy: governanceThreshold,
          policy_update_parameters: governanceThreshold,
        },
      },
      {
        kind: { Group: config.financiers },
        name: "Approver",
        permissions: [
          "call:VoteReject",
          "call:VoteApprove",
          "call:RemoveProposal",
          "call:Finalize",
          "transfer:VoteReject",
          "transfer:VoteApprove",
          "transfer:RemoveProposal",
          "transfer:Finalize",
        ],
        vote_policy: {
          transfer: paymentThreshold,
          call: paymentThreshold,
        },
      },
    ],
    default_vote_policy: {
      weight_kind: "RoleWeight",
      quorum: "0",
      threshold: [1, 2],
    },
    proposal_bond: "0",
    proposal_period: "604800000000000",
    bounty_bond: "0",
    bounty_forgiveness_period: "604800000000000",
  };
}

function buildCreateArgs(config: TreasuryConfig): string {
  const policy = buildPolicy(config);
  const args = {
    name: config.accountId.split(".")[0],
    args: Buffer.from(
      JSON.stringify({
        config: {
          name: config.name,
          purpose: "managing digital assets",
          metadata: "",
        },
        policy,
      })
    ).toString("base64"),
  };
  return Buffer.from(JSON.stringify(args)).toString("base64");
}

function buildCommand(config: TreasuryConfig): string[] {
  const base64Args = buildCreateArgs(config);
  return [
    "contract",
    "call-function",
    "as-transaction",
    DAO_FACTORY_ID,
    "create",
    "base64-args",
    base64Args,
    "prepaid-gas",
    GAS,
    "attached-deposit",
    DEPOSIT,
    "sign-as",
    "network-config",
    config.network,
  ];
}

async function promptForSigner(): Promise<string> {
  const signer = await input({
    message: "Enter your NEAR account ID (will be pre-filled as all roles):",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Account ID is required";
      }
      if (!value.includes(".")) {
        return "Account ID must be a full account (e.g., account.near or account.testnet)";
      }
      return true;
    },
  });
  return signer.trim();
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("\n🏛️  NEAR Treasury Creator\n");

  const network = await select({
    message: "Select network:",
    choices: [
      { value: "testnet", name: "Testnet" },
      { value: "mainnet", name: "Mainnet" },
    ],
  });

  const signer = await promptForSigner();

  const name = await input({
    message: "Treasury display name:",
    default: "My Treasury",
  });

  const defaultAccountId = `${slugify(name)}.${DAO_FACTORY_ID}`;
  const accountId = await input({
    message: "Treasury account ID:",
    default: defaultAccountId,
    validate: (value) => {
      if (!value.endsWith(`.${DAO_FACTORY_ID}`)) {
        return `Account ID must end with .${DAO_FACTORY_ID}`;
      }
      return true;
    },
  });

  const paymentThreshold = await number({
    message: "Payment threshold (votes needed to approve transfers):",
    default: 1,
    min: 1,
  });

  const governanceThreshold = await number({
    message: "Governance threshold (votes needed for config changes):",
    default: 2,
    min: 1,
  });

  const governorsInput = await input({
    message: "Governors (Admin role, full permissions):",
    default: signer,
  });
  const governors = parseAccountIds(governorsInput);

  const financiersInput = await input({
    message: "Financiers (Approver role, can approve/reject payments):",
    default: signer,
  });
  const financiers = parseAccountIds(financiersInput);

  const requestorsInput = await input({
    message: "Requestors (can create proposals):",
    default: signer,
  });
  const requestors = parseAccountIds(requestorsInput);

  const config: TreasuryConfig = {
    network: network as "testnet" | "mainnet",
    name,
    accountId,
    paymentThreshold: paymentThreshold!,
    governanceThreshold: governanceThreshold!,
    governors,
    financiers,
    requestors,
  };

  console.log("\n📋 Summary:");
  console.log(`   Network:     ${config.network}`);
  console.log(`   Name:        ${config.name}`);
  console.log(`   Account:     ${config.accountId}`);
  console.log(`   Payment:     ${config.paymentThreshold} vote(s)`);
  console.log(`   Governance:  ${config.governanceThreshold} vote(s)`);
  console.log(`   Governors:   ${config.governors.join(", ")}`);
  console.log(`   Financiers:  ${config.financiers.join(", ")}`);
  console.log(`   Requestors:  ${config.requestors.join(", ")}`);
  console.log(`   Deposit:     0.09 NEAR`);
  console.log(`   Gas:         300 Tgas\n`);

  const proceed = await confirm({
    message: "Create treasury?",
    default: true,
  });

  if (!proceed) {
    console.log("Cancelled.");
    process.exit(0);
  }

  const nearArgs = buildCommand(config);

  if (dryRun) {
    console.log("\nCommand (dry-run):");
    console.log(`near ${nearArgs.join(" ")}\n`);
    process.exit(0);
  }

  console.log("\n🚀 Calling near-cli-rs...\n");

  const child = spawn("near", nearArgs, {
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    if (code === 0) {
      console.log(`\n✅ Treasury created: ${config.accountId}`);
      console.log(`   View at: https://trezu.app/address/${config.accountId}\n`);
    }
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});
