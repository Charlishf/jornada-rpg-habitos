import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.https://jyfrnpratsoalwmfcnax.supabase.co;
const supabaseAnonKey = import.meta.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5ZnJucHJhdHNvYWx3bWZjbmF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY1MDg5MjgsImV4cCI6MjA4MjA4NDkyOH0.bpbGSaHZE7MtBhMBQ4xiP2CEZy7PCjx5gNmbzLLkbe8;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Variáveis de ambiente do Supabase não configuradas');
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);
