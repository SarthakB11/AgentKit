"use client";

import { useState } from "react";
import { reviewPlan } from "../actions/orchestrate";
import type { Decision, ReviewResult } from "../lib/types";
import { PlanInput } from "../components/PlanInput";
import { VerdictBanner } from "../components/VerdictBanner";
import { ChangeTable } from "../components/ChangeTable";
import { ReviewComment } from "../components/ReviewComment";
import { DecisionPanel } from "../components/DecisionPanel";

export default function Page() {
  const [planText, setPlanText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  async function loadSample(name: "routine-plan" | "risky-plan") {
    const res = await fetch(`/samples/${name}.json`);
    setPlanText(await res.text());
    setResult(null);
    setDecision(null);
    setError(null);
  }

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    setDecision(null);
    const res = await reviewPlan(planText);
    setBusy(false);
    if (res.ok) setResult(res.data);
    else setError(res.error);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Terraform Plan Gate</h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Paste the output of <code>terraform show -json tfplan</code>. The app extracts change facts
          (never secrets), a Lamatic flow scores each change against your policies, and you decide.
        </p>
      </header>

      <PlanInput
        value={planText}
        onChange={setPlanText}
        onLoadSample={loadSample}
        onReview={run}
        busy={busy}
      />

      {error && (
        <div
          className="mt-6 rounded-md border px-4 py-3 text-sm"
          style={{ borderColor: "var(--block)", color: "var(--block)" }}
          role="alert"
        >
          {error}
        </div>
      )}

      {result && (
        <section className="mt-8 space-y-6">
          <VerdictBanner result={result} decision={decision} />
          <ChangeTable changes={result.changes} />
          <div className="grid gap-6 lg:grid-cols-2">
            <ReviewComment markdown={result.reviewComment} policies={result.policiesConsulted} />
            <DecisionPanel result={result} decision={decision} onDecide={setDecision} />
          </div>
        </section>
      )}
    </main>
  );
}
