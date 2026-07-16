import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import type { ImportProfile, ImportResult, Transaction } from "../types";
import { getInstallmentsForMonth } from "../lib/calculations";
import { formatDate, money, slug, toNumber, todayISO, uid, ym } from "../lib/utils";
import {
  getUnknownCsvPreviews, parseFinanceFiles, parseGenericCsvPreview,
  type GenericCsvMapping, type GenericCsvPreview,
} from "../lib/importers";
import { Panel } from "../components/ui";
import type { PageProps } from "./types";

type ImportStep = "file" | "mapping" | "review" | "result";

type ImportPageProps = PageProps & { onGoToTransactions?: () => void };

export function ImportPage({ state, updateState, onGoToTransactions }: ImportPageProps) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [automaticResult, setAutomaticResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<ImportStep>("file");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");
  const [mappingError, setMappingError] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [completion, setCompletion] = useState<{ imported: number; ignored: number; duplicates: number; errors: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const applyingRef = useRef(false);
  const [genericCsvPreview, setGenericCsvPreview] =
    useState<GenericCsvPreview | null>(null);
  const [selectedImportProfileId, setSelectedImportProfileId] = useState("");
  const [genericCsvProfileName, setGenericCsvProfileName] = useState("");
  const [genericCsvMapping, setGenericCsvMapping] =
    useState<GenericCsvMapping>({
      dateColumn: "",
      descriptionColumn: "",
      amountColumn: "",
      typeColumn: "",
      accountOrCard: "",
      paymentMethod: "Outros",
      incomeTypeValues: "credito, crédito, receita, entrada, recebido, income, credit",
      expenseTypeValues: "debito, débito, despesa, saida, saída, compra, expense, debit",
      negativeMeansExpense: true,
    });

  const expenseCategories =
    state.settings.categories.length > 0
      ? state.settings.categories
      : ["Outros"];

  const incomeCategories =
    state.settings.incomeCategories.length > 0
      ? state.settings.incomeCategories
      : ["Outros"];

  const accountOptions = Array.from(
    new Set([
      ...state.settings.accounts,
      ...state.settings.cards,
      "Conta digital",
      "Conta Caixa",
      "Nubank",
    ].filter(Boolean))
  );

  const paymentMethodOptions = Array.from(
    new Set([
      ...state.settings.paymentMethods,
      "Pix",
      "Débito",
      "Crédito",
      "Boleto",
      "Transferência",
      "Outros",
    ].filter(Boolean))
  );

  const findGenericColumn = (columns: string[], keywords: string[]) => {
  return (
    columns.find((column) => {
      const normalizedColumn = slug(column);

      return keywords.some((keyword) =>
        normalizedColumn.includes(slug(keyword))
      );
    }) || ""
  );
};

  const createDefaultGenericCsvMapping = (
    preview: GenericCsvPreview
  ): GenericCsvMapping => {
    const columns = preview.columns;

    return {
      dateColumn:
        findGenericColumn(columns, [
          "data",
          "date",
          "dt",
          "lançamento",
          "lancamento",
          "posted",
        ]) ||
        columns[0] ||
        "",
      descriptionColumn:
        findGenericColumn(columns, [
          "descrição",
          "descricao",
          "description",
          "histórico",
          "historico",
          "memo",
          "estabelecimento",
          "titulo",
          "title",
        ]) ||
        columns[1] ||
        "",
      amountColumn:
        findGenericColumn(columns, [
          "valor",
          "amount",
          "vlr",
          "value",
          "total",
          "montante",
        ]) ||
        columns[2] ||
        "",
      typeColumn: findGenericColumn(columns, [
        "tipo",
        "type",
        "operação",
        "operacao",
        "natureza",
        "entrada",
        "saida",
        "saída",
      ]),
      accountOrCard: accountOptions[0] || "",
      paymentMethod: paymentMethodOptions[0] || "Outros",
      incomeTypeValues:
        "credito, crédito, receita, entrada, recebido, income, credit",
      expenseTypeValues:
        "debito, débito, despesa, saida, saída, compra, expense, debit",
      negativeMeansExpense: true,
    };
  };

  const patchGenericCsvMapping = (patch: Partial<GenericCsvMapping>) => {
    setGenericCsvMapping((prev) => ({
      ...prev,
      ...patch,
    }));
  };

  const importProfiles = state.settings.importProfiles || [];

  const getCsvColumnsSignature = (columns: string[]) =>
    columns.map((column) => slug(column)).join("|");

  const normalizeProfileMappingForPreview = (
    mapping: GenericCsvMapping,
    preview: GenericCsvPreview
  ): GenericCsvMapping => {
    const hasColumn = (column: string) => preview.columns.includes(column);

    return {
      ...mapping,
      dateColumn: hasColumn(mapping.dateColumn) ? mapping.dateColumn : "",
      descriptionColumn: hasColumn(mapping.descriptionColumn)
        ? mapping.descriptionColumn
        : "",
      amountColumn: hasColumn(mapping.amountColumn) ? mapping.amountColumn : "",
      typeColumn:
        mapping.typeColumn && hasColumn(mapping.typeColumn)
          ? mapping.typeColumn
          : "",
    };
  };

  const applySavedImportProfile = (profileId: string) => {
    setSelectedImportProfileId(profileId);

    if (!genericCsvPreview) return;

    if (!profileId) {
      setGenericCsvMapping(createDefaultGenericCsvMapping(genericCsvPreview));
      setGenericCsvProfileName("");
      return;
    }

    const profile = importProfiles.find((item) => item.id === profileId);

    if (!profile) return;

    setGenericCsvMapping(
      normalizeProfileMappingForPreview(
        profile.mapping as GenericCsvMapping,
        genericCsvPreview
      )
    );
    setGenericCsvProfileName(profile.name);
  };

  const saveGenericCsvProfile = () => {
    if (!genericCsvPreview) return;

    if (
      !genericCsvMapping.dateColumn ||
      !genericCsvMapping.descriptionColumn ||
      !genericCsvMapping.amountColumn
    ) {
      alert("Selecione data, descrição e valor antes de salvar o perfil.");
      return;
    }

    const now = new Date().toISOString();
    const existingProfile = importProfiles.find(
      (item) => item.id === selectedImportProfileId
    );

    const nextProfile: ImportProfile = {
      id: existingProfile?.id || uid("ip"),
      name:
        genericCsvProfileName.trim() ||
        existingProfile?.name ||
        `Perfil ${genericCsvPreview.fileName}`,
      fileType: "csv",
      columnsSignature: getCsvColumnsSignature(genericCsvPreview.columns),
      mapping: genericCsvMapping,
      createdAt: existingProfile?.createdAt || now,
      updatedAt: now,
    };

    updateState((prev) => {
      const currentProfiles = prev.settings.importProfiles || [];
      const alreadyExists = currentProfiles.some(
        (item) => item.id === nextProfile.id
      );

      return {
        ...prev,
        settings: {
          ...prev.settings,
          importProfiles: alreadyExists
            ? currentProfiles.map((item) =>
                item.id === nextProfile.id ? nextProfile : item
              )
            : [...currentProfiles, nextProfile],
        },
      };
    });

    setSelectedImportProfileId(nextProfile.id);
    setGenericCsvProfileName(nextProfile.name);
  };

  const parse = async (files: FileList | File[] | null) => {
    if (!files?.length || loading) return;

    setLoading(true);
    setFileError("");
    setMappingError("");
    setCompletion(null);
    setGenericCsvPreview(null);

    try {
      const fileArray = [...files];
      setSelectedFiles(fileArray);
      const parsed = await parseFinanceFiles(fileArray, state);
      const unknownCsvPreviews = await getUnknownCsvPreviews(fileArray);

      setResult(parsed);
      setAutomaticResult(parsed);

      if (unknownCsvPreviews.length > 0) {
        const preview = unknownCsvPreviews[0];
        const signature = getCsvColumnsSignature(preview.columns);

        const matchedProfile = importProfiles.find(
          (profile) =>
            profile.fileType === "csv" &&
            profile.columnsSignature === signature
        );

        setGenericCsvPreview(preview);
        setStep("mapping");

        if (matchedProfile) {
          setSelectedImportProfileId(matchedProfile.id);
          setGenericCsvProfileName(matchedProfile.name);
          setGenericCsvMapping(
            normalizeProfileMappingForPreview(
              matchedProfile.mapping as GenericCsvMapping,
              preview
            )
          );
        } else {
          setSelectedImportProfileId("");
          setGenericCsvProfileName("");
          setGenericCsvMapping(createDefaultGenericCsvMapping(preview));
        }
      } else {
        setStep("review");
      }

    } catch (error) {
      console.error(error);
      const message = error instanceof Error
        ? error.message
        : "Não foi possível importar o arquivo.";
      setFileError(message);
      alert(message);
    } finally {
      setLoading(false);
    }
  };

  const getSourceLabel = (source?: string) => {
    const key = (source || "").split(":")[0];

    if (key === "caixa-period-pdf") return "Caixa PDF";
    if (key === "nubank-account-pdf") return "Nubank Conta PDF";
    if (key === "nubank-account-csv") return "Nubank Conta CSV";
    if (key === "nubank-card-csv") return "Nubank Fatura CSV";
    if (key === "generic-csv") return "CSV mapeado";

    return key || "Arquivo";
  };

  const getCategoryOptions = (transaction: Transaction) => {
    const base =
      transaction.type === "income" ? incomeCategories : expenseCategories;

    return Array.from(
      new Set(
        [...base, transaction.category]
          .map((item) => item?.trim())
          .filter(Boolean)
      )
    );
  };

  const getDefaultCategory = (type: Transaction["type"]) => {
    if (type === "income") {
      return incomeCategories[0] || "Outros";
    }

    return expenseCategories[0] || "Outros";
  };

    type ImportReconciliationTone = "bad" | "warn" | "neutral";

  const normalizeImportMatchText = (value?: string) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const amountMatches = (a: number, b: number, tolerance = 1) =>
    Math.abs(toNumber(a) - toNumber(b)) <= tolerance;

  const dateDiffInDays = (a?: string, b?: string) => {
    const left = new Date(`${a || ""}T00:00:00`).getTime();
    const right = new Date(`${b || ""}T00:00:00`).getTime();

    if (Number.isNaN(left) || Number.isNaN(right)) return Number.POSITIVE_INFINITY;

    return Math.abs(left - right) / (1000 * 60 * 60 * 24);
  };

  const textLooksRelated = (a?: string, b?: string) => {
    const left = normalizeImportMatchText(a);
    const right = normalizeImportMatchText(b);

    if (!left || !right) return false;
    if (left.includes(right) || right.includes(left)) return true;

    const leftWords = left.split(" ").filter((word) => word.length >= 4);
    const rightWords = right.split(" ").filter((word) => word.length >= 4);

    return rightWords.some((word) => leftWords.includes(word));
  };

  const getImportReconciliationAlert = (
    transaction: Transaction
  ): {
    tone: ImportReconciliationTone;
    label: string;
    description: string;
  } => {
    const transactionAmount = toNumber(transaction.amount);
    const transactionDescription = transaction.description || "";
    const transactionDate = transaction.date || todayISO();
    const transactionMonth = ym(transactionDate);
    const normalizedDescription =
      normalizeImportMatchText(transactionDescription);

    const duplicateTransaction = state.transactions.find(
      (existing) =>
        existing.type === transaction.type &&
        existing.date === transactionDate &&
        amountMatches(existing.amount, transactionAmount, 0.01) &&
        textLooksRelated(existing.description, transactionDescription)
    );

    if (duplicateTransaction) {
      return {
        tone: "bad",
        label: "Possível duplicado",
        description: `Já existe em Lançamentos: ${duplicateTransaction.description}`,
      };
    }

    const possibleFutureBill = state.bills.find(
      (bill) =>
        !bill.paid &&
        transaction.type === "expense" &&
        amountMatches(bill.amount, transactionAmount) &&
        dateDiffInDays(bill.dueDate, transactionDate) <= 7 &&
        (textLooksRelated(bill.description, transactionDescription) ||
          bill.category === transaction.category)
    );

    if (possibleFutureBill) {
      return {
        tone: "warn",
        label: "Possível conta futura",
        description: `Pode ser pagamento de: ${possibleFutureBill.description}`,
      };
    }

    const cardPaymentKeywords = [
      "pagamento cartao",
      "pagamento de cartao",
      "pagamento cartão",
      "pagamento de cartão",
      "pagamento fatura",
      "pagamento de fatura",
      "fatura cartao",
      "fatura cartão",
      "cartoes",
      "cartões",
    ];

    const looksLikeCardPayment =
      transaction.type === "expense" &&
      cardPaymentKeywords.some((keyword) =>
        normalizedDescription.includes(normalizeImportMatchText(keyword))
      );

    const mentionsKnownCard = state.settings.cards.some((card) =>
      normalizedDescription.includes(normalizeImportMatchText(card))
    );

    if (looksLikeCardPayment || mentionsKnownCard) {
      return {
        tone: "warn",
        label: "Possível fatura",
        description:
          "Pode ser pagamento de cartão. Cuidado para não duplicar despesas já controladas em Cartões e parcelas.",
      };
    }

    const possibleInstallment = getInstallmentsForMonth(
      state,
      transactionMonth
    ).find(
      (row) =>
        transaction.type === "expense" &&
        amountMatches(row.amount, transactionAmount) &&
        (textLooksRelated(row.item.description, transactionDescription) ||
          textLooksRelated(row.item.cardName, transaction.accountOrCard))
    );

    if (possibleInstallment) {
      return {
        tone: "warn",
        label: "Possível parcela",
        description: `Pode ser ${possibleInstallment.item.description} ${possibleInstallment.installmentNumber}/${possibleInstallment.item.installments}`,
      };
    }

    return {
      tone: "neutral",
      label: "Novo lançamento",
      description: "Nenhuma correspondência encontrada.",
    };
  };

  const patchPreviewTransaction = (
    id: string,
    patch: Partial<Transaction>
  ) => {
    setResult((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        transactions: prev.transactions.map((transaction) => {
          if (transaction.id !== id) return transaction;

          const nextType = patch.type || transaction.type;
          const categoryOptions =
            nextType === "income" ? incomeCategories : expenseCategories;

          const currentCategory = patch.category ?? transaction.category;

          const nextCategory =
            patch.type && !categoryOptions.includes(currentCategory)
              ? getDefaultCategory(nextType)
              : currentCategory;

          return {
            ...transaction,
            ...patch,
            type: nextType,
            category: nextCategory,
          };
        }),
      };
    });
  };

  const removePreviewTransaction = (transactionId: string) => {
    setResult((prev) =>
      prev
        ? {
            ...prev,
            transactions: prev.transactions.filter(
              (transaction) => transaction.id !== transactionId
            ),
          }
        : prev
    );
  };

  const applyGenericCsvMapping = () => {
    if (!genericCsvPreview) return;

    if (!genericCsvMapping.dateColumn || !genericCsvMapping.descriptionColumn || !genericCsvMapping.amountColumn) {
      setMappingError("Selecione as colunas obrigatórias de data, descrição e valor.");
      return;
    }

    const parsed = parseGenericCsvPreview(
      genericCsvPreview,
      genericCsvMapping,
      state
    );

    setResult(() => {
      const current = automaticResult || {
        transactions: [],
        ignored: [],
        warnings: [],
      };

      return {
        transactions: [...current.transactions, ...parsed.transactions],
        ignored: [...current.ignored, ...parsed.ignored],
        warnings: [...current.warnings, ...parsed.warnings],
      };
    });

    setMappingError("");
    setStep("review");
  };

  const apply = () => {
    if (!result || applyingRef.current) return;
    applyingRef.current = true;

    const validTransactions = result.transactions.filter((t) =>
      /^\d{4}-\d{2}-\d{2}$/.test(t.date || "")
    );

    if (validTransactions.length !== result.transactions.length) {
      alert(
        "Alguns lançamentos foram ignorados porque estavam sem data válida."
      );
    }

    updateState((prev) => ({
      ...prev,
      transactions: [...validTransactions, ...prev.transactions],
    }));

    const duplicates = result.ignored.filter((item) =>
      slug(item.reason).includes("duplic")
    ).length;
    setCompletion({
      imported: validTransactions.length,
      ignored: result.ignored.length + result.transactions.length - validTransactions.length,
      duplicates,
      errors: result.warnings.length + result.transactions.length - validTransactions.length,
    });
    setStep("result");
    applyingRef.current = false;
  };

  const clearPreview = () => {
    setResult(null);
    setAutomaticResult(null);
    setGenericCsvPreview(null);
    setSelectedFiles([]);
    setFileError("");
    setMappingError("");
    setCompletion(null);
    setSelectedImportProfileId("");
    setGenericCsvProfileName("");
    setStep("file");
    if (inputRef.current) inputRef.current.value = "";
  };

    const reconciliationAlerts = result
    ? result.transactions.map(getImportReconciliationAlert)
    : [];

  const importantReconciliationAlerts = reconciliationAlerts.filter(
    (alert) => alert.tone !== "neutral"
  ).length;

  const importSummary = result
    ? {
        total: result.transactions.length,
        incomeCount: result.transactions.filter((t) => t.type === "income")
          .length,
        expenseCount: result.transactions.filter((t) => t.type === "expense")
          .length,
        incomeTotal: result.transactions
          .filter((t) => t.type === "income")
          .reduce((sum, t) => sum + t.amount, 0),
        expenseTotal: result.transactions
          .filter((t) => t.type === "expense")
          .reduce((sum, t) => sum + t.amount, 0),
        ignoredCount: result.ignored.length,
        sources: Array.from(
          new Set(result.transactions.map((t) => getSourceLabel(t.source || "")))
        ),
      }
    : null;

  return (
    <div className="page-stack import-workspace">
      <nav className="import-steps" aria-label="Etapas da importação">
        {(["Arquivo", "Mapeamento", "Revisão", "Resultado"] as const).map((label, index) => {
          const steps: ImportStep[] = ["file", "mapping", "review", "result"];
          const activeIndex = steps.indexOf(step);
          return <span key={label} className={index === activeIndex ? "active" : index < activeIndex ? "done" : ""}><b>{index + 1}</b>{label}</span>;
        })}
      </nav>

      {step === "file" && <Panel title="1. Escolha os arquivos">
        <p className="muted">
          Selecione CSV ou PDF. Nubank e Caixa continuam com leitura automática.
          Para CSVs de outros bancos, o app abrirá um mapeamento manual de colunas
          antes de gerar a prévia.
        </p>

        <label
          className={`dropzone ${isDragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => { event.preventDefault(); setIsDragging(false); void parse([...event.dataTransfer.files]); }}
        >
          <FileUp />
          <strong>Arraste arquivos aqui ou selecione no computador</strong>
          <span>CSV ou PDF · Nubank, Caixa e CSV de outros bancos</span>
          <input
            ref={inputRef}
            hidden
            type="file"
            aria-label="Selecionar arquivos"
            multiple
            accept=".csv,.pdf,text/csv,application/pdf"
            onChange={(e) => parse(e.target.files)}
          />
        </label>

        {selectedFiles.length > 0 && <div className="import-file-list" aria-label="Arquivos selecionados">
          {selectedFiles.map((file) => <div key={`${file.name}-${file.size}`}><strong>{file.name}</strong><span>{file.type || "Tipo não informado"} · {(file.size / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} KB</span></div>)}
          <button className="secondary small" type="button" onClick={() => inputRef.current?.click()}>Trocar arquivo</button>
        </div>}
        {loading && <div className="notice" role="status" aria-live="polite">Convertendo arquivos...</div>}
        {fileError && <div className="notice danger" role="alert">{fileError}</div>}
      </Panel>}
      {step === "mapping" && genericCsvPreview && (
      <Panel
        title={`2. Mapear ${genericCsvPreview.fileName}`}
        action={
          <div className="generic-csv-preview-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                clearPreview();
              }}
            >
              Ignorar CSV
            </button>

            <button
              className="secondary"
              type="button"
              onClick={saveGenericCsvProfile}
            >
              Salvar perfil
            </button>

            <button
              className="primary"
              type="button"
              onClick={applyGenericCsvMapping}
            >
              Revisar importação
            </button>
          </div>
        }
      >
        <div className="notice warn">
          Este CSV não foi reconhecido automaticamente. Escolha quais colunas
          representam data, descrição e valor.
        </div>
        {mappingError && <div className="notice danger" role="alert">{mappingError}</div>}
        <div className="import-profile-row">
          <label className="field">
            <span>Perfil salvo</span>
            <select
              value={selectedImportProfileId}
              onChange={(e) => applySavedImportProfile(e.target.value)}
            >
              <option value="">Não usar perfil salvo</option>
              {importProfiles
                .filter((profile) => profile.fileType === "csv")
                .map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="field">
            <span>Nome do perfil</span>
            <input
              value={genericCsvProfileName}
              placeholder="Exemplo: Fatura cartão XP"
              onChange={(e) => setGenericCsvProfileName(e.target.value)}
            />
          </label>
        </div>

        <div className="import-mapping-grid">
          <label className="field required-field">
            <span>Coluna de data <b>Obrigatório</b></span>
            <select
              value={genericCsvMapping.dateColumn}
              onChange={(e) =>
                patchGenericCsvMapping({ dateColumn: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {genericCsvPreview.columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label className="field required-field">
            <span>Coluna de descrição <b>Obrigatório</b></span>
            <select
              value={genericCsvMapping.descriptionColumn}
              onChange={(e) =>
                patchGenericCsvMapping({ descriptionColumn: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {genericCsvPreview.columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label className="field required-field">
            <span>Coluna de valor <b>Obrigatório</b></span>
            <select
              value={genericCsvMapping.amountColumn}
              onChange={(e) =>
                patchGenericCsvMapping({ amountColumn: e.target.value })
              }
            >
              <option value="">Selecione</option>
              {genericCsvPreview.columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <details className="import-advanced">
            <summary>Opções avançadas</summary>
            <div className="import-mapping-grid">
          <label className="field">
            <span>Coluna de tipo</span>
            <select
              value={genericCsvMapping.typeColumn}
              onChange={(e) =>
                patchGenericCsvMapping({ typeColumn: e.target.value })
              }
            >
              <option value="">Não usar</option>
              {genericCsvPreview.columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Conta/cartão padrão</span>
            <select
              value={genericCsvMapping.accountOrCard}
              onChange={(e) =>
                patchGenericCsvMapping({ accountOrCard: e.target.value })
              }
            >
              {accountOptions.map((account) => (
                <option key={account} value={account}>
                  {account}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Forma de pagamento padrão</span>
            <select
              value={genericCsvMapping.paymentMethod}
              onChange={(e) =>
                patchGenericCsvMapping({ paymentMethod: e.target.value })
              }
            >
              {paymentMethodOptions.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Textos de receita</span>
            <input
              value={genericCsvMapping.incomeTypeValues}
              onChange={(e) =>
                patchGenericCsvMapping({ incomeTypeValues: e.target.value })
              }
            />
          </label>

          <label className="field">
            <span>Textos de despesa</span>
            <input
              value={genericCsvMapping.expenseTypeValues}
              onChange={(e) =>
                patchGenericCsvMapping({ expenseTypeValues: e.target.value })
              }
            />
          </label>

          <label className="field mapping-check">
            <span>Regra de valor</span>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={genericCsvMapping.negativeMeansExpense}
                onChange={(e) =>
                  patchGenericCsvMapping({
                    negativeMeansExpense: e.target.checked,
                  })
                }
              />
              Valor negativo significa despesa
            </label>
          </label>
            </div>
          </details>
        </div>

        <p className="muted">
          Prévia das primeiras linhas do arquivo. Use isso para conferir se o
          mapeamento está correto antes de gerar os lançamentos.
        </p>

        <div className="table-wrap generic-csv-preview-table">
          <table>
            <thead>
              <tr>
                {genericCsvPreview.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {genericCsvPreview.sampleRows.map((row, index) => (
                <tr key={`${genericCsvPreview.fileName}-${index}`}>
                  {genericCsvPreview.columns.map((column) => (
                    <td key={column}>{row[column]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    )}

      {step === "review" && result && importSummary && (
        <Panel
          title="3. Revise antes de importar"
          action={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {genericCsvPreview && <button className="secondary" type="button" onClick={() => setStep("mapping")}>
                Voltar ao mapeamento
              </button>}
              <button className="secondary" type="button" onClick={clearPreview}>
                Trocar arquivo
              </button>

              <button
                className="primary"
                onClick={apply}
                disabled={result.transactions.length === 0}
              >
                Confirmar {result.transactions.length} lançamentos
              </button>
            </div>
          }
        >
          {result.warnings.map((w) => (
            <div className="notice warn" key={w}>
              {w}
            </div>
          ))}

          {result.ignored.length > 0 && <details className="import-ignored">
            <summary>Entenda as {result.ignored.length} linhas ignoradas</summary>
            <ul>{result.ignored.map((item, index) => <li key={`${item.reason}-${index}`}><b>{item.fileName} · item {index + 1}:</b> {item.reason}{item.raw ? <code>{item.raw}</code> : null}</li>)}</ul>
          </details>}

          {importantReconciliationAlerts > 0 && (
            <div className="notice warn">
              Atenção: {importantReconciliationAlerts} lançamento(s) possuem
              possível correspondência com dados já cadastrados. Revise a coluna
              “Alerta” antes de importar.
            </div>
          )}

          <div className="summary-row">
            <strong>{importSummary.total}</strong>
            <span>lançamentos prontos</span>

            <strong>{importSummary.incomeCount}</strong>
            <span>receitas</span>

            <strong>{importSummary.expenseCount}</strong>
            <span>despesas</span>

            <strong>{importSummary.ignoredCount}</strong>
            <span>linhas ignoradas</span>

            <strong>{result.ignored.filter((item) => slug(item.reason).includes("duplic")).length}</strong>
            <span>duplicados</span>
          </div>

          {genericCsvPreview && <div className="import-review-rules">
            <span><b>Conta/cartão</b>{genericCsvMapping.accountOrCard || "Não informado"}</span>
            <span><b>Pagamento</b>{genericCsvMapping.paymentMethod}</span>
            <span><b>Regra de sinal</b>{genericCsvMapping.negativeMeansExpense ? "Negativo é despesa" : "Tipo define receita/despesa"}</span>
          </div>}

          <div className="summary-row">
            <strong>{money(importSummary.incomeTotal, state)}</strong>
            <span>total de receitas</span>

            <strong>{money(importSummary.expenseTotal, state)}</strong>
            <span>total de despesas</span>

            <strong>{importSummary.sources.join(", ")}</strong>
            <span>banco/origem detectado</span>
          </div>

          <p className="muted">
            Revise os lançamentos antes de importar. Você pode ajustar tipo,
            categoria, descrição, conta/cartão e forma de pagamento nesta prévia.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Tipo</th>
                  <th>Categoria</th>
                  <th>Valor</th>
                  <th>Pagamento</th>
                  <th>Conta/cartão</th>
                  <th>Alerta</th>
                  <th>Ações</th>
                  <th>Origem</th>
                </tr>
              </thead>

              <tbody>
                {result.transactions.slice(0, 80).map((t) => {
                  const reconciliationAlert = getImportReconciliationAlert(t);

                  return (
                    <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>

                    <td>
                      <input
                        value={t.description}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            description: e.target.value,
                          })
                        }
                      />
                    </td>

                    <td>
                      <select
                        className={`type-select ${t.type === "income" ? "income" : "expense"}`}
                        value={t.type}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            type: e.target.value as Transaction["type"],
                          })
                        }
                      >
                        <option value="income">Receita</option>
                        <option value="expense">Despesa</option>
                      </select>
                    </td>

                    <td>
                      <select
                        value={t.category}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            category: e.target.value,
                          })
                        }
                      >
                        {getCategoryOptions(t).map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td
                      className={
                        t.type === "income"
                          ? "amount-positive"
                          : "amount-negative"
                      }
                    >
                      {money(t.amount, state)}
                    </td>

                    <td>
                      <select
                        value={t.paymentMethod || "Outros"}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            paymentMethod: e.target.value,
                          })
                        }
                      >
                        {paymentMethodOptions.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <select
                        value={t.accountOrCard || accountOptions[0] || "Conta"}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            accountOrCard: e.target.value,
                          })
                        }
                      >
                        {accountOptions.map((account) => (
                          <option key={account} value={account}>
                            {account}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <div className={`import-alert ${reconciliationAlert.tone}`}>
                        <strong>{reconciliationAlert.label}</strong>
                        <span>{reconciliationAlert.description}</span>
                      </div>
                    </td>

                    <td>
                      <button
                        className="secondary small"
                        type="button"
                        onClick={() => removePreviewTransaction(t.id)}
                      >
                        Remover
                      </button>
                    </td>

                    <td>{t.source}</td>
                  </tr>
                  );
                })}

              {result.transactions.length === 0 && (
                <tr>
                  <td colSpan={10}>
                    <div className="empty">
                      Todas as linhas foram removidas da prévia.
                    </div>
                  </td>
                </tr>
              )}

              </tbody>
            </table>
          </div>

          {result.transactions.length > 80 && (
            <div className="notice">
              Mostrando os primeiros 80 lançamentos na prévia. Todos os{" "}
              {result.transactions.length} lançamentos serão importados ao
              confirmar.
            </div>
          )}
        </Panel>
      )}

      {step === "result" && completion && (
        <Panel title="4. Importação concluída">
          <div className="import-result" role="status" aria-live="polite">
            <div><strong>{completion.imported}</strong><span>importados</span></div>
            <div><strong>{completion.ignored}</strong><span>ignorados</span></div>
            <div><strong>{completion.duplicates}</strong><span>duplicados</span></div>
            <div><strong>{completion.errors}</strong><span>erros e avisos</span></div>
          </div>
          <p className="muted">A confirmação foi processada uma única vez. Os lançamentos importados já estão disponíveis para revisão.</p>
          <div className="import-result-actions">
            <button className="secondary" type="button" onClick={clearPreview}>Importar outro arquivo</button>
            {onGoToTransactions && <button className="primary" type="button" onClick={onGoToTransactions}>Ir para lançamentos</button>}
          </div>
        </Panel>
      )}
    </div>
  );
}
