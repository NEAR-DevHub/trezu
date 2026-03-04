import { select, input } from "@inquirer/prompts";

export async function promptNetwork(): Promise<"testnet" | "mainnet"> {
  return (await select({
    message: "Select network:",
    choices: [
      { value: "testnet", name: "Testnet" },
      { value: "mainnet", name: "Mainnet" },
    ],
  })) as "testnet" | "mainnet";
}

export async function promptAccountId(
  message: string,
  validate?: (value: string) => boolean | string | Promise<boolean | string>
): Promise<string> {
  return await input({
    message,
    validate: validate || ((value) => {
      if (!value || value.trim().length === 0) {
        return "Account ID is required";
      }
      if (!value.includes(".")) {
        return "Account ID must be a full account (e.g., account.near or account.testnet)";
      }
      return true;
    }),
  });
}

export async function promptTreasuryId(): Promise<string> {
  return await promptAccountId(
    "Treasury account ID:",
    (value) => {
      if (!value || value.trim().length === 0) {
        return "Treasury ID is required";
      }
      if (!value.includes(".")) {
        return "Treasury ID must be a full account (e.g., treasury.sputnik-dao.near)";
      }
      return true;
    }
  );
}

export function parseAccountIds(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
