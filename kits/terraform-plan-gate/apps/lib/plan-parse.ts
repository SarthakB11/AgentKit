/**
 * Deterministic side of the gate: turn a `terraform show -json` plan into a
 * small list of change facts. No model is involved here, and nothing marked
 * sensitive by Terraform ever leaves this file.
 *
 * Field names follow the Terraform JSON output format (plan representation):
 * resource_changes[].{address, module_address, mode, type, name, provider_name,
 * action_reason, change.{actions, before, after, after_unknown,
 * before_sensitive, after_sensitive, replace_paths}}.
 */

export type Action = "no-op" | "create" | "read" | "update" | "delete";

export interface ResourceChange {
  address: string;
  module_address?: string;
  mode: "managed" | "data";
  type: string;
  name: string;
  provider_name: string;
  action_reason?: string;
  change: {
    actions: Action[];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    after_unknown?: Record<string, unknown>;
    before_sensitive?: Record<string, unknown> | boolean;
    after_sensitive?: Record<string, unknown> | boolean;
    replace_paths?: unknown[][];
  };
}

export interface TerraformPlan {
  format_version: string;
  terraform_version?: string;
  resource_changes?: ResourceChange[];
}

/** What crosses the boundary into the Lamatic flow. */
export interface ChangeFact {
  address: string;
  type: string;
  provider: string;
  actions: Action[];
  /** "replace", "destroy", "create", "update", or "read" — derived from actions. */
  kind: "create" | "update" | "destroy" | "replace" | "read";
  actionReason: string | null;
  /** Attribute names whose value differs between before and after. Never values. */
  changedAttributes: string[];
  /** Attribute names Terraform marks sensitive. Names only; values are dropped. */
  sensitiveAttributes: string[];
  /** Security-relevant attribute values from the safelist below. */
  attributeValues: Record<string, unknown>;
  /** Deterministic hints for the reviewer, e.g. "stateful", "destroy", "open-to-internet:22". */
  flags: string[];
}

export interface PlanFacts {
  terraformVersion: string | null;
  totalChanges: number;
  facts: ChangeFact[];
  counts: { create: number; update: number; destroy: number; replace: number; read: number };
  summary: string;
}

/**
 * Attributes whose *values* are safe and useful to show a reviewer. Everything
 * else crosses the boundary as a name only.
 */
const SAFE_VALUE_ATTRIBUTES = new Set([
  "acl",
  "publicly_accessible",
  "block_public_acls",
  "block_public_policy",
  "ignore_public_acls",
  "restrict_public_buckets",
  "deletion_protection",
  "deletion_protection_enabled",
  "skip_final_snapshot",
  "force_destroy",
  "storage_encrypted",
  "encrypted",
  "kms_key_id",
  "kms_key_arn",
  "instance_class",
  "instance_type",
  "engine",
  "engine_version",
  "multi_az",
  "backup_retention_period",
  "from_port",
  "to_port",
  "protocol",
  "cidr_blocks",
  "ipv6_cidr_blocks",
  "cidr_ipv4",
  "cidr_ipv6",
  "ingress",
  "egress",
  "tags",
  "tags_all",
  "versioning",
  "lifecycle",
  "min_size",
  "max_size",
  "desired_capacity",
  "create_before_destroy",
]);

/** Resource types that hold data or long-lived state. Destroying one is never routine. */
const STATEFUL_TYPES = [
  /^aws_(db_instance|rds_cluster|rds_cluster_instance|dynamodb_table|s3_bucket|ebs_volume|efs_file_system|elasticache_cluster|elasticache_replication_group|redshift_cluster|secretsmanager_secret|kms_key|docdb_cluster|neptune_cluster|opensearch_domain|elasticsearch_domain|sqs_queue|kinesis_stream)$/,
  /^google_(sql_database_instance|sql_database|storage_bucket|bigquery_dataset|bigquery_table|compute_disk|redis_instance|secret_manager_secret|spanner_instance|firestore_database)$/,
  /^azurerm_(storage_account|mssql_database|mssql_server|postgresql_server|postgresql_flexible_server|mysql_server|cosmosdb_account|managed_disk|key_vault|redis_cache|storage_container)$/,
];

/** Resources whose replacement means downtime unless done create-before-destroy. */
const LONG_LIVED_COMPUTE = [
  /^aws_(instance|autoscaling_group|eks_cluster|eks_node_group|ecs_service|lb|alb|elb|nat_gateway|vpc|subnet)$/,
  /^google_(compute_instance|container_cluster|container_node_pool|compute_forwarding_rule)$/,
  /^azurerm_(virtual_machine|linux_virtual_machine|windows_virtual_machine|kubernetes_cluster|lb)$/,
];

const ADMIN_PORTS = new Set([22, 3389, 5432, 3306, 6379, 27017, 9200, 1433, 5984]);

export function parsePlan(text: string): TerraformPlan {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("The plan is not valid JSON. Generate it with `terraform show -json tfplan > plan.json`.");
  }
  if (!doc || typeof doc !== "object" || !("format_version" in doc)) {
    throw new Error(
      "This does not look like a Terraform plan: no top-level `format_version`. Use `terraform show -json`, not `terraform plan` text."
    );
  }
  const plan = doc as TerraformPlan;
  if (plan.resource_changes !== undefined && !Array.isArray(plan.resource_changes)) {
    throw new Error("`resource_changes` is present but is not an array.");
  }
  return plan;
}

function kindOf(actions: Action[]): ChangeFact["kind"] {
  if (actions.includes("delete") && actions.includes("create")) return "replace";
  if (actions.includes("delete")) return "destroy";
  if (actions.includes("create")) return "create";
  if (actions.includes("read")) return "read";
  return "update";
}

function sensitiveKeys(mask: Record<string, unknown> | boolean | undefined): Set<string> {
  const keys = new Set<string>();
  if (!mask || typeof mask !== "object") return keys;
  for (const [k, v] of Object.entries(mask)) {
    // Terraform marks a sensitive attribute as `true`, or as a nested object
    // for blocks; either way the top-level name is enough to redact.
    if (v === true || (v && typeof v === "object" && JSON.stringify(v).includes("true"))) keys.add(k);
  }
  return keys;
}

function looksSecretName(key: string): boolean {
  return /(password|secret|token|private_key|credential|connection_string|api_key|access_key)/i.test(key);
}

function changedAttributeNames(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const k of keys) {
    const b = JSON.stringify(before?.[k] ?? null);
    const a = JSON.stringify(after?.[k] ?? null);
    if (b !== a) changed.push(k);
  }
  return changed.sort();
}

function cidrsOpenToWorld(rule: Record<string, unknown>): boolean {
  const lists = [rule.cidr_blocks, rule.ipv6_cidr_blocks];
  const singles = [rule.cidr_ipv4, rule.cidr_ipv6];
  const all = [
    ...lists.flatMap((l) => (Array.isArray(l) ? l : [])),
    ...singles.filter((s) => typeof s === "string"),
  ] as string[];
  return all.some((c) => c === "0.0.0.0/0" || c === "::/0");
}

function portFlags(rule: Record<string, unknown>): string[] {
  if (!cidrsOpenToWorld(rule)) return [];
  const from = Number(rule.from_port ?? rule.from ?? NaN);
  const to = Number(rule.to_port ?? rule.to ?? NaN);
  const protocol = String(rule.protocol ?? rule.ip_protocol ?? "");
  if (protocol === "-1" || (from === 0 && (to === 0 || to === 65535))) return ["open-to-internet:all-ports"];
  const out: string[] = [];
  for (const p of ADMIN_PORTS) if (!Number.isNaN(from) && !Number.isNaN(to) && p >= from && p <= to) out.push(`open-to-internet:${p}`);
  if (out.length === 0 && !Number.isNaN(from)) out.push(`open-to-internet:${from === to ? from : `${from}-${to}`}`);
  return out;
}

function iamWildcard(policyText: unknown): boolean {
  if (typeof policyText !== "string") return false;
  try {
    const doc = JSON.parse(policyText);
    const statements = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement].filter(Boolean);
    return statements.some((s: Record<string, unknown>) => {
      const has = (v: unknown) => (Array.isArray(v) ? v : [v]).includes("*");
      return s.Effect === "Allow" && has(s.Action) && has(s.Resource);
    });
  } catch {
    return /"Action"\s*:\s*"\*"/.test(policyText) && /"Resource"\s*:\s*"\*"/.test(policyText);
  }
}

function flagsFor(rc: ResourceChange, kind: ChangeFact["kind"], values: Record<string, unknown>): string[] {
  const flags = new Set<string>();
  const after = rc.change.after ?? {};
  const before = rc.change.before ?? {};

  if (kind === "destroy") flags.add("destroy");
  if (kind === "replace") flags.add("replace");
  if (STATEFUL_TYPES.some((re) => re.test(rc.type))) flags.add("stateful");
  if (LONG_LIVED_COMPUTE.some((re) => re.test(rc.type)) && kind === "replace") flags.add("compute-replacement");

  if (values.acl === "public-read" || values.acl === "public-read-write") flags.add("public-acl");
  if (values.publicly_accessible === true) flags.add("publicly-accessible");
  if (
    values.block_public_acls === false ||
    values.block_public_policy === false ||
    values.ignore_public_acls === false ||
    values.restrict_public_buckets === false
  )
    flags.add("public-access-block-disabled");

  if (before.deletion_protection === true && after.deletion_protection === false) flags.add("deletion-protection-removed");
  else if (after.deletion_protection === false && (kind === "destroy" || kind === "replace")) flags.add("deletion-protection-off");
  if (after.skip_final_snapshot === true || before.skip_final_snapshot === true) flags.add("skip-final-snapshot");
  if (after.force_destroy === true) flags.add("force-destroy");

  const encBefore = before.storage_encrypted ?? before.encrypted;
  const encAfter = after.storage_encrypted ?? after.encrypted;
  if (encBefore === true && encAfter === false) flags.add("encryption-disabled");
  if ((before.kms_key_id || before.kms_key_arn) && !(after.kms_key_id || after.kms_key_arn) && kind !== "destroy")
    flags.add("customer-kms-key-removed");

  const rules: Record<string, unknown>[] = [];
  for (const key of ["ingress"]) {
    const v = after[key];
    if (Array.isArray(v)) rules.push(...(v as Record<string, unknown>[]));
  }
  if (/security_group_rule$|vpc_security_group_ingress_rule$|firewall/.test(rc.type) && (after.type === "ingress" || after.type === undefined))
    rules.push(after);
  for (const r of rules) for (const f of portFlags(r)) flags.add(f);

  for (const key of ["policy", "assume_role_policy", "policy_document", "inline_policy"]) {
    if (iamWildcard(after[key])) flags.add("iam-wildcard");
  }
  if (typeof after.policy_arn === "string" && /AdministratorAccess/.test(after.policy_arn)) flags.add("iam-admin-access");

  const tags = (after.tags_all ?? after.tags ?? before.tags_all ?? before.tags) as Record<string, string> | undefined;
  const env = tags && typeof tags === "object" ? String(tags.environment ?? tags.Environment ?? tags.env ?? "") : "";
  if (/^prod/i.test(env) || /(^|[._-])prod(uction)?([._-]|$)/i.test(rc.address)) flags.add("production");

  return [...flags].sort();
}

export function extractFacts(plan: TerraformPlan): PlanFacts {
  const counts = { create: 0, update: 0, destroy: 0, replace: 0, read: 0 };
  const facts: ChangeFact[] = [];

  for (const rc of plan.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    if (actions.length === 0 || (actions.length === 1 && actions[0] === "no-op")) continue;
    const kind = kindOf(actions);
    counts[kind] += 1;

    const sensitive = new Set([
      ...sensitiveKeys(rc.change.before_sensitive),
      ...sensitiveKeys(rc.change.after_sensitive),
    ]);
    const changed = changedAttributeNames(rc.change.before, rc.change.after);
    for (const k of changed) if (looksSecretName(k)) sensitive.add(k);

    const attributeValues: Record<string, unknown> = {};
    const source = kind === "destroy" ? rc.change.before ?? {} : rc.change.after ?? {};
    for (const [k, v] of Object.entries(source)) {
      if (!SAFE_VALUE_ATTRIBUTES.has(k) || sensitive.has(k) || v === null || v === undefined) continue;
      attributeValues[k] = v;
    }
    // A before/after pair for the safeguards a reviewer cares about most.
    for (const k of ["deletion_protection", "skip_final_snapshot", "storage_encrypted", "publicly_accessible"]) {
      const b = rc.change.before?.[k];
      const a = rc.change.after?.[k];
      if (b !== undefined && a !== undefined && b !== a) attributeValues[`${k}_before`] = b;
    }

    facts.push({
      address: rc.address,
      type: rc.type,
      provider: rc.provider_name,
      actions,
      kind,
      actionReason: rc.action_reason ?? null,
      changedAttributes: changed.filter((k) => !sensitive.has(k)),
      sensitiveAttributes: [...sensitive].sort(),
      attributeValues,
      flags: flagsFor(rc, kind, attributeValues),
    });
  }

  const flagged = facts.filter((f) => f.flags.some((x) => x !== "production")).length;
  const stateful = facts.filter((f) => f.flags.includes("stateful") && (f.kind === "destroy" || f.kind === "replace")).length;
  const summary =
    `${facts.length} resource change(s): ${counts.create} create, ${counts.update} update, ${counts.destroy} destroy, ${counts.replace} replace, ${counts.read} read. ` +
    `${stateful} stateful resource(s) destroyed or replaced. ${flagged} change(s) carry risk flags: ` +
    (facts
      .flatMap((f) => f.flags.filter((x) => x !== "production").map((x) => `${f.address} ${x}`))
      .slice(0, 12)
      .join("; ") || "none") +
    ".";

  return { terraformVersion: plan.terraform_version ?? null, totalChanges: facts.length, facts, counts, summary };
}
