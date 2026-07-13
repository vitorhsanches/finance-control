import { useEffect, useState } from "react";
import type { FinanceState } from "../types";
import { toNumber } from "../lib/utils";
import { NumberField, Panel, TextArea } from "../components/ui";
import type { PageProps } from "./types";

export function SettingsPage({
  state,
  updateState,
  email,
  displayNameDraft,
  setDisplayNameDraft,
  onSaveProfile,
  profileMessage,
}: PageProps & {
  email: string | null;
  displayNameDraft: string;
  setDisplayNameDraft: (value: string) => void;
  onSaveProfile: () => void;
  profileMessage: string;
}) {

  const s = state.settings;

  const [listDrafts, setListDrafts] = useState({
    categories: s.categories.join(", "),
    incomeCategories: s.incomeCategories.join(", "),
    accounts: s.accounts.join(", "),
    cards: s.cards.join(", "),
    paymentMethods: s.paymentMethods.join(", "),
  });

  useEffect(() => {
    setListDrafts({
      categories: s.categories.join(", "),
      incomeCategories: s.incomeCategories.join(", "),
      accounts: s.accounts.join(", "),
      cards: s.cards.join(", "),
      paymentMethods: s.paymentMethods.join(", "),
    });
  }, [
    s.categories,
    s.incomeCategories,
    s.accounts,
    s.cards,
    s.paymentMethods,
  ]);

  const setSettings = (patch: Partial<FinanceState["settings"]>) =>
    updateState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));

  const parseListDraft = (value: string) =>
    value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

  const updateListDraft = (
    key: keyof typeof listDrafts,
    value: string,
  ) => {
    setListDrafts((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const saveListDraft = (
    key: keyof Pick<
      FinanceState["settings"],
      | "categories"
      | "incomeCategories"
      | "accounts"
      | "cards"
      | "paymentMethods"
    >,
  ) => {
    setSettings({
      [key]: parseListDraft(listDrafts[key]),
    } as Partial<FinanceState["settings"]>);
  };

  const patchCardRule = (
    cardName: string,
    patch: Partial<{ closingDay: number; dueDay: number }>,
  ) =>
    setSettings({
      cardRules: s.cardRules.map((r) =>
        r.cardName === cardName ? { ...r, ...patch } : r,
      ),
    });
return (
  <div className="page-stack">
    <Panel title="Perfil">
      <div className="form-grid">
        <label className="field">
          <span>Nome de exibição</span>
          <input
            value={displayNameDraft}
            onChange={(e) => setDisplayNameDraft(e.target.value)}
            placeholder="Ex: Vitor"
          />
        </label>

        <label className="field">
          <span>E-mail</span>
          <input value={email || ""} disabled />
        </label>
      </div>

      <button
        className="primary"
        style={{ marginTop: 12 }}
        onClick={onSaveProfile}
      >
        Salvar perfil
      </button>

      {profileMessage && <div className="notice">{profileMessage}</div>}
    </Panel>

    <Panel title="Configurações gerais">
        <div className="form-grid">
          <NumberField
            label="Saldo inicial"
            value={s.startingBalance}
            onChange={(v) => setSettings({ startingBalance: v })}
          />
          <NumberField
            label="Renda mensal estimada"
            value={s.monthlyIncomeEstimate}
            onChange={(v) => setSettings({ monthlyIncomeEstimate: v })}
          />
          <NumberField
            label="Meta mensal de investimento"
            value={s.monthlySavingGoal}
            onChange={(v) => setSettings({ monthlySavingGoal: v })}
          />
          <NumberField
            label="Reserva de emergência mensal"
            value={s.emergencyContribution}
            onChange={(v) => setSettings({ emergencyContribution: v })}
          />
        </div>
      </Panel>
      <Panel title="Listas e categorias">
        <p className="muted">
          Separe os itens por vírgula. Exemplo: Nubank, Inter, Itaú.
        </p>

        <div className="form-grid single">
          <TextArea
            label="Categorias de despesa"
            value={listDrafts.categories}
            onChange={(v) => updateListDraft("categories", v)}
            onBlur={() => saveListDraft("categories")}
          />

          <TextArea
            label="Categorias de receita"
            value={listDrafts.incomeCategories}
            onChange={(v) => updateListDraft("incomeCategories", v)}
            onBlur={() => saveListDraft("incomeCategories")}
          />

          <TextArea
            label="Contas"
            value={listDrafts.accounts}
            onChange={(v) => updateListDraft("accounts", v)}
            onBlur={() => saveListDraft("accounts")}
          />

          <TextArea
            label="Cartões"
            value={listDrafts.cards}
            onChange={(v) => updateListDraft("cards", v)}
            onBlur={() => saveListDraft("cards")}
          />

          <TextArea
            label="Formas de pagamento"
            value={listDrafts.paymentMethods}
            onChange={(v) => updateListDraft("paymentMethods", v)}
            onBlur={() => saveListDraft("paymentMethods")}
          />
        </div>
      </Panel>
      <Panel title="Fechamento e vencimento dos cartões">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cartão</th>
                <th>Fecha no dia</th>
                <th>Paga no dia</th>
              </tr>
            </thead>
            <tbody>
              {s.cardRules.map((r) => (
                <tr key={r.cardName}>
                  <td>{r.cardName}</td>
                  <td>
                    <input
                      type="number"
                      value={r.closingDay}
                      onChange={(e) =>
                        patchCardRule(r.cardName, {
                          closingDay: toNumber(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={r.dueDay}
                      onChange={(e) =>
                        patchCardRule(r.cardName, {
                          dueDay: toNumber(e.target.value),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

