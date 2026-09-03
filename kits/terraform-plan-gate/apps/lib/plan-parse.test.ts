import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePlan, extractFacts } from "./plan-parse";

const load = (name: string) => readFileSync(join(process.cwd(), "public", "samples", name), "utf8");

test("rejects text that is not a plan", () => {
  assert.throws(() => parsePlan("not json"), /not valid JSON/);
  assert.throws(() => parsePlan('{"hello": 1}'), /format_version/);
});

test("routine plan: no-ops dropped, safeguards recognised, nothing destroyed", () => {
  const facts = extractFacts(parsePlan(load("routine-plan.json")));
  assert.equal(facts.totalChanges, 4); // the SNS topic is a no-op
  assert.deepEqual(facts.counts, { create: 2, update: 2, destroy: 0, replace: 0, read: 0 });
  const pab = facts.facts.find((f) => f.type === "aws_s3_bucket_public_access_block")!;
  assert.ok(!pab.flags.includes("public-access-block-disabled"));
  const bucket = facts.facts.find((f) => f.type === "aws_s3_bucket")!;
  assert.deepEqual(bucket.flags, ["stateful"]);
});

test("risky plan: destructive replace, exposure and wildcard IAM are all flagged", () => {
  const facts = extractFacts(parsePlan(load("risky-plan.json")));
  const db = facts.facts.find((f) => f.address.endsWith("aws_db_instance.primary"))!;
  assert.equal(db.kind, "replace");
  assert.equal(db.actionReason, "replace_because_cannot_update");
  for (const flag of ["stateful", "replace", "deletion-protection-removed", "skip-final-snapshot", "production"]) {
    assert.ok(db.flags.includes(flag), `expected ${flag} on ${db.address}`);
  }
  const ssh = facts.facts.find((f) => f.address === "aws_security_group_rule.bastion_ssh")!;
  assert.ok(ssh.flags.includes("open-to-internet:22"));
  const pab = facts.facts.find((f) => f.type === "aws_s3_bucket_public_access_block")!;
  assert.ok(pab.flags.includes("public-access-block-disabled"));
  const iam = facts.facts.find((f) => f.type === "aws_iam_policy")!;
  assert.ok(iam.flags.includes("iam-wildcard"));
});

test("sensitive values never cross the boundary", () => {
  const facts = extractFacts(parsePlan(load("risky-plan.json")));
  const db = facts.facts.find((f) => f.address.endsWith("aws_db_instance.primary"))!;
  assert.ok(db.sensitiveAttributes.includes("password"));
  assert.ok(!db.changedAttributes.includes("password"));
  const serialized = JSON.stringify(facts);
  assert.ok(!serialized.includes("REDACTED-BY-TERRAFORM"), "a sensitive value leaked into the facts");
  assert.ok(!("password" in db.attributeValues));
});

test("summary names the flagged resources", () => {
  const facts = extractFacts(parsePlan(load("risky-plan.json")));
  assert.match(facts.summary, /6 resource change\(s\)/);
  assert.match(facts.summary, /1 stateful resource\(s\) destroyed or replaced/);
  assert.match(facts.summary, /aws_security_group_rule\.bastion_ssh open-to-internet:22/);
});
