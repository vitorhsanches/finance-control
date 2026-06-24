# Finance Control React v3

Versão v3 com persistência online em tabelas estruturadas no Supabase.

## O que mudou na v3

A v2 salvava tudo em uma única tabela `finance_states`, com um JSON por usuário.

A v3 passa a salvar em tabelas separadas:

- `profiles`
- `app_settings`
- `categories`
- `accounts`
- `cards`
- `payment_methods`
- `card_rules`
- `transactions`
- `future_bills`
- `installments`
- `investments`
- `budgets`
- `imports`
- `import_items`

Isso melhora a base para filtros, relatórios, histórico de importação, deduplicação e evolução do produto.

## Antes de rodar a v3

No Supabase, abra:

```text
SQL Editor → New Query
```

Cole e execute o arquivo:

```text
supabase/schema_v3.sql
```

O arquivo `supabase/schema.sql` também está apontando para o mesmo conteúdo da v3.

A v3 pode coexistir com a tabela antiga `finance_states`.
Se um usuário já tinha dados na v2, a v3 tenta migrar automaticamente os dados antigos do `finance_states` para as tabelas novas no primeiro login.

## Variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA
```

Nunca suba `.env.local` para o GitHub.

## Rodar localmente

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy na Vercel

Depois de subir para o GitHub, adicione na Vercel as variáveis:

```env
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Depois faça o deploy.

## Check pós-deploy

Teste:

1. Login
2. Criar conta
3. Adicionar lançamento sem linha anterior
4. Atualizar página com F5
5. Logout/login
6. Criar outro usuário e validar que começa vazio
7. Verificar no Supabase se os dados aparecem nas tabelas novas, principalmente `transactions` e `app_settings`

## Observação técnica

A v3 ainda mantém a interface e o estado em memória no formato antigo do app para acelerar a migração.
A diferença principal está na camada `src/lib/storage.ts`, que agora converte esse estado para tabelas estruturadas no Supabase.
