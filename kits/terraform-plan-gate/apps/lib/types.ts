import type { Action } from "./plan-parse";

export type Verdict = "allow" | "needs-approval" | "block" | "no-changes";
export type Risk = "low" | "medium" | "high" | "critical" | "unclassified";

export interface AssessedChange {
  address: string;
  type: string;
  actions: Action[];
  actionReason: string | null;
  changedAttributes: string[];
  flags: string[];
  risk: Risk;
  category: string | null;
  policyIds: string[];
  reason: string | null;
  mitigation: string | null;
  confidence: number | null;
}

export interface PolicyHit {
  policyId: string | null;
  title: string | null;
  certainty: number | null;
}

/** Exactly what the flow's API Response node returns, after validation. */
export interface ReviewResult {
  verdict: Verdict;
  summary: string;
  totalChanges: number;
  counts: { critical: number; high: number; medium: number; low: number; unclassified: number };
  changes: AssessedChange[];
  reviewComment: string | null;
  policiesConsulted: PolicyHit[];
  /** Model assessments the flow discarded because they named no known resource. */
  droppedAssessments: number;
}

export type ReviewResponse = { ok: true; data: ReviewResult } | { ok: false; error: string };

/** The human decision recorded locally after the gate has spoken. */
export interface Decision {
  verdict: Verdict;
  action: "approved" | "overridden" | "rejected";
  justification: string;
  decidedAt: string;
  planSummary: string;
}
