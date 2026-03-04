#!/usr/bin/env node
import { select } from "@inquirer/prompts";
import { createTreasury } from "./commands/create-treasury.js";
import { createProposal } from "./commands/create-proposal.js";

interface ParsedArgs {
  command: string | undefined;
  dryRun: boolean;
  nonInteractive: boolean;
  showHelp: boolean;
  options: Record<string, string>;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  const options: Record<string, string> = {};
  
  let command: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith("--")) {
      const [key, value] = arg.slice(2).split("=", 2);
      if (value !== undefined) {
        options[key] = value;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        options[key] = args[++i];
      } else {
        options[key] = "true";
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const key = arg.slice(1);
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        options[key] = args[++i];
      } else {
        options[key] = "true";
      }
    } else if (!command) {
      command = arg;
    }
  }
  
  return {
    command,
    dryRun: "dry-run" in options,
    nonInteractive: "non-interactive" in options,
    showHelp: "help" in options || "h" in options,
    options,
  };
}

function printHelp(command?: string) {
  if (!command) {
    console.log(`
trezu - NEAR Treasury CLI

Usage:
  trezu [command] [options]
  trezu                           # Interactive mode

Commands:
  create-treasury    Create a new Sputnik DAO treasury
  create-proposal    Create a proposal (function call)

Options:
  --dry-run              Print command without executing
  --non-interactive     Run without prompts (requires all args)
  --help, -h             Show this help message

Examples:
  trezu                           # Interactive mode
  trezu create-treasury
  trezu create-treasury --dry-run
  trezu create-proposal
`);
  } else if (command === "create-treasury") {
    console.log(`
trezu create-treasury - Create a new Sputnik DAO treasury

Usage:
  trezu create-treasury [options]

Options:
  --network <testnet|mainnet>     Network (required in non-interactive)
  --signer <account-id>           Signer account ID (required in non-interactive)
  --name <name>                    Treasury display name (required in non-interactive)
  --account-id <id>                Treasury account ID (required in non-interactive)
  --payment-threshold <n>          Votes for payments (default: 1)
  --governance-threshold <n>       Votes for governance (default: 2)
  --governors <accounts>           Comma-separated governor accounts
  --financiers <accounts>          Comma-separated financier accounts
  --requestors <accounts>          Comma-separated requestor accounts
  --dry-run                        Print command without executing
  --non-interactive                Run without prompts

Examples:
  trezu create-treasury
  trezu create-treasury --non-interactive --network mainnet --signer alice.near --name "My Treasury" --account-id my-treasury.sputnik-dao.near
`);
  } else if (command === "create-proposal") {
    console.log(`
trezu create-proposal - Create a function call proposal

Usage:
  trezu create-proposal [options]

Options:
  --network <testnet|mainnet>     Network (required in non-interactive)
  --treasury-id <id>               Treasury account ID (required in non-interactive)
  --title <title>                  Proposal title (required in non-interactive)
  --notes <notes>                  Proposal notes (optional)
  --receiver-id <id>               Contract to call (required in non-interactive)
  --method <name>                  Method name (required in non-interactive)
  --args <json>                    JSON arguments (default: {})
  --deposit <near>                 Attached deposit in NEAR (default: 0)
  --gas <tgas>                     Gas in Tgas (default: 150)
  --dry-run                        Print command without executing
  --non-interactive                Run without prompts

Examples:
  trezu create-proposal
  trezu create-proposal --non-interactive --network mainnet --treasury-id my-treasury.sputnik-dao.near --title "Transfer" --receiver-id token.near --method ft_transfer --args '{"receiver_id":"bob.near","amount":"1000000"}' --deposit 0.00001
`);
  } else {
    console.error(`Unknown command: ${command}`);
  }
}

async function main() {
  const parsed = parseArgs();
  
  if (parsed.showHelp) {
    printHelp(parsed.command);
    process.exit(0);
  }

  let selectedCommand = parsed.command;

  if (!selectedCommand && !parsed.nonInteractive) {
    console.log("\n🏛️  trezu - NEAR Treasury CLI\n");
    selectedCommand = await select({
      message: "Select a command:",
      choices: [
        { value: "create-treasury", name: "create-treasury    - Create a new Sputnik DAO treasury" },
        { value: "create-proposal", name: "create-proposal    - Create a proposal (function call)" },
      ],
    });
  }

  switch (selectedCommand) {
    case "create-treasury":
      await createTreasury(parsed.dryRun, parsed.nonInteractive, parsed.options);
      break;

    case "create-proposal":
      await createProposal(parsed.dryRun, parsed.nonInteractive, parsed.options);
      break;

    default:
      console.error(`Unknown command: ${selectedCommand}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\n❌ Error: ${error.message}`);
  process.exit(1);
});
