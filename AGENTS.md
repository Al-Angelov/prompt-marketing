# Codex instructions for this repository

Use repo-scoped skills in `.codex/skills/` when relevant.

## Frontend work
For any task involving React/Vite UI, layout, styling, interaction design, loading states, result presentation, or user flow, use the `ui-ux` skill.

## Integration / verification
For any task that changes frontend-backend integration, APIs, scoring, research orchestration, deployment behavior, or end-to-end flow, use the `qa-integration` skill before declaring the work complete.

## Multi-agent use
If Codex multi-agent/subagent support is available:
- Delegate frontend design/review to a UI/UX subagent using the `ui-ux` skill.
- Delegate final integration verification to a QA/integration subagent using the `qa-integration` skill.
- Do not let two agents edit the same files concurrently.
- The QA agent should review the UI agent's completed changes rather than racing it.

## Product invariant
The main product flow is:

Country + Industry
→ regional research
→ company discovery
→ evidence verification
→ structured analysis
→ Priority Score
→ company report
→ ranked results

Keep complexity behind the interface.
