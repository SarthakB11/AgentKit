"use client";

import { useState } from "react";
import type { Decision, ReviewResult } from "../lib/types";

/**
 * The human step. The gate never applies anything; it records what a person
 * decided and why, so the record can travel with the change (PR comment,
 * ticket, audit log). An override of a block requires a written justification.
 */
export function DecisionPanel({
  result,
  decision,
  onDecide,
}: {
  result: ReviewResult;
  decision: Decision | null;
  onDecide: (d: Decision) => void;
}) {
  const [justification, setJustification] = useState("");
  const needsText = result.verdict !== "allow";
  const canApprove = !needsText || justification.trim().length >= 20;

  function decide(action: Decision["action"]) {
    onDecide({
      verdict: result.verdict,
      action,
      justification: justification.trim(),
      decidedAt: new Date().toISOString(),
      planSummary: result.summary,
    });
  }

  return (
    <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <h2 className="text-sm font-semibold">Decision</h2>
      <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
        {result.verdict === "allow" && "Nothing above low risk. Approve to record the decision."}
        {result.verdict === "needs-approval" && "Approval needs a written reason (20+ characters): what was checked, who signed off."}
        {result.verdict === "block" && "Blocked by a critical finding. Overriding requires a written justification and is recorded as an override."}
        {result.verdict === "no-changes" && "Nothing to decide."}
      </p>
      {needsText && result.verdict !== "no-changes" && (
        <>
          <label htmlFor="decision-justification" className="mt-3 block text-xs font-medium">
            Justification
          </label>
          <textarea
            id="decision-justification"
            name="decision-justification"
            className="mt-1 h-24 w-full rounded-md border p-2 text-xs"
            style={{ background: "var(--surface-deep)", borderColor: "var(--border)" }}
            placeholder="e.g. Snapshot orders-prod-2026-09-03 taken, change window 02:00 UTC agreed with payments on-call (R. Mehta)."
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            disabled={!!decision}
          />
        </>
      )}
      {!decision && result.verdict !== "no-changes" && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!canApprove}
            onClick={() => decide(result.verdict === "block" ? "overridden" : "approved")}
            className="rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            style={{ background: result.verdict === "block" ? "var(--block)" : "var(--allow)", color: "var(--surface-deep)" }}
          >
            {result.verdict === "block" ? "Override and approve" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => decide("rejected")}
            className="rounded border px-3 py-1.5 text-sm"
            style={{ borderColor: "var(--border)" }}
          >
            Reject
          </button>
        </div>
      )}
      {decision && (
        <pre
          className="mt-3 overflow-x-auto rounded-md border p-3 text-xs"
          style={{ background: "var(--surface-deep)", borderColor: "var(--border)" }}
        >
          {JSON.stringify(decision, null, 2)}
        </pre>
      )}
    </section>
  );
}
