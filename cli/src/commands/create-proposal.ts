import { spawn } from "child_process";
import { input, confirm, number } from "@inquirer/prompts";
import { promptNetwork, promptTreasuryId } from "../lib/prompts.js";

interface FunctionCallAction {
  method_name: string;
  args: string;
  deposit: string;
  gas: string;
}

interface FunctionCallProposal {
  description: string;
  kind: {
    FunctionCall: {
      receiver_id: string;
      actions: FunctionCallAction[];
    };
  };
}

function encodeDescription(title: string, notes?: string): string {
  let desc = `# ${title}`;
  if (notes && notes.trim().length > 0) {
    desc += `\n\n${notes.trim()}`;
  }
  return desc;
}

function parseJsonArgs(argsInput: string): string {
  try {
    const parsed = JSON.parse(argsInput);
    return Buffer.from(JSON.stringify(parsed)).toString("base64");
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}

function nearToYocto(near: string): string {
  const nearValue = parseFloat(near);
  if (isNaN(nearValue)) {
    return "0";
  }
  return (nearValue * 1e24).toFixed(0);
}

function tgasToGas(tgas: string): string {
  const tgasValue = parseFloat(tgas);
  if (isNaN(tgasValue)) {
    return "150000000000000";
  }
  return (tgasValue * 1e12).toFixed(0);
}

async function promptForAction(): Promise<FunctionCallAction> {
  const methodName = await input({
    message: "Method name:",
    validate: (value) => {
      if (!value || value.trim().length === 0) {
        return "Method name is required";
      }
      return true;
    },
  });

  const argsInput = await input({
    message: "Arguments (JSON):",
    default: "{}",
    validate: (value) => {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return "Invalid JSON";
      }
    },
  });

  const depositInput = await input({
    message: "Deposit (NEAR):",
    default: "0",
    validate: (value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) {
        return "Must be a non-negative number";
      }
      return true;
    },
  });

  const gasInput = await input({
    message: "Gas (Tgas):",
    default: "150",
    validate: (value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num < 0) {
        return "Must be a non-negative number";
      }
      return true;
    },
  });

  return {
    method_name: methodName.trim(),
    args: parseJsonArgs(argsInput),
    deposit: nearToYocto(depositInput),
    gas: tgasToGas(gasInput),
  };
}

export async function createProposal(
  dryRun: boolean = false,
  nonInteractive: boolean = false,
  options: Record<string, string> = {}
) {
  console.log("\n📝 Create Proposal: Function Call\n");

  let network: "testnet" | "mainnet";
  let treasuryId: string;
  let title: string;
  let notes: string;
  let receiverId: string;
  let actions: FunctionCallAction[];

  if (nonInteractive) {
    if (!options.network) {
      console.error("Error: --network is required in non-interactive mode");
      process.exit(1);
    }
    if (!options["treasury-id"]) {
      console.error("Error: --treasury-id is required in non-interactive mode");
      process.exit(1);
    }
    if (!options.title) {
      console.error("Error: --title is required in non-interactive mode");
      process.exit(1);
    }
    if (!options["receiver-id"]) {
      console.error("Error: --receiver-id is required in non-interactive mode");
      process.exit(1);
    }
    if (!options.method) {
      console.error("Error: --method is required in non-interactive mode");
      process.exit(1);
    }

    network = options.network as "testnet" | "mainnet";
    treasuryId = options["treasury-id"];
    title = options.title;
    notes = options.notes || "";
    receiverId = options["receiver-id"];

    const action: FunctionCallAction = {
      method_name: options.method,
      args: parseJsonArgs(options.args || "{}"),
      deposit: nearToYocto(options.deposit || "0"),
      gas: tgasToGas(options.gas || "150"),
    };
    actions = [action];
  } else {
    network = (await promptNetwork()) as "testnet" | "mainnet";
    treasuryId = await promptTreasuryId();

    title = await input({
      message: "Proposal title:",
      default: "Function Call Proposal",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Title is required";
        }
        return true;
      },
    });

    notes = await input({
      message: "Notes (optional):",
      default: "",
    });

    receiverId = await input({
      message: "Receiver ID (contract to call):",
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Receiver ID is required";
        }
        if (!value.includes(".")) {
          return "Receiver ID must be a full account ID";
        }
        return true;
      },
    });

    actions = [];

    let addMore = true;
    while (addMore) {
      console.log(`\n📍 Action ${actions.length + 1}`);
      const action = await promptForAction();
      actions.push(action);

      if (actions.length < 10) {
        addMore = await confirm({
          message: "Add another action?",
          default: false,
        });
      } else {
        console.log("\nMaximum 10 actions per proposal.");
        addMore = false;
      }
    }
  }

  const proposal: FunctionCallProposal = {
    description: encodeDescription(title, notes),
    kind: {
      FunctionCall: {
        receiver_id: receiverId.trim(),
        actions,
      },
    },
  };

  console.log("\n📋 Summary:");
  console.log(`   Network:     ${network}`);
  console.log(`   Treasury:    ${treasuryId}`);
  console.log(`   Title:       ${title}`);
  console.log(`   Receiver:    ${receiverId}`);
  console.log(`   Actions:     ${actions.length}`);
  actions.forEach((action, i) => {
    console.log(`\n   Action ${i + 1}:`);
    console.log(`     Method:     ${action.method_name}`);
    console.log(`     Deposit:    ${(parseInt(action.deposit) / 1e24).toFixed(6)} NEAR`);
    console.log(`     Gas:        ${(parseInt(action.gas) / 1e12).toFixed(0)} Tgas`);
  });
  console.log("");

  if (!nonInteractive) {
    const proceed = await confirm({
      message: "Create proposal?",
      default: true,
    });

    if (!proceed) {
      console.log("Cancelled.");
      process.exit(0);
    }
  }

  const proposalArgs = {
    proposal,
  };

  const base64Args = Buffer.from(JSON.stringify(proposalArgs)).toString("base64");

  const nearArgs = [
    "contract",
    "call-function",
    "as-transaction",
    treasuryId,
    "add_proposal",
    "base64-args",
    base64Args,
    "prepaid-gas",
    "300Tgas",
    "attached-deposit",
    "0NEAR",
    "sign-as",
    "network-config",
    network,
  ];

  if (dryRun) {
    console.log("\nCommand (dry-run):");
    console.log(`near ${nearArgs.join(" ")}\n`);
    console.log("Decoded args:");
    console.log(JSON.stringify(proposalArgs, null, 2));
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
      console.log(`\n✅ Proposal created`);
      console.log(`   View at: https://trezu.app/address/${treasuryId}\n`);
    }
    process.exit(code ?? 1);
  });
}
