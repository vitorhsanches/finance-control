import { createClient, Session } from '@supabase/supabase-js';
import type { FinanceState } from '../types';
import { emptyState, normalizeState, sampleState } from '../data/sample';

export const LOCAL_STORAGE_KEY = 'finance-control-react-v1';
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('SEU-PROJETO'));
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

export function loadLocalState(): FinanceState {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return sampleState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return sampleState();
  }
}

export function saveLocalState(state: FinanceState) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function loadRemoteState(userId: string): Promise<FinanceState> {
  if (!supabase) return loadLocalState();
  const { data, error } = await supabase.from('finance_states').select('data').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data?.data) {
    const initial = emptyState();
    await saveRemoteState(userId, initial);
    return initial;
  }
  return normalizeState(data.data as Partial<FinanceState>);
}

export async function saveRemoteState(userId: string, state: FinanceState) {
  if (!supabase) return;
  const { error } = await supabase.from('finance_states').upsert({
    user_id: userId,
    data: state,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
}
