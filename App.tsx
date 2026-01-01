
import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';
import { getOrCreatePlayerId } from './player';
import { loadLocalState, loadRemoteState, saveLocalState, saveRemoteState } from './persistence';

/**
 * CONSTANTES E INTERFACES DE CLASSE
 */
interface Atributos {
  forca: number;
  disciplina: number;   
  consistencia: number; 
  agilidade: number;
}

interface Classe {
  id: string;
  nome: string;
  descricao: string;
  icone: string;
  favorecidos: (keyof Atributos)[];
}

const LISTA_CLASSES: Classe[] = [
  { 
    id: 'guerreiro', 
    nome: 'Guerreiro', 
    descricao: 'Especialista em força física e consistência absoluta.', 
    icone: '⚔️',
    favorecidos: ['forca', 'consistencia'] 
  },
  { 
    id: 'mago', 
    nome: 'Mago', 
    descricao: 'Mestre da disciplina mental e agilidade de raciocínio.', 
    icone: '🔮',
    favorecidos: ['disciplina', 'agilidade'] 
  },
  { 
    id: 'cacador', 
    nome: 'Caçador', 
    descricao: 'Equilíbrio entre agilidade de ação e disciplina de caça.', 
    icone: '🏹',
    favorecidos: ['agilidade', 'disciplina'] 
  }
];

/**
 * TIPAGENS E INTERFACES
 */
type EstadoMissao = "pendente" | "concluida" | "falha";
type StatusHabito = "pendente" | "resistido" | "falha";
type TipoEfeito = 'removerPenalidade' | 'converterPenalidadeEmXP' | 'protecaoTemporaria';
type NivelDificuldade = 'muito_facil' | 'facil' | 'normal' | 'dificil' | 'epico';

const DIFICULDADES: Record<NivelDificuldade, { nome: string; label: string; mult: number; cor: string; icone: string; sombra: string }> = {
  muito_facil: { nome: 'Muito Fácil', label: 'Trivial', mult: 0.5, cor: 'text-emerald-400', icone: '🌱', sombra: 'shadow-emerald-500/10' },
  facil: { nome: 'Fácil', label: 'Simples', mult: 0.75, cor: 'text-sky-400', icone: '⚔️', sombra: 'shadow-sky-500/10' },
  normal: { nome: 'Normal', label: 'Padrão', mult: 1, cor: 'text-amber-400', icone: '📜', sombra: 'shadow-amber-500/10' },
  dificil: { nome: 'Difícil', label: 'Arriscado', mult: 1.25, cor: 'text-orange-400', icone: '🔥', sombra: 'shadow-orange-500/10' },
  epico: { nome: 'Épico', label: 'Lendário', mult: 1.5, cor: 'text-purple-400', icone: '👑', sombra: 'shadow-purple-500/30 border-purple-900/50' }
};

interface HabitoRuim {
  id: string;
  nome: string;
  descricao: string;
  comoQuebrar: string;
  recompensaXP: number;
  recompensaOuro: number;
  tipoPenalidade: string;
  statusHoje: StatusHabito;
  penalidadeCumprida: boolean;
  protegido?: boolean;
}

interface MissaoDiaria {
  id: string;
  nome: string;
  estado: EstadoMissao;
  tipo: "objetiva" | "progresso";
  unidade?: string;
  valorAlvo?: number;
  progressoAtual?: number;
  tipoPenalidade: string;
  penalidadeCumprida: boolean;
  protegida?: boolean;
  dificuldade: NivelDificuldade;
}

interface QuestUnica {
  id: string;
  nome: string;
  concluida: boolean;
  dificuldade: NivelDificuldade;
}

interface Meta {
  id: string;
  nome: string;
  total: number;
  progresso: number;
  unidade: string;
  concluida: boolean;
  dataInicio?: string;
  dataFim?: string;
  notificadoProximo?: boolean;
  notificadoHoje?: boolean;
}

interface EventoImportante {
  id: string;
  nome: string;
  descricao: string;
  data: string;
  diasAntesLembrete: number;
  status: "pendente" | "concluido";
  notificadoProximo?: boolean;
  notificadoHoje?: boolean;
}

interface ItemLoja {
  id: string;
  nome: string;
  descricao: string;
  custo: number;
  categoria: 'recompensa' | 'alivio';
  tipoEfeito?: TipoEfeito;
}

interface ItemInventario { idUnique: string; itemId: string; }
interface Compra { id: string; itemId: string; custo: number; data: string; }

interface EstadoJogo {
  telaAtual: 'jornada' | 'missoes' | 'habitos' | 'penalidades' | 'loja' | 'eventos' | 'inventario';
  abaAtivaMissoes: 'diarias' | 'quests' | 'metas';
  missoesDiarias: MissaoDiaria[];
  habitosRuins: HabitoRuim[];
  quests: QuestUnica[];
  metas: Meta[];
  eventos: EventoImportante[];
  compras: Compra[];
  itensLoja: ItemLoja[];
  inventario: ItemInventario[];
  classeId: string | null;
  atributosIniciais: Atributos;
  xpExtraItens: number;
  protecaoAtiva: boolean;
}

const CHAVE_STORAGE = "rpg-habitos-v29-store-crud";
const VALORES_BASE = {
  MISSAO: { xp: 15, moedas: 10, attrXP: 40 }, 
  QUEST: { xp: 30, moedas: 20, attrXP: 100 },  
  META: { xp: 100, moedas: 30, attrXP: 200 },   
  FALHA_MULTA: 5
};

const ITENS_PADRAO: ItemLoja[] = [
  { id: '1', nome: 'Selo de Absolvição', descricao: 'Anula uma penitência ativa do Tribunal.', custo: 40, categoria: 'alivio', tipoEfeito: 'removerPenalidade' },
  { id: '2', nome: 'Alquimia do Arrependimento', descricao: 'Converte uma falha em 25 pontos de XP.', custo: 60, categoria: 'alivio', tipoEfeito: 'converterPenalidadeEmXP' },
  { id: '3', nome: 'Manto da Providência', descricao: 'Concede imunidade à sua próxima falha.', custo: 50, categoria: 'alivio', tipoEfeito: 'protecaoTemporaria' },
  { id: '4', nome: 'Pequeno Deleite', descricao: 'Uma recompensa mundana pela sua disciplina.', custo: 15, categoria: 'recompensa' },
];

const initialState: EstadoJogo = {
  version: 1,
  telaAtual: "jornada",
  abaAtivaMissoes: 'diarias',
  missoesDiarias: [],
  habitosRuins: [],
  quests: [],
  metas: [],
  eventos: [],
  compras: [],
  itensLoja: ITENS_PADRAO,
  inventario: [],
  classeId: null,
  atributosIniciais: { forca: 1, disciplina: 1, consistencia: 1, agilidade: 1 },
  xpExtraItens: 0,
  protecaoAtiva: false
};

/**
 * COMPONENTES UI
 */
const Card: React.FC<{ children: React.ReactNode; className?: string; interactive?: boolean }> = ({ children, className = "", interactive }) => (
  <div className={`bg-stone-900/70 backdrop-blur-md border border-amber-900/20 rounded-2xl p-6 shadow-2xl transition-all duration-300 ${interactive ? 'hover:border-amber-600/50 hover:bg-stone-900/90' : ''} ${className}`}>
    {children}
  </div>
);

const SeccaoTitulo: React.FC<{ titulo: string; icone?: string; subtitulo?: string }> = ({ titulo, icone, subtitulo }) => (
  <div className="flex flex-col items-center mb-10 w-full group">
    <div className="flex items-center space-x-6 w-full max-w-4xl px-4">
      <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-amber-900/50 to-amber-700/60"></div>
      <div className="flex flex-col items-center text-center">
        {icone && <span className="text-4xl mb-3 drop-shadow-[0_0_10px_rgba(245,158,11,0.4)] group-hover:scale-110 transition-transform duration-500">{icone}</span>}
        <h2 className="text-2xl md:text-3xl text-amber-500 font-rpg uppercase tracking-[0.25em] whitespace-nowrap">{titulo}</h2>
        {subtitulo && <p className="text-[10px] text-stone-500 font-bold uppercase tracking-[0.3em] mt-2">{subtitulo}</p>}
      </div>
      <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-amber-900/50 to-amber-700/60"></div>
    </div>
  </div>
);

const BotaoRPG: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger' | 'epic' }> = ({ onClick, children, disabled, variant = 'primary' }) => {
  const baseStyle = "px-5 py-2.5 rounded-xl font-bold transition-all transform active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:grayscale uppercase tracking-widest text-[11px] md:text-xs shadow-lg border-b-2 font-rpg";
  const variants = {
    primary: "bg-amber-800 hover:bg-amber-700 text-amber-50 border-amber-950 hover:shadow-amber-900/20",
    secondary: "bg-stone-800 hover:bg-stone-700 text-stone-300 border-stone-950 hover:shadow-black/40",
    danger: "bg-rose-900 hover:bg-rose-800 text-rose-100 border-rose-950 hover:shadow-rose-900/20",
    epic: "bg-purple-800 hover:bg-purple-700 text-purple-50 border-purple-950 shadow-purple-900/20"
  };
  return <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${variants[variant]}`}>{children}</button>;
};

const ProgressoBar: React.FC<{ percent: number; cor?: string; small?: boolean }> = ({ percent, cor = "bg-amber-600", small }) => (
  <div className={`${small ? 'h-1.5' : 'h-3'} w-full bg-stone-950 rounded-full border border-stone-800/50 overflow-hidden shadow-inner p-[1px]`}>
    <div className={`h-full ${cor} rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_rgba(0,0,0,0.5)]`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}></div>
  </div>
);

export default function App() {
const [estado, setEstado] = useState<EstadoJogo>(initialState);
// --- Estados de autenticação (login opcional) ---
const [usuarioLogado, setUsuarioLogado] = useState<User | null>(null);
const [carregandoAuth, setCarregandoAuth] = useState(true);
const [modoRecuperacao, setModoRecuperacao] = useState(false);
const [novaSenha, setNovaSenha] = useState('');

const [email, setEmail] = useState('');
const [senha, setSenha] = useState('');
const [erroAuth, setErroAuth] = useState<string | null>(null);

const [carregado, setCarregado] = useState(false);
const estadoSeguro = useMemo(() => ({
  ...estado,
  missoesDiarias: estado.missoesDiarias ?? [],
  quests: estado.quests ?? [],
  metas: estado.metas ?? [],
  penalidades: estado.penalidades ?? [],
  eventos: estado.eventos ?? [],
  itensLoja: estado.itensLoja ?? [],
  inventario: estado.inventario ?? [],
  habitosRuins: estado.habitosRuins ?? [],
  conquistas: estado.conquistas ?? []
}), [estado]);

// --- Autenticação ---
async function entrar() {
  setErroAuth(null);

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: senha
  });

  if (error) {
    if (error.message.includes('Email not confirmed')) {
      setErroAuth('Confirme seu email antes de entrar.');
    } else if (error.message.includes('Invalid login')) {
      setErroAuth('Email ou senha incorretos.');
    } else {
      setErroAuth(error.message);
    }
  }
}

async function recuperarSenha() {
  setErroAuth(null);

  if (!email) {
    setErroAuth('Digite seu email para recuperar a senha.');
    return;
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });

  if (error) {
    setErroAuth('Erro ao enviar email de recuperação.');
  } else {
    setErroAuth('Email de recuperação enviado. Verifique sua caixa de entrada.');
  }
}

async function redefinirSenha() {
  if (!novaSenha) {
    setErroAuth('Digite a nova senha.');
    return;
  }

  const { error } = await supabase.auth.updateUser({
    password: novaSenha
  });

  if (error) {
    setErroAuth('Erro ao redefinir a senha.');
  } else {
    setErroAuth('Senha alterada com sucesso. Faça login novamente.');
    setModoRecuperacao(false);
    await supabase.auth.signOut();
  }
}
  
async function criarConta() {
  setErroAuth(null);

  if (!email) {
    setErroAuth('Digite um email válido.');
    return;
  }

  if (!senha) {
    setErroAuth('Digite uma senha para criar sua conta.');
    return;
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password: senha
  });

  if (error) {
    if (error.message.toLowerCase().includes('already')) {
      setErroAuth(
        'Este email já está cadastrado. Use "Entrar" ou "Esqueceu a senha".'
      );
    } else {
      setErroAuth(error.message);
    }
    return;
  }

  // 👇 CASO CLÁSSICO: email já existe, mas Supabase não retorna erro
  if (!data?.user) {
    setErroAuth(
      'Este email já está cadastrado. Use "Entrar" ou "Esqueceu a senha".'
    );
    return;
  }

  setErroAuth(
    'Conta criada! Verifique seu email para confirmar antes de entrar.'
  );
}

async function sair() {
  await supabase.auth.signOut();
  setUsuarioLogado(null);
}

  const [ultimoFeedback, setUltimoFeedback] = useState<string | null>(null);
  const [modalItemUso, setModalItemUso] = useState<{ idUnique: string; tipo: TipoEfeito } | null>(null);

useEffect(() => {
  const init = async () => {
    const playerId = getOrCreatePlayerId();

    const { data, error } = await supabase
      .from('profiles')
      .select('id, data')
      .eq('id', playerId)
      .single();

    if (!data) {
      await supabase.from('profiles').insert({
        id: playerId,
        data: {}
      });
    }

    if (error && error.code !== 'PGRST116') {
      console.error('Erro ao inicializar jogador:', error);
    }

    // 1️⃣ tenta nuvem
    const remoteState = await loadRemoteState(playerId);

    if (remoteState) {
      const estadoFinal = {
        ...initialState,
        ...remoteState,
        version: initialState.version
      };
      setEstado(estadoFinal);
      saveLocalState(estadoFinal);
      setCarregado(true);
      return;
    }

    // 2️⃣ fallback local
    const localState = loadLocalState();
    if (localState) {
      const estadoFinal = {
        ...initialState,
        ...localState,
        version: initialState.version
      };
      setEstado(estadoFinal);
      await saveRemoteState(playerId, estadoFinal);
      setCarregado(true);
      return;
    }

    // 3️⃣ nenhum estado encontrado
    setCarregado(true);
  };

  init();
}, []);

useEffect(() => {
  if (!carregado) return;

  const playerId = getOrCreatePlayerId();
  saveLocalState(estado);
  saveRemoteState(playerId, estado);
}, [estado, carregado]);

  useEffect(() => {
    if (ultimoFeedback) {
      const timer = setTimeout(() => setUltimoFeedback(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [ultimoFeedback]);

  // --- Autenticação: detectar sessão ativa ---
useEffect(() => {
  const { data: listener } = supabase.auth.onAuthStateChange(
    (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setModoRecuperacao(true);
        setUsuarioLogado(session?.user ?? null);
        setCarregandoAuth(false);
        return;
      }

      setUsuarioLogado(session?.user ?? null);
      setCarregandoAuth(false);
    }
  );

  return () => {
    listener.subscription.unsubscribe();
  };
}, []);

  /**
   * CÁLCULOS DE PROGRESSÃO E ECONOMIA
   */
  const atributosCalculados = useMemo(() => {
    const missoesConcluidas = estadoSeguro.missoesDiarias.filter(m => m.estado === "concluida");
    const habitosResistidos = estadoSeguro.habitosRuins.filter(h => h.statusHoje === "resistido");
    const questsConcluidas = estadoSeguro.quests.filter(q => q.concluida);
    const metasConcluidas = estadoSeguro.metas.filter(m => m.concluida);

    const xpTotais = {
      disciplina: (missoesConcluidas.length * VALORES_BASE.MISSAO.attrXP) + (habitosResistidos.length * 50) + (questsConcluidas.length * VALORES_BASE.QUEST.attrXP),
      consistencia: (missoesConcluidas.length * VALORES_BASE.MISSAO.attrXP) + (metasConcluidas.length * VALORES_BASE.META.attrXP),
      forca: (questsConcluidas.length * 50) + (metasConcluidas.length * 100),
      agilidade: (missoesConcluidas.filter(m => m.tipo === 'objetiva').length * 20) + (habitosResistidos.length * 30)
    };

    const classe = LISTA_CLASSES.find(c => c.id === estado.classeId);
    const calc = (attr: keyof Atributos) => {
      const xp = xpTotais[attr] || 0;
      const progressao = Math.floor(xp / 100);
      const base = estado.atributosIniciais[attr] + progressao;
      const bonus = classe?.favorecidos.includes(attr) ? 2 : 0;
      const final = base + bonus;
      return { valorFinal: final, valorBase: base, bonusClasse: bonus, xpRestante: xp % 100, percentual: (xp % 100) };
    };
    return { disciplina: calc('disciplina'), consistencia: calc('consistencia'), forca: calc('forca'), agilidade: calc('agilidade') };
  }, [estado.missoesDiarias, estado.habitosRuins, estado.quests, estado.metas, estado.classeId, estado.atributosIniciais]);

  const totalXP = useMemo(() => {
    let xp = estado.xpExtraItens;
    const mult = 1 + (atributosCalculados.disciplina.valorFinal * 0.05);
    estado.missoesDiarias.forEach(m => { if (m.estado === "concluida") xp += Math.round(VALORES_BASE.MISSAO.xp * DIFICULDADES[m.dificuldade].mult); });
    estado.habitosRuins.forEach(h => { if (h.statusHoje === "resistido") xp += h.recompensaXP; });
    estado.quests.forEach(q => { if (q.concluida) xp += Math.round(VALORES_BASE.QUEST.xp * DIFICULDADES[q.dificuldade].mult); });
    estado.metas.forEach(m => { if (m.concluida) xp += VALORES_BASE.META.xp; });
    return Math.floor(xp * mult);
  }, [estado.missoesDiarias, estado.habitosRuins, estado.quests, estado.metas, estado.xpExtraItens, atributosCalculados.disciplina.valorFinal]);

  const moedasAtuais = useMemo(() => {
    let m = 0;
    const mult = 1 + (atributosCalculados.consistencia.valorFinal * 0.05);
    estado.missoesDiarias.forEach(missao => { if (missao.estado === "concluida") m += Math.round(VALORES_BASE.MISSAO.moedas * DIFICULDADES[missao.dificuldade].mult); });
    estado.habitosRuins.forEach(h => { if (h.statusHoje === "resistido") m += h.recompensaOuro; });
    estado.quests.forEach(quest => { if (quest.concluida) m += Math.round(VALORES_BASE.QUEST.moedas * DIFICULDADES[quest.dificuldade].mult); });
    estado.metas.forEach(met => { if (met.concluida) m += VALORES_BASE.META.moedas; });
    
    let penalidade = 0;
    estado.missoesDiarias.forEach(ms => { if (ms.estado === "falha" && !ms.protegida) penalidade += Math.round(VALORES_BASE.FALHA_MULTA * DIFICULDADES[ms.dificuldade].mult); });
    estado.habitosRuins.forEach(hb => { if (hb.statusHoje === "falha" && !hb.protegido) penalidade += VALORES_BASE.FALHA_MULTA; });
    const gastos = estado.compras.reduce((acc, c) => acc + c.custo, 0);
    return Math.max(0, Math.floor(m * mult) - penalidade - gastos);
  }, [estado.missoesDiarias, estado.habitosRuins, estado.quests, estado.metas, estado.compras, atributosCalculados.consistencia.valorFinal]);

  const nivelHeroi = Math.floor(totalXP / 100) + 1;
  const xpNivel = totalXP % 100;

  const avisosIniciais = useMemo(() => {
    const avisos: { id: string; msg: string; tipo: 'meta' | 'evento' }[] = [];
    const hoje = new Date().toISOString().split('T')[0];
    const hojeDate = new Date(hoje + "T00:00:00");

    estado.metas.forEach(m => {
      if (!m.concluida && m.dataFim) {
        const dataFim = new Date(m.dataFim + "T00:00:00");
        const diffDias = Math.ceil((dataFim.getTime() - hojeDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDias >= 0 && diffDias <= 5) avisos.push({ id: `meta-${m.id}`, msg: `${m.nome} termina em ${diffDias} dias!`, tipo: 'meta' });
      }
    });

    estado.eventos.forEach(e => {
      if (e.status === 'pendente') {
        const dataInicio = new Date(e.data + "T00:00:00");
        const diffDias = Math.ceil((dataInicio.getTime() - hojeDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDias >= 0 && diffDias <= e.diasAntesLembrete) avisos.push({ id: `event-${e.id}`, msg: `${e.nome} está próximo! (${diffDias}d)`, tipo: 'evento' });
      }
    });
    return avisos;
  }, [estado.metas, estado.eventos]);

  const penalidadesAtivas = useMemo(() => {
    const pM = estadoSeguro.missoesDiarias.filter(m => m.estado === "falha" && !m.penalidadeCumprida && !m.protegida).map(m => ({ id: m.id, nome: m.nome, punicao: m.tipoPenalidade, origem: 'missao' as const, dificuldade: m.dificuldade }));
    const pH = estadoSeguro.habitosRuins.filter(h => h.statusHoje === "falha" && !h.penalidadeCumprida && !h.protegido).map(h => ({ id: h.id, nome: h.nome, punicao: h.tipoPenalidade, origem: 'habito' as const, dificuldade: 'normal' as NivelDificuldade }));
    return [...pM, ...pH];
  }, [estado.missoesDiarias, estado.habitosRuins]);

  const penalidadesCumpridas = useMemo(() => {
    const pM = estadoSeguro.missoesDiarias.filter(m => m.estado === "falha" && m.penalidadeCumprida).map(m => ({ id: m.id, nome: m.nome, punicao: m.tipoPenalidade, origem: 'missao' as const }));
    const pH = estadoSeguro.habitosRuins.filter(h => h.statusHoje === "falha" && h.penalidadeCumprida).map(h => ({ id: h.id, nome: h.nome, punicao: h.tipoPenalidade, origem: 'habito' as const }));
    return [...pM, ...pH];
  }, [estado.missoesDiarias, estado.habitosRuins]);

  /**
   * MANIPULADORES
   */
  const handleConcluirMissao = (id: string, novoEstado: EstadoMissao) => {
    let protUsada = false;
    if (novoEstado === 'falha' && estado.protecaoAtiva) { protUsada = true; setUltimoFeedback("O Manto da Providência te protegeu da falha!"); }
    setEstado(prev => ({
      ...prev,
      protecaoAtiva: protUsada ? false : prev.protecaoAtiva,
      missoesDiarias: prev.missoesDiarias.map(m => m.id === id ? { ...m, estado: novoEstado, penalidadeCumprida: false, protegida: protUsada } : m)
    }));
    if (novoEstado === 'concluida') setUltimoFeedback("⚔️ Vitória! Sua disciplina foi recompensada.");
  };

  const handleExpiar = (p: any, status: boolean) => {
    setEstado(prev => ({
      ...prev,
      missoesDiarias: p.origem === 'missao' ? prev.missoesDiarias.map(m => m.id === p.id ? { ...m, penalidadeCumprida: status } : m) : prev.missoesDiarias,
      habitosRuins: p.origem === 'habito' ? prev.habitosRuins.map(h => h.id === p.id ? { ...h, penalidadeCumprida: status } : h) : prev.habitosRuins
    }));
    if (status) setUltimoFeedback("⚖️ Penitência cumprida. Honra restaurada.");
  };

  const usarItem = (idUnique: string, targetId?: string) => {
    const invItem = estado.inventario.find(i => i.idUnique === idUnique);
    const base = estado.itensLoja.find(i => i.id === invItem?.itemId);
    if (!base) return;

    setEstado(prev => {
      let n = { ...prev, inventario: prev.inventario.filter(i => i.idUnique !== idUnique) };
      if (base.tipoEfeito === 'protecaoTemporaria') n.protecaoAtiva = true;
      else if (targetId) {
        n.missoesDiarias = n.missoesDiarias.map(m => m.id === targetId ? { ...m, penalidadeCumprida: true } : m);
        n.habitosRuins = n.habitosRuins.map(h => h.id === targetId ? { ...h, penalidadeCumprida: true } : h);
        if (base.tipoEfeito === 'converterPenalidadeEmXP') n.xpExtraItens += 25;
      }
      return n;
    });
    setModalItemUso(null);
    setUltimoFeedback(`✨ Artefato ${base.nome} ativado!`);
  };

  /**
   * RENDERS DE TELA
   */
  const RenderJornada = () => (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-10">
      <SeccaoTitulo titulo="Salão do Herói" icone="🏰" subtitulo="Visão Geral da Jornada" />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="flex flex-col md:flex-row items-center gap-8 py-10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
              <span className="text-9xl">{LISTA_CLASSES.find(c => c.id === estado.classeId)?.icone || '👤'}</span>
            </div>
            <div className="relative z-10 w-32 h-32 rounded-3xl bg-gradient-to-br from-amber-900 to-amber-700 flex items-center justify-center border-2 border-amber-500/40 shadow-[0_0_30px_rgba(120,53,15,0.4)]">
              <span className="text-5xl drop-shadow-md">{LISTA_CLASSES.find(c => c.id === estado.classeId)?.icone || '❓'}</span>
            </div>
            <div className="relative z-10 flex-1 text-center md:text-left">
              <p className="text-[10px] text-amber-600 font-bold uppercase tracking-[0.4em] mb-1">Vocação Atual</p>
              <h3 className="text-3xl font-rpg text-amber-200 uppercase tracking-widest mb-2">{LISTA_CLASSES.find(c => c.id === estado.classeId)?.nome || 'Iniciado'}</h3>
              <p className="text-stone-400 text-sm italic mb-4 max-w-sm leading-relaxed">{LISTA_CLASSES.find(c => c.id === estado.classeId)?.descricao || 'Escolha seu caminho para começar a jornada.'}</p>
              {!estado.classeId ? (
                <div className="flex flex-wrap gap-2 justify-center md:justify-start">
                  {LISTA_CLASSES.map(cls => (
                    <button key={cls.id} onClick={() => setEstado(p => ({ ...p, classeId: cls.id }))} className="px-4 py-1.5 rounded-lg bg-amber-900/20 border border-amber-900/40 text-[10px] uppercase font-bold text-amber-500 hover:bg-amber-900/40 hover:border-amber-500 transition-all">{cls.nome}</button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setEstado(p => ({ ...p, classeId: null }))} className="text-[9px] text-stone-600 uppercase font-bold hover:text-amber-500 transition-colors">Alterar Vocação</button>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {[
              { k: 'disciplina', l: 'Disciplina', i: '🧠', d: atributosCalculados.disciplina, c: "bg-purple-600" },
              { k: 'consistencia', l: 'Consistência', i: '❤️', d: atributosCalculados.consistencia, c: "bg-rose-600" },
              { k: 'forca', l: 'Força', i: '💪', d: atributosCalculados.forca, c: "bg-amber-600" },
              { k: 'agilidade', l: 'Agilidade', i: '⚡', d: atributosCalculados.agilidade, c: "bg-sky-600" },
            ].map(attr => (
              <Card key={attr.k} className="flex items-center gap-6 group hover:translate-y-[-2px] interactive">
                <div className="w-14 h-14 rounded-2xl bg-stone-950 flex items-center justify-center text-2xl border border-stone-800 group-hover:border-amber-500/30 transition-colors shadow-inner">{attr.i}</div>
                <div className="flex-1">
                  <div className="flex justify-between items-end mb-1">
                    <h4 className="text-[10px] text-stone-500 font-bold uppercase tracking-widest">{attr.l}</h4>
                    <span className="text-xl font-rpg text-amber-200">{attr.d.valorFinal}</span>
                  </div>
                  <ProgressoBar percent={attr.d.percentual} cor={attr.c} small />
                  <p className="text-[8px] text-stone-600 font-bold uppercase mt-1 tracking-wider text-right">{attr.d.xpRestante} / 100 XP</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <Card className="border-amber-900/10 bg-stone-950/40">
            <h3 className="text-amber-500 font-rpg text-xs uppercase tracking-widest mb-6 border-b border-amber-900/10 pb-3">Pergaminhos de Alerta</h3>
            {avisosIniciais.length > 0 ? (
              <ul className="space-y-4">
                {avisosIniciais.map(a => (
                  <li key={a.id} className="flex items-start gap-3 animate-pulse">
                    <span className="text-amber-600 text-sm">📜</span>
                    <p className="text-stone-300 text-[11px] leading-relaxed font-bold">{a.msg}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-stone-600 text-[10px] italic text-center py-4">Nenhum perigo iminente ou prazo próximo no horizonte.</p>
            )}
          </Card>

          <Card className="border-amber-900/10 bg-stone-950/40">
            <h3 className="text-amber-500 font-rpg text-xs uppercase tracking-widest mb-6 border-b border-amber-900/10 pb-3">Deveres Pendentes</h3>
            <div className="space-y-4">
              {estado.missoesDiarias.filter(m => m.estado === 'pendente').length > 0 ? (
                estado.missoesDiarias.filter(m => m.estado === 'pendente').slice(0, 3).map(m => (
                  <div key={m.id} className="flex justify-between items-center text-[11px]">
                    <span className="text-stone-400 truncate pr-2">• {m.nome}</span>
                    <span className={`font-bold px-1.5 rounded border ${DIFICULDADES[m.dificuldade].cor} border-current/20 text-[8px]`}>{DIFICULDADES[m.dificuldade].icone}</span>
                  </div>
                ))
              ) : (
                <p className="text-emerald-600 text-[10px] font-bold text-center py-4">Tudo em ordem para hoje!</p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );

  const RenderMissoes = () => {
    const [mNome, setMNome] = useState("");
    const [mPun, setMPun] = useState("");
    const [mTipo, setMTipo] = useState<"objetiva" | "progresso">("objetiva");
    const [mDif, setMDif] = useState<NivelDificuldade>("normal");
    const [mUni, setMUni] = useState("");
    const [mAlv, setMAlv] = useState<number | "">("");
    const [qNom, setQNom] = useState("");
    const [qDif, setQDif] = useState<NivelDificuldade>("normal");
    const [meNom, setMeNom] = useState("");
    const [meTot, setMeTot] = useState<number | "">("");
    const [meUni, setMeUni] = useState("");
    const [meIni, setMeIni] = useState("");
    const [meFim, setMeFim] = useState("");
    const [inputs, setInputs] = useState<Record<string, number>>({});
    const [metaEditId, setMetaEditId] = useState<string | null>(null);
    const [metaEditData, setMetaEditData] = useState<{ total: number; unidade: string; inicio?: string; fim?: string }>({ total: 0, unidade: "" });
    const epicaAtiva = estado.missoesDiarias.some(m => m.dificuldade === 'epico' && m.estado === 'pendente');

    return (
      <div className="space-y-10 animate-in fade-in duration-500 pb-10">
        <SeccaoTitulo titulo="Log de Aventuras" icone="📜" subtitulo="Deveres e Metas de Longo Prazo" />
        <div className="flex flex-wrap justify-center gap-4 mb-10">
           {['diarias', 'quests', 'metas'].map(aba => (
             <button key={aba} onClick={() => setEstado(p => ({ ...p, abaAtivaMissoes: aba as any }))} className={`px-8 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-[0.2em] border-b-4 transition-all duration-300 font-rpg ${estado.abaAtivaMissoes === aba ? 'bg-amber-900/30 text-amber-100 border-amber-500 shadow-xl translate-y-[-2px]' : 'bg-stone-900/40 text-stone-600 border-transparent opacity-60 hover:opacity-100'}`}>
               {aba === 'diarias' ? '📅 Diárias' : aba === 'quests' ? '🗡️ Quests' : '🏹 Metas'}
             </button>
           ))}
        </div>
        {estado.abaAtivaMissoes === 'diarias' && (
          <div className="space-y-8 max-w-4xl mx-auto">
            <Card className="border-amber-900/30 bg-stone-900/90 shadow-[0_10px_40px_rgba(0,0,0,0.6)]">
               <h3 className="text-amber-500 font-rpg text-sm uppercase mb-6 tracking-widest border-b border-amber-900/10 pb-4">Registrar Novo Dever Diário</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-stone-500 font-bold uppercase px-1">Título do Dever</label>
                    <input value={mNome} onChange={e => setMNome(e.target.value)} placeholder="Ex: Treino de Força" className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 focus:border-amber-600 outline-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-stone-500 font-bold uppercase px-1">Penitência em caso de falha</label>
                    <input value={mPun} onChange={e => setMPun(e.target.value)} placeholder="Ex: 50 flexões extras" className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-rose-300 focus:border-rose-900 outline-none placeholder:text-rose-900/40" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-stone-500 font-bold uppercase px-1">Tipo de Ação</label>
                    <select value={mTipo} onChange={e => setMTipo(e.target.value as any)} className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none">
                      <option value="objetiva">Ato Único (Check)</option>
                      <option value="progresso">Progresso Numérico</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[9px] text-stone-500 font-bold uppercase px-1">Grau de Dificuldade</label>
                    <select value={mDif} onChange={e => setMDif(e.target.value as NivelDificuldade)} className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none">
                      {Object.entries(DIFICULDADES).map(([k, v]) => (
                        <option key={k} value={k} disabled={k === 'epico' && epicaAtiva}>{v.icone} {v.nome} (x{v.mult})</option>
                      ))}
                    </select>
                  </div>
                  {mTipo === "progresso" && (
                    <div className="flex gap-4 md:col-span-2 animate-in fade-in zoom-in duration-300">
                      <div className="flex-1 space-y-1.5">
                        <label className="text-[9px] text-stone-500 font-bold uppercase px-1">Alvo</label>
                        <input type="number" value={mAlv} onChange={e => setMAlv(e.target.value === '' ? '' : parseFloat(e.target.value))} placeholder="Ex: 10" className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" />
                      </div>
                      <div className="flex-[2] space-y-1.5">
                        <label className="text-[9px] text-stone-500 font-bold uppercase px-1">Unidade</label>
                        <input value={mUni} onChange={e => setMUni(e.target.value)} placeholder="Ex: km, páginas" className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" />
                      </div>
                    </div>
                  )}
               </div>
               <div className="flex flex-col sm:flex-row justify-between items-center mt-8 gap-4 pt-6 border-t border-amber-900/10">
                 <div className="text-[10px] text-stone-500 font-bold uppercase tracking-wider flex gap-4">
                   <span className="flex items-center gap-1">🪙 Ouro: <span className="text-yellow-500">{Math.round(VALORES_BASE.MISSAO.moedas * DIFICULDADES[mDif].mult)}</span></span>
                   <span className="flex items-center gap-1">✨ XP: <span className="text-amber-200">{Math.round(VALORES_BASE.MISSAO.xp * DIFICULDADES[mDif].mult)}</span></span>
                 </div>
                 <BotaoRPG disabled={!mNome || !mPun || (mTipo === 'progresso' && !mAlv) || (mDif === 'epico' && epicaAtiva)} onClick={() => { const nova = { id: Math.random().toString(36).substr(2, 9), nome: mNome, estado: "pendente" as const, tipo: mTipo, tipoPenalidade: mPun, penalidadeCumprida: false, progressoAtual: 0, valorAlvo: Number(mAlv) || 0, unidade: mUni, dificuldade: mDif }; setEstado(p => ({ ...p, missoesDiarias: [...p.missoesDiarias, nova] })); setMNome(""); setMPun(""); setMAlv(""); }} variant={mDif === 'epico' ? 'epic' : 'primary'}>Fixar no Pergaminho</BotaoRPG>
               </div>
               {mDif === 'epico' && epicaAtiva && <p className="text-[9px] text-rose-500 font-bold text-center mt-3 animate-pulse uppercase">Você já possui uma missão Lendária ativa no momento.</p>}
            </Card>
            <div className="space-y-4">
              {estadoSeguro.missoesDiarias.map(m => (
                <Card key={m.id} className={`${m.estado === "concluida" ? 'opacity-50 scale-[0.98]' : m.estado === "falha" ? 'border-rose-950 bg-rose-950/5' : DIFICULDADES[m.dificuldade].sombra} transition-all duration-500 overflow-hidden`}>
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{DIFICULDADES[m.dificuldade].icone}</span>
                        <h4 className={`text-lg font-rpg tracking-wide ${m.estado === 'concluida' ? 'line-through text-stone-500' : 'text-stone-100'}`}>{m.nome}</h4>
                        <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full border ${DIFICULDADES[m.dificuldade].cor} border-current/20 bg-stone-950/50 uppercase`}>{DIFICULDADES[m.dificuldade].label}</span>
                      </div>
                      <p className="text-[10px] text-rose-500/80 font-bold uppercase italic tracking-widest pl-8">Penitência: {m.tipoPenalidade}</p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                      {m.estado === "pendente" ? (
                        <div className="flex gap-2 w-full sm:w-auto">
                          {m.tipo === "objetiva" && <BotaoRPG onClick={() => handleConcluirMissao(m.id, "concluida")}>Cumprir</BotaoRPG>}
                          <BotaoRPG variant="danger" onClick={() => handleConcluirMissao(m.id, "falha")}>Falhei</BotaoRPG>
                          <button onClick={() => setEstado(p => ({ ...p, missoesDiarias: p.missoesDiarias.filter(x => x.id !== m.id) }))} className="p-2.5 rounded-xl text-stone-600 hover:text-rose-500 transition-colors bg-stone-950/40 border border-stone-800">🗑️</button>
                        </div>
                      ) : (
                        <div className="flex gap-3 items-center">
                          <button onClick={() => setEstado(p => ({ ...p, missoesDiarias: p.missoesDiarias.map(x => x.id === m.id ? { ...x, estado: "pendente", protegida: false } : x) }))} className="text-[10px] underline text-stone-600 font-bold uppercase hover:text-amber-500">Reverter Ato</button>
                          <button onClick={() => setEstado(p => ({ ...p, missoesDiarias: p.missoesDiarias.filter(x => x.id !== m.id) }))} className="p-2 rounded-xl text-stone-700 hover:text-rose-500 transition-colors">🗑️</button>
                        </div>
                      )}
                    </div>
                  </div>
                  {m.tipo === "progresso" && m.estado === "pendente" && (
                    <div className="mt-6 pt-5 border-t border-stone-800/50 animate-in fade-in slide-in-from-top-2">
                      <div className="flex justify-between items-end mb-2.5">
                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-widest">Avanço: <span className="text-amber-200">{m.progressoAtual}</span> / {m.valorAlvo} {m.unidade}</p>
                        <p className="text-xs font-rpg text-amber-500">{Math.floor(((m.progressoAtual || 0) / (m.valorAlvo || 1)) * 100)}%</p>
                      </div>
                      <ProgressoBar percent={((m.progressoAtual || 0) / (m.valorAlvo || 1)) * 100} />
                      <div className="flex items-center gap-3 mt-5">
                         <input type="number" placeholder="Val" className="w-16 bg-stone-950 border border-stone-800 rounded-xl px-2 py-2 text-xs text-amber-100 text-center outline-none focus:border-amber-600" value={inputs[m.id] || ""} onChange={e => setInputs(p => ({ ...p, [m.id]: parseFloat(e.target.value) }))} />
                         <BotaoRPG variant="secondary" onClick={() => { const v = inputs[m.id] || 0; const n = (m.progressoAtual || 0) + v; setEstado(p => ({ ...p, missoesDiarias: p.missoesDiarias.map(x => x.id === m.id ? { ...x, progressoAtual: n, estado: n >= (x.valorAlvo || 0) ? 'concluida' : 'pendente' } : x) })); setInputs(p => ({ ...p, [m.id]: 0 })); }}>Somar</BotaoRPG>
                         <BotaoRPG variant="secondary" onClick={() => { const v = inputs[m.id] || 0; const n = Math.max(0, (m.progressoAtual || 0) - v); setEstado(p => ({ ...p, missoesDiarias: p.missoesDiarias.map(x => x.id === m.id ? { ...x, progressoAtual: n } : x) })); setInputs(p => ({ ...p, [m.id]: 0 })); }}>Reduzir</BotaoRPG>
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
        {estado.abaAtivaMissoes === 'quests' && (
          <div className="space-y-6 max-w-3xl mx-auto">
            <Card className="bg-stone-800/10 border-amber-900/10">
               <h3 className="text-amber-500 font-rpg text-xs uppercase mb-6 tracking-widest">Nova Jornada Única</h3>
               <div className="flex flex-col sm:flex-row gap-4">
                  <input value={qNom} onChange={e => setQNom(e.target.value)} placeholder="Título da Quest..." className="flex-1 bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2 text-sm text-amber-100 outline-none focus:border-amber-600" />
                  <select value={qDif} onChange={e => setQDif(e.target.value as NivelDificuldade)} className="bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2 text-sm text-amber-100 outline-none">
                    {Object.entries(DIFICULDADES).map(([k, v]) => <option key={k} value={k}>{v.icone} {v.nome}</option>)}
                  </select>
               </div>
               <div className="flex justify-between items-center mt-6">
                 <p className="text-[9px] text-stone-600 font-bold uppercase">Premiação Estimada: <span className="text-yellow-500">🪙 {Math.round(VALORES_BASE.QUEST.moedas * DIFICULDADES[qDif].mult)}</span></p>
                 <BotaoRPG onClick={() => { if(qNom) { setEstado(p => ({ ...p, quests: [...p.quests, { id: Math.random().toString(36).substr(2, 9), nome: qNom, concluida: false, dificuldade: qDif }] })); setQNom(""); } }}>Iniciar Quest</BotaoRPG>
               </div>
            </Card>
            <div className="grid grid-cols-1 gap-4">
              {estadoSeguro.quests.map(q => (
                <Card key={q.id} className={`${q.concluida ? 'opacity-40 grayscale scale-[0.97]' : DIFICULDADES[q.dificuldade].sombra} py-4 interactive`}>
                  <div className="flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <span className={`w-3 h-3 rounded-full ${q.concluida ? 'bg-stone-700' : 'bg-amber-600 shadow-[0_0_8px_rgba(245,158,11,0.5)] animate-pulse'}`}></span>
                        <span className={`font-bold tracking-wide ${q.concluida ? 'line-through text-stone-600' : 'text-stone-100'}`}>{q.nome}</span>
                        <span className={`text-[8px] font-bold px-1.5 rounded bg-stone-950 border border-stone-800 ${DIFICULDADES[q.dificuldade].cor}`}>{DIFICULDADES[q.dificuldade].label}</span>
                     </div>
                     <div className="flex gap-4">
                       <button onClick={() => setEstado(p => ({ ...p, quests: p.quests.map(x => x.id === q.id ? { ...x, concluida: !x.concluida } : x) }))} className="text-[10px] font-bold uppercase text-amber-600 hover:text-amber-400 transition-colors">{q.concluida ? 'Reabrir' : 'Completar'}</button>
                       <button onClick={() => setEstado(p => ({ ...p, quests: p.quests.filter(x => x.id !== q.id) }))} className="text-stone-700 hover:text-rose-500">🗑️</button>
                     </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
        {estado.abaAtivaMissoes === 'metas' && (
          <div className="space-y-8 max-w-4xl mx-auto">
            <Card className="bg-stone-800/10 border-amber-900/10">
               <h3 className="text-amber-500 font-rpg text-xs uppercase mb-6 tracking-widest">Traçar Alvo Distante</h3>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2"><input value={meNom} onChange={e => setMeNom(e.target.value)} placeholder="Título da Meta de Longo Prazo..." className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none focus:border-amber-600" /></div>
                  <input type="number" value={meTot} onChange={e => setMeTot(e.target.value === '' ? '' : parseFloat(e.target.value))} placeholder="Total Desejado" className="bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" />
                  <input value={meUni} onChange={e => setMeUni(e.target.value)} placeholder="Unidade (ex: Livros)" className="bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" />
                  <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Início</label><input type="date" value={meIni} onChange={e => setMeIni(e.target.value)} className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2 text-sm text-amber-100 outline-none" /></div>
                  <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Prazo</label><input type="date" value={meFim} onChange={e => setMeFim(e.target.value)} className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2 text-sm text-amber-100 outline-none" /></div>
               </div>
               <div className="flex justify-end mt-8 border-t border-amber-900/10 pt-6"><BotaoRPG onClick={() => { if(meNom && Number(meTot) > 0) { setEstado(p => ({ ...p, metas: [...p.metas, { id: Math.random().toString(36).substr(2, 9), nome: meNom, total: Number(meTot), unidade: meUni, progresso: 0, concluida: false, dataInicio: meIni || undefined, dataFim: meFim || undefined }] })); setMeNom(""); setMeTot(""); setMeUni(""); setMeIni(""); setMeFim(""); } }}>Firmar Acordo</BotaoRPG></div>
            </Card>
            <div className="space-y-6">
              {estadoSeguro.metas.map(meta => (
                <Card key={meta.id} className={`${meta.concluida ? 'opacity-50 grayscale' : 'shadow-blue-900/5'}`}>
                  {metaEditId === meta.id ? (
                    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-300">
                      <h4 className="text-amber-500 font-rpg text-xs uppercase tracking-[0.2em]">✏️ Editando: {meta.nome}</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1"><label className="text-[9px] text-stone-500 uppercase font-bold">Total</label><input type="number" value={metaEditData.total} onChange={e => setMetaEditData({...metaEditData, total: parseFloat(e.target.value) || 0})} className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2 text-xs text-amber-100 outline-none" /></div>
                        <div className="space-y-1"><label className="text-[9px] text-stone-500 uppercase font-bold">Unidade</label><input value={metaEditData.unidade} onChange={e => setMetaEditData({...metaEditData, unidade: e.target.value})} className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2 text-xs text-amber-100 outline-none" /></div>
                        <div className="space-y-1"><label className="text-[9px] text-stone-500 uppercase font-bold">Início</label><input type="date" value={metaEditData.inicio || ""} onChange={e => setMetaEditData({...metaEditData, inicio: e.target.value})} className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2 text-xs text-amber-100 outline-none" /></div>
                        <div className="space-y-1"><label className="text-[9px] text-stone-500 uppercase font-bold">Fim</label><input type="date" value={metaEditData.fim || ""} onChange={e => setMetaEditData({...metaEditData, fim: e.target.value})} className="w-full bg-stone-950 border border-stone-800 rounded-xl px-3 py-2 text-xs text-amber-100 outline-none" /></div>
                      </div>
                      <div className="flex justify-end gap-3 pt-4 border-t border-stone-800"><button onClick={() => setMetaEditId(null)} className="text-xs text-stone-500 font-bold uppercase hover:text-stone-300">Cancelar</button><BotaoRPG onClick={() => { setEstado(p => ({ ...p, metas: p.metas.map(x => x.id === meta.id ? { ...x, total: metaEditData.total, unidade: metaEditData.unidade, dataInicio: metaEditData.inicio, dataFim: metaEditData.fim, concluida: x.progresso >= metaEditData.total } : x) })); setMetaEditId(null); }}>Salvar</BotaoRPG></div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row justify-between items-center gap-8">
                      <div className="flex-1 w-full space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><h4 className="text-xl font-rpg text-amber-200 tracking-wider">{meta.nome}</h4>{meta.dataInicio || meta.dataFim ? (<p className="text-[9px] text-stone-500 font-bold uppercase bg-stone-950/50 px-3 py-1 rounded-full border border-stone-800/50">📅 {meta.dataInicio || '?'} → {meta.dataFim || '?'}</p>) : null}</div>
                          <div className="flex justify-between items-end text-[10px] font-bold uppercase tracking-widest text-stone-500"><span>Avanço: <span className="text-sky-400">{meta.progresso}</span> / {meta.total} {meta.unidade}</span><span>{Math.floor((meta.progresso / meta.total) * 100)}%</span></div>
                          <ProgressoBar percent={(meta.progresso / meta.total) * 100} cor="bg-sky-600" />
                      </div>
                      <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                        {!meta.concluida && (
                          <div className="flex items-center gap-1.5 bg-stone-950/60 p-1 rounded-2xl border border-stone-800/50">
                            <input type="number" placeholder="0" className="w-12 bg-transparent text-center text-xs text-amber-100 outline-none font-bold" value={inputs[meta.id] || ""} onChange={e => setInputs(p => ({ ...p, [meta.id]: parseFloat(e.target.value) }))} />
                            <button onClick={() => { const v = inputs[meta.id] || 0; const n = Math.min(meta.total, meta.progresso + v); setEstado(p => ({ ...p, metas: p.metas.map(x => x.id === meta.id ? { ...x, progresso: n, concluida: n >= meta.total } : x) })); if (n >= meta.total) setUltimoFeedback("🏹 Meta atingida!"); setInputs(p => ({ ...p, [meta.id]: 0 })); }} className="w-8 h-8 rounded-xl bg-amber-900/40 text-amber-500 flex items-center justify-center font-bold text-lg hover:bg-amber-600 hover:text-white transition-all">+</button>
                            <button onClick={() => { const v = inputs[meta.id] || 0; const n = Math.max(0, meta.progresso - v); setEstado(p => ({ ...p, metas: p.metas.map(x => x.id === meta.id ? { ...x, progresso: n, concluida: false } : x) })); setInputs(p => ({ ...p, [meta.id]: 0 })); }} className="w-8 h-8 rounded-xl bg-stone-800 text-stone-400 flex items-center justify-center font-bold text-lg hover:bg-stone-700 hover:text-white transition-all">-</button>
                          </div>
                        )}
                        <div className="flex gap-2 ml-2"><button onClick={() => { setMetaEditId(meta.id); setMetaEditData({ total: meta.total, unidade: meta.unidade, inicio: meta.dataInicio, fim: meta.dataFim }); }} className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800 text-stone-500 hover:text-amber-500 transition-all">✏️</button><button onClick={() => setEstado(p => ({ ...p, metas: p.metas.filter(x => x.id !== meta.id) }))} className="p-2.5 rounded-xl bg-stone-950/60 border border-stone-800 text-stone-600 hover:text-rose-500 transition-all">🗑️</button></div>
                        {meta.concluida && <button onClick={() => setEstado(p => ({ ...p, metas: p.metas.map(x => x.id === meta.id ? { ...x, concluida: false } : x) }))} className="text-[10px] text-amber-600 underline font-bold uppercase ml-4">Reabrir</button>}
                      </div>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const RenderHabitos = () => {
    const [hNom, setHNom] = useState("");
    const [hPun, setHPun] = useState("");
    const [hEst, setHEst] = useState("");
    return (
      <div className="space-y-12 animate-in fade-in duration-500 pb-10">
        <SeccaoTitulo titulo="Vigilância Permanente" icone="🚫" subtitulo="Dominando os Impulsos Sombrios" />
        <Card className="space-y-6 max-w-4xl mx-auto border-rose-900/10">
           <h3 className="text-rose-500 font-rpg text-xs uppercase mb-4 tracking-widest border-b border-rose-900/10 pb-4">Registrar Cadeia a Quebrar</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Título</label><input value={hNom} onChange={e => setHNom(e.target.value)} placeholder="Ex: Procrastinação" className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" /></div>
              <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Penitência</label><input value={hPun} onChange={e => setHPun(e.target.value)} placeholder="Ex: R$ 50,00" className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-rose-300 outline-none" /></div>
              <div className="space-y-1.5 col-span-1 md:col-span-2"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Estratégia</label><textarea value={hEst} onChange={e => setHEst(e.target.value)} placeholder="Plano de contenção..." className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none resize-none" rows={3} /></div>
           </div>
           <div className="flex justify-end pt-4"><BotaoRPG onClick={() => { if(hNom && hPun) { setEstado(p => ({ ...p, habitosRuins: [...p.habitosRuins, { id: Math.random().toString(36).substr(2, 9), nome: hNom, descricao: "", comoQuebrar: hEst, recompensaXP: 20, recompensaOuro: 5, tipoPenalidade: hPun, statusHoje: "pendente", penalidadeCumprida: false }] })); setHNom(""); setHPun(""); setHEst(""); } }}>Firmar Vigilância</BotaoRPG></div>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-6xl mx-auto">
          {estado.habitosRuins.map(h => (
            <Card key={h.id} className={`${h.statusHoje === "resistido" ? 'opacity-50 grayscale' : h.statusHoje === "falha" ? "border-rose-900/50 bg-rose-950/10" : "border-stone-800"} flex flex-col h-full transition-all duration-500`}>
               <div className="flex justify-between items-start mb-6"><div className="space-y-1"><h4 className="text-xl font-rpg tracking-wide text-stone-100">{h.nome}</h4><p className="text-[10px] text-rose-500 font-bold uppercase tracking-[0.2em]">Penitência: {h.tipoPenalidade}</p></div><button onClick={() => setEstado(p => ({ ...p, habitosRuins: p.habitosRuins.filter(x => x.id !== h.id) }))} className="text-stone-700 hover:text-rose-500 transition-colors">🗑️</button></div>
               <div className="flex-1 bg-stone-950/40 rounded-2xl p-4 mb-8 border border-stone-800/30"><h5 className="text-[9px] uppercase font-bold text-amber-600/60 mb-2 tracking-widest">Estratégia:</h5><p className="text-xs text-stone-400 italic leading-relaxed">{h.comoQuebrar || "Plano não definido."}</p></div>
               <div className="flex gap-3 justify-center">{h.statusHoje === "pendente" ? (<><BotaoRPG onClick={() => { setEstado(p => ({ ...p, habitosRuins: p.habitosRuins.map(x => x.id === h.id ? { ...x, statusHoje: "resistido" } : x) })); setUltimoFeedback("🌿 Fortaleza demonstrada."); }}>Resisti</BotaoRPG><BotaoRPG variant="danger" onClick={() => setEstado(p => ({ ...p, habitosRuins: p.habitosRuins.map(x => x.id === h.id ? { ...x, statusHoje: "falha", penalidadeCumprida: false } : x) }))}>Cedi</BotaoRPG></>) : (<button onClick={() => setEstado(p => ({ ...p, habitosRuins: p.habitosRuins.map(x => x.id === h.id ? { ...x, statusHoje: "pendente" } : x) }))} className="text-[10px] underline text-stone-500 font-bold uppercase hover:text-amber-500">Resetar Dia</button>)}</div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const RenderEventos = () => {
    const [eNom, setENom] = useState("");
    const [eDat, setEDat] = useState("");
    const [eAnt, setEAnt] = useState<number>(1);
    const [eDes, setEDes] = useState("");
    return (
      <div className="space-y-12 animate-in fade-in duration-500 pb-10">
        <SeccaoTitulo titulo="Crônicas do Tempo" icone="📅" subtitulo="Agendamento de Eventos e Prazos" />
        <Card className="space-y-6 max-w-3xl mx-auto border-sky-900/10">
           <h3 className="text-sky-500 font-rpg text-xs uppercase mb-4 tracking-widest border-b border-sky-900/10 pb-4">Marcar Nova Efeméride</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="md:col-span-2"><input value={eNom} onChange={e => setENom(e.target.value)} placeholder="Título..." className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 focus:border-sky-600 outline-none" /></div>
              <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Data</label><input type="date" value={eDat} onChange={e => setEDat(e.target.value)} className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2 text-sm text-amber-100 outline-none" /></div>
              <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase px-1">Lembrete (Dias)</label><input type="number" value={eAnt} onChange={e => setEAnt(parseInt(e.target.value) || 0)} className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2 text-sm text-amber-100 outline-none" /></div>
              <div className="md:col-span-2"><textarea value={eDes} onChange={e => setEDes(e.target.value)} placeholder="Anotações..." className="w-full bg-stone-950/60 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none resize-none" rows={3} /></div>
           </div>
           <div className="flex justify-end pt-4"><BotaoRPG onClick={() => { if(eNom && eDat) { setEstado(p => ({ ...p, eventos: [...p.eventos, { id: Math.random().toString(36).substr(2, 9), nome: eNom, descricao: eDes, data: eDat, diasAntesLembrete: eAnt, status: "pendente" }] })); setENom(""); setEDat(""); setEAnt(1); setEDes(""); } }}>Agendar</BotaoRPG></div>
        </Card>
        <div className="grid grid-cols-1 gap-4 max-w-4xl mx-auto">
          {estadoSeguro.eventos.map(e => (
            <Card key={e.id} className={`${e.status === "concluido" ? "opacity-40 grayscale" : "border-stone-800"}`}>
               <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
                  <div className="flex-1"><div className="flex items-center gap-3 mb-1"><h4 className="text-xl font-rpg tracking-wider text-stone-100">{e.nome}</h4><span className="text-[10px] font-bold text-sky-400 bg-sky-900/10 px-2 rounded-full border border-sky-900/20">{e.data}</span></div><p className="text-stone-500 text-xs italic">{e.descricao || 'Sem detalhes.'}</p></div>
                  <div className="flex gap-4 items-center"><button onClick={() => setEstado(p => ({ ...p, eventos: p.eventos.map(x => x.id === e.id ? { ...x, status: x.status === 'concluido' ? 'pendente' : 'concluido' } : x) }))} className="text-[10px] font-bold uppercase text-sky-600 hover:text-sky-400">{e.status === 'concluido' ? 'Reabrir' : 'Finalizar'}</button><button onClick={() => setEstado(p => ({ ...p, eventos: p.eventos.filter(x => x.id !== e.id) }))} className="text-stone-700 hover:text-rose-500">🗑️</button></div>
               </div>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  const RenderPenalidades = () => (
    <div className="space-y-16 animate-in fade-in duration-500 pb-10">
      <SeccaoTitulo titulo="Tribunal das Almas" icone="⚖️" subtitulo="O Custo da Negligência" />
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="bg-rose-950/10 border-2 border-rose-900/20 rounded-[2rem] p-10 shadow-[inset_0_0_50px_rgba(159,18,57,0.05)]">
          <h3 className="text-rose-500 font-rpg text-xl uppercase text-center tracking-[0.3em] mb-10">Dívidas de Honra Ativas</h3>
          <div className="grid grid-cols-1 gap-6">
            {penalidadesAtivas.map(p => (
              <Card key={p.id} className="border-rose-900/40 bg-stone-900/90 relative overflow-hidden"><div className="absolute top-0 left-0 w-1 h-full bg-rose-700"></div><div className="flex flex-col md:flex-row justify-between items-center gap-8 pl-4"><div className="text-center md:text-left space-y-2"><div className="flex items-center gap-2 justify-center md:justify-start"><span className="text-[9px] text-stone-500 font-bold uppercase tracking-[0.3em]">{p.origem === 'missao' ? 'Dever Falhado' : 'Cedeu ao Hábito'}</span><span className="w-1 h-1 rounded-full bg-stone-700"></span><span className="text-[9px] text-rose-800 font-bold uppercase">{p.nome}</span></div><p className="italic text-rose-400 text-xl md:text-2xl font-rpg">"{p.punicao}"</p></div><BotaoRPG variant="danger" onClick={() => handleExpiar(p, true)}>Saldar Dívida</BotaoRPG></div></Card>
            ))}
            {penalidadesAtivas.length === 0 && (<div className="flex flex-col items-center py-10 opacity-40"><span className="text-6xl mb-4">✨</span><p className="text-stone-500 italic text-sm text-center">Sua honra está intocada.</p></div>)}
          </div>
        </div>
        <div className="pt-12 border-t border-stone-900"><h3 className="text-stone-600 font-rpg text-lg uppercase text-center tracking-[0.2em] mb-8">Penitências Cumpridas</h3><div className="grid grid-cols-1 gap-4 opacity-40 grayscale">{penalidadesCumpridas.map(p => (<Card key={p.id} className="border-stone-800 flex justify-between items-center py-3 px-8"><div><p className="text-stone-500 font-bold uppercase text-[8px]">{p.nome}</p><p className="text-stone-300 text-sm italic font-rpg">"{p.punicao}"</p></div><button onClick={() => handleExpiar(p, false)} className="text-[9px] text-amber-900 underline font-bold uppercase hover:text-amber-600">Reabrir Processo</button></Card>))}</div></div>
      </div>
    </div>
  );

  const RenderLoja = () => {
    const [abaLoja, setAbaLoja] = useState<'emporio' | 'artesao'>('emporio');
    const [editItemId, setEditItemId] = useState<string | null>(null);
    const [itemFormData, setItemFormData] = useState<{ nome: string; descricao: string; custo: number; categoria: 'recompensa' | 'alivio' }>({ nome: '', descricao: '', custo: 10, categoria: 'recompensa' });

    const handleSalvarItem = () => {
      if (!itemFormData.nome.trim()) { setUltimoFeedback("❌ O item precisa de um nome!"); return; }
      if (itemFormData.custo < 0) { setUltimoFeedback("❌ O custo não pode ser negativo!"); return; }
      
      setEstado(prev => {
        const novosItens = editItemId 
          ? prev.itensLoja.map(i => i.id === editItemId ? { ...i, ...itemFormData } : i)
          : [...prev.itensLoja, { id: Math.random().toString(36).substr(2, 9), ...itemFormData }];
        return { ...prev, itensLoja: novosItens };
      });
      
      setItemFormData({ nome: '', descricao: '', custo: 10, categoria: 'recompensa' });
      setEditItemId(null);
      setUltimoFeedback("🔨 Item forjado com sucesso!");
    };

    const handleExcluirItem = (id: string) => {
      if (confirm("Deseja banir este item da loja para sempre?")) {
        setEstado(prev => ({ ...prev, itensLoja: prev.itensLoja.filter(i => i.id !== id) }));
        setUltimoFeedback("🗑️ Item removido da vitrine.");
      }
    };

    return (
      <div className="space-y-12 animate-in fade-in duration-500 pb-10">
        <SeccaoTitulo titulo="Mercado das Maravilhas" icone="💰" subtitulo="Troque seu ouro por glória ou alívio" />
        
        <div className="flex justify-center gap-4 mb-8">
           <button onClick={() => setAbaLoja('emporio')} className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${abaLoja === 'emporio' ? 'bg-amber-900/30 text-amber-100 border-amber-500 shadow-lg' : 'bg-stone-900/40 text-stone-500 border-transparent opacity-60'}`}>🛍️ Comprar</button>
           <button onClick={() => setAbaLoja('artesao')} className={`px-6 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${abaLoja === 'artesao' ? 'bg-stone-800 text-stone-100 border-stone-500 shadow-lg' : 'bg-stone-900/40 text-stone-500 border-transparent opacity-60'}`}>🔨 Gerenciar Loja</button>
        </div>

        {abaLoja === 'emporio' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto px-4 animate-in fade-in slide-in-from-left-4 duration-500">
            {estadoSeguro.itensLoja.map(item => (
              <Card key={item.id} className="flex flex-col h-full border-amber-900/10 interactive group">
                <div className="relative mb-6">
                  <div className="w-full aspect-square rounded-2xl bg-stone-950 border border-stone-800 flex items-center justify-center text-5xl shadow-inner group-hover:border-amber-500/30 transition-all">
                    {item.categoria === 'alivio' ? '✨' : '🎁'}
                  </div>
                  <div className="absolute bottom-[-10px] left-1/2 translate-x-[-50%] bg-stone-900 border border-amber-900/40 px-4 py-1.5 rounded-full shadow-lg text-center min-w-[5rem]">
                    <span className="text-yellow-500 font-bold text-xs">{item.custo === 0 ? "Gratuito" : `🪙 ${item.custo}`}</span>
                  </div>
                </div>
                <div className="text-center flex-1 mb-6">
                  <h4 className="text-amber-200 font-rpg uppercase tracking-widest text-sm mb-2">{item.nome}</h4>
                  <p className="text-stone-500 text-[10px] leading-relaxed italic">{item.descricao}</p>
                </div>
                <BotaoRPG onClick={() => {
                  if (moedasAtuais >= item.custo) {
                    setEstado(p => ({ ...p, compras: [...p.compras, { id: Math.random().toString(36).substr(2, 9), itemId: item.id, custo: item.custo, data: new Date().toISOString() }], inventario: [...p.inventario, { idUnique: Math.random().toString(36).substr(2, 9), itemId: item.id }] }));
                    setUltimoFeedback(`✨ ${item.nome} adquirido!`);
                  }
                }} disabled={moedasAtuais < item.custo} variant={item.categoria === 'alivio' ? 'secondary' : 'primary'}>
                  {moedasAtuais < item.custo ? "Ouro Insuficiente" : "Adquirir"}
                </BotaoRPG>
              </Card>
            ))}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            <Card className="border-stone-700 bg-stone-900 shadow-xl">
              <h3 className="text-stone-300 font-rpg text-sm uppercase mb-6 tracking-widest border-b border-stone-800 pb-4">{editItemId ? "Refinar Artefato" : "Forjar Novo Item"}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase">Nome do Item</label><input value={itemFormData.nome} onChange={e => setItemFormData({...itemFormData, nome: e.target.value})} placeholder="Ex: Baú de Joias" className="w-full bg-stone-950 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" /></div>
                <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase">Custo em Ouro</label><input type="number" value={itemFormData.custo} onChange={e => setItemFormData({...itemFormData, custo: parseInt(e.target.value) || 0})} className="w-full bg-stone-950 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" /></div>
                <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase">Tipo</label><select value={itemFormData.categoria} onChange={e => setItemFormData({...itemFormData, categoria: e.target.value as any})} className="w-full bg-stone-950 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none"><option value="recompensa">Recompensa (Mundano)</option><option value="alivio">Alívio (Remover Penitência)</option></select></div>
                <div className="space-y-1.5"><label className="text-[9px] text-stone-500 font-bold uppercase">Descrição Curta</label><input value={itemFormData.descricao} onChange={e => setItemFormData({...itemFormData, descricao: e.target.value})} placeholder="O que este item representa?" className="w-full bg-stone-950 border border-stone-800 rounded-xl px-4 py-2.5 text-sm text-amber-100 outline-none" /></div>
              </div>
              <div className="flex justify-end gap-3 mt-8 border-t border-stone-800 pt-6">
                {editItemId && <button onClick={() => { setEditItemId(null); setItemFormData({ nome: '', descricao: '', custo: 10, categoria: 'recompensa' }); }} className="text-[10px] text-stone-500 font-bold uppercase hover:text-stone-300">Cancelar</button>}
                <BotaoRPG onClick={handleSalvarItem}>{editItemId ? "Confirmar Refinamento" : "Expor na Vitrine"}</BotaoRPG>
              </div>
            </Card>

            <div className="space-y-3">
              <h4 className="text-[10px] text-stone-500 font-bold uppercase tracking-widest ml-2">Lista de Itens Disponíveis</h4>
              {estadoSeguro.itensLoja.map(item => (
                <div key={item.id} className="flex items-center justify-between bg-stone-900/50 border border-stone-800 p-4 rounded-2xl group hover:border-stone-600 transition-all">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl">{item.categoria === 'alivio' ? '✨' : '🎁'}</span>
                    <div>
                      <h5 className="text-stone-200 font-bold text-sm">{item.nome} <span className="text-yellow-500/80 text-[10px] ml-2 tracking-tighter">({item.custo === 0 ? "Gratuito" : `🪙 ${item.custo}`})</span></h5>
                      <p className="text-[10px] text-stone-500 italic">{item.descricao}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 opacity-30 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditItemId(item.id); setItemFormData({ nome: item.nome, descricao: item.descricao, custo: item.custo, categoria: item.categoria }); }} className="p-2 text-sky-600 hover:text-sky-400">✏️</button>
                    <button onClick={() => handleExcluirItem(item.id)} className="p-2 text-rose-800 hover:text-rose-500">🗑️</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const RenderInventario = () => (
    <div className="space-y-12 animate-in fade-in duration-500 pb-10">
      <SeccaoTitulo titulo="Mochila do Viajante" icone="🎒" subtitulo="Itens e Relíquias Coletadas" />
      {estado.protecaoAtiva && (<div className="max-w-xl mx-auto mb-10"><div className="bg-sky-950/20 border-2 border-sky-600/30 p-5 rounded-2xl text-center shadow-[0_0_20px_rgba(2,132,199,0.1)] flex items-center justify-center gap-4 animate-pulse"><span className="text-3xl">🛡️</span><div><p className="text-sky-200 text-xs font-bold uppercase tracking-[0.2em]">Manto da Providência Ativo</p></div></div></div>)}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6 max-w-6xl mx-auto px-4">
        {estado.inventario.length === 0 && <p className="text-stone-700 italic text-center py-20 w-full col-span-full">Sua mochila está vazia.</p>}
        {estadoSeguro.inventario.map(invItem => {
          const base = estado.itensLoja.find(i => i.id === invItem.itemId);
          const icon = base?.categoria === 'alivio' ? '✨' : '🎁';
          return (
            <Card key={invItem.idUnique} className="flex flex-col h-full border-stone-800 text-center py-5 group interactive">
               <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">{icon}</div>
               <h4 className="text-amber-200 font-rpg uppercase text-[10px] tracking-widest mb-4 flex-1">{base?.nome || "Artefato Antigo"}</h4>
               <button onClick={() => { if (base?.tipoEfeito === 'removerPenalidade' || base?.tipoEfeito === 'converterPenalidadeEmXP') setModalItemUso({ idUnique: invItem.idUnique, tipo: base.tipoEfeito }); else usarItem(invItem.idUnique); }} className="text-[9px] font-bold uppercase py-2 rounded-lg bg-stone-950 border border-stone-800 text-stone-500 hover:text-amber-500 transition-all">Ativar</button>
            </Card>
          );
        })}
      </div>
      {modalItemUso && (<div className="fixed inset-0 bg-stone-950/95 z-[110] flex items-center justify-center p-6 backdrop-blur-xl"><Card className="max-w-md w-full space-y-8 border-amber-500/20"><div className="text-center"><span className="text-5xl mb-4 inline-block">✨</span><h3 className="text-amber-500 font-rpg text-xl uppercase">Aplicar Alívio</h3></div><div className="max-h-[25rem] overflow-y-auto space-y-4 pr-3 custom-scrollbar">{penalidadesAtivas.map(p => (<button key={p.id} onClick={() => usarItem(modalItemUso.idUnique, p.id)} className="w-full bg-stone-900 border border-stone-800 p-5 rounded-2xl text-left hover:border-amber-600 transition-all"><p className="text-stone-200 font-rpg text-lg">"{p.punicao}"</p><p className="text-[9px] uppercase font-bold text-stone-600 mt-2">{p.nome}</p></button>))}{penalidadesAtivas.length === 0 && <p className="text-stone-600 text-center text-xs py-10 italic">Nenhum fardo pendente.</p>}</div><div className="flex justify-center pt-2"><button onClick={() => setModalItemUso(null)} className="text-[10px] text-stone-600 uppercase font-bold hover:text-stone-400 tracking-widest underline">Fechar Mochila</button></div></Card></div>)}
    </div>
  );

  const NavButton: React.FC<{ a: boolean; o: () => void; l: string; i: string }> = ({ a, o, l, i }) => (
    <button onClick={o} className={`flex-1 flex flex-col items-center justify-center transition-all duration-300 relative group ${a ? 'text-amber-500 translate-y-[-8px]' : 'text-stone-600 hover:text-stone-400'}`}>
      <span className={`text-2xl mb-1.5 drop-shadow-lg ${a ? 'scale-125' : 'group-hover:scale-110'} transition-transform`}>{i}</span>
      <span className={`text-[8px] uppercase font-bold tracking-[0.25em] ${a ? 'opacity-100' : 'opacity-40'}`}>{l}</span>
      {a && (<div className="absolute bottom-[-10px] w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.8)] animate-pulse"></div>)}
    </button>
  );

 return (
  <div className="min-h-screen bg-stone-950 text-stone-200 font-sans">

    {carregandoAuth ? (

      // ⏳ CARREGANDO AUTENTICAÇÃO
      <div className="min-h-screen flex items-center justify-center font-rpg tracking-widest text-stone-400">
        Conectando aos pergaminhos do destino...
      </div>

      ) : modoRecuperacao ? (

      // 🔑 RECUPERAÇÃO DE SENHA
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-stone-900 p-8 rounded-2xl border border-amber-500/30 w-full max-w-md">
          <h2 className="font-rpg text-amber-300 text-center mb-4">
            Redefinir Senha
          </h2>

          <input
            type="password"
            placeholder="Nova senha"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            className="w-full mb-4 px-4 py-2 rounded bg-stone-800 border border-stone-700 text-stone-200"
          />

          <BotaoRPG
            onClick={async () => {
              const { error } = await supabase.auth.updateUser({
                password: novaSenha,
              });

              if (error) {
                setErroAuth(error.message);
              } else {
                setModoRecuperacao(false);
                setNovaSenha('');
                alert('Senha alterada com sucesso!');
              }
            }}
          >
            Salvar nova senha
          </BotaoRPG>

          {erroAuth && (
            <p className="text-rose-400 text-xs mt-3 text-center">
              {erroAuth}
            </p>
          )}
        </div>
      </div>

    ) : usuarioLogado ? (

      // 🎮 APP NORMAL (JOGO)
      <div className="min-h-screen pb-40 text-stone-200 bg-stone-950 font-sans overflow-x-hidden selection:bg-amber-900/50 selection:text-amber-100">

        {ultimoFeedback && (
          <div className="fixed top-28 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-lg animate-in fade-in slide-in-from-top-6 duration-500">
            <div className="bg-stone-900/90 backdrop-blur-xl border border-amber-500/30 rounded-3xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.8)] flex items-center gap-5">
              <div className="w-12 h-12 rounded-2xl bg-amber-900/30 border border-amber-500/20 flex items-center justify-center text-2xl">
                ⚡
              </div>
              <p className="text-amber-50 text-xs font-bold italic font-rpg uppercase tracking-widest">
                {ultimoFeedback}
              </p>
            </div>
          </div>
        )}

        {/* HEADER */}
        <header className="sticky top-0 z-50 bg-stone-950/90 backdrop-blur-2xl border-b border-amber-900/20 px-8 py-5 shadow-2xl">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center space-x-6">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-900 to-amber-700 flex items-center justify-center font-bold text-amber-50 font-rpg text-2xl shadow-[0_0_20px_rgba(120,53,15,0.4)] border-2 border-amber-500/30">
                  {nivelHeroi}
                </div>
                <div className="absolute -top-2 -right-2 bg-stone-950 border border-amber-500/40 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-md text-amber-400">
                  Lv
                </div>
              </div>

              <div className="hidden sm:block">
                <p className="text-[9px] uppercase text-stone-600 font-bold tracking-[0.4em] mb-1.5">
                  Herói do Alvorecer
                </p>
                <h1 className="text-sm font-rpg text-amber-200 uppercase tracking-[0.2em]">
                  {LISTA_CLASSES.find(c => c.id === estado.classeId)?.nome || 'Iniciado'}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="hidden md:flex flex-col items-end">
                <div className="flex justify-between w-32 mb-1">
                  <span className="text-[8px] font-bold text-stone-500 uppercase">XP</span>
                  <span className="text-[8px] font-bold text-amber-400">{xpNivel}%</span>
                </div>
                <div className="w-32">
                  <ProgressoBar percent={xpNivel} small />
                </div>
              </div>

              <div className="flex items-center space-x-4 bg-stone-900/60 px-6 py-3 rounded-2xl border border-amber-900/10">
                <span className="text-2xl">🪙</span>
                <span className="text-xl font-bold text-yellow-500 font-rpg tracking-[0.2em]">
                  {moedasAtuais}
                </span>
              </div>
  <BotaoRPG variant="secondary" onClick={sair}>
  Sair
</BotaoRPG>
            </div>
          </div>
        </header>

        {/* CONTEÚDO PRINCIPAL */}
        <main className="max-w-6xl mx-auto p-6 md:p-10 w-full animate-in fade-in duration-1000">
          {estado.telaAtual === 'jornada' && <RenderJornada />}
          {estado.telaAtual === 'missoes' && <RenderMissoes />}
          {estado.telaAtual === 'habitos' && <RenderHabitos />}
          {estado.telaAtual === 'penalidades' && <RenderPenalidades />}
          {estado.telaAtual === 'loja' && <RenderLoja />}
          {estado.telaAtual === 'eventos' && <RenderEventos />}
          {estado.telaAtual === 'inventario' && <RenderInventario />}
        </main>

        {/* NAVEGAÇÃO */}
        <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 w-[95%] max-w-4xl bg-stone-900/90 backdrop-blur-3xl border border-amber-900/30 z-50 h-24 flex items-center justify-around px-4 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.8)]">
          <NavButton a={estado.telaAtual === 'jornada'} o={() => setEstado(p => ({ ...p, telaAtual: 'jornada' }))} l="Herói" i="⚔️" />
          <NavButton a={estado.telaAtual === 'missoes'} o={() => setEstado(p => ({ ...p, telaAtual: 'missoes' }))} l="Quests" i="📜" />
          <NavButton a={estado.telaAtual === 'inventario'} o={() => setEstado(p => ({ ...p, telaAtual: 'inventario' }))} l="Mochila" i="🎒" />
          <NavButton a={estado.telaAtual === 'eventos'} o={() => setEstado(p => ({ ...p, telaAtual: 'eventos' }))} l="Crônica" i="📅" />
          <NavButton a={estado.telaAtual === 'habitos'} o={() => setEstado(p => ({ ...p, telaAtual: 'habitos' }))} l="Vigia" i="🚫" />
          <NavButton a={estado.telaAtual === 'penalidades'} o={() => setEstado(p => ({ ...p, telaAtual: 'penalidades' }))} l="Almas" i="⚖️" />
          <NavButton a={estado.telaAtual === 'loja'} o={() => setEstado(p => ({ ...p, telaAtual: 'loja' }))} l="Loja" i="💰" />
        </nav>

      </div>

    ) : (

      // 🔐 TELA DE LOGIN
      <div className="min-h-screen flex items-center justify-center">
        <div className="bg-stone-900 border border-stone-700 rounded-3xl p-8 w-full max-w-md shadow-2xl space-y-4">

          <h1 className="font-rpg text-xl text-center text-amber-400 uppercase tracking-widest">
            Crônicas da Alvorada
          </h1>

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-stone-950 border border-stone-700 text-stone-100"
          />

          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={e => setSenha(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-stone-950 border border-stone-700 text-stone-100"
          />

          {erroAuth && (
            <div className="text-rose-400 text-sm text-center">
              {erroAuth}
            </div>
          )}

          <div className="flex gap-3 justify-center pt-2">
            <BotaoRPG onClick={entrar}>
              Entrar
            </BotaoRPG>
            <BotaoRPG variant="secondary" onClick={criarConta}>
              Criar Conta
            </BotaoRPG>
          </div>
      <button
  onClick={recuperarSenha}
  className="w-full text-xs text-amber-400 hover:text-amber-300 underline text-center mt-2"
>
  Esqueceu a senha?
</button>

        </div>
      </div>

    )}

  </div>
);
}
