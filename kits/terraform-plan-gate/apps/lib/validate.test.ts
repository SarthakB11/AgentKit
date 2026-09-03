import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateReviewResult } from "./validate";

// A real response from the deployed tf-plan-review flow for samples/risky-plan.json.
const golden = () => JSON.parse(readFileSync(join(__dirname, "fixtures", "review-response.json"), "utf8"));

test("a real flow response passes and keeps its shape", () => {
  const r = validateReviewResult(golden());
  assert.equal(r.verdict, "block");
  assert.equal(r.changes.length, r.totalChanges);
  assert.ok(r.counts.critical >= 1);
  assert.ok(r.changes.every((c) => typeof c.address === "string" && Array.isArray(c.actions)));
  assert.ok(r.changes.some((c) => c.policyIds.length > 0), "at least one change cites a policy");
  assert.ok(typeof r.reviewComment === "string" && r.reviewComment.includes("### Findings"));
  assert.equal(typeof r.droppedAssessments, "number");
});

test("the result envelope is unwrapped by the caller, so a bare wrapper is rejected", () => {
  assert.throws(() => validateReviewResult({ result: golden() }), /unknown verdict/);
});

test("an unknown verdict is rejected", () => {
  assert.throws(() => validateReviewResult({ ...golden(), verdict: "maybe" }), /unknown verdict/);
});

test("malformed counts are rejected", () => {
  assert.throws(() => validateReviewResult({ ...golden(), counts: { critical: -1 } }), /malformed counts/);
  assert.throws(() => validateReviewResult({ ...golden(), counts: null }), /malformed counts/);
});

test("a change without an address or actions is rejected, not rendered half-shaped", () => {
  const g = golden();
  assert.throws(() => validateReviewResult({ ...g, changes: [{ risk: "high" }] }), /has no address/);
  assert.throws(() => validateReviewResult({ ...g, changes: [{ address: "aws_x.y", actions: "delete" }] }), /no actions array/);
});

test("a mismatch between totalChanges and changes is rejected", () => {
  const g = golden();
  assert.throws(() => validateReviewResult({ ...g, totalChanges: g.changes.length + 1 }), /reported .* changes but returned/);
});

test("unknown risk labels become unclassified and optional fields are normalised", () => {
  const g = golden();
  const r = validateReviewResult({
    ...g,
    totalChanges: 1,
    changes: [{ address: "aws_x.y", actions: ["update"], risk: "severe", confidence: "high", policyIds: "POL-01" }],
    reviewComment: 42,
    policiesConsulted: [{ policyId: 7 }],
    droppedAssessments: "1",
  });
  assert.equal(r.changes[0].risk, "unclassified");
  assert.equal(r.changes[0].confidence, null);
  assert.deepEqual(r.changes[0].policyIds, []);
  assert.equal(r.changes[0].type, "unknown");
  assert.equal(r.reviewComment, null);
  assert.deepEqual(r.policiesConsulted, [{ policyId: null, title: null, certainty: null }]);
  assert.equal(r.droppedAssessments, 0);
});
