Plan summary: {{triggerNode_1.output.summary}}

Assessments (JSON):
{{InstructorLLMNode_1.output}}

Change facts (JSON, one per line):
{{triggerNode_1.output.changes}}

Write the review comment in this shape:
1. One line verdict sentence: what we recommend (apply as-is, apply after the listed fixes, or do not apply) and why, in plain words.
2. "### Findings" - one bullet per change that is medium or above, ordered critical first: `address` - risk - what is wrong - cite policy ids in brackets - the fix.
3. "### Before apply" - a checklist of concrete steps (backup/snapshot names, change window, owner sign-off, split plan) derived from the mitigations. Omit this section if there is nothing above low.
4. "### Routine" - one line listing the low-risk addresses, or "none".
Under 300 words.
