import { PIInfo, ProcessedCampaignData } from '../types/campaign';

/**
 * Cruzamento entre as linhas de um PI e os dados realizados da campanha.
 *
 * Extraído do PIInfoCard para ser reaproveitado por páginas que precisam dos
 * mesmos números fora do card (ex: CPL no topo do dashboard). A lógica é a
 * mesma de sempre — nada aqui muda o que o card já exibia.
 */

// Minúsculo, sem espaços nas pontas e sem acentos, para casar "Programática" com "Programatica"
export const normalizeVehicleName = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .split('')
    .filter(c => {
      const code = c.charCodeAt(0);
      return code < 0x300 || code > 0x36f;
    })
    .join('');

// O PI e a planilha de resultados nomeiam o mesmo veículo de formas diferentes:
// o PI traz "Fb Ig" enquanto os dados chegam com "Facebook" e "Instagram" separados.
// Chaves e valores já normalizados (minúsculo, sem acento).
const VEHICLE_ALIASES: Record<string, string[]> = {
  'fb ig': ['facebook', 'instagram'],
  'fb/ig': ['facebook', 'instagram'],
  'fb e ig': ['facebook', 'instagram'],
  'fb+ig': ['facebook', 'instagram'],
  'facebook/instagram': ['facebook', 'instagram'],
  'facebook e instagram': ['facebook', 'instagram'],
  meta: ['facebook', 'instagram'],
  'meta ads': ['facebook', 'instagram'],
  google: ['google search'],
  'google ads': ['google search'],
  youtube: ['youtube'],
};

// Nomes de veículo (como aparecem nos dados) que uma linha do PI representa
export const resolveVehicleNames = (piVeiculo: string): string[] => {
  const key = normalizeVehicleName(piVeiculo);
  return VEHICLE_ALIASES[key] ?? [key];
};

const splitKey = (key: string) => {
  const i = key.lastIndexOf('|');
  return { veiculo: key.slice(0, i), tipo: key.slice(i + 1) };
};

export const parseValorPI = (valor: string): number =>
  parseFloat(valor.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()) || 0;

export interface TotaisRealizados {
  realizado: number;
  impressoes: number;
  cliques: number;
}

export interface VeiculacaoPI {
  veiculo: string;
  tipoDeCompra: string;
  previsto: number;
  realizado: number;
  quantidade: number;
  impressoesRealizadas: number;
  cliquesRealizados: number;
  matchedByVehicle: boolean;
}

export const calcularTotaisRealizados = (
  campaignData: ProcessedCampaignData[]
): TotaisRealizados =>
  campaignData.reduce(
    (acc, item) => {
      acc.realizado += item.cost;
      acc.impressoes += item.impressions;
      acc.cliques += item.clicks;
      return acc;
    },
    { realizado: 0, impressoes: 0, cliques: 0 }
  );

/** Detalhamento por veículo+tipo do PI, cruzado com os dados realizados */
export const agruparVeiculacaoPI = (
  piInfo: PIInfo[] | null,
  campaignData: ProcessedCampaignData[],
  totaisRealizados: TotaisRealizados
): VeiculacaoPI[] => {
  if (!piInfo || piInfo.length === 0) return [];

  // Agrupa PI por veículo+tipo
  const piGrouped = new Map<string, {
    veiculo: string;
    tipoDeCompra: string;
    previsto: number;
    quantidade: number;
  }>();

  piInfo.forEach(info => {
    const key = `${normalizeVehicleName(info.veiculo)}|${info.modeloCompra.toUpperCase()}`;
    const valor = parseValorPI(info.totalBruto);
    const qtd = parseFloat(info.quantidade.replace(/\./g, '').replace(',', '.').trim()) || 0;
    if (piGrouped.has(key)) {
      const e = piGrouped.get(key)!;
      e.previsto += valor;
      e.quantidade += qtd;
    } else {
      piGrouped.set(key, { veiculo: info.veiculo, tipoDeCompra: info.modeloCompra, previsto: valor, quantidade: qtd });
    }
  });

  // Agrupa realizados por veículo+tipo da campanha
  const realizadoGrouped = new Map<string, { realizado: number; cliques: number; impressoes: number }>();
  campaignData.forEach(item => {
    const key = `${normalizeVehicleName(item.veiculo)}|${item.tipoDeCompra.toUpperCase()}`;
    if (realizadoGrouped.has(key)) {
      const e = realizadoGrouped.get(key)!;
      e.realizado += item.cost;
      e.cliques += item.clicks;
      e.impressoes += item.impressions;
    } else {
      realizadoGrouped.set(key, {
        realizado: item.cost,
        cliques: item.clicks,
        impressoes: item.impressions,
      });
    }
  });

  const resultado: VeiculacaoPI[] = [];

  // Veículos dos dados já representados por alguma linha do PI. Impede que uma linha
  // genérica absorva o realizado que pertence a outra linha do mesmo tipo de compra.
  const veiculosDoPI = new Set<string>();
  piGrouped.forEach(p => resolveVehicleNames(p.veiculo).forEach(n => veiculosDoPI.add(n)));

  const somaRealizados = (aceita: (veiculo: string) => boolean, tipoKey: string) => {
    let realizado = 0, cliques = 0, impressoes = 0, found = false;
    for (const [k, v] of realizadoGrouped.entries()) {
      const { veiculo, tipo } = splitKey(k);
      if (tipo !== tipoKey || !aceita(veiculo)) continue;
      realizado += v.realizado;
      cliques += v.cliques;
      impressoes += v.impressoes;
      found = true;
    }
    return found ? { realizado, cliques, impressoes } : undefined;
  };

  piGrouped.forEach((piData) => {
    const tipoKey = piData.tipoDeCompra.toUpperCase();
    const nomesDoVeiculo = resolveVehicleNames(piData.veiculo);

    // Soma os realizados dos veículos que esta linha do PI representa
    // (ex: PI tem "Fb Ig" e os dados têm "Facebook" + "Instagram" separados)
    let match = somaRealizados(v => nomesDoVeiculo.includes(v), tipoKey);
    const matchedByVehicle = !!match;

    // Sem nenhum veículo correspondente: fica com o que sobrou do mesmo tipo de compra,
    // ou seja, os veículos que nenhuma outra linha do PI reivindica
    if (!match) {
      match = somaRealizados(v => !veiculosDoPI.has(v), tipoKey);
    }

    if (!match && piGrouped.size === 1) {
      match = { realizado: totaisRealizados.realizado, cliques: totaisRealizados.cliques, impressoes: totaisRealizados.impressoes };
    }

    resultado.push({
      veiculo: piData.veiculo,
      tipoDeCompra: piData.tipoDeCompra,
      previsto: piData.previsto,
      realizado: match?.realizado ?? 0,
      quantidade: piData.quantidade,
      impressoesRealizadas: match?.impressoes ?? 0,
      cliquesRealizados: match?.cliques ?? 0,
      matchedByVehicle,
    });
  });

  return resultado;
};

/**
 * Bonificação: o investimento contratado vira teto. Tudo que a veiculação passou
 * disso não é cobrado do cliente — é bonificado. O "realizado" que o cliente
 * enxerga é sempre o valor travado no teto, veículo a veículo.
 */
export interface VeiculacaoBonificada extends VeiculacaoPI {
  /** Realizado travado no teto contratado */
  realizadoConsiderado: number;
  /** Excedente entregue sem custo */
  bonificacao: number;
  /** Volume entregue além do contratado (cliques ou impressões, conforme o tipo) */
  volumeBonificado: number;
}

export interface ResumoBonificacao {
  contratado: number;
  realizadoBruto: number;
  /** Soma dos realizados já travados no teto de cada veículo */
  realizado: number;
  bonificacao: number;
  linhas: VeiculacaoBonificada[];
}

export const aplicarBonificacao = (
  linhas: VeiculacaoPI[],
  totaisRealizados: TotaisRealizados
): ResumoBonificacao => {
  const comBonificacao: VeiculacaoBonificada[] = linhas.map(linha => {
    const isCPM = linha.tipoDeCompra.toUpperCase().includes('CPM');
    const isCPC = linha.tipoDeCompra.toUpperCase().includes('CPC');
    const volumeRealizado = isCPM ? linha.impressoesRealizadas : isCPC ? linha.cliquesRealizados : 0;

    return {
      ...linha,
      realizadoConsiderado: Math.min(linha.realizado, linha.previsto),
      bonificacao: Math.max(0, linha.realizado - linha.previsto),
      volumeBonificado: linha.quantidade > 0 ? Math.max(0, volumeRealizado - linha.quantidade) : 0,
    };
  });

  const contratado = comBonificacao.reduce((s, l) => s + l.previsto, 0);
  const realizado = comBonificacao.reduce((s, l) => s + l.realizadoConsiderado, 0);

  // O gasto total da planilha é a referência: o que não couber no teto é bonificação,
  // inclusive o que por acaso não tenha casado com nenhuma linha do PI.
  const realizadoBruto = totaisRealizados.realizado;

  return {
    contratado,
    realizadoBruto,
    realizado,
    bonificacao: Math.max(0, realizadoBruto - realizado),
    linhas: comBonificacao,
  };
};
