"use client";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onLoadSample: (name: "routine-plan" | "risky-plan") => void;
  onReview: () => void;
  busy: boolean;
}

export function PlanInput({ value, onChange, onLoadSample, onReview, busy }: Props) {
  return (
    <section className="rounded-lg border p-4" style={{ background: "var(--panel)", borderColor: "var(--border)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="plan-json" className="text-sm font-medium">
          Plan JSON
        </label>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          terraform plan -out tfplan &amp;&amp; terraform show -json tfplan &gt; plan.json
        </span>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => onLoadSample("routine-plan")}>
            Load routine example
          </button>
          <button type="button" className="btn-secondary" onClick={() => onLoadSample("risky-plan")}>
            Load risky example
          </button>
        </div>
      </div>
      <textarea
        id="plan-json"
        name="plan-json"
        className="h-64 w-full resize-y rounded-md border p-3 text-xs leading-5"
        style={{ background: "var(--surface-deep)", borderColor: "var(--border)" }}
        spellCheck={false}
        placeholder='{ "format_version": "1.2", "resource_changes": [ ... ] }'
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className="btn-primary" onClick={onReview} disabled={busy || value.trim().length === 0}>
          {busy ? "Reviewing…" : "Review plan"}
        </button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          Sensitive attributes are stripped before anything leaves this app.
        </span>
      </div>
    </section>
  );
}
