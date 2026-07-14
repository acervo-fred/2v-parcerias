/* ============================================================
   Período de um lançamento: tipo (duração) + início + fim.

   Regra de ouro: o tipo escolhido MANDA — fim e rótulo são
   calculados a partir dele, pra todo lançamento ter um intervalo
   real (não só uma data solta) e o Dashboard poder filtrar por
   sobreposição de período com confiança.

   "Personalizado" é a única exceção: início e fim são livres,
   escolhidos à mão.
   ============================================================ */

import { formatDataBR } from "../ui/dom.js";

export const PERIODO_TIPOS = ["Dia", "Semana", "Mês", "Personalizado"];
export const PERIODO_MAP = { Dia: "dia", Semana: "semana", "Mês": "mes", Personalizado: "personalizado" };
const MES_NOMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export function rotuloTipoAtual(tipo) {
  return Object.entries(PERIODO_MAP).find(([, v]) => v === tipo)?.[0] || "Semana";
}

function parseISO(iso) {
  const [y, m, d] = (iso || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function toISO(dt) {
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/* Fim do período a partir do tipo + início. "Personalizado" devolve ""
   (o usuário escolhe à mão) — nos outros tipos, sempre calculado. */
export function calcularDataFim(tipo, dataInicio) {
  if (!dataInicio) return "";
  if (tipo === "personalizado") return "";
  const dt = parseISO(dataInicio);
  if (tipo === "dia") return dataInicio;
  if (tipo === "semana") { dt.setDate(dt.getDate() + 6); return toISO(dt); }
  if (tipo === "mes") { const fim = new Date(dt.getFullYear(), dt.getMonth() + 1, 0); return toISO(fim); }
  return dataInicio;
}

/* Rótulo legível a partir do tipo + intervalo — sempre acompanha o
   tipo escolhido, pra não ficar dessincronizado do período real. */
export function calcularRotulo(tipo, dataInicio, dataFim) {
  if (!dataInicio) return "";
  if (tipo === "dia") return formatDataBR(dataInicio);
  if (tipo === "mes") {
    const [y, m] = dataInicio.split("-");
    return `${MES_NOMES[parseInt(m, 10) - 1]}/${y}`;
  }
  if (!dataFim || dataFim === dataInicio) return formatDataBR(dataInicio);
  const inicioFmt = formatDataBR(dataInicio);
  const fimFmt = formatDataBR(dataFim);
  const inicioCurto = dataInicio.slice(0, 4) === dataFim.slice(0, 4) ? inicioFmt.slice(0, 5) : inicioFmt;
  if (tipo === "semana") return `Semana de ${inicioCurto} a ${fimFmt}`;
  return `${inicioCurto} – ${fimFmt}`;
}

/* Overlap entre o intervalo do lançamento e o período [de, ate]
   escolhido no Dashboard — em vez de comparar uma única data,
   garante que qualquer lançamento cujo período toque o filtro
   selecionado apareça (ex.: semana que cruza a virada do mês). */
export function lancamentoNoPeriodo(l, de, ate) {
  const inicio = l.dataInicio || "";
  const fim = l.dataFim || inicio;
  if (!inicio) return false;
  if (de && fim < de) return false;
  if (ate && inicio > ate) return false;
  return true;
}
