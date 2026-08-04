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

## 2026-07-16 11:03
- fix: persist transaction deletions

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.test.tsx
-  M src/App.tsx
-  M src/AuthScreen.test.tsx
-  M src/lib/storage.test.ts
-  M src/lib/storage.ts
-  M src/pages/TransactionsPage.tsx
-  M tests/e2e/remote.spec.ts
-  M tests/e2e/support/supabaseMock.ts

## 2026-07-16 11:08
- style: modernize transactions workspace

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.test.tsx
-  M src/index.css
-  M src/pages/TransactionsPage.tsx
-  M tests/e2e/local.spec.ts
-  M tests/e2e/mobile.spec.ts
-  M tests/e2e/remote.spec.ts

## 2026-07-16 11:29
- style: modernize staged import workflow

Changed files:
-  M src/App.test.tsx
-  M src/App.tsx
-  M src/index.css
-  M src/pages/ImportPage.tsx
-  M tests/e2e/local.spec.ts
-  M tests/e2e/mobile.spec.ts

## 2026-07-31 13:34
- feat: mostrar compromissos por categoria no dashboard

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.test.tsx
-  M src/lib/calculations.test.ts
-  M src/lib/calculations.ts
-  M src/pages/Dashboard.tsx

## 2026-07-31 13:46
- fix: persistir exclusão de contas futuras

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.test.tsx
-  M src/App.tsx
-  M src/lib/storage.test.ts
-  M src/lib/storage.ts
-  M src/pages/BillsPage.tsx
-  M src/pages/types.ts

## 2026-07-31 14:18
- feat: adicionar identidade a séries de contas futuras

Changed files:
-  M src/lib/storage.test.ts
-  M src/lib/storage.ts
-  M src/pages/BillsPage.tsx
-  M src/types.ts
- ?? src/pages/BillsPage.test.tsx
- ?? supabase/migrations/

## 2026-07-31 14:34
- feat: adicionar exclusão segura de ocorrências futuras

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.test.tsx
-  M src/App.tsx
-  M src/index.css
-  M src/lib/storage.test.ts
-  M src/lib/storage.ts
-  M src/pages/BillsPage.test.tsx
-  M src/pages/BillsPage.tsx
-  M src/pages/types.ts
-  M src/test/supabaseMock.ts

## 2026-08-03 11:49
- fix: preservar integridade dos compromissos financeiros

Changed files:
-  M src/lib/calculations.test.ts
-  M src/lib/calculations.ts
-  M src/pages/BillsPage.test.tsx
-  M src/pages/BillsPage.tsx
-  M src/pages/Dashboard.tsx
- ?? src/pages/Dashboard.test.tsx

## 2026-08-03 17:56
- fix: preservar backup local ao sair com sincronização indisponível

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.tsx

## 2026-08-04
- Aplicada manualmente no projeto Supabase `mvmdcmiwkwerldriyzce` a migration `supabase/migrations/20260731140000_add_future_bill_series_identity.sql`.
- Causa: ausência das colunas `series_id` e `occurrence_number` causava PGRST204 no upsert de `future_bills`.
- Ação: migration aplicada e cache do PostgREST recarregado.
- Resultado: autosave restaurado.
- Nenhuma outra migration foi aplicada.

## 2026-08-04 10:18
- docs: registrar aplicação da migration de contas futuras

Changed files:
-  M docs/devlog.md

## 2026-08-04 11:01
- feat: melhorar diagnóstico e status de sincronização

Changed files:
-  M src/App.remote.test.tsx
-  M src/App.test.tsx
-  M src/App.tsx
-  M src/index.css
-  M src/lib/storage.ts
