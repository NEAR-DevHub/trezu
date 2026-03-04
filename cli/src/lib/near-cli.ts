import { spawn } from "child_process";

export interface NearCallOptions {
  contractId: string;
  methodName: string;
  args: string;
  gas: string;
  deposit: string;
  network: "testnet" | "mainnet";
}

export function callContract(options: NearCallOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "contract",
      "call-function",
      "as-transaction",
      options.contractId,
      options.methodName,
      "base64-args",
      options.args,
      "prepaid-gas",
      options.gas,
      "attached-deposit",
      options.deposit,
      "sign-as",
      "network-config",
      options.network,
    ];

    const child = spawn("near", args, {
      stdio: "inherit",
      shell: false,
    });

    child.on("error", (error) => {
      reject(new Error(`Failed to call near-cli: ${error.message}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`near-cli exited with code ${code}`));
      }
    });
  });
}

export function buildBase64Args(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

export function nearToYocto(near: string): string {
  const nearValue = parseFloat(near);
  if (isNaN(nearValue)) {
    throw new Error(`Invalid NEAR amount: ${near}`);
  }
  return (nearValue * 1e24).toFixed(0);
}

export function tgasToGas(tgas: string): string {
  const tgasValue = parseFloat(tgas);
  if (isNaN(tgasValue)) {
    throw new Error(`Invalid Tgas amount: ${tgas}`);
  }
  return `${tgasValue}Tgas`;
}
