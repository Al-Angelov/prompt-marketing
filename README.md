# Mergero / MGX prospect intelligence

A responsive React + TypeScript frontend for evidence-led private market origination. Brand logo sourced from https://mergero.com/; typography follows its serif and sans-serif approach, with restrained sage accents for research status.

## Run

```sh
npm install
npm run dev
```

`npm run build` generates the production site in `dist/`.

## Included

- Regional and country filters, industry and transaction filters, confidence filtering, search, and sorting.
- Explainable prospect briefs, signal review, transaction hypotheses, and an insufficient-evidence state that disables outreach preparation.
- Shortlists and editable outreach drafts persisted locally in the browser.
- CSV export, market coverage, and regional methodology views.
- Responsive desktop and mobile layouts; Ctrl/Cmd+K focuses search and Escape dismisses dialogs.

## Data boundary

This is a frontend demonstration. Companies, owner identities, financials, scores, signals, and verification counts are illustrative. It does not scrape sources, validate claims, run scoring agents, connect to a CRM, or send messages. Production integration needs provenance-linked observations, independent corroboration, validated regional scoring criteria, human review, authentication, and server persistence. Local storage here is for demonstration preferences and drafts only.

## Verify

With the dev server running on port 5173 and Microsoft Edge installed:

```sh
npx playwright test
```

The browser tests cover regional filtering, low-evidence outreach gating, shortlist persistence, draft persistence, export, empty results, and mobile navigation.
