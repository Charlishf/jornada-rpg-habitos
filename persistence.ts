import { supabase } from './supabase';

const STORAGE_KEY = 'cronicas_game_state';

export function saveLocalState(state: any) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function loadLocalState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function saveRemoteState(playerId: string, state: any) {
  await supabase
    .from('profiles')
    .update({ data: state })
    .eq('id', playerId);
}

export async function loadRemoteState(playerId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('data')
    .eq('id', playerId)
    .single();

  return data?.data ?? null;
}
