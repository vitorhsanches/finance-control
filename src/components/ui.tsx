import { memo, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { toNumber } from '../lib/utils';

export function MoneyInput({ value, onChange, className }: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value ? String(value).replace('.', ',') : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value ? String(value).replace('.', ',') : '');
  }, [value, focused]);

  const commit = () => {
    const parsed = toNumber(draft);
    onChange(parsed);
    setDraft(parsed ? String(parsed).replace('.', ',') : '');
    setFocused(false);
  };

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (!raw.endsWith('.') && !raw.endsWith(',')) onChange(toNumber(raw));
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

export const MetricCard = memo(function MetricCard({ label, value, tone }: {
  label: string;
  value: string;
  tone?: 'good' | 'bad' | 'warn' | 'neutral';
}) {
  return (
    <div className={`metric ${tone || 'neutral'}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
});

export function Panel({ title, action, children }: {
  title: string;
  action?: JSX.Element;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const Empty = memo(function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
});

export function StatusBadge({ bad, children }: { bad?: boolean; children: ReactNode }) {
  return <span className={bad ? 'badge bad' : 'badge good'}>{children}</span>;
}

export function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option === 'income' ? 'Receita' : option === 'expense' ? 'Despesa' : option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function NumberField({ label, value, onChange }: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <MoneyInput value={value} onChange={onChange} />
    </label>
  );
}

export function TextArea({ label, value, onChange, onBlur }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} rows={3} />
    </label>
  );
}
