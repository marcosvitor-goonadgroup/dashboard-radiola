import { CampaignMetrics, Filters } from '../types/campaign';
import BenchmarkIndicator from './BenchmarkIndicator';
import AnimatedNumber from './AnimatedNumber';
import MetricThermometer from './MetricThermometer';

interface BigNumbersProps {
  metrics: CampaignMetrics;
  filters?: Filters;
  periodFilter?: '7days' | 'all';
  generalBenchmarks?: {
    ctr: number;
    vtr: number;
    taxaEngajamento: number;
  };
  comparisonMode?: 'benchmark' | 'previous';
  previousPeriodMetrics?: CampaignMetrics | null;
  selectedPI?: string | null;
  /** Métricas da landing page (GA4). Quando ausente, a linha mantém os 5 cards de sempre. */
  lpMetrics?: {
    sessoes: number;
    leads: number;
    cpl: number;
    carregando?: boolean;
    /** Investimento usado no CPL. Quando informado, o CPL ganha um tooltip com a conta. */
    investimentoBase?: number;
    /** Excedente bonificado que ficou fora do CPL, explicado no tooltip */
    bonificacao?: number;
  } | null;
  /**
   * Excedente veiculado além do teto contratado. Quando informado, `metrics.investimento`
   * deve vir já travado no teto: o card passa a se chamar "Investimento realizado" e
   * mostra a bonificação separada, para ninguém somar as duas coisas.
   */
  investimentoBonificado?: number;
}

const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)} mi`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)} mil`;
  }
  return num.toFixed(0);
};

const formatCurrency = (num: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(num);
};

const BigNumbers = ({
  metrics,
  filters,
  periodFilter = 'all',
  generalBenchmarks,
  comparisonMode = 'benchmark',
  previousPeriodMetrics,
  selectedPI,
  lpMetrics,
  investimentoBonificado
}: BigNumbersProps) => {
  // Detecta se há filtros ativos
  const hasActiveFilters = () => {
    if (!filters) return false;

    // Verifica se o período não é "Todo o período" (all)
    if (periodFilter === '7days') return true;

    // Verifica se há filtros de data
    if (filters.dateRange.start || filters.dateRange.end) return true;

    // Verifica se há filtros de veículo, tipo de compra ou campanha
    if (filters.veiculo.length > 0 || filters.tipoDeCompra.length > 0 || filters.campanha.length > 0) {
      return true;
    }

    // Verifica se há PI selecionado
    if (selectedPI) {
      return true;
    }

    return false;
  };

  const showComparison = hasActiveFilters();

  // Helper para calcular comparação com período anterior
  const getComparisonData = (_currentValue: number, metric: keyof CampaignMetrics) => {
    if (comparisonMode === 'previous' && previousPeriodMetrics) {
      const previousValue = previousPeriodMetrics[metric] as number;
      return {
        benchmark: previousValue,
        hidePercentageDiff: false // Mostra a % de diferença quando comparando com período anterior
      };
    }
    // Modo benchmark
    return {
      benchmark: metric === 'ctr' ? (generalBenchmarks?.ctr ?? 0) :
                 metric === 'vtr' ? (generalBenchmarks?.vtr ?? 0) :
                 metric === 'taxaEngajamento' ? (generalBenchmarks?.taxaEngajamento ?? 0) :
                 0,
      hidePercentageDiff: true // Oculta a % de diferença quando comparando com benchmark
    };
  };

  const investimentoComparison = getComparisonData(metrics.investimento, 'investimento');
  const impressoesComparison = getComparisonData(metrics.impressoes, 'impressoes');
  const viewsComparison = getComparisonData(metrics.views, 'views');
  const vtrComparison = getComparisonData(metrics.vtr, 'vtr');
  const engajamentoComparison = getComparisonData(metrics.engajamento, 'engajamento');
  const taxaEngajamentoComparison = getComparisonData(metrics.taxaEngajamento, 'taxaEngajamento');
  const cliquesComparison = getComparisonData(metrics.cliques, 'cliques');
  const ctrComparison = getComparisonData(metrics.ctr, 'ctr');

  // Sempre usa o gasto real (cost) reportado na planilha — ou, com bonificação,
  // o gasto já travado no teto contratado
  const displayInvestment = metrics.investimento;
  const comBonificacao = investimentoBonificado !== undefined;

  return (
    <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 ${lpMetrics ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
      {/* Investimento - usando valor real */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1">
          {comBonificacao ? 'Investimento realizado' : 'Investimento'}
        </p>
        <p className="text-base sm:text-2xl font-bold text-blue-900 leading-tight">
          <AnimatedNumber
            value={displayInvestment}
            formatter={formatCurrency}
            duration={2000}
          />
        </p>
        {comparisonMode === 'previous' && showComparison && previousPeriodMetrics && (
          <div className="mt-2">
            <BenchmarkIndicator
              value={displayInvestment}
              benchmark={investimentoComparison.benchmark}
              format="number"
              showComparison={true}
              hidePercentageDiff={investimentoComparison.hidePercentageDiff}
              compactMode={true}
            />
          </div>
        )}
        {comBonificacao && investimentoBonificado! > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-100">
            <p className="text-xs text-amber-700 mb-1">Bonificação</p>
            <p className="text-sm font-bold text-amber-700">
              {formatCurrency(investimentoBonificado!)}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">
              Entregue além do contratado, sem custo
            </p>
          </div>
        )}
      </div>

      {/* Impressões - agora com comparação */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1">
          Impressões
        </p>
        <p className="text-base sm:text-2xl font-bold text-blue-700 leading-tight">
          <AnimatedNumber
            value={metrics.impressoes}
            formatter={formatNumber}
            duration={2000}
          />
        </p>
        {comparisonMode === 'previous' && showComparison && previousPeriodMetrics && (
          <div className="mt-2">
            <BenchmarkIndicator
              value={metrics.impressoes}
              benchmark={impressoesComparison.benchmark}
              format="number"
              showComparison={true}
              hidePercentageDiff={impressoesComparison.hidePercentageDiff}
              compactMode={true}
            />
          </div>
        )}
      </div>

      {/* Views com VTR */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1">
          Views
        </p>
        <p className="text-base sm:text-2xl font-bold text-blue-600 leading-tight">
          <AnimatedNumber
            value={metrics.views}
            formatter={formatNumber}
            duration={2000}
          />
        </p>
        {comparisonMode === 'previous' && showComparison && previousPeriodMetrics && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 mb-1">Views</p>
            <BenchmarkIndicator
              value={metrics.views}
              benchmark={viewsComparison.benchmark}
              format="number"
              showComparison={true}
              hidePercentageDiff={viewsComparison.hidePercentageDiff}
              compactMode={true}
            />
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">VTR</p>
          <BenchmarkIndicator
            value={metrics.vtr}
            benchmark={vtrComparison.benchmark}
            format="percentage"
            showComparison={showComparison}
            hidePercentageDiff={vtrComparison.hidePercentageDiff}
          />
          {showComparison && periodFilter === '7days' && (
            <MetricThermometer
              currentValue={metrics.vtr}
              benchmarkValue={vtrComparison.benchmark}
              metricName="VTR"
            />
          )}
        </div>
      </div>

      {/* Engajamento com Taxa de Engajamento */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1">
          Engajamento
        </p>
        <p className="text-base sm:text-2xl font-bold text-blue-500 leading-tight">
          <AnimatedNumber
            value={metrics.engajamento}
            formatter={formatNumber}
            duration={2000}
          />
        </p>
        {comparisonMode === 'previous' && showComparison && previousPeriodMetrics && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 mb-1">Engajamento</p>
            <BenchmarkIndicator
              value={metrics.engajamento}
              benchmark={engajamentoComparison.benchmark}
              format="number"
              showComparison={true}
              hidePercentageDiff={engajamentoComparison.hidePercentageDiff}
              compactMode={true}
            />
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">Taxa Engajamento</p>
          <BenchmarkIndicator
            value={metrics.taxaEngajamento}
            benchmark={taxaEngajamentoComparison.benchmark}
            format="percentage"
            showComparison={showComparison}
            hidePercentageDiff={taxaEngajamentoComparison.hidePercentageDiff}
          />
          {showComparison && periodFilter === '7days' && (
            <MetricThermometer
              currentValue={metrics.taxaEngajamento}
              benchmarkValue={taxaEngajamentoComparison.benchmark}
              metricName="Taxa Engajamento"
            />
          )}
        </div>
      </div>

      {/* Cliques com CTR */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
        <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1">
          Cliques
        </p>
        <p className="text-base sm:text-2xl font-bold text-blue-400 leading-tight">
          <AnimatedNumber
            value={metrics.cliques}
            formatter={formatNumber}
            duration={2000}
          />
        </p>
        {comparisonMode === 'previous' && showComparison && previousPeriodMetrics && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 mb-1">Cliques</p>
            <BenchmarkIndicator
              value={metrics.cliques}
              benchmark={cliquesComparison.benchmark}
              format="number"
              showComparison={true}
              hidePercentageDiff={cliquesComparison.hidePercentageDiff}
              compactMode={true}
            />
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-500 mb-1">CTR</p>
          <BenchmarkIndicator
            value={metrics.ctr}
            benchmark={ctrComparison.benchmark}
            format="percentage"
            showComparison={showComparison}
            hidePercentageDiff={ctrComparison.hidePercentageDiff}
          />
          {showComparison && periodFilter === '7days' && (
            <MetricThermometer
              currentValue={metrics.ctr}
              benchmarkValue={ctrComparison.benchmark}
              metricName="CTR"
            />
          )}
        </div>
      </div>

      {/* Landing page: sessões, leads e CPL vindos do GA4 */}
      {lpMetrics && (
        <div className="bg-white rounded-lg border border-[#153ece]/30 p-3 sm:p-4">
          <p className="text-[10px] sm:text-xs font-medium text-gray-500 mb-1">
            Sessões <span className="text-gray-400 font-normal">LP</span>
          </p>
          <p className="text-base sm:text-2xl font-bold text-[#153ece] leading-tight">
            {lpMetrics.carregando ? (
              <span className="text-gray-300">—</span>
            ) : (
              <AnimatedNumber value={lpMetrics.sessoes} formatter={formatNumber} duration={2000} />
            )}
          </p>
          <div className="mt-2 pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-1">Leads gerados</p>
            <p className="text-sm font-bold text-gray-800">
              {lpMetrics.carregando ? '—' : formatNumber(lpMetrics.leads)}
            </p>
          </div>
          {(() => {
            const temConta =
              !lpMetrics.carregando && lpMetrics.leads > 0 && lpMetrics.investimentoBase !== undefined;
            const valorCPL = lpMetrics.carregando || lpMetrics.leads === 0 ? '—' : formatCurrency(lpMetrics.cpl);

            if (!temConta) {
              return (
                <div className="mt-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-500 mb-1">CPL</p>
                  <p className="text-sm font-bold text-gray-800">{valorCPL}</p>
                </div>
              );
            }

            const bonificacao = lpMetrics.bonificacao ?? 0;

            return (
              // tabIndex: no celular não há hover, o toque foca o bloco e abre o tooltip
              <div
                tabIndex={0}
                className="group relative mt-2 pt-2 border-t border-gray-100 cursor-help outline-none"
                aria-describedby="lp-cpl-calculo"
              >
                <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                  CPL
                  <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-[#153ece] group-focus:text-[#153ece] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </p>
                <p className="text-sm font-bold text-gray-800 underline decoration-dotted decoration-gray-300 underline-offset-4">
                  {valorCPL}
                </p>

                <div
                  id="lp-cpl-calculo"
                  role="tooltip"
                  className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 transition-opacity duration-150 absolute right-0 bottom-full mb-2 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-gray-900 text-white text-xs p-3 shadow-xl"
                >
                  <p className="font-semibold mb-2">Como este CPL é calculado</p>

                  <div className="space-y-1">
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-300">Investimento considerado</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(lpMetrics.investimentoBase!)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-gray-300">÷ Leads gerados</span>
                      <span className="font-semibold tabular-nums">
                        {new Intl.NumberFormat('pt-BR').format(lpMetrics.leads)}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3 pt-1 mt-1 border-t border-white/20">
                      <span className="text-gray-300">= CPL</span>
                      <span className="font-bold tabular-nums">{formatCurrency(lpMetrics.cpl)}</span>
                    </div>
                  </div>

                  <p className="mt-2 pt-2 border-t border-white/20 text-gray-300 leading-relaxed">
                    O investimento é o realizado até o teto contratado do PI.
                    {bonificacao > 0 && (
                      <> Os {formatCurrency(bonificacao)} veiculados além do contratado são bonificação e não entram na conta.</>
                    )}
                    {' '}Leads são as inscrições concluídas na landing page (GA4) em todo o período do PI.
                  </p>

                  {/* Seta apontando para o CPL */}
                  <span className="absolute -bottom-1 right-6 w-2 h-2 rotate-45 bg-gray-900" />
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default BigNumbers;
