# Fina Sync Devlog


## 2026-07-08 15:03
- feat: add generic csv import mapping

Changed files:
- ?? scripts/

## 2026-07-08 15:06
- feat: add generic csv import mapping

Changed files:
-  D scripts/devlog.ps1

## 2026-07-08 15:21
- feat: save csv import profiles

Changed files:
-  M src/App.tsx
-  M src/data/sample.ts
-  M src/index.css
-  M src/types.ts

## 2026-07-11 12:32
- feat: save csv import profiles

Changed files:
-  M src/lib/storage.ts

## 2026-07-11 12:53
- fix: prevent destructive financial autosave

Changed files:
-  M src/lib/storage.ts

## 2026-07-12 17:32
- fix: prevent destructive financial autosave

Changed files:
- M  src/lib/storage.ts

## 2026-07-12 17:45
- style: improve application-wide UX and frontend consistency

Changed files:
-  M src/App.tsx
-  M src/index.css

## 2026-07-12 18:04
- refactor: improve performance and extract reusable UI components

Changed files:
-  M src/App.tsx
-  M src/lib/importers.ts
- ?? src/components/

## 2026-07-12 18:15
- test: add automated test foundation with Vitest

Changed files:
-  M .gitignore
-  M package-lock.json
-  M package.json
-  M src/App.tsx
- ?? src/App.test.tsx
- ?? src/AuthScreen.test.tsx
- ?? src/lib/calculations.test.ts
- ?? src/lib/importers.test.ts
- ?? src/test/
- ?? vitest.config.ts

## 2026-07-12 23:28
- test: expand Supabase persistence and remote lifecycle coverage

Changed files:
-  M src/App.test.tsx
-  M src/lib/storage.ts
- ?? src/App.remote.test.tsx
- ?? src/lib/storage.test.ts
- ?? src/lib/supabaseClient.ts
- ?? src/test/supabaseMock.ts

## 2026-07-12 23:35
- test: add dedicated bank import format coverage

Changed files:
-  M src/test/setup.ts
-  M vitest.config.ts
- ?? src/lib/bankImportFormats.test.ts
- ?? src/test/fixtures/

## 2026-07-12 23:46
- refactor: split App into dedicated domain pages

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.tsx
-  M src/lib/storage.ts
- ?? src/pages/

## 2026-07-12 23:56
- perf: add page-level lazy loading

Changed files:
-  M src/App.tsx
-  M src/index.css

## 2026-07-13 00:08
- test: add Playwright end-to-end coverage

Changed files:
-  M .gitignore
-  M package-lock.json
-  M package.json
-  M vitest.config.ts
- ?? playwright.config.ts
- ?? tests/

## 2026-07-13 00:16
- feat: add explainable financial insights

Changed files:
-  M src/index.css
-  M src/pages/Dashboard.tsx
- ?? src/lib/financialInsights.test.ts
- ?? src/lib/financialInsights.ts

## 2026-07-13 11:57
- feat: make dashboard insights collapsible and add project instructions

Changed files:
-  M src/App.test.tsx
-  M src/index.css
-  M src/pages/Dashboard.tsx
- ?? AGENTS.md

## 2026-07-15 14:25
- style: simplify app shell and group sidebar navigation

Changed files:
-  M src/App.test.tsx
-  M src/App.tsx
-  M src/index.css

## 2026-07-16 10:04
- style: modernize dashboard financial overview

Changed files:
-  M src/App.test.tsx
-  M src/index.css
-  M src/pages/Dashboard.tsx
-  M tests/e2e/mobile.spec.ts
