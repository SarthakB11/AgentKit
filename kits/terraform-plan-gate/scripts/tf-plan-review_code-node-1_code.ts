const trigger = {{triggerNode_1.output}};
const assessed = {{InstructorLLMNode_1.output}};
const comment = {{LLMNode_1.output.generatedResponse}};
const policies = {{searchNode_1.output.searchResults}};

const rawFacts = Array.isArray(trigger.changes) ? trigger.changes : [];
const facts = rawFacts.map(f => {
  if (typeof f === "string") { try { return JSON.parse(f); } catch (e) { return { address: String(f), parseError: true }; } }
  return f;
});

const list = Array.isArray(assessed && assessed.assessments) ? assessed.assessments : [];
const byAddress = new Map(list.filter(a => a && a.address).map(a => [String(a.address), a]));
const order = { critical: 4, high: 3, medium: 2, low: 1 };

const changes = facts.map(f => {
  const a = byAddress.get(String(f.address));
  const risk = a && order[a.risk] ? a.risk : "unclassified";
  return {
    address: f.address, type: f.type, actions: f.actions, actionReason: f.actionReason || null,
    changedAttributes: f.changedAttributes || [], flags: f.flags || [],
    risk, category: a ? a.category : null, policyIds: a && Array.isArray(a.policyIds) ? a.policyIds : [],
    reason: a ? a.reason : null, mitigation: a ? a.mitigation : null,
    confidence: a && typeof a.confidence === "number" ? a.confidence : null
  };
});

const counts = { critical: 0, high: 0, medium: 0, low: 0, unclassified: 0 };
for (const c of changes) counts[c.risk] = (counts[c.risk] || 0) + 1;

// Verdict is arithmetic, never asked of the model. Unclassified counts against
// the verdict: a gap in the assessment is unknown risk, not absent risk.
let verdict = "allow";
if (counts.critical > 0) verdict = "block";
else if (counts.high > 0 || counts.unclassified > 0) verdict = "needs-approval";
else if (counts.medium > 0) verdict = "needs-approval";

const highest = changes.reduce((m, c) => (order[c.risk] || 0) > (order[m] || 0) ? c.risk : m, "low");
const summary = verdict === "allow"
  ? `${changes.length} change(s), nothing above low risk.`
  : `${changes.length} change(s): ${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.unclassified} unclassified. Highest: ${highest}.`;

const policiesConsulted = (Array.isArray(policies) ? policies : []).map(p => ({
  policyId: p.policy_id || null, title: p.title || null, certainty: typeof p.certainty === "number" ? p.certainty : null
}));

output = { verdict, summary, totalChanges: changes.length, counts, changes, reviewComment: comment || null, policiesConsulted };
