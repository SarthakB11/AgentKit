#!/usr/bin/env tsx
/**
 * CI entry point: the same gate as the UI, without the UI.
 *
 *   terraform plan -out tfplan && terraform show -json tfplan > plan.json
 *   npm run gate -- plan.json            # exit 0 allow, 2 needs-approval, 1 block
 *   npm run gate -- plan.json --comment  # also print the review comment (markdown)
 *
 * Reads the same LAMATIC_* variables as the app (from the environment or
 * apps/.env.local). Prints one JSON line with the verdict and counts so a
 * pipeline can parse it; the review comment goes to stdout after it when
 * --comment is given, so it can be posted on the pull request.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Lamatic } from "lamatic";
import kit from "../../lamatic.config";
import { endpoint, env, loadDotEnvLocal } from "./env";
import { parsePlan, extractFacts } from "../lib/plan-parse";
import { validateReviewResult } from "../lib/validate";

const EXIT = { allow: 0, "no-changes": 0, block: 1, "needs-approval": 2 } as const;

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const wantComment = args.includes("--comment");
  if (!file) {
    console.error("Usage: npm run gate -- <plan.json> [--comment]");
    process.exitCode = 3;
    return;
  }

  loadDotEnvLocal();
  const path = resolve(file);
  if (!existsSync(path)) {
    console.error(`Plan file not found: ${path}`);
    process.exitCode = 3;
    return;
  }
  const facts = extractFacts(parsePlan(readFileSync(path, "utf8")));
  if (facts.totalChanges === 0) {
    console.log(JSON.stringify({ verdict: "no-changes", totalChanges: 0 }));
    process.exitCode = EXIT["no-changes"];
    return;
  }

  const step = kit.steps.find((s) => s.id === "tf-plan-review");
  if (!step || !("envKey" in step) || !step.envKey) throw new Error("lamatic.config.ts has no tf-plan-review step with an envKey.");

  const client = new Lamatic({
    endpoint: endpoint(),
    projectId: env("LAMATIC_PROJECT_ID"),
    apiKey: env("LAMATIC_API_KEY"),
  });
  const raw = (await client.executeFlow(env(step.envKey), {
    changes: facts.facts.map((f) => JSON.stringify(f)),
    totalChanges: facts.totalChanges,
    summary: facts.summary,
  })) as { status?: string; message?: string; result?: unknown };
  if (raw?.status === "error" || raw?.message) throw new Error(`Lamatic rejected the request: ${raw.message ?? "unknown error"}`);

  const result = validateReviewResult(raw?.result ?? raw);
  console.log(
    JSON.stringify({
      verdict: result.verdict,
      totalChanges: result.totalChanges,
      counts: result.counts,
      findings: result.changes
        .filter((c) => c.risk !== "low")
        .map((c) => ({ address: c.address, risk: c.risk, policyIds: c.policyIds, reason: c.reason })),
    })
  );
  if (wantComment && result.reviewComment) {
    console.log("");
    console.log(result.reviewComment);
  }
  // exitCode rather than exit(): a piped stdout is still flushing when exit()
  // would kill the process, which truncates the JSON line or the comment.
  process.exitCode = EXIT[result.verdict];
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 3;
});
