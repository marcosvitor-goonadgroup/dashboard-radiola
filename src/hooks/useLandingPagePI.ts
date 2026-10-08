import { useEffect, useMemo, useState } from 'react';
import { PIInfo, ProcessedCampaignData } from '../types/campaign';
import { fetchPIInfo } from '../services/api';
import { fetchGA4Resumo, GA4Resumo, PeriodoGA4 } from '../services/ga4';
import {
  agruparVeiculacaoPI,
  aplicarBonificacao,
  calcularTotaisRealizados,
  ResumoBonificacao,
} from '../utils/piMatching';
import { toSlug } from '../utils/slug';

interface Params {
  /** Base completa de mídia (do CampaignContext) */
  dados: ProcessedCampaignData[];
  clientSlug: string;
  campaignSlug: string;
  /** null desliga o hook — usado quando a página não tem PI de comparação */
  piSlug: string | null;
  /** Valores de "Session campaign" do GA4 que pertencem à campanha */
  campanhasGA4: string[];
  periodoGA4: PeriodoGA4;
}

export interface LandingPagePI {
  piData: ProcessedCampaignData[];
  piInfo: PIInfo[] | null;
  ga4: GA4Resumo | null;
  resumoBonificacao: ResumoBonificacao;
  /** Investimento realizado (travado no teto) ÷ leads do período; 0 sem leads */
  cpl: number;
  carregando: boolean;
}

/**
 * Tudo que um dashboard com landing page precisa de um PI: as linhas de mídia, as
 * linhas contratadas, a bonificação e os dados do GA4 fechados no período do PI.
 */
export const useLandingPagePI = ({
  dados,
  clientSlug,
  campaignSlug,
  piSlug,
  campanhasGA4,
  periodoGA4,
}: Params): LandingPagePI => {
  const [piInfo, setPiInfo] = useState<PIInfo[] | null>(null);
  const [ga4, setGa4] = useState<GA4Resumo | null>(null);
  const [carregando, setCarregando] = useState(piSlug !== null);

  const { inicio, fim } = periodoGA4;
  // Chave estável para o efeito: a lista pode chegar como array novo a cada render
  const chaveCampanhas = campanhasGA4.join('|');

  useEffect(() => {
    if (piSlug === null) {
      setCarregando(false);
      return;
    }

    let ativo = true;
    setCarregando(true);

    Promise.all([fetchPIInfo(piSlug), fetchGA4Resumo(chaveCampanhas.split('|'), { inicio, fim })])
      .then(([infoPI, resumoGA4]) => {
        if (!ativo) return;
        setPiInfo(infoPI);
        setGa4(resumoGA4);
      })
      .catch(() => {
        if (!ativo) return;
        setPiInfo(null);
        setGa4(null);
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });

    return () => { ativo = false; };
  }, [piSlug, chaveCampanhas, inicio, fim]);

  const piData = useMemo(
    () =>
      piSlug === null
        ? []
        : dados.filter(
            d =>
              toSlug(d.cliente || '') === clientSlug &&
              toSlug(d.campanha || '') === campaignSlug &&
              d.numeroPi === piSlug
          ),
    [dados, clientSlug, campaignSlug, piSlug]
  );

  // Bonificação sobre o PI inteiro: o teto contratado não depende do filtro de período
  const resumoBonificacao = useMemo(() => {
    const totais = calcularTotaisRealizados(piData);
    return aplicarBonificacao(agruparVeiculacaoPI(piInfo, piData, totais), totais);
  }, [piInfo, piData]);

  const leads = ga4?.leads ?? 0;
  const cpl = leads > 0 ? resumoBonificacao.realizado / leads : 0;

  return { piData, piInfo, ga4, resumoBonificacao, cpl, carregando };
};
