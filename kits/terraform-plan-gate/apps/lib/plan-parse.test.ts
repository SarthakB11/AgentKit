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

test("tag maps never cross the boundary, only the derived production flag", () => {
  const plan = JSON.parse(load("risky-plan.json"));
  plan.resource_changes[5].change.after.tags = { environment: "production", db_url: "postgres://admin:hunter2@db.internal:5432/orders" };
  const facts = extractFacts(plan);
  const lg = facts.facts.find((f) => f.type === "aws_cloudwatch_log_group")!;
  assert.ok(lg.flags.includes("production"));
  assert.ok(!("tags" in lg.attributeValues) && !("tags_all" in lg.attributeValues));
  assert.ok(!JSON.stringify(facts).includes("hunter2"), "a tag value leaked into the facts");
});

test("force_destroy is kept on deletes, where after is null", () => {
  const plan = JSON.parse(load("routine-plan.json"));
  plan.resource_changes.push({
    address: "aws_s3_bucket.scratch", mode: "managed", type: "aws_s3_bucket", name: "scratch", provider_name: "registry.terraform.io/hashicorp/aws",
    change: { actions: ["delete"], before: { bucket: "acme-scratch", force_destroy: true }, after: null, after_unknown: {}, before_sensitive: {}, after_sensitive: false },
  });
  const f = extractFacts(plan).facts.find((x) => x.address === "aws_s3_bucket.scratch")!;
  assert.equal(f.kind, "destroy");
  assert.ok(f.flags.includes("force-destroy"));
  assert.ok(f.flags.includes("stateful"));
});

test("GCP firewall and Azure NSG rules get the same open-to-internet flags as AWS", () => {
  const plan = JSON.parse(load("routine-plan.json"));
  plan.resource_changes.push(
    { address: "google_compute_firewall.ssh", mode: "managed", type: "google_compute_firewall", name: "ssh", provider_name: "registry.terraform.io/hashicorp/google",
      change: { actions: ["create"], before: null, after: { direction: "INGRESS", source_ranges: ["0.0.0.0/0"], allow: [{ protocol: "tcp", ports: ["22", "8080-8090"] }] }, after_unknown: {}, before_sensitive: false, after_sensitive: {} } },
    { address: "azurerm_network_security_rule.rdp", mode: "managed", type: "azurerm_network_security_rule", name: "rdp", provider_name: "registry.terraform.io/hashicorp/azurerm",
      change: { actions: ["create"], before: null, after: { direction: "Inbound", access: "Allow", protocol: "Tcp", source_address_prefix: "*", destination_port_range: "3389" }, after_unknown: {}, before_sensitive: false, after_sensitive: {} } },
    { address: "azurerm_network_security_rule.deny_all", mode: "managed", type: "azurerm_network_security_rule", name: "deny_all", provider_name: "registry.terraform.io/hashicorp/azurerm",
      change: { actions: ["create"], before: null, after: { direction: "Inbound", access: "Deny", protocol: "*", source_address_prefix: "*", destination_port_range: "*" }, after_unknown: {}, before_sensitive: false, after_sensitive: {} } },
    { address: "azurerm_network_security_rule.ping", mode: "managed", type: "azurerm_network_security_rule", name: "ping", provider_name: "registry.terraform.io/hashicorp/azurerm",
      change: { actions: ["create"], before: null, after: { direction: "Inbound", access: "Allow", protocol: "Icmp", source_address_prefix: "Internet", destination_port_range: "*" }, after_unknown: {}, before_sensitive: false, after_sensitive: {} } },
    { address: "azurerm_network_security_rule.any", mode: "managed", type: "azurerm_network_security_rule", name: "any", provider_name: "registry.terraform.io/hashicorp/azurerm",
      change: { actions: ["create"], before: null, after: { direction: "Inbound", access: "Allow", protocol: "*", source_address_prefix: "*", destination_port_range: "*" }, after_unknown: {}, before_sensitive: false, after_sensitive: {} } }
  );
  const facts = extractFacts(plan).facts;
  assert.ok(facts.find((f) => f.address === "google_compute_firewall.ssh")!.flags.includes("open-to-internet:22"));
  assert.ok(facts.find((f) => f.address === "azurerm_network_security_rule.rdp")!.flags.includes("open-to-internet:3389"));
  assert.ok(!facts.find((f) => f.address === "azurerm_network_security_rule.deny_all")!.flags.some((x) => x.startsWith("open-to-internet")), "a Deny rule is not an exposure");
  assert.ok(!facts.find((f) => f.address === "azurerm_network_security_rule.ping")!.flags.some((x) => x.startsWith("open-to-internet")), "ICMP has no ports to expose");
  assert.ok(facts.find((f) => f.address === "azurerm_network_security_rule.any")!.flags.includes("open-to-internet:all-ports"));
});

test("a rule for TCP port 0 alone is port 0, not all ports", () => {
  const plan = JSON.parse(load("routine-plan.json"));
  plan.resource_changes.push({ address: "aws_security_group_rule.zero", mode: "managed", type: "aws_security_group_rule", name: "zero", provider_name: "registry.terraform.io/hashicorp/aws",
    change: { actions: ["create"], before: null, after: { type: "ingress", from_port: 0, to_port: 0, protocol: "tcp", cidr_blocks: ["0.0.0.0/0"] }, after_unknown: {}, before_sensitive: false, after_sensitive: {} } });
  const flags = extractFacts(plan).facts.find((f) => f.address === "aws_security_group_rule.zero")!.flags;
  assert.ok(flags.includes("open-to-internet:0"));
  assert.ok(!flags.includes("open-to-internet:all-ports"));
});

test("large blast radius is flagged on every change when the plan is big or destructive", () => {
  const plan = JSON.parse(load("routine-plan.json"));
  for (let i = 0; i < 6; i++) {
    plan.resource_changes.push({ address: `aws_sqs_queue.q${i}`, mode: "managed", type: "aws_sqs_queue", name: `q${i}`, provider_name: "registry.terraform.io/hashicorp/aws",
      change: { actions: ["delete"], before: { name: `q${i}` }, after: null, after_unknown: {}, before_sensitive: {}, after_sensitive: false } });
  }
  const facts = extractFacts(plan);
  assert.equal(facts.counts.destroy, 6);
  assert.ok(facts.facts.every((f) => f.flags.includes("large-blast-radius")));
  assert.match(facts.summary, /large blast radius/);
  const small = extractFacts(parsePlan(load("routine-plan.json")));
  assert.ok(small.facts.every((f) => !f.flags.includes("large-blast-radius")));
});

test("summary names the flagged resources", () => {
  const facts = extractFacts(parsePlan(load("risky-plan.json")));
  assert.match(facts.summary, /6 resource change\(s\)/);
  assert.match(facts.summary, /1 stateful resource\(s\) destroyed or replaced/);
  assert.match(facts.summary, /aws_security_group_rule\.bastion_ssh open-to-internet:22/);
});
