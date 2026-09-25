import { format } from 'date-fns';
import { ProcessedCampaignData } from '../types/campaign';
import {
  GA4Criativo,
  GrupoVeiculo,
  grupoDaFonte,
  grupoDoVeiculoMidia,
  grupoDoVeiculoPI,
} from '../services/ga4';
import { VeiculacaoBonificada } from './piMatching';

/**
 * Cruzamento dos leads da landing page (GA4) com os criativos da planilha de mídia.
 *
 * O GA4 identifica o criativo pelo utm_content ("um-encontro"); a mídia, pelo nome
 * na taxonomia "formato_tipo_dim_x_na_<criativo>_na". Os nomes nem sempre são
 * idênticos ("teaser" na mídia vira "video-teaser" no GA4), então o casamento é
 * por palavra inteira. Anúncios de busca não têm criativo: o utm_content deles
 * ("pesquisa") casa com um trecho do nome da campanha.
 *
 * O cruzamento respeita o veículo — leads vindos de "meta / paid" só vão para
 * linhas de Facebook/Instagram — e o dia, para o filtro de período continuar certo.
 */

// Posição do nome do criativo na taxonomia "formato_tipo_dim_x_na_<criativo>_na"
const POSICAO_CRIATIVO = 5;

export const slugDoCriativo = (adName: string): string | null => {
  const nome = adName.trim().toLowerCase();
  if (!nome) return null;
  const partes = nome.split('_');
  return partes.length > POSICAO_CRIATIVO && partes[POSICAO_CRIATIVO] ? partes[POSICAO_CRIATIVO] : nome;
};

const entreHifens = (s: string) => `-${s}-`;

/**
 * Quão bem o utm_content do GA4 casa com o criativo da mídia:
 * 3 = idêntico, 2 = um contém o outro por palavra inteira, 0 = não casa.
 */
const pontuarCriativo = (adContent: string, slug: string): number => {
  if (adContent === slug) return 3;
  if (entreHifens(adContent).includes(entreHifens(slug))) return 2;
  if (entreHifens(slug).includes(entreHifens(adContent))) return 2;
  return 0;
};

export interface CruzamentoCriativo {
  sourceMedium: string;
  adContent: string;
  leads: number;
  /** Criativo (ou campanha, para busca) da mídia que recebeu os leads; null quando não casou */
  criativo: string | null;
  motivo?: 'origem-sem-veiculo' | 'sem-criativo-correspondente';
}

interface Identidade {
  chave: string;
  rotulo: string;
  pontos: number;
}

/** Melhor identidade de mídia para um utm_content, entre os itens de um grupo de veículo */
const melhorIdentidade = (adContent: string, itens: ProcessedCampaignData[]): Identidade | null => {
  const alvo = adContent.trim().toLowerCase();
  let melhor: Identidade | null = null;

  for (const item of itens) {
    const slug = slugDoCriativo(item.adName);
    let candidata: Identidade | null = null;

    if (slug) {
      const pontos = pontuarCriativo(alvo, slug);
      if (pontos > 0) candidata = { chave: `criativo:${slug}`, rotulo: item.adName, pontos };
    } else {
      // Busca: sem criativo, o utm_content aparece como um trecho do nome da campanha
      const trechos = item.campaignName.trim().toLowerCase().split('_');
      if (trechos.includes(alvo)) {
        candidata = { chave: `campanha:${item.campaignName}`, rotulo: item.campaignName, pontos: 1 };
      }
    }

    if (!candidata) continue;
    // Mais pontos vence; no empate, o nome mais específico (mais longo)
    if (
      !melhor ||
      candidata.pontos > melhor.pontos ||
      (candidata.pontos === melhor.pontos && candidata.chave.length > melhor.chave.length)
    ) {
      melhor = candidata;
    }
  }

  return melhor;
};

const chaveDaIdentidade = (item: ProcessedCampaignData): string => {
  const slug = slugDoCriativo(item.adName);
  return slug ? `criativo:${slug}` : `campanha:${item.campaignName}`;
};

/** Reparte um total entre itens, na proporção dos cliques (ou impressões, ou igualmente) */
const repartir = (total: number, itens: number[], dados: ProcessedCampaignData[], destino: number[]) => {
  const pesoCliques = itens.reduce((s, i) => s + dados[i].clicks, 0);
  const pesoImpressoes = itens.reduce((s, i) => s + dados[i].impressions, 0);

  itens.forEach(i => {
    const peso =
      pesoCliques > 0 ? dados[i].clicks / pesoCliques :
      pesoImpressoes > 0 ? dados[i].impressions / pesoImpressoes :
      1 / itens.length;
    destino[i] += total * peso;
  });
};

export const atribuirLeadsAosCriativos = (
  dados: ProcessedCampaignData[],
  porCriativo: GA4Criativo[]
): { itens: ProcessedCampaignData[]; cruzamentos: CruzamentoCriativo[] } => {
  const leads = dados.map(() => 0);
  const grupoDoItem = dados.map(item => grupoDoVeiculoMidia(item.veiculo));
  const diaDoItem = dados.map(item => format(item.date, 'yyyy-MM-dd'));

  // Consolida por origem + criativo para decidir o casamento uma vez só
  const decisoes = new Map<string, Identidade | null>();
  const decidir = (grupo: GrupoVeiculo, adContent: string) => {
    const chave = `${grupo.chave}|${adContent}`;
    if (!decisoes.has(chave)) {
      decisoes.set(chave, melhorIdentidade(adContent, dados.filter((_, i) => grupoDoItem[i] === grupo)));
    }
    return decisoes.get(chave)!;
  };

  const resumoCruzamentos = new Map<string, CruzamentoCriativo>();
  const registrar = (registro: GA4Criativo, criativo: string | null, motivo?: CruzamentoCriativo['motivo']) => {
    const chave = `${registro.sourceMedium}|${registro.adContent}`;
    const atual = resumoCruzamentos.get(chave) ?? {
      sourceMedium: registro.sourceMedium,
      adContent: registro.adContent,
      leads: 0,
      criativo,
      motivo,
    };
    atual.leads += registro.leads;
    resumoCruzamentos.set(chave, atual);
  };

  porCriativo.forEach(registro => {
    if (registro.leads <= 0) return;

    const grupo = grupoDaFonte(registro.sourceMedium);
    if (!grupo) {
      registrar(registro, null, 'origem-sem-veiculo');
      return;
    }

    const identidade = decidir(grupo, registro.adContent);
    if (!identidade) {
      registrar(registro, null, 'sem-criativo-correspondente');
      return;
    }

    const doCriativo = dados
      .map((_, i) => i)
      .filter(i => grupoDoItem[i] === grupo && chaveDaIdentidade(dados[i]) === identidade.chave);
    const doDia = doCriativo.filter(i => diaDoItem[i] === registro.dia);

    // Lead num dia sem veiculação registrada: reparte no período todo do criativo
    // em vez de perder o lead
    repartir(registro.leads, doDia.length > 0 ? doDia : doCriativo, dados, leads);
    registrar(registro, identidade.rotulo);
  });

  return {
    itens: dados.map((item, i) => ({ ...item, leads: leads[i] })),
    cruzamentos: Array.from(resumoCruzamentos.values()).sort((a, b) => b.leads - a.leads),
  };
};

/**
 * Custo de cada linha depois do teto de bonificação: cada veículo do PI é cobrado
 * até o contratado, e esse desconto se espalha proporcionalmente pelos criativos.
 */
export const aplicarTetoAosItens = (
  dados: ProcessedCampaignData[],
  linhasBonificadas: VeiculacaoBonificada[]
): ProcessedCampaignData[] => {
  const fatores = new Map<GrupoVeiculo, number>();

  const somaPorGrupo = new Map<GrupoVeiculo, { cobrado: number; veiculado: number }>();
  linhasBonificadas.forEach(linha => {
    const grupo = grupoDoVeiculoPI(linha.veiculo);
    if (!grupo) return;
    const soma = somaPorGrupo.get(grupo) ?? { cobrado: 0, veiculado: 0 };
    soma.cobrado += linha.realizadoConsiderado;
    soma.veiculado += linha.realizado;
    somaPorGrupo.set(grupo, soma);
  });
  somaPorGrupo.forEach((soma, grupo) => {
    fatores.set(grupo, soma.veiculado > 0 ? soma.cobrado / soma.veiculado : 1);
  });

  return dados.map(item => {
    const grupo = grupoDoVeiculoMidia(item.veiculo);
    const fator = grupo ? fatores.get(grupo) ?? 1 : 1;
    return { ...item, custoCobrado: item.cost * fator };
  });
};
