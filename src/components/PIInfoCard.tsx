import { useEffect, useState, useMemo } from 'react';
import { PIInfo, ProcessedCampaignData } from '../types/campaign';
import { fetchPIInfo } from '../services/api';
import { parse, isValid, differenceInDays } from 'date-fns';
import {
  agruparVeiculacaoPI,
  aplicarBonificacao,
  calcularTotaisRealizados,
  parseValorPI,
  VeiculacaoBonificada,
} from '../utils/piMatching';
import { GA4Fonte, metricasDoVeiculoPI } from '../services/ga4';

interface PIInfoCardProps {
  numeroPi: string | null;
  campaignData?: ProcessedCampaignData[];
  /** Linhas do PI já carregadas pelo pai — evita uma segunda busca na planilha */
  piInfoExterno?: PIInfo[] | null;
  /** Acompanha o carregamento do pai quando as linhas vêm de fora */
  carregandoExterno?: boolean;
  /** Trava o realizado no investimento contratado e exibe o excedente como bonificação */
  bonificacao?: boolean;
  /** Leads do GA4 por origem, para atribuir a cada veículo do PI */
  leadsPorFonte?: GA4Fonte[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

const fmtNum = (n: number) => new Intl.NumberFormat('pt-BR').format(Math.round(n));

const PIInfoCard = ({
  numeroPi,
  campaignData = [],
  piInfoExterno,
  carregandoExterno = false,
  bonificacao = false,
  leadsPorFonte,
}: PIInfoCardProps) => {
  const [piInfoBuscado, setPiInfoBuscado] = useState<PIInfo[] | null>(null);
  const [loadingBusca, setLoadingBusca] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const usaPiExterno = piInfoExterno !== undefined;
  const piInfo = usaPiExterno ? piInfoExterno : piInfoBuscado;
  const loading = usaPiExterno ? carregandoExterno : loadingBusca;

  // Pacing temporal: % dos dias decorridos no período do PI
  const pacingExpected = useMemo(() => {
    if (!piInfo || piInfo.length === 0) return null;
    const info = piInfo[0];
    if (!info.inicio || !info.fim) return null;
    const start = parse(info.inicio, 'dd/MM/yyyy', new Date());
    const end = parse(info.fim, 'dd/MM/yyyy', new Date());
    if (!isValid(start) || !isValid(end)) return null;
    const totalDays = differenceInDays(end, start) + 1;
    if (totalDays <= 0) return null;
    const daysElapsed = Math.min(Math.max(differenceInDays(new Date(), start) + 1, 0), totalDays);
    return { percentElapsed: daysElapsed / totalDays, daysElapsed, totalDays };
  }, [piInfo]);

  // Totais realizados de TODA a campaignData filtrada (já filtrada por PI no pai)
  const totaisRealizados = useMemo(
    () => calcularTotaisRealizados(campaignData),
    [campaignData]
  );

  // Detalhamento por veículo+tipo do PI, cruzado com os dados realizados
  const veiculacaoPorVeiculoTipo = useMemo(
    () => agruparVeiculacaoPI(piInfo, campaignData, totaisRealizados),
    [campaignData, piInfo, totaisRealizados]
  );

  // Teto contratado por veículo: o que passou disso vira bonificação
  const resumoBonificacao = useMemo(
    () => (bonificacao ? aplicarBonificacao(veiculacaoPorVeiculoTipo, totaisRealizados) : null),
    [bonificacao, veiculacaoPorVeiculoTipo, totaisRealizados]
  );

  useEffect(() => {
    if (usaPiExterno) return;
    if (!numeroPi) { setPiInfoBuscado(null); return; }
    setLoadingBusca(true);
    fetchPIInfo(numeroPi)
      .then(setPiInfoBuscado)
      .catch(() => setPiInfoBuscado(null))
      .finally(() => setLoadingBusca(false));
  }, [numeroPi, usaPiExterno]);

  if (!numeroPi) return null;

  if (loading) {
    return (
      <div className="bg-white rounded-[24px] p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#153ece]" />
          <span className="ml-3 text-gray-600">Carregando informações do PI...</span>
        </div>
      </div>
    );
  }

  if (!piInfo || piInfo.length === 0) {
    return (
      <div className="bg-white rounded-[24px] p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">Informações do PI {numeroPi}</h3>
        <p className="text-gray-500">Nenhuma informação encontrada para este PI.</p>
      </div>
    );
  }

  const firstInfo = piInfo[0];
  const totalInvestimento = piInfo.reduce((sum, info) => sum + parseValorPI(info.totalBruto), 0);
  const pacingInvestPrevisto = totalInvestimento * (pacingExpected?.percentElapsed ?? 1);
  // Com bonificação ativa o cliente só é cobrado até o teto — é esse o valor que conta
  const realizadoExibido = resumoBonificacao?.realizado ?? totaisRealizados.realizado;
  const pacingOk = realizadoExibido >= pacingInvestPrevisto;

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-[24px] shadow-lg border border-blue-200 overflow-hidden">
      {/* Header */}
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-800">PI {numeroPi}</h3>
          <div className="flex items-center gap-2">
            {firstInfo.status && (
              <span className="px-3 py-1 bg-[#153ece] text-white text-xs font-semibold rounded-full">
                {firstInfo.status}
              </span>
            )}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 hover:bg-blue-100 rounded-lg transition-colors"
            >
              <svg
                className={`w-5 h-5 text-gray-600 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Período + Investimento */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 mb-1">Período</p>
            <p className="text-sm font-semibold text-gray-800">{firstInfo.inicio} a {firstInfo.fim}</p>
            {pacingExpected && (
              <p className="text-xs text-gray-400 mt-1">
                Dia {pacingExpected.daysElapsed} de {pacingExpected.totalDays}
                {' '}({(pacingExpected.percentElapsed * 100).toFixed(0)}% decorrido)
              </p>
            )}
          </div>

          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 mb-1">Investimento Contratado</p>
            <p className="text-sm font-semibold text-gray-800">{fmt(totalInvestimento)}</p>
            {pacingExpected && (
              <p className="text-xs text-gray-400 mt-0.5">
                Esperado hoje: <span className="font-medium text-gray-600">{fmt(pacingInvestPrevisto)}</span>
                {' '}({(pacingExpected.percentElapsed * 100).toFixed(0)}%)
              </p>
            )}
            {totaisRealizados.realizado > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="flex justify-between items-center mb-1">
                  <p className="text-xs text-gray-500">Realizado</p>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-lg ${pacingOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {pacingOk ? '✓ Pacing ok' : '! Abaixo do pacing'}
                  </span>
                </div>
                <p className={`text-sm font-semibold ${pacingOk ? 'text-green-700' : 'text-red-700'}`}>
                  {fmt(realizadoExibido)}
                  <span className="text-xs ml-1 font-normal text-gray-500">
                    ({totalInvestimento > 0 ? ((realizadoExibido / totalInvestimento) * 100).toFixed(1) : '0.0'}% do total)
                  </span>
                </p>
                {resumoBonificacao && resumoBonificacao.bonificacao > 0 && (
                  <div className="mt-2 pt-2 border-t border-dashed border-amber-300">
                    <div className="flex justify-between items-center">
                      <p className="text-xs text-amber-700 font-medium">Bonificação</p>
                      <span className="px-2 py-0.5 text-[10px] font-semibold rounded-lg bg-amber-100 text-amber-700">
                        entregue sem custo
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-amber-700">
                      {fmt(resumoBonificacao.bonificacao)}
                      <span className="text-xs ml-1 font-normal text-gray-500">
                        (veiculado {fmt(resumoBonificacao.realizadoBruto)})
                      </span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Objetivo */}
        {firstInfo.objetivo && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 mb-2">Objetivo</p>
            <p className="text-sm text-gray-700 leading-relaxed">{firstInfo.objetivo}</p>
          </div>
        )}
      </div>

      {/* Conteúdo expansível */}
      <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? 'max-h-[3000px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="px-6 pb-6 space-y-4">

          {/* Detalhamento por Veículo */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500 mb-3">Detalhamento por Veículo</p>
            <div className="space-y-4">
              {(resumoBonificacao?.linhas ?? veiculacaoPorVeiculoTipo).map((item, index) => {
                const isCPM = item.tipoDeCompra.toUpperCase().includes('CPM');
                const isCPC = item.tipoDeCompra.toUpperCase().includes('CPC');
                const pacingPrevisto = item.previsto * (pacingExpected?.percentElapsed ?? 1);
                // Com bonificação, o realizado do veículo é o valor travado no teto
                const linhaBonificada = resumoBonificacao ? (item as VeiculacaoBonificada) : null;
                const realizadoLinha = linhaBonificada ? linhaBonificada.realizadoConsiderado : item.realizado;
                const bonificacaoLinha = linhaBonificada?.bonificacao ?? 0;
                const volumeBonificado = linhaBonificada?.volumeBonificado ?? 0;
                const investOk = realizadoLinha >= pacingPrevisto;
                const ga4Veiculo = leadsPorFonte ? metricasDoVeiculoPI(item.veiculo, leadsPorFonte) : null;

                const volumeRealizado = isCPM ? item.impressoesRealizadas : isCPC ? item.cliquesRealizados : 0;
                const volumePacingPrevisto = item.quantidade * (pacingExpected?.percentElapsed ?? 1);
                const volumePercent = item.quantidade > 0 ? Math.min((volumeRealizado / item.quantidade) * 100, 100) : 0;
                const volumePacingPercent = item.quantidade > 0 ? Math.min((volumePacingPrevisto / item.quantidade) * 100, 100) : 0;
                const volumeOk = volumeRealizado >= volumePacingPrevisto;

                return (
                  <div key={index} className="border-l-4 border-[#153ece] pl-3 py-2 bg-gray-50 rounded-xl">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">{item.veiculo}</p>
                        <p className="text-xs text-gray-500">{item.tipoDeCompra}</p>
                      </div>
                      <div className="flex gap-1">
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded-lg ${investOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {investOk ? '✓ Invest.' : '! Invest.'}
                        </span>
                        {(isCPM || isCPC) && item.quantidade > 0 && (
                          <span className={`px-2 py-0.5 text-xs font-semibold rounded-lg ${volumeOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {volumeOk ? `✓ ${isCPM ? 'Impr.' : 'Cliques'}` : `! ${isCPM ? 'Impr.' : 'Cliques'}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Investimento */}
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <p className="text-xs text-gray-500">Invest. Contratado</p>
                        <p className="text-sm font-semibold text-gray-700">{fmt(item.previsto)}</p>
                        {pacingExpected && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Esperado: <span className="font-medium">{fmt(pacingPrevisto)}</span>
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Invest. Realizado</p>
                        <p className={`text-sm font-semibold ${investOk ? 'text-green-700' : 'text-red-700'}`}>
                          {fmt(realizadoLinha)}
                          {item.previsto > 0 && (
                            <span className="text-xs ml-1 font-normal">({((realizadoLinha / item.previsto) * 100).toFixed(1)}%)</span>
                          )}
                        </p>
                        {bonificacaoLinha > 0 && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            Bonificação: <span className="font-semibold">{fmt(bonificacaoLinha)}</span>
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Leads da landing page atribuídos a este veículo */}
                    {ga4Veiculo && (
                      <div className="grid grid-cols-3 gap-3 mb-3 pb-3 border-b border-gray-200">
                        <div>
                          <p className="text-xs text-gray-500">Sessões LP</p>
                          <p className="text-sm font-semibold text-gray-700">{fmtNum(ga4Veiculo.sessoes)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Leads</p>
                          <p className="text-sm font-semibold text-[#153ece]">{fmtNum(ga4Veiculo.leads)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">CPL</p>
                          <p className="text-sm font-semibold text-gray-700">
                            {ga4Veiculo.leads > 0 ? fmt(realizadoLinha / ga4Veiculo.leads) : '—'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Barra de pacing de volume */}
                    {(isCPM || isCPC) && item.quantidade > 0 && (
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs text-gray-500">
                            {isCPM ? 'Impressões' : 'Cliques'} contratados:{' '}
                            <span className="font-medium text-gray-700">{fmtNum(item.quantidade)}</span>
                          </p>
                          <p className="text-xs font-medium text-gray-600">
                            {fmtNum(volumeRealizado)} ({volumePercent.toFixed(1)}%)
                          </p>
                        </div>
                        <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`absolute h-full rounded-full transition-all ${volumeOk ? 'bg-green-500' : 'bg-[#153ece]'}`}
                            style={{ width: `${volumePercent}%` }}
                          />
                          {pacingExpected && (
                            <div
                              className="absolute top-0 h-full w-0.5 bg-orange-400"
                              style={{ left: `${volumePacingPercent}%` }}
                              title={`Pacing esperado: ${fmtNum(volumePacingPrevisto)}`}
                            />
                          )}
                        </div>
                        {pacingExpected && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            Esperado hoje: <span className="font-medium">{fmtNum(volumePacingPrevisto)}</span>
                            {' '}— linha laranja na barra
                          </p>
                        )}
                        {volumeBonificado > 0 && (
                          <p className="text-xs text-amber-700 mt-0.5">
                            {fmtNum(volumeBonificado)} {isCPM ? 'impressões' : 'cliques'} além do contratado
                          </p>
                        )}
                        {isCPC && realizadoLinha > 0 && item.cliquesRealizados > 0 && (
                          <p className="text-xs text-gray-500 mt-1">
                            CPC Real: {fmt(realizadoLinha / item.cliquesRealizados)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Praça + Público */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {firstInfo.praca && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 mb-2">Praça</p>
                <p className="text-sm text-gray-700">{firstInfo.praca}</p>
              </div>
            )}
            {firstInfo.publico && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <p className="text-xs font-medium text-gray-500 mb-2">Público</p>
                <p className="text-sm text-gray-700">{firstInfo.publico}</p>
              </div>
            )}
          </div>

          {firstInfo.segmentacao && (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <p className="text-xs font-medium text-gray-500 mb-2">Segmentação</p>
              <p className="text-sm text-gray-700">{firstInfo.segmentacao}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PIInfoCard;
