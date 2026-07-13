# AGENTS.md

## Project overview

Fina Sync is a personal finance application built with React, TypeScript, Vite, Supabase, Vitest, React Testing Library, and Playwright.

The application includes:

- Authentication and session handling.
- Local and remote persistence.
- Autosave.
- Transactions.
- Bills.
- Installments.
- Budgets.
- Investments.
- Bank file imports.
- Backup import and export.
- Financial insights.
- Responsive desktop and mobile layouts.

The application already has automated unit, integration, and end-to-end tests. Changes must preserve existing behavior unless the user explicitly requests a behavior change.

## General working rules

- Read this file before making changes.
- Inspect the existing implementation before proposing edits.
- Preserve existing features unless removal is explicitly requested.
- Avoid broad rewrites when a focused change is enough.
- Prefer maintainable, readable code over clever abstractions.
- Keep TypeScript strict and avoid `any` unless there is a clear justification.
- Reuse existing patterns and components before creating new ones.
- Do not duplicate logic that already exists in shared modules.
- Keep changes scoped to the requested task.
- Do not modify unrelated files.
- Do not add dependencies unless they are necessary and justified.
- Do not update major dependency versions as part of unrelated work.
- Do not expose secrets, tokens, credentials, personal data, or production configuration.
- Never contact production Supabase services during automated tests.

## Git and delivery rules

- Never commit or push unless explicitly instructed.
- Do not create empty or artificial commits.
- Do not rewrite Git history unless explicitly instructed.
- Do not use force push unless explicitly instructed.
- Before finishing, report every file changed or created.
- Suggest an appropriate Conventional Commit message, but do not run it.
- The user normally publishes changes with:

```powershell
.\scripts\up.ps1 "type: concise description"
```

Preferred commit prefixes:

- `feat:` new user-facing functionality
- `fix:` bug correction
- `refactor:` internal restructuring without intended behavior changes
- `perf:` performance improvement
- `test:` automated test changes
- `style:` visual or interaction polish without core behavior changes
- `docs:` documentation-only changes
- `chore:` tooling, configuration, or maintenance work

## Windows and command execution rules

The project is developed on Windows using PowerShell.

- Prefer PowerShell-compatible commands.
- Keep file operations inside the repository workspace.
- Do not repeatedly request permission to check whether `apply_patch` is available.
- Do not attempt to call `apply_patch` outside the Windows sandbox.
- If `apply_patch` is unavailable, edit files using a workspace-safe method such as PowerShell, Python, or the available editor tools.
- Do not run destructive commands without explicit permission.
- Do not delete files unless the task clearly requires it.
- Do not install global packages.
- Use local project commands and package scripts when available.

## Architecture

### App shell

`src/App.tsx` should remain focused on application-level responsibilities:

- Application boot.
- Authentication lifecycle.
- Session handling.
- Local and remote state ownership.
- Autosave.
- Backup import/export.
- Logout.
- Navigation shell.
- Composition of domain pages.

Avoid moving large page-specific logic back into `App.tsx`.

### Pages

Domain pages live under `src/pages`.

Current page modules include:

- `Dashboard.tsx`
- `TransactionsPage.tsx`
- `ImportPage.tsx`
- `InstallmentsPage.tsx`
- `BillsPage.tsx`
- `InvestmentsPage.tsx`
- `BudgetsPage.tsx`
- `SettingsPage.tsx`

Keep page-specific filters, drafts, handlers, and view logic inside the relevant page when practical.

Use `src/pages/types.ts` for small shared page contracts such as `PageProps`.

Avoid using a barrel import when it would prevent Vite from preserving lazy-loading chunk boundaries.

### Shared UI

Reusable UI primitives belong in:

```text
src/components/ui.tsx
```

Current shared primitives include:

- `Panel`
- `MetricCard`
- `MoneyInput`
- `NumberField`
- `Select`
- `TextArea`
- `Empty`
- `StatusBadge`

Reuse these primitives before creating page-local copies.

### Business logic

Extract deterministic financial calculations into testable modules under:

```text
src/lib/
```

Examples include:

- calculations
- importers
- financial insights
- storage
- Supabase client construction

Business rules should not be embedded deeply inside rendering code when they can be expressed as pure functions.

### Supabase

Supabase client construction lives in:

```text
src/lib/supabaseClient.ts
```

Persistence behavior lives in:

```text
src/lib/storage.ts
```

Preserve existing public exports unless there is a strong reason to change them.

Remote tests should use the existing mocks rather than contacting a real backend.

## Performance rules

- Preserve page-level lazy loading for large pages.
- Keep Recharts out of the initial bundle when possible.
- Keep PDF.js dynamically imported and loaded only when a PDF is selected.
- Reuse the cached PDF.js loading promise.
- Avoid unnecessary re-renders.
- Use `useMemo` only for genuinely expensive or stable derived data.
- Use `useCallback` when callback stability materially helps child rendering or effects.
- Avoid premature micro-optimizations.
- Do not over-split very small modules.
- Measure bundle impact when changing imports, pages, charts, or large dependencies.
- Preserve useful Vite chunk boundaries.

## UX and accessibility rules

- Preserve the existing visual design system.
- Maintain consistent spacing, typography, borders, shadows, fields, buttons, notices, and panels.
- Use clear page descriptions and concise status messages.
- Preserve responsive desktop and mobile behavior.
- Use accessible labels and semantic elements.
- Prefer stable accessible selectors in tests.
- Ensure buttons have meaningful names.
- Use `aria-expanded`, `aria-controls`, and related attributes for collapsible content.
- Preserve visible keyboard focus states.
- Respect reduced-motion preferences.
- Avoid adding visual clutter.
- Important secondary content, such as financial insights, may be collapsible when appropriate.
- Do not remove information unless explicitly requested.

## Financial insights rules

Financial insights must be:

- Deterministic.
- Explainable.
- Based only on data already available in application state.
- Supported by visible source values.
- Hidden when supporting data is insufficient.
- Free of generic or unsupported financial advice.
- Tested for normal, empty, zero-value, unusual, and insufficient-history cases.

Current insight types include:

- Monthly spending increase or decrease.
- Largest category growth.
- Unusual expenses.
- Expected end-of-month balance.
- Significant pending bill impact.
- Recurring expense descriptions.
- Budget warnings near or above limits.

Do not change calculation thresholds silently. If thresholds change, document and test them.

## Import rules

Supported real bank formats include:

- Nubank account CSV.
- Nubank card CSV.
- Nubank account PDF.
- Caixa statement PDF.
- Generic CSV mapping.

Preserve:

- Original transaction descriptions.
- Source metadata.
- External hashes.
- Duplicate detection.
- Warnings and ignored-row behavior.
- Existing account/card assignment.
- Date and amount parsing.
- Payment-method and category inference.

Fixtures must:

- Contain no personal data.
- Stay small and focused.
- Represent realistic formats.
- Cover malformed rows, duplicates, positive and negative values, supported dates, and ignored summary rows.

PDF tests may mock PDF.js text extraction, but browser behavior should remain as close to real use as practical.

## Testing requirements

For any meaningful code change, run the relevant checks.

Minimum validation before completion:

```powershell
npm test
npm run build
git diff --check
```

When the change affects browser flows, navigation, file handling, authentication, autosave, responsiveness, or lazy loading, also run:

```powershell
npm run test:e2e
```

When test coverage is relevant, also run:

```powershell
npm run test:coverage
```

Do not weaken assertions merely to make tests pass.

Do not remove or skip failing tests without explaining why.

Prefer stable accessible selectors over brittle CSS selectors.

### Existing test stack

- Vitest
- jsdom
- React Testing Library
- jest-dom
- user-event
- V8 coverage
- Playwright

### Existing test areas

- Application rendering and navigation.
- Authentication.
- Transactions and filtering.
- Financial calculations.
- Storage and Supabase lifecycle.
- Autosave.
- Backup import/export.
- Bank import formats.
- Generic CSV mapping.
- Financial insights.
- Desktop and mobile E2E flows.

## E2E rules

- Do not contact production services.
- Mock Supabase at the HTTP boundary using the existing E2E support utilities.
- Preserve real application code paths where practical.
- Cover both local and mocked remote modes when relevant.
- Keep tests deterministic.
- Avoid arbitrary fixed waits.
- Use Playwright expectations and event-based waits.
- Preserve Chromium desktop and Pixel 7 coverage unless the task changes browser scope.

## CSS rules

- Prefer extending existing classes and design tokens.
- Avoid large inline style objects.
- Keep responsive behavior intact.
- Preserve sticky navigation and table behavior.
- Check desktop and mobile layouts after visual changes.
- Avoid introducing unnecessary animations.
- Respect `prefers-reduced-motion`.
- Do not use CSS changes to hide functional regressions.

## File organization

Expected high-level structure:

```text
fcr_v2/
├─ AGENTS.md
├─ docs/
│  └─ devlog.md
├─ scripts/
│  └─ up.ps1
├─ src/
│  ├─ components/
│  │  └─ ui.tsx
│  ├─ lib/
│  ├─ pages/
│  ├─ test/
│  ├─ App.tsx
│  └─ index.css
├─ tests/
│  └─ e2e/
├─ package.json
├─ package-lock.json
├─ playwright.config.ts
├─ vitest.config.ts
└─ vite.config.ts
```

Do not place `AGENTS.md` inside `src`, `scripts`, or `docs`. It belongs in the repository root.

## Completion report

At the end of every task, report:

1. A concise summary of what changed.
2. The files changed or added.
3. Validation commands executed.
4. Test and build results.
5. Bundle or coverage impact when relevant.
6. Any remaining risks, gaps, or follow-up opportunities.
7. A suggested Conventional Commit message.
8. Confirmation that no commit or push was performed.

Do not claim a check passed unless it was actually executed.

## Current product direction

Prioritize work in this order unless the user requests otherwise:

1. Correctness and prevention of data loss.
2. Clear and uncluttered user experience.
3. Useful, explainable financial insights.
4. Import reliability.
5. Test coverage for critical flows.
6. Performance and bundle size.
7. Maintainable architecture.
8. Additional features.

Do not add features solely to increase commit count or GitHub activity. Every change should provide real project value.