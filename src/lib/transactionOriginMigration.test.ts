import { describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20260803150312_add_transaction_origin_identity.sql?raw';

describe('transaction origin migration', () => {
  it('adds nullable structured origin columns and the required constraints', () => {
    expect(migration).toContain('add column if not exists origin_type text');
    expect(migration).toContain('add column if not exists origin_id text');
    expect(migration).toContain('add column if not exists import_id text');
    for (const type of ['manual', 'future_bill_payment', 'installment_payment', 'bank_import']) {
      expect(migration).toContain(`'${type}'`);
    }
    expect(migration).toContain("origin_type = 'manual' and origin_id is null");
    expect(migration).toContain("import_id is null or origin_type = 'bank_import'");
  });

  it('backfills only exact future bill sources without financial heuristics', () => {
    expect(migration).toContain("source ~ '^future-bill:[^:[:space:]]+$'");
    expect(migration).toContain("origin_type = 'future_bill_payment'");
    expect(migration).toContain("origin_id = substring(source from '^future-bill:([^:[:space:]]+)$')");
    expect(migration).not.toMatch(/description|category|amount|due_date/i);
  });

  it('blocks duplicate legacy origins before backfill and scopes uniqueness by user', () => {
    expect(migration.indexOf('duplicate future bill payment origin')).toBeLessThan(
      migration.indexOf("set\n  origin_type = 'future_bill_payment'")
    );
    expect(migration).toContain('group by user_id');
    expect(migration).toContain('on public.transactions (user_id, origin_type, origin_id)');
    expect(migration).toContain("origin_type <> 'manual'");
  });

  it('provides bidirectional legacy compatibility and rejects conflicts', () => {
    expect(migration).toContain('sync_transaction_origin_compatibility');
    expect(migration).toContain("new.source := 'future-bill:' || new.origin_id");
    expect(migration).toContain("new.origin_type := 'future_bill_payment'");
    expect(migration).toContain('Transaction source conflicts with its structured origin.');
  });
});
