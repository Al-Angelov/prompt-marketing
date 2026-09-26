---
name: ui-ux
description: Design or revise the Mergero React/Vite frontend so the product is immediately understandable, visually polished, and centered on the two-input Country + Industry workflow. Use this skill for any frontend, layout, visual hierarchy, interaction, loading, or results-screen work.
---

# Goal

Make the product feel like a focused M&A intelligence tool, not a generic CRM/dashboard.

The user should understand the main action within 3 seconds:

Country + Industry → research → ranked opportunities.

# Rules

- Preserve working backend/API integration.
- The main input screen has exactly two primary controls: Country and Industry.
- Do not expose backend phases, Java/OpenAI terminology, scoring internals, model settings, filters, or infrastructure.
- Prefer progressive disclosure: simple ranked results first, detailed evidence only when a company is opened.
- Avoid dashboard clutter, excessive cards, pills, badges, gradients, glow effects, and unnecessary navigation.
- Use strong spacing, typography, hierarchy, and responsive behavior.
- Keep Mergero styling institutional and editorial: warm off-white, charcoal, restrained accent colors, serif display headings where appropriate, clean sans-serif UI text, thin borders.
- Loading states should use user language such as: understanding market, finding companies, checking evidence, running analysis, ranking opportunities.
- Result rows should prioritize: Company, Priority Score, Confidence, Why now, and access to the report.
- Make errors understandable and recoverable.
- Do not invent data to make the UI look complete.

# Definition of done

- A first-time user knows what to do without instructions.
- The main screen is not visually busy.
- Mobile and desktop layouts work.
- Country and Industry flow reaches the existing investigation endpoint.
- Loading and result states are coherent.
- No backend capability is removed merely because it is hidden from the UI.
