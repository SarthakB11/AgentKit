"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { ClipboardCheck, Copy } from "lucide-react";
import type { PolicyHit } from "../lib/types";
import { Button } from "@/components/ui/button";

export function ReviewComment({ markdown, policies }: { markdown: string | null; policies: PolicyHit[] }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="rounded-lg border p-4" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
      <div className="mb-2 flex items-center">
        <h2 className="text-sm font-semibold">Review comment</h2>
        <Button variant="outline" size="xs" className="ml-auto" onClick={copy} disabled={!markdown}>
          {copied ? <ClipboardCheck aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy for the PR"}
        </Button>
      </div>
      <div className="prose-review text-sm">
        {markdown ? <ReactMarkdown>{markdown}</ReactMarkdown> : <p style={{ color: "var(--muted)" }}>No comment was generated.</p>}
      </div>
      {policies.length > 0 && (
        <div className="mt-4 text-xs" style={{ color: "var(--muted)" }}>
          Policies consulted:{" "}
          {policies.map((p) => `${p.policyId ?? "?"}${p.certainty !== null ? ` (${p.certainty.toFixed(2)})` : ""}`).join(", ")}
        </div>
      )}
    </section>
  );
}
