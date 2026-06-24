# Finance Control React v1

Primeira refatoração do app financeiro para virar um produto online com login.

## O que esta versão já tem

- React + TypeScript + Vite.
- Interface editável parecida com planilha.
- Dashboard financeiro.
- Lançamentos.
- Importação direta de CSV/PDF dentro do app.
- Contas futuras com botão "Pagar" que gera lançamento.
- Cartões e parcelas com fechamento/vencimento.
- Investimentos.
- Metas e orçamento.
- Backup JSON.
- Modo localStorage se Supabase não estiver configurado.
- Modo online com login/cadastro se Supabase estiver configurado.

## Como rodar no VS Code

1. Abra a pasta `finance-control-react-v1` no VS Code.
2. Rode:

```bash
npm install
```

3. Rode:

```bash
npm run dev
```

4. Abra o endereço que aparecer no terminal, normalmente:

```text
http://localhost:5173
```

## Rodar sem Supabase

Sem configurar `.env`, o app roda em modo local usando `localStorage`.
Isso é bom para testar a interface e as regras.

## Rodar com Supabase

1. Crie um projeto Supabase.
2. Vá em SQL Editor.
3. Execute o arquivo:

```text
supabase/schema.sql
```

4. Copie o arquivo `.env.example` para `.env`.
5. Preencha:

```bash
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_ANON_KEY
```

6. Rode novamente:

```bash
npm run dev
```

Com Supabase configurado, o app mostra tela de login/cadastro e salva o estado financeiro na tabela `finance_states`.

## Importação de arquivos

Na aba **Importar banco/cartão**, o app aceita:

- CSV do extrato da conta Nubank.
- CSV da fatura Nubank.
- PDF do extrato da conta Nubank.

Por enquanto, PDF de fatura do cartão ainda não está habilitado com segurança. O ideal para fatura continua sendo CSV.

## Observação importante

Esta versão usa uma tabela JSONB única no Supabase para acelerar o MVP. Para virar produto mais robusto, o próximo passo será normalizar em tabelas reais:

- transactions
- accounts
- cards
- categories
- future_bills
- installments
- investments
- budgets
- imports
- import_items

Isso melhora relatórios, permissões, auditoria e performance em uso real.


## v2 - Correção de isolamento de usuários

Esta versão corrige o comportamento em que um novo usuário podia receber dados do `localStorage` do navegador. Agora, quando um usuário online ainda não tem registro no Supabase, ele começa com uma base vazia. O app também bloqueia salvamento remoto enquanto os dados online ainda estão carregando.
