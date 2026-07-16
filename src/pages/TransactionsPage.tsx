import { useMemo, useState } from "react";
import { Check, ChevronDown, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { Transaction } from "../types";
import { currentMonth, formatDate, money, todayISO, uid, ym } from "../lib/utils";
import { Empty, MoneyInput, Panel, Select } from "../components/ui";
import type { PageProps } from "./types";

const FALLBACK_EXPENSE_CATEGORIES = [
  "Alimentação", "Transporte", "Casa", "Compras", "Saúde", "Educação", "Lazer", "Outros",
];
const FALLBACK_INCOME_CATEGORIES = ["Salário", "Freelance", "Investimentos", "Outras receitas"];

export function TransactionsPage({ state, updateState, month, onDeleteTransaction }: PageProps & { month: string; onDeleteTransaction: (transactionId: string) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Todos");
  const [type, setType] = useState("Todos");
  const [account, setAccount] = useState("Todos");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Transaction | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const expenseCategories = state.settings.categories.length
    ? state.settings.categories
    : FALLBACK_EXPENSE_CATEGORIES;
  const incomeCategories = state.settings.incomeCategories.length
    ? state.settings.incomeCategories
    : FALLBACK_INCOME_CATEGORIES;
  const categories = Array.from(new Set([...incomeCategories, ...expenseCategories]));
  const accounts = Array.from(new Set([...state.settings.accounts, ...state.settings.cards]));
  const monthRows = useMemo(
    () => state.transactions.filter((transaction) => ym(transaction.date) === month),
    [state.transactions, month],
  );
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
    return monthRows
      .filter((transaction) => category === "Todos" || transaction.category === category)
      .filter((transaction) => type === "Todos" || transaction.type === type)
      .filter((transaction) => account === "Todos" || transaction.accountOrCard === account)
      .filter((transaction) => !normalizedQuery || [transaction.description, transaction.category, transaction.accountOrCard]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(normalizedQuery)));
  }, [monthRows, category, type, account, query]);
  const hasFilters = query !== "" || category !== "Todos" || type !== "Todos" || account !== "Todos";

  const categoryOptions = (transaction: Transaction) => {
    const base = transaction.type === "income" ? incomeCategories : expenseCategories;
    return Array.from(new Set([...base, transaction.category].map((item) => item?.trim()).filter(Boolean)));
  };

  const add = () => {
    const transaction: Transaction = {
      id: uid("tr"),
      date: month === currentMonth() ? todayISO() : `${month}-01`,
      description: "Novo lançamento",
      type: "expense",
      category: state.settings.categories[0] || "Outros",
      amount: 0,
      paymentMethod: "Pix",
      accountOrCard: state.settings.accounts[0] || "Conta",
      essential: false,
      paid: true,
    };
    updateState((previous) => ({ ...previous, transactions: [transaction, ...previous.transactions] }));
    setEditingId(transaction.id);
    setDraft(transaction);
    setFeedback("Lançamento criado. Complete os dados e salve as alterações.");
  };

  const startEditing = (transaction: Transaction) => {
    setEditingId(transaction.id);
    setDraft({ ...transaction });
    setPendingDate(null);
    setFeedback("");
  };

  const updateDraft = (patch: Partial<Transaction>) => {
    setDraft((current) => current ? { ...current, ...patch } : current);
  };

  const changeDraftDate = (nextDate: string) => {
    if (!draft || !nextDate) return;
    if (ym(nextDate) !== ym(draft.date)) {
      setPendingDate(nextDate);
      return;
    }
    setPendingDate(null);
    updateDraft({ date: nextDate });
  };

  const saveEdit = () => {
    if (!draft || pendingDate) return;
    updateState((previous) => ({
      ...previous,
      transactions: previous.transactions.map((transaction) =>
        transaction.id === draft.id ? { ...transaction, ...draft } : transaction),
    }));
    setEditingId(null);
    setDraft(null);
    setFeedback("Alterações salvas com sucesso.");
  };

  const remove = async (transaction: Transaction) => {
    if (!window.confirm(`Excluir o lançamento “${transaction.description}”?`)) return;
    try {
      await onDeleteTransaction(transaction.id);
      if (editingId === transaction.id) {
        setEditingId(null);
        setDraft(null);
      }
      setFeedback("Lançamento excluído.");
    } catch {
      // The app shell keeps the transaction visible and reports the remote error.
    }
  };

  const clearFilters = () => {
    setQuery("");
    setCategory("Todos");
    setType("Todos");
    setAccount("Todos");
  };

  const toggleDetails = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <Panel title="Lançamentos" action={<button className="primary" onClick={add}><Plus size={16} /> Adicionar</button>}>
      {feedback && <div className="transaction-feedback" role="status"><Check size={16} /> {feedback}</div>}

      <div className="transaction-filters" aria-label="Filtros de lançamentos">
        <label className="field transaction-search">
          <span>Buscar</span>
          <span className="transaction-search-input"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Descrição, categoria ou conta" /></span>
        </label>
        <Select label="Tipo" value={type} onChange={setType} options={["Todos", "income", "expense"]} />
        <Select label="Categoria" value={category} onChange={setCategory} options={["Todos", ...categories]} />
        <Select label="Conta/cartão" value={account} onChange={setAccount} options={["Todos", ...accounts]} />
        <div className="field transaction-period"><span>Período</span><strong>{month}</strong></div>
        <button className="secondary transaction-clear" type="button" onClick={clearFilters} disabled={!hasFilters}><X size={15} /> Limpar</button>
      </div>

      <div className="transaction-results" aria-live="polite">
        <strong>{rows.length}</strong> de {monthRows.length} lançamento(s)
      </div>

      {rows.length ? (
        <div className="transaction-table-wrap">
          <table className="transaction-table">
            <thead><tr><th>Descrição</th><th>Data</th><th>Categoria e conta</th><th>Valor</th><th>Status</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>
              {rows.map((transaction) => {
                const isEditing = editingId === transaction.id && draft?.id === transaction.id;
                const expanded = expandedIds.has(transaction.id) || isEditing;
                return (
                  <tr className={`${expanded ? "is-expanded" : ""} ${isEditing ? "is-editing" : ""}`} key={transaction.id}>
                    <td className="transaction-primary" data-label="Lançamento">
                      {isEditing ? <input aria-label={`Descrição de ${transaction.description}`} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} /> : <><strong>{transaction.description}</strong><span>{transaction.type === "income" ? "Receita" : "Despesa"}</span></>}
                    </td>
                    <td data-label="Data">
                      {isEditing ? <><input aria-label={`Data de ${transaction.description}`} type="date" required value={pendingDate || draft.date || todayISO()} onChange={(event) => changeDraftDate(event.target.value)} />{pendingDate && <div className="transaction-date-warning"><span>Mudança de mês pendente</span><button className="secondary small" onClick={() => { updateDraft({ date: pendingDate }); setPendingDate(null); }}>Confirmar</button><button className="secondary small" onClick={() => setPendingDate(null)}>Cancelar</button></div>}</> : <span>{formatDate(transaction.date)}</span>}
                    </td>
                    <td className="transaction-meta" data-label="Categoria e conta">
                      {isEditing ? <><select aria-label={`Categoria de ${transaction.description}`} value={draft.category} onChange={(event) => updateDraft({ category: event.target.value })}>{categoryOptions(draft).map((item) => <option key={item}>{item}</option>)}</select><select aria-label={`Conta/cartão de ${transaction.description}`} value={draft.accountOrCard} onChange={(event) => updateDraft({ accountOrCard: event.target.value })}>{accounts.map((item) => <option key={item}>{item}</option>)}</select></> : <><strong>{transaction.category}</strong><span>{transaction.accountOrCard}</span></>}
                    </td>
                    <td className={`transaction-amount ${transaction.type === "income" ? "income" : "expense"}`} data-label="Valor">
                      {isEditing ? <MoneyInput className="money-input" value={draft.amount} onChange={(amount) => updateDraft({ amount })} /> : money(transaction.amount, state)}
                    </td>
                    <td className="transaction-extra" data-label="Status">
                      {isEditing ? <div className="transaction-edit-fields"><label><span>Tipo</span><select aria-label={`Tipo de ${transaction.description}`} value={draft.type} onChange={(event) => updateDraft({ type: event.target.value as Transaction["type"] })}><option value="expense">Despesa</option><option value="income">Receita</option></select></label><label><span>Pagamento</span><select aria-label={`Pagamento de ${transaction.description}`} value={draft.paymentMethod} onChange={(event) => updateDraft({ paymentMethod: event.target.value })}>{state.settings.paymentMethods.map((item) => <option key={item}>{item}</option>)}</select></label><label className="transaction-paid"><input aria-label={`Pago ${transaction.description}`} type="checkbox" checked={draft.paid} onChange={(event) => updateDraft({ paid: event.target.checked })} /><span>Pago</span></label></div> : <><span className={`transaction-status ${transaction.paid ? "paid" : "pending"}`}>{transaction.paid ? "Pago" : "Pendente"}</span><span className="transaction-payment">{transaction.paymentMethod}</span></>}
                    </td>
                    <td className="transaction-actions" data-label="Ações">
                      <button type="button" className="transaction-details-toggle" aria-expanded={expanded} aria-label={`${expanded ? "Ocultar" : "Mostrar"} detalhes de ${transaction.description}`} onClick={() => toggleDetails(transaction.id)}><ChevronDown size={17} /></button>
                      {isEditing ? <><button type="button" className="icon transaction-save" aria-label={`Salvar ${transaction.description}`} onClick={saveEdit} disabled={Boolean(pendingDate)}><Check size={16} /></button><button type="button" className="icon" aria-label={`Cancelar edição de ${transaction.description}`} onClick={() => { setEditingId(null); setDraft(null); setPendingDate(null); }}><X size={16} /></button></> : <button type="button" className="icon" aria-label={`Editar lançamento ${transaction.description}`} onClick={() => startEditing(transaction)}><Pencil size={15} /></button>}
                      <button type="button" className="icon danger" aria-label={`Excluir lançamento ${transaction.description}`} onClick={() => remove(transaction)}><Trash2 size={15} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty message={monthRows.length ? "Nenhum lançamento corresponde aos filtros selecionados." : "Nenhum lançamento neste mês. Adicione o primeiro para começar."} />}
    </Panel>
  );
}
