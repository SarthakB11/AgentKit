# Terraform Plan Gate

## Overview

An agent that reads the JSON form of a Terraform plan and answers the reviewer's question before `apply`: *what in here can hurt us, which of our rules does it break, and what has to be true before we run it?* It scores every resource change, cites the organisation policy it violates, drafts the pull-request comment, and returns a verdict that a human confirms or overrides with a written reason.

## Purpose

Infrastructure changes fail in the expensive direction. A missed `["delete", "create"]` on a database is an outage; a missed `0.0.0.0/0` is a breach. Reviewers know the rules but read plans under time pressure, and the rules live in a wiki nobody opens during review. The gate makes the rules part of the review, every time, without pretending the model should be the one to decide.

## Architecture

```text
plan JSON
   │
   ├─ apps/lib/plan-parse.ts        deterministic: facts, flags, redaction
   │
   └─ flows/tf-plan-review          judgment
         ├─ Vector Search           relevant policies from the tfpolicies store
         ├─ Generate JSON           per-change risk, category, policy ids, mitigation
         ├─ Generate Text           review comment
         └─ Code                    join facts with assessments, counts, verdict
```

The split is deliberate. Whether a change destroys a stateful resource, opens an admin port to the world, or removes deletion protection in the same plan that deletes is a question with a right answer, so it is computed and tested. Ranking, policy matching and explanation are the model's job. The verdict is arithmetic on the model's answers, never a model output, so the same counts always give the same gate result.

Each change fact crosses the boundary JSON-encoded, because Studio's trigger schema offers `[]` or `[string]` for arrays and object items are rejected at ingestion. The assemble node parses either shape.

## Flows

### `tf-policy-ingest`

Run once, or whenever the policy set changes.

**Trigger** — API Request with a single `run` field (any string).

**Processing** — a Code node holds the policy set (ten defaults, each `{ policy_id, title, text }`), Vectorize embeds `id + title + text`, VectorDB Index writes them into `tfpolicies` keyed by `policy_id` with `overwrite` on duplicates.

**Response** — `{ indexed, result: { recordsIndexed, duplicateRecordsDeleted, message } }`.

**Dependencies** — one embedding model; a Vector Store named `tfpolicies`.

### `tf-plan-review`

**Trigger** — API Request:

| Field | Type | Meaning |
|---|---|---|
| `changes` | `[string]` | Change facts from `extractFacts()`, each JSON-encoded |
| `totalChanges` | int | Length of `changes` |
| `summary` | string | One-paragraph plan summary with the flagged addresses; also the search query |

**Processing** — Vector Search over `tfpolicies` (query = `summary`, limit 7, certainty 0.5). Generate JSON returns one assessment per fact keyed by `address`. Generate Text writes the review comment from the facts, the assessments and the summary. The Code node joins facts with assessments, marks anything without an assessment `unclassified`, counts, and computes the verdict.

**Response** —

```typescript
{
  verdict: "allow" | "needs-approval" | "block",
  summary: string,
  totalChanges: number,
  counts: { critical, high, medium, low, unclassified },
  changes: Array<{
    address, type, actions, actionReason, changedAttributes, flags,
    risk: "low" | "medium" | "high" | "critical" | "unclassified",
    category, policyIds: string[], reason, mitigation, confidence
  }>,
  reviewComment: string | null,          // markdown
  policiesConsulted: Array<{ policyId, title, certainty }>
}
```

Verdict rule: any `critical` → `block`; any `high`, `medium` or `unclassified` → `needs-approval`; otherwise `allow`. Unclassified counts against the verdict on purpose: a change the classifier did not assess is unknown risk, and unknown must not read as safe.

**When to use it** — on every pull request that changes infrastructure, before a scheduled apply, or when auditing a plan someone else produced.

**Dependencies** — one structured-output model, one text model, the same embedding model the ingest flow used.

## Guardrails

Beyond `constitutions/default.md`:

- **Secrets are redacted before the model.** Attributes marked sensitive by Terraform, and any attribute named like a secret, are sent as names only. Values are sent for a fixed safelist of security-relevant attributes. This is enforced in `plan-parse.ts` and covered by a test.
- **One assessment per fact, keyed by address.** The classifier does not add resources, drop resources, or rename them. Anything it fails to assess is surfaced as `unclassified`, not hidden.
- **Cite only policies that were provided.** Policy ids come from the Vector Search results; the model must not invent ids or quote policy text it was not given.
- **Round up.** When two risk levels are plausible, the higher one is chosen. A plain tag or description change is low.
- **The gate never applies.** It produces a verdict, a comment and a decision record. Approval and override are human actions with a required justification.

### Not in scope

- Estimating cost or simulating the apply.
- Rewriting the Terraform.
- Provider types outside the lists in `plan-parse.ts` get model scoring without deterministic flags.

## Integration reference

| Service | Purpose | Credential |
|---|---|---|
| Lamatic | Hosts and executes both flows and the Vector Store | `LAMATIC_API_KEY`, `LAMATIC_PROJECT_ID`, `LAMATIC_API_URL` |
| Embedding model | Policy embeddings (ingest) and query embedding (review) | Configured in Studio on the Vectorize, Index and Vector Search nodes |
| Structured-output model | Per-change assessment | Configured in Studio on the Generate JSON node |
| Text model | Review comment | Configured in Studio on the Generate Text node |

A review makes exactly one outbound request from the server action. A plan with no changes makes none; the app answers locally.

## Environment setup

| Variable | Source |
|---|---|
| `LAMATIC_API_KEY` | Studio → Settings → API Keys |
| `LAMATIC_PROJECT_ID` | Studio → Settings → General → Project ID |
| `LAMATIC_API_URL` | Studio → flow → Setup → API URL |
| `LAMATIC_TERRAFORM_PLAN_REVIEW_FLOW_ID` | `tf-plan-review` → three-dot menu → Copy Flow Id |

## Quickstart

1. In Lamatic Studio, create a Vector Store named `tfpolicies` (Data → Context Stores) and recreate the two flows from `flows/` (they are Studio's own export; re-select your model credentials on the model nodes).
2. Deploy `tf-policy-ingest`; run it once (Test in Studio, or one API call).
3. Deploy `tf-plan-review`; copy its Flow ID.
4. `cd kits/terraform-plan-gate/apps && cp .env.example .env.local`, fill in the four values.
5. `npm install && npm run dev`, open http://localhost:3000, press **Load risky example**, then **Review plan**.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing LAMATIC_… — copy apps/.env.example…` | No `.env.local` or a blank value | Fill in all four variables and restart the dev server |
| `This does not look like a Terraform plan` | Pasted `terraform plan` text, or a state file | Use `terraform show -json tfplan` |
| Every change is `unclassified` | Generate JSON returned nothing, or addresses do not match | Check the node's model credential; confirm the schema in Studio still requires `address` |
| `policiesConsulted` is empty | The `tfpolicies` store is empty, or the review flow points at a different store | Run `tf-policy-ingest`; check the Vector DB field on the Vector Search node |
| Search returns nothing although the store has records | `certainty` too high for the embedding model in use | Lower certainty on the Vector Search node (0.5 works with Gemini embeddings) |
| Index reports success but the store shows 0 records | A metadata key is a reserved name (`id`) | Keep `policy_id` as the primary key; do not rename it to `id` |
| `Could not reach Lamatic` | Wrong `LAMATIC_API_URL` or no network | Re-copy the API URL from the flow's Setup panel |
| A node shows "Required Fields" after import, or a model call fails with a credential error | The `credentialId` values in `model-configs/` belong to the author's project | Re-select your own credential on the Vectorize, Index, Vector Search, Generate JSON and Generate Text nodes, then save and deploy |
| Verdict is `needs-approval` for a plan you consider routine | A medium finding, often "large blast radius" or a production tag on a replace | Read the finding; adjust the policy text in the ingest flow if the rule is wrong for your team |
