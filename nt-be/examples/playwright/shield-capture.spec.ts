/**
 * Playwright research script: capture near.com confidential shield network traffic.
 *
 * Opens near.com in headed mode, intercepts all 1Click API calls and server actions,
 * and saves request/response pairs as JSON fixtures.
 *
 * Usage:
 *   cd nt-be/examples/playwright
 *   npm install
 *   npx playwright install chromium
 *   npx playwright test shield-capture.spec.ts --headed --timeout 300000
 *
 * The test will:
 * 1. Open near.com
 * 2. Wait for you to connect your wallet (petersalomonsendev.near)
 * 3. Navigate to /transfer/confidential?mode=shield
 * 4. Wait for you to complete the shield operation
 * 5. Save all captured API calls to fixtures/
 *
 * You sign with your wallet manually — the script just captures traffic.
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

interface CapturedRequest {
  timestamp: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number;
  responseBody: unknown;
}

test("capture confidential shield flow on near.com", async ({ page }) => {
  // Increase timeout for manual interaction
  test.setTimeout(600_000); // 10 minutes

  const captured: CapturedRequest[] = [];
  const fixturesDir = path.join(__dirname, "fixtures");
  fs.mkdirSync(fixturesDir, { recursive: true });

  // Intercept all relevant API calls
  page.on("response", async (response) => {
    const url = response.url();
    const request = response.request();

    // Capture 1Click API calls, solver relay, and near.com server actions
    const isRelevant =
      url.includes("chaindefuser.com") ||
      url.includes("defuse.org") ||
      url.includes("near-rpc.defuse.org") ||
      (url.includes("near.com/transfer/confidential") &&
        request.method() === "POST");

    if (!isRelevant) return;

    try {
      let requestBody: unknown = null;
      try {
        const postData = request.postData();
        if (postData) {
          requestBody = JSON.parse(postData);
        }
      } catch {
        requestBody = request.postData();
      }

      let responseBody: unknown = null;
      try {
        responseBody = await response.json();
      } catch {
        try {
          const text = await response.text();
          responseBody = text.substring(0, 2000);
        } catch {
          responseBody = "<could not read body>";
        }
      }

      const entry: CapturedRequest = {
        timestamp: new Date().toISOString(),
        method: request.method(),
        url,
        requestHeaders: Object.fromEntries(
          Object.entries(request.headers()).filter(
            ([k]) =>
              k === "authorization" ||
              k === "x-api-key" ||
              k === "content-type" ||
              k === "next-action"
          )
        ),
        requestBody,
        responseStatus: response.status(),
        responseBody,
      };

      captured.push(entry);

      // Log to console for live monitoring
      const shortUrl = url.length > 80 ? url.substring(0, 80) + "..." : url;
      console.log(
        `[${entry.timestamp}] ${request.method()} ${response.status()} ${shortUrl}`
      );
      if (requestBody && typeof requestBody === "object") {
        const bodyStr = JSON.stringify(requestBody);
        if (bodyStr.length < 200) {
          console.log(`  Request: ${bodyStr}`);
        }
      }
    } catch (err) {
      console.error(`Failed to capture ${url}:`, err);
    }
  });

  // Navigate directly to the shield page
  console.log("\n=== Opening near.com/transfer/confidential?mode=shield ===");
  console.log("1. Connect your wallet (petersalomonsendev.near)");
  console.log("2. Complete a small shield operation (e.g., 0.5 USDC)");
  console.log("3. The script will auto-detect SUCCESS and save fixtures\n");

  await page.goto("https://near.com/transfer/confidential?mode=shield");

  // Poll for SUCCESS in captured responses (up to 8 minutes)
  // Wrapped in try/catch so fixtures are saved even if browser closes
  try {
    const startTime = Date.now();
    while (Date.now() - startTime < 480_000) {
      const hasSuccess = captured.some((c) => {
        try {
          const body = c.responseBody;
          if (typeof body === "string" && body.includes('"SUCCESS"'))
            return true;
          if (typeof body === "object" && body !== null) {
            const str = JSON.stringify(body);
            if (str.includes('"SUCCESS"')) return true;
          }
        } catch {}
        return false;
      });

      if (hasSuccess) {
        console.log("\nShield completed successfully!\n");
        break;
      }

      if (captured.length > 0) {
        console.log(`  [${captured.length} requests captured so far]`);
      }

      await page.waitForTimeout(3000);
    }
  } catch (err) {
    console.log(
      `\nBrowser closed or error during polling (captured ${captured.length} requests). Saving fixtures...\n`
    );
  }

  // Save all captured requests (always runs)
  const outputPath = path.join(fixturesDir, "shield_capture.json");
  fs.writeFileSync(outputPath, JSON.stringify(captured, null, 2));
  console.log(`\nSaved ${captured.length} captured requests to ${outputPath}`);

  // Also save individual fixtures for key steps
  for (const entry of captured) {
    // Identify key steps by URL/content
    const body = entry.responseBody as Record<string, unknown> | null;
    if (!body || typeof body !== "object") continue;

    const ok = body.ok as Record<string, unknown> | undefined;

    if (ok && "quote" in ok) {
      fs.writeFileSync(
        path.join(fixturesDir, "shield_quote.json"),
        JSON.stringify(entry, null, 2)
      );
      console.log("  → Saved shield_quote.json");
    }

    if (ok && "intent" in ok) {
      fs.writeFileSync(
        path.join(fixturesDir, "shield_generate_intent.json"),
        JSON.stringify(entry, null, 2)
      );
      console.log("  → Saved shield_generate_intent.json");
    }

    if (ok && "intentHash" in ok) {
      fs.writeFileSync(
        path.join(fixturesDir, "shield_submit_intent.json"),
        JSON.stringify(entry, null, 2)
      );
      console.log("  → Saved shield_submit_intent.json");
    }

    if (ok && "status" in ok && ok.status === "SUCCESS") {
      fs.writeFileSync(
        path.join(fixturesDir, "shield_success.json"),
        JSON.stringify(entry, null, 2)
      );
      console.log("  → Saved shield_success.json");
    }
  }

  // Redact sensitive headers before final save
  const redacted = captured.map((c) => ({
    ...c,
    requestHeaders: Object.fromEntries(
      Object.entries(c.requestHeaders).map(([k, v]) =>
        k === "authorization" ? [k, "Bearer REDACTED"] : [k, v]
      )
    ),
  }));

  fs.writeFileSync(
    path.join(fixturesDir, "shield_capture_redacted.json"),
    JSON.stringify(redacted, null, 2)
  );
  console.log("  → Saved shield_capture_redacted.json (for committing)");

  expect(captured.length).toBeGreaterThan(0);
});
