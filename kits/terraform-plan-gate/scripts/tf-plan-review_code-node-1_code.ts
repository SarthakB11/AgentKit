const trigger = {{triggerNode_1.output}};
const assessed = {{InstructorLLMNode_1.output}};
const comment = {{LLMNode_1.output.generatedResponse}};
const policies = {{searchNode_1.output.searchResults}};

// Facts arrive JSON-encoded (Studio's trigger schema only offers [] or [string]).
const rawFacts = Array.isArray(trigger.changes) ? trigger.changes : [];
const facts = rawFacts.map(f => {
  if (typeof f === "string") { try { return JSON.parse(f); } catch (e) { return { address: String(f), parseError: true }; } }
  return f;
});

// Everything the model returned is validated against what it was given:
// known addresses only, known risk levels only, known policy ids only,
// confidence clamped. Anything else is dropped or downgraded to unclassified.
const RISKS = { critical: 4, high: 3, medium: 2, low: 1 };
const CATEGORIES = new Set(["data-loss", "availability", "security-exposure", "privilege", "cost", "drift", "routine"]);
const knownPolicyIds = new Set((Array.isArray(policies) ? policies : []).map(p => p && p.policy_id).filter(Boolean));
const knownAddresses = new Set(facts.map(f => String(f.address)));

const list = Array.isArray(assessed && assessed.assessments) ? assessed.assessments : [];
const byAddress = new Map();
let droppedAssessments = 0;
for (const a of list) {
  if (!a || typeof a !== "object" || !knownAddresses.has(String(a.address))) { droppedAssessments++; continue; }
  if (byAddress.has(String(a.address))) { droppedAssessments++; continue; }
  byAddress.set(String(a.address), a);
}

const changes = facts.map(f => {
  const a = byAddress.get(String(f.address));
  const risk = a && RISKS[a.risk] ? a.risk : "unclassified";
  const policyIds = a && Array.isArray(a.policyIds) ? a.policyIds.filter(id => knownPolicyIds.has(id)) : [];
  const confidence = a && typeof a.confidence === "number" && isFinite(a.confidence) ? Math.min(1, Math.max(0, a.confidence)) : null;
  return {
    address: f.address, type: f.type || null, actions: Array.isArray(f.actions) ? f.actions : [], actionReason: f.actionReason || null,
    changedAttributes: Array.isArray(f.changedAttributes) ? f.changedAttributes : [], flags: Array.isArray(f.flags) ? f.flags : [],
    risk,
    category: a && CATEGORIES.has(a.category) ? a.category : null,
    policyIds,
    reason: a && typeof a.reason === "string" ? a.reason : null,
    mitigation: a && typeof a.mitigation === "string" ? a.mitigation : null,
    confidence
  };
});

const counts = { critical: 0, high: 0, medium: 0, low: 0, unclassified: 0 };
for (const c of changes) counts[c.risk] += 1;

// Verdict is arithmetic, never asked of the model. Unclassified counts against
// the verdict: a gap in the assessment is unknown risk, not absent risk.
let verdict = "allow";
if (counts.critical > 0) verdict = "block";
else if (counts.high > 0 || counts.medium > 0 || counts.unclassified > 0) verdict = "needs-approval";

const highest = counts.unclassified > 0 && counts.critical === 0
  ? "unknown"
  : changes.reduce((m, c) => (RISKS[c.risk] || 0) > (RISKS[m] || 0) ? c.risk : m, "low");
const summary = verdict === "allow"
  ? `${changes.length} change(s), nothing above low risk.`
  : `${changes.length} change(s): ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.unclassified} unclassified. Highest: ${highest}.`;

const policiesConsulted = (Array.isArray(policies) ? policies : []).map(p => ({
  policyId: p.policy_id || null, title: p.title || null, certainty: typeof p.certainty === "number" ? p.certainty : null
}));

output = { verdict, summary, totalChanges: changes.length, counts, changes, reviewComment: typeof comment === "string" && comment.trim() ? comment : null, policiesConsulted, droppedAssessments };
