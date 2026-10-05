import { format } from 'date-fns';
import { ProcessedCampaignData } from '../types/campaign';
import {
  GA4Criativo,
  GrupoVeiculo,
  grupoDaFonte,
  grupoDoVeiculoMidia,
} from '../services/ga4';
import { chaveRealizado, VeiculacaoBonificada } from './piMatching';

/**
 * Cruzamento dos leads da landing page (GA4) com os criativos da planilha de mídia.
 *
 * O GA4 identifica o criativo pelo utm_content ("video-cesar-domingos"); a mídia,
 * pelo nome na taxonomia "formato_tipo_dim_x_na_<criativo>_na". Os nomes nem sempre
 * são idênticos ("teaser" na mídia vira "video-teaser" no GA4), então o casamento é
 * por palavra inteira, e o formato ("video", "banner") desempata quando o mesmo
 * criativo roda nos dois. Anúncios de busca não têm criativo: o utm_content deles
 * ("pesquisa") casa com um trecho do nome da campanha, e sitelinks — que só existem
 * na busca — vão para ela também.
 *
 * O cruzamento respeita o veículo — leads vindos de "meta / paid" só vão para
 * linhas de Facebook/Instagram — e o dia, para o filtro de período continuar certo.
 */

// Posições na taxonomia "formato_tipo_dim_x_na_<criativo>_na"
const POSICAO_FORMATO = 0;
const POSICAO_CRIATIVO = 5;

// Minúsculo e sem acento: "iório" no GA4 e na mídia nem sempre chegam com a mesma grafia
const normalizar = (texto: string): string =>
  texto
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const partesDaTaxonomia = (adName: string): string[] | null => {
  const partes = normalizar(adName).split('_');
  return partes.length > POSICAO_CRIATIVO && partes[POSICAO_CRIATIVO] ? partes : null;
};

export const slugDoCriativo = (adName: string): string | null => {
  const nome = normalizar(adName);
  if (!nome) return null;
  return partesDaTaxonomia(adName)?.[POSICAO_CRIATIVO] ?? nome;
};

const formatoDoCriativo = (adName: string): string | null =>
  partesDaTaxonomia(adName)?.[POSICAO_FORMATO] ?? null;

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
  /** Tamanho do trecho que casou — no empate, o nome mais específico vence */
  especificidade: number;
}

/** Cada nome de criativo é uma linha na tabela; anúncios de busca se agrupam pela campanha */
const chaveDaIdentidade = (item: ProcessedCampaignData): string =>
  item.adName.trim() ? `criativo:${normalizar(item.adName)}` : `campanha:${item.campaignName}`;

/** Melhor identidade de mídia para um utm_content, entre os itens de um grupo de veículo */
const melhorIdentidade = (adContent: string, itens: ProcessedCampaignData[]): Identidade | null => {
  const alvo = normalizar(adContent);
  const palavrasDoAlvo = alvo.split('-');
  let melhor: Identidade | null = null;

  for (const item of itens) {
    const slug = item.adName.trim() ? slugDoCriativo(item.adName) : null;
    let candidata: Identidade | null = null;

    if (slug) {
      const pontos = pontuarCriativo(alvo, slug);
      if (pontos > 0) {
        // "video-cesar-domingos" prefere o vídeo ao banner do mesmo criativo
        const formato = formatoDoCriativo(item.adName);
        const bonusFormato = formato && palavrasDoAlvo.includes(formato) ? 1 : 0;
        candidata = {
          chave: chaveDaIdentidade(item),
          rotulo: item.adName,
          pontos: pontos + bonusFormato,
          especificidade: slug.length,
        };
      }
    } else {
      // Busca: sem criativo, o utm_content aparece como um trecho do nome da campanha
      // ("pesquisa"), ou é um sitelink, extensão que só existe em anúncio de busca
      const trechos = normalizar(item.campaignName).split('_');
      if (trechos.includes(alvo) || alvo.startsWith('sitelink')) {
        candidata = { chave: chaveDaIdentidade(item), rotulo: item.campaignName, pontos: 1, especificidade: 0 };
      }
    }

    if (!candidata) continue;
    if (
      !melhor ||
      candidata.pontos > melhor.pontos ||
      (candidata.pontos === melhor.pontos && candidata.especificidade > melhor.especificidade)
    ) {
      melhor = candidata;
    }
  }

  return melhor;
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
 * Custo de cada linha depois do teto de bonificação: cada linha do PI é cobrada
 * até o contratado, e esse desconto se espalha proporcionalmente pelas linhas de
 * mídia que ela absorveu. Mídia que não casou com nenhuma linha do PI não tem
 * contrato que a cubra — sai como bonificação, como no card do PI.
 */
export const aplicarTetoAosItens = (
  dados: ProcessedCampaignData[],
  linhasBonificadas: VeiculacaoBonificada[]
): ProcessedCampaignData[] => {
  // Sem linhas do PI (ainda carregando, ou PI fora da planilha) não há teto conhecido
  if (linhasBonificadas.length === 0) {
    return dados.map(item => ({ ...item, custoCobrado: item.cost }));
  }

  // Fração cobrada de cada chave "veículo|tipo"; a primeira linha do PI que a absorveu vale
  const fatorPorChave = new Map<string, number>();
  linhasBonificadas.forEach(linha => {
    const fator = linha.realizado > 0 ? linha.realizadoConsiderado / linha.realizado : 1;
    linha.chavesRealizado.forEach(chave => {
      if (!fatorPorChave.has(chave)) fatorPorChave.set(chave, fator);
    });
  });

  return dados.map(item => ({
    ...item,
    custoCobrado: item.cost * (fatorPorChave.get(chaveRealizado(item)) ?? 0),
  }));
};
