import { useState, useMemo } from 'react';
import { CampaignProvider, useCampaign } from '../contexts/CampaignContext';
import BigNumbers from '../components/BigNumbers';
import ImpressionsChart from '../components/ImpressionsChart';
import VehicleMetrics from '../components/VehicleMetrics';
import ComparisonToggle from '../components/ComparisonToggle';
import PIInfoCard from '../components/PIInfoCard';
import CreativePerformance from '../components/CreativePerformance';
import ParticlesBackground from '../components/ParticlesBackground';
import Footer from '../components/Footer';
import adDeskWhite from '../images/ad-desk-white.svg';
import { subDays, startOfDay, format, addDays, differenceInCalendarDays } from 'date-fns';
import { toSlug } from '../utils/slug';
import { PeriodoGA4 } from '../services/ga4';
import { useLandingPagePI } from '../hooks/useLandingPagePI';
import { aplicarTetoAosItens, atribuirLeadsAosCriativos } from '../utils/leadsCriativos';

/**
 * Dashboard dos PIs da campanha ALIMENTA 2026 (SEBRAE): 1952 em setembro, 1953 em outubro.
 *
 * Variante do PIDashboard com regras próprias desta campanha:
 *  - bonificação: o investimento contratado é teto, o excedente é entregue sem custo;
 *  - métricas da landing page (GA4): sessões, leads e CPL, fechadas no mês do PI;
 *  - comparativo opcional com o mês do PI anterior da mesma campanha.
 *
 * Os demais PIs continuam no PIDashboard padrão — ver o registro em App.tsx.
 */

export interface PeriodoLP extends PeriodoGA4 {
  /** Como o período aparece na tela, ex: "set/2026" */
  rotulo: string;
}

export interface PIDashboardAlimentaProps {
  clientSlug: string;
  campaignSlug: string;
  piSlug: string;
  /** Nome base da campanha na aba GA4 (a planilha usa um rótulo curto, ex: "alimenta") */
  campanhaGA4: string;
  /**
   * Janela do GA4 que pertence a este PI. A campanha usa o mesmo utm em todos os
   * PIs, então é o mês que separa as sessões e leads de um PI do outro.
   */
  periodoLP: PeriodoLP;
  /** PI anterior da mesma campanha, para comparar sessões, leads e CPL */
  comparativo?: {
    piSlug: string;
    periodoLP: PeriodoLP;
  };
}

const PIHeader = ({
  clientName,
  campaignName,
  piNumber,
  agencia,
}: {
  clientName: string;
  campaignName: string;
  piNumber: string;
  agencia: string;
}) => (
  <header className="w-full bg-[#153ece] rounded-[34px] px-8 py-6 mb-6">
    <div className="flex items-center gap-6 min-w-0">
      <img src={adDeskWhite} alt="AD Desk" className="h-14 w-auto shrink-0" />
      <div className="border-l border-white/30 pl-6 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white/60 text-xs font-medium">{clientName}</span>
          <span className="text-white/40 text-xs">/</span>
          <span className="text-white/70 text-xs font-medium truncate max-w-[260px]">{campaignName}</span>
          <span className="text-white/40 text-xs">/</span>
          <h1 className="text-white font-bold text-sm sm:text-base leading-tight">
            PI {piNumber}
          </h1>
        </div>
        {agencia && (
          <p className="text-white/60 text-xs mt-0.5">
            Painel de Campanhas | {agencia}
          </p>
        )}
      </div>
    </div>
  </header>
);

const PIDashboardAlimentaContent = ({
  clientSlug,
  campaignSlug,
  piSlug,
  campanhaGA4,
  periodoLP,
  comparativo,
}: PIDashboardAlimentaProps) => {
  const { loading, error, filteredData, data, agencia } = useCampaign();

  const [periodFilter, setPeriodFilter] = useState<'7days' | 'all'>('7days');
  const [comparisonMode, setComparisonMode] = useState<'benchmark' | 'previous'>('benchmark');
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  // PI desta página (o PIInfoCard recebe as linhas prontas, em vez de buscá-las de novo)
  const lp = useLandingPagePI({
    dados: filteredData,
    clientSlug,
    campaignSlug,
    piSlug,
    campanhaGA4,
    periodoGA4: periodoLP,
  });

  // PI anterior, só para o comparativo da landing page
  const lpAnterior = useLandingPagePI({
    dados: data,
    clientSlug,
    campaignSlug,
    piSlug: comparativo?.piSlug ?? null,
    campanhaGA4,
    periodoGA4: comparativo?.periodoLP ?? periodoLP,
  });

  const { piData, piInfo, ga4, resumoBonificacao } = lp;
  const carregandoPIeLP = lp.carregando;

  const clientName = useMemo(() => {
    const found = data.find(d => toSlug(d.cliente || '') === clientSlug);
    return found?.cliente || clientSlug.toUpperCase();
  }, [data, clientSlug]);

  const campaignName = useMemo(() => {
    const found = data.find(
      d => toSlug(d.cliente || '') === clientSlug && toSlug(d.campanha || '') === campaignSlug
    );
    return found?.campanha || campaignSlug;
  }, [data, clientSlug, campaignSlug]);

  const maxAvailableDate = useMemo(() => {
    if (piData.length === 0) return startOfDay(new Date());
    return startOfDay(new Date(Math.max(...piData.map(d => d.date.getTime()))));
  }, [piData]);

  const sevenDaysAgoFromMaxDate = useMemo(
    () => startOfDay(subDays(maxAvailableDate, 7)),
    [maxAvailableDate]
  );

  const minAvailableDate = useMemo(() => {
    if (piData.length === 0) return new Date();
    return new Date(Math.min(...piData.map(d => d.date.getTime())));
  }, [piData]);

  // Impressões do PI anterior nos mesmos dias de campanha que estão na tela.
  // Os PIs começam em datas diferentes (1952 no meio de setembro, 1953 no dia 1º),
  // então o alinhamento é pelo dia de campanha, a partir do primeiro dia com entrega:
  // os dias 1 a 4 de um contra os dias 1 a 4 do outro.
  const comparativoImpressoes = useMemo(() => {
    if (!comparativo) return undefined;

    const primeiroDiaComEntrega = (dados: typeof piData) => {
      const datas = dados.filter(i => i.impressions > 0).map(i => i.date.getTime());
      return datas.length > 0 ? startOfDay(new Date(Math.min(...datas))) : null;
    };

    const inicioAtual = primeiroDiaComEntrega(piData);
    const inicioAnterior = primeiroDiaComEntrega(lpAnterior.piData);
    if (!inicioAtual || !inicioAnterior) return undefined;

    // Mesma janela do displayData: últimos 7 dias ou todo o período, até o último dia com dados
    const janelaInicio =
      periodFilter === '7days' && sevenDaysAgoFromMaxDate > inicioAtual ? sevenDaysAgoFromMaxDate : inicioAtual;
    const diaInicial = differenceInCalendarDays(janelaInicio, inicioAtual);
    const diaFinal = differenceInCalendarDays(maxAvailableDate, inicioAtual);

    const de = addDays(inicioAnterior, diaInicial);
    const ate = addDays(inicioAnterior, diaFinal);

    const impressoes = lpAnterior.piData
      .filter(i => i.date >= de && i.date <= ate)
      .filter(i => !selectedVehicle || i.veiculo === selectedVehicle)
      .reduce((s, i) => s + i.impressions, 0);

    return {
      rotulo: comparativo.periodoLP.rotulo,
      datas: `${format(de, 'dd/MM')}–${format(ate, 'dd/MM')}`,
      impressoes,
    };
  }, [comparativo, piData, lpAnterior.piData, periodFilter, sevenDaysAgoFromMaxDate, maxAvailableDate, selectedVehicle]);

  const generalBenchmarks = useMemo(() => {
    const totalImp = data.reduce((s, i) => s + i.impressions, 0);
    const totalClk = data.reduce((s, i) => s + i.clicks, 0);
    const totalVid = data.reduce((s, i) => s + i.videoCompletions, 0);
    const totalEng = data.reduce((s, i) => s + i.totalEngagements, 0);
    return {
      ctr: totalImp > 0 ? (totalClk / totalImp) * 100 : 0,
      vtr: totalImp > 0 ? (totalVid / totalImp) * 100 : 0,
      taxaEngajamento: totalImp > 0 ? (totalEng / totalImp) * 100 : 0,
    };
  }, [data]);

  const vehicleBenchmarks = useMemo(() => {
    const map = new Map<string, { ctr: number; vtr: number; taxaEngajamento: number }>();
    const vMap = new Map<string, { imp: number; clk: number; vid: number; eng: number }>();
    data.forEach(item => {
      if (!item.veiculo) return;
      const e = vMap.get(item.veiculo) ?? { imp: 0, clk: 0, vid: 0, eng: 0 };
      e.imp += item.impressions; e.clk += item.clicks;
      e.vid += item.videoCompletions; e.eng += item.totalEngagements;
      vMap.set(item.veiculo, e);
    });
    vMap.forEach((e, v) => {
      map.set(v, {
        ctr: e.imp > 0 ? (e.clk / e.imp) * 100 : 0,
        vtr: e.imp > 0 ? (e.vid / e.imp) * 100 : 0,
        taxaEngajamento: e.imp > 0 ? (e.eng / e.imp) * 100 : 0,
      });
    });
    return map;
  }, [data]);

  // CPL = investimento efetivamente cobrado (já travado no teto) ÷ leads da LP no mês do PI
  const lpMetrics = useMemo(() => ({
    sessoes: ga4?.sessoes ?? 0,
    leads: ga4?.leads ?? 0,
    cpl: lp.cpl,
    carregando: carregandoPIeLP,
    investimentoBase: resumoBonificacao.realizado,
    bonificacao: resumoBonificacao.bonificacao,
    rotuloPeriodo: periodoLP.rotulo,
    comparativo: comparativo
      ? {
          piSlug: comparativo.piSlug,
          rotulo: comparativo.periodoLP.rotulo,
          carregando: lpAnterior.carregando,
          sessoes: lpAnterior.ga4?.sessoes ?? 0,
          leads: lpAnterior.ga4?.leads ?? 0,
          cpl: lpAnterior.cpl,
          investimentoBase: lpAnterior.resumoBonificacao.realizado,
        }
      : undefined,
  }), [ga4, lp.cpl, carregandoPIeLP, resumoBonificacao, periodoLP.rotulo, comparativo, lpAnterior]);

  // Cada linha de mídia ganha o custo já travado no teto e os leads da LP do seu
  // criativo (cruzados por veículo e por dia), para a tabela de criativos
  const piDataComLeads = useMemo(
    () =>
      atribuirLeadsAosCriativos(
        aplicarTetoAosItens(piData, resumoBonificacao.linhas),
        ga4?.porCriativo ?? []
      ).itens,
    [piData, resumoBonificacao, ga4]
  );

  const displayData = useMemo(() => {
    let d = piDataComLeads;
    if (periodFilter === '7days') d = d.filter(i => i.date >= sevenDaysAgoFromMaxDate);
    if (selectedVehicle) d = d.filter(i => i.veiculo === selectedVehicle);
    return d;
  }, [piDataComLeads, periodFilter, sevenDaysAgoFromMaxDate, selectedVehicle]);

  const previousPeriodMetrics = useMemo(() => {
    if (periodFilter !== '7days') return null;
    const fourteenDaysAgo = startOfDay(subDays(maxAvailableDate, 14));
    const prev = piDataComLeads.filter(i => i.date >= fourteenDaysAgo && i.date < sevenDaysAgoFromMaxDate);
    // Mesmo critério do período atual: investimento travado no teto
    const totalInv = prev.reduce((s, i) => s + (i.custoCobrado ?? i.cost), 0);
    const totalImp = prev.reduce((s, i) => s + i.impressions, 0);
    const totalClk = prev.reduce((s, i) => s + i.clicks, 0);
    const totalVid = prev.reduce((s, i) => s + i.videoViews, 0);
    const totalEng = prev.reduce((s, i) => s + i.totalEngagements, 0);
    const totalVidC = prev.reduce((s, i) => s + i.videoCompletions, 0);
    return {
      investimento: totalInv, investimentoReal: 0,
      impressoes: totalImp, cliques: totalClk, views: totalVid, engajamento: totalEng,
      cpm: totalImp > 0 ? (totalInv / totalImp) * 1000 : 0,
      cpc: totalClk > 0 ? totalInv / totalClk : 0,
      cpv: totalVid > 0 ? totalInv / totalVid : 0,
      cpe: totalEng > 0 ? totalInv / totalEng : 0,
      ctr: totalImp > 0 ? (totalClk / totalImp) * 100 : 0,
      vtr: totalImp > 0 ? (totalVidC / totalImp) * 100 : 0,
      taxaEngajamento: totalImp > 0 ? (totalEng / totalImp) * 100 : 0,
    };
  }, [piDataComLeads, periodFilter, maxAvailableDate, sevenDaysAgoFromMaxDate]);

  // O card de investimento mostra o realizado (até o teto contratado) e a bonificação
  // separados. Num recorte de período ou veículo, o teto se divide na proporção do que
  // cada linha veiculou — o mesmo critério do CPL dos criativos.
  const displayMetrics = useMemo(() => {
    const totalInv = displayData.reduce((s, i) => s + (i.custoCobrado ?? i.cost), 0);
    const totalInvR = displayData.reduce((s, i) => s + (i.realInvestment || 0), 0);
    const totalImp = displayData.reduce((s, i) => s + i.impressions, 0);
    const totalClk = displayData.reduce((s, i) => s + i.clicks, 0);
    const totalVid = displayData.reduce((s, i) => s + i.videoViews, 0);
    const totalEng = displayData.reduce((s, i) => s + i.totalEngagements, 0);
    const totalVidC = displayData.reduce((s, i) => s + i.videoCompletions, 0);
    return {
      investimento: totalInv, investimentoReal: totalInvR,
      impressoes: totalImp, cliques: totalClk, views: totalVid, engajamento: totalEng,
      cpm: totalImp > 0 ? (totalInv / totalImp) * 1000 : 0,
      cpc: totalClk > 0 ? totalInv / totalClk : 0,
      cpv: totalVid > 0 ? totalInv / totalVid : 0,
      cpe: totalEng > 0 ? totalInv / totalEng : 0,
      ctr: totalImp > 0 ? (totalClk / totalImp) * 100 : 0,
      vtr: totalImp > 0 ? (totalVidC / totalImp) * 100 : 0,
      taxaEngajamento: totalImp > 0 ? (totalEng / totalImp) * 100 : 0,
    };
  }, [displayData]);

  const investimentoBonificado = useMemo(
    () => displayData.reduce((s, i) => s + i.cost - (i.custoCobrado ?? i.cost), 0),
    [displayData]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f1f1f1] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#153ece]" />
          <p className="mt-4 text-gray-600">Carregando dados...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#f1f1f1] flex items-center justify-center">
        <p className="text-red-600 text-lg">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f1f1] relative">
      <ParticlesBackground />
      <div className="relative z-10 max-w-[1440px] mx-auto px-3 sm:px-6 pt-3 sm:pt-6 pb-3 sm:pb-6">
        <PIHeader
          clientName={clientName}
          campaignName={campaignName}
          piNumber={piSlug}
          agencia={agencia}
        />

        <main>
          <div className="space-y-6">

            <div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-2">
                <h2 className="text-xs sm:text-sm font-medium text-gray-600">
                  Resultados{' '}
                  <span className="text-gray-400 font-normal">
                    {format(periodFilter === '7days' ? sevenDaysAgoFromMaxDate : minAvailableDate, 'dd/MM/yyyy')} à {format(maxAvailableDate, 'dd/MM/yyyy')}
                  </span>
                </h2>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4 w-full sm:w-auto">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button
                      onClick={() => setPeriodFilter('7days')}
                      className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 ${
                        periodFilter === '7days'
                          ? 'bg-green-600 text-white shadow-md hover:bg-green-700'
                          : 'bg-white/60 backdrop-blur-md text-gray-700 border border-gray-200/50 hover:bg-white/80'
                      }`}
                    >
                      <span className="hidden sm:inline">Últimos 7 dias</span>
                      <span className="sm:hidden">7 dias</span>
                    </button>
                    <button
                      onClick={() => setPeriodFilter('all')}
                      className={`flex-1 sm:flex-none px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 ${
                        periodFilter === 'all'
                          ? 'bg-green-600 text-white shadow-md hover:bg-green-700'
                          : 'bg-white/60 backdrop-blur-md text-gray-700 border border-gray-200/50 hover:bg-white/80'
                      }`}
                    >
                      <span className="hidden sm:inline">Todo o período</span>
                      <span className="sm:hidden">Tudo</span>
                    </button>
                  </div>
                  {periodFilter === '7days' && (
                    <>
                      <div className="hidden sm:block h-8 w-px bg-gradient-to-b from-transparent via-gray-300 to-transparent" />
                      <ComparisonToggle comparisonMode={comparisonMode} onModeChange={setComparisonMode} />
                    </>
                  )}
                </div>
              </div>

              <BigNumbers
                metrics={displayMetrics}
                filters={{ dateRange: { start: null, end: null }, veiculo: [], tipoDeCompra: [], campanha: [], numeroPi: null }}
                periodFilter={periodFilter}
                generalBenchmarks={generalBenchmarks}
                comparisonMode={comparisonMode}
                previousPeriodMetrics={previousPeriodMetrics}
                selectedPI={piSlug}
                lpMetrics={lpMetrics}
                investimentoBonificado={investimentoBonificado}
                impressoesCompletas
                comparativoImpressoes={comparativoImpressoes}
              />
            </div>

            <PIInfoCard
              numeroPi={piSlug}
              campaignData={piData}
              piInfoExterno={piInfo}
              carregandoExterno={carregandoPIeLP}
              bonificacao
              leadsPorFonte={ga4?.fontes}
            />

            <div className="h-[420px]">
              <ImpressionsChart
                data={piData}
                allData={piData}
                periodFilter={periodFilter}
                comparisonMode={comparisonMode}
                showComparison={periodFilter === '7days'}
                maxAvailableDate={maxAvailableDate}
                sevenDaysAgoFromMaxDate={sevenDaysAgoFromMaxDate}
              />
            </div>

            <VehicleMetrics
              data={displayData}
              selectedCampaign={null}
              periodFilter={periodFilter}
              vehicleBenchmarks={vehicleBenchmarks}
              selectedVehicle={selectedVehicle}
              onSelectVehicle={setSelectedVehicle}
              selectedPI={piSlug}
            />

            <CreativePerformance data={displayData} mostrarLeads />
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
};

const PIDashboardAlimenta = (props: PIDashboardAlimentaProps) => (
  <CampaignProvider>
    <PIDashboardAlimentaContent {...props} />
  </CampaignProvider>
);

export default PIDashboardAlimenta;
