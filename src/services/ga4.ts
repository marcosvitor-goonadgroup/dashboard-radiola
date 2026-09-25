import axios from 'axios';
import { ApiResponse } from '../types/campaign';
import { parse } from 'date-fns';
import { normalizeVehicleName } from '../utils/piMatching';

// Em dev usa proxy do Vite (evita CORS); em produção chama a API diretamente
const API_BASE = import.meta.env.DEV
  ? '/api-proxy'
  : 'https://nmbcoamazonia-api.vercel.app';

// Aba GA4 da base do SEBRAE: métricas da landing page da campanha
const GA4_SEBRAE_URL = `${API_BASE}/google/sheets/1CBCFY6ND17r34KnwApqlAr5UfARwYqHMtzuCEl5AcU8/data?range=GA4`;

/** Evento do GA4 que representa a inscrição concluída — o lead da campanha */
const EVENTO_LEAD = 'inscricao_evento';

/** GA4 emite um session_start por sessão, então seu Event count é a contagem de sessões */
const EVENTO_SESSAO = 'session_start';

export interface GA4Fonte {
  sourceMedium: string;
  sessoes: number;
  leads: number;
}

export interface GA4Dia {
  date: Date;
  sessoes: number;
  leads: number;
}

/** Menor recorte da aba: um dia, uma origem, um criativo (utm_content) */
export interface GA4Criativo {
  dia: string; // "yyyy-MM-dd", como vem da planilha
  sourceMedium: string;
  adContent: string;
  sessoes: number;
  leads: number;
}

export interface GA4Resumo {
  sessoes: number;
  leads: number;
  fontes: GA4Fonte[];
  porDia: GA4Dia[];
  porCriativo: GA4Criativo[];
}

export const GA4_RESUMO_VAZIO: GA4Resumo = { sessoes: 0, leads: 0, fontes: [], porDia: [], porCriativo: [] };

const parseNumero = (valor: string): number => {
  if (!valor) return 0;
  const limpo = valor.replace(/\./g, '').replace(',', '.').trim();
  return parseFloat(limpo) || 0;
};

const parseGA4Date = (valor: string): Date => {
  try {
    // Formato da aba GA4: "2026-09-16"
    return parse(valor, 'yyyy-MM-dd', new Date());
  } catch {
    return new Date();
  }
};

const fonteSource = (sourceMedium: string): string =>
  (sourceMedium.split('/')[0] ?? '').trim().toLowerCase();

const fonteMedium = (sourceMedium: string): string =>
  (sourceMedium.split('/')[1] ?? '').trim().toLowerCase();

/**
 * Um mesmo veículo tem três nomes: o do GA4 ("meta / paid"), o da planilha de
 * mídia ("Facebook", "Instagram") e o do PI ("Fb Ig"). Cada grupo amarra os três.
 * Nomes já normalizados (minúsculo, sem acento).
 *
 * Origens fora destes grupos (orgânico, referral de busca) entram no total da LP
 * mas não são atribuídas a nenhum veículo nem criativo.
 */
export interface GrupoVeiculo {
  chave: string;
  /** Como o veículo aparece na coluna Veículo dos dados de mídia */
  veiculosMidia: string[];
  /** Como o veículo aparece na planilha de PI */
  nomesPI: string[];
  aceitaFonte: (source: string, medium: string) => boolean;
}

const ehMeta = (source: string) => source === 'meta' || source === 'facebook' || source === 'instagram';

export const GRUPOS_VEICULO: GrupoVeiculo[] = [
  {
    chave: 'meta',
    veiculosMidia: ['facebook', 'instagram'],
    nomesPI: ['fb ig', 'fb/ig', 'meta', 'meta ads', 'facebook', 'instagram'],
    aceitaFonte: ehMeta,
  },
  {
    chave: 'google-ads',
    veiculosMidia: ['google ads'],
    nomesPI: ['google ads', 'google'],
    aceitaFonte: (source, medium) => source === 'google' && medium === 'cpc',
  },
];

export const grupoDaFonte = (sourceMedium: string): GrupoVeiculo | undefined =>
  GRUPOS_VEICULO.find(g => g.aceitaFonte(fonteSource(sourceMedium), fonteMedium(sourceMedium)));

export const grupoDoVeiculoMidia = (veiculo: string): GrupoVeiculo | undefined => {
  const nome = normalizeVehicleName(veiculo);
  return GRUPOS_VEICULO.find(g => g.veiculosMidia.includes(nome));
};

export const grupoDoVeiculoPI = (piVeiculo: string): GrupoVeiculo | undefined => {
  const nome = normalizeVehicleName(piVeiculo);
  return GRUPOS_VEICULO.find(g => g.nomesPI.includes(nome));
};

/** Sessões e leads do GA4 que pertencem a uma linha de veículo do PI */
export const metricasDoVeiculoPI = (
  piVeiculo: string,
  fontes: GA4Fonte[]
): { sessoes: number; leads: number } | null => {
  const grupo = grupoDoVeiculoPI(piVeiculo);
  if (!grupo) return null;
  const aceita = grupo.aceitaFonte;

  return fontes.reduce(
    (acc, fonte) => {
      if (!aceita(fonteSource(fonte.sourceMedium), fonteMedium(fonte.sourceMedium))) return acc;
      acc.sessoes += fonte.sessoes;
      acc.leads += fonte.leads;
      return acc;
    },
    { sessoes: 0, leads: 0 }
  );
};

/**
 * A aba GA4 vem quebrada por Data × Campanha × Evento × Origem × Criativo, e a
 * coluna "Sessions" repete o total daquele recorte em cada linha de evento.
 * Somar a coluna direto multiplicaria as sessões pelo número de eventos, então
 * as sessões saem do Event count do session_start.
 */
export const fetchGA4Resumo = async (campanhaGA4: string): Promise<GA4Resumo> => {
  try {
    const response = await axios.get<ApiResponse>(GA4_SEBRAE_URL);

    if (!response.data.success || !response.data.data.values || response.data.data.values.length <= 1) {
      return GA4_RESUMO_VAZIO;
    }

    const alvo = campanhaGA4.trim().toLowerCase();
    const linhas = response.data.data.values
      .slice(1)
      .filter(row => row.length >= 6 && (row[2] || '').trim().toLowerCase() === alvo);

    // Agrupa por dia + origem + criativo: cada recorte tem um session_start próprio.
    // Planilhas antigas sem a coluna de criativo caem todas em "(not set)".
    const recortes = new Map<string, {
      dia: string;
      sourceMedium: string;
      adContent: string;
      sessoes: number;
      maiorSessions: number;
      leads: number;
    }>();

    linhas.forEach(row => {
      const [dia, sessions, , eventName, eventCount, sourceMedium] = row;
      const adContent = (row[6] || '(not set)').trim();
      const chave = `${dia}|${sourceMedium}|${adContent}`;
      const recorte = recortes.get(chave) ?? {
        dia,
        sourceMedium,
        adContent,
        sessoes: 0,
        maiorSessions: 0,
        leads: 0,
      };

      if (eventName === EVENTO_SESSAO) recorte.sessoes += parseNumero(eventCount);
      if (eventName === EVENTO_LEAD) recorte.leads += parseNumero(eventCount);
      recorte.maiorSessions = Math.max(recorte.maiorSessions, parseNumero(sessions));

      recortes.set(chave, recorte);
    });

    const porFonte = new Map<string, GA4Fonte>();
    const porDia = new Map<string, GA4Dia>();
    const porCriativo: GA4Criativo[] = [];

    recortes.forEach(recorte => {
      // Sem session_start no recorte, o maior "Sessions" é a melhor aproximação
      const sessoes = recorte.sessoes > 0 ? recorte.sessoes : recorte.maiorSessions;

      porCriativo.push({
        dia: recorte.dia,
        sourceMedium: recorte.sourceMedium,
        adContent: recorte.adContent,
        sessoes,
        leads: recorte.leads,
      });

      const fonte = porFonte.get(recorte.sourceMedium) ?? {
        sourceMedium: recorte.sourceMedium,
        sessoes: 0,
        leads: 0,
      };
      fonte.sessoes += sessoes;
      fonte.leads += recorte.leads;
      porFonte.set(recorte.sourceMedium, fonte);

      const dia = porDia.get(recorte.dia) ?? { date: parseGA4Date(recorte.dia), sessoes: 0, leads: 0 };
      dia.sessoes += sessoes;
      dia.leads += recorte.leads;
      porDia.set(recorte.dia, dia);
    });

    const fontes = Array.from(porFonte.values()).sort((a, b) => b.sessoes - a.sessoes);

    return {
      sessoes: fontes.reduce((s, f) => s + f.sessoes, 0),
      leads: fontes.reduce((s, f) => s + f.leads, 0),
      fontes,
      porDia: Array.from(porDia.values()).sort((a, b) => a.date.getTime() - b.date.getTime()),
      porCriativo,
    };
  } catch (error) {
    console.error('Erro ao buscar dados do GA4:', error);
    return GA4_RESUMO_VAZIO;
  }
};
