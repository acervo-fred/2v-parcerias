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
export const MES_NOMES = [
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

/* Remove duplicidade: quando o mesmo parceiro (cupom) tem dois ou mais
   lançamentos com período SOBREPOSTO, mantém só um por grupo que se
   sobrepõe, descarta o resto. Não exige data de início/fim idênticas —
   cobre também o caso comum de um período mais curto contido dentro de
   um mais longo (ex.: um lançamento de "terça-feira" sozinho dentro de
   uma "semana" que também cobre aquele dia).

   Critério de desempate:
   1) período mais ESPECÍFICO (menor, em dias) vence — um lançamento de
      um dia é mais confiável que uma semana que só por acaso o cobre;
   2) em caso de empate no tamanho do período (ex.: dois lançamentos
      "semana" sobrepostos — relatório parcial e completo do mesmo
      intervalo), o de maior valor (cupom + total + uso somados) vence.

   Usado nas agregações (Dashboard, stats), nunca na listagem bruta da
   Base de Dados — lá o usuário precisa ver e poder excluir a duplicata
   manualmente se quiser. */
export function dedupLancamentos(lista) {
  const peso = (l) => (l.faturamentoCupom || 0) + (l.faturamentoTotal || 0) + (l.quantidadeUso || 0);
  const melhorEntre = (a, b) => {
    const spanA = spanDias(a.dataInicio, a.dataFim), spanB = spanDias(b.dataInicio, b.dataFim);
    if (spanA !== spanB) return spanA < spanB ? a : b;
    return peso(b) > peso(a) ? b : a;
  };
  const porParceiro = new Map();
  for (const l of lista) {
    if (!porParceiro.has(l.parceiroId)) porParceiro.set(l.parceiroId, []);
    porParceiro.get(l.parceiroId).push(l);
  }

  const resultado = [];
  for (const lancs of porParceiro.values()) {
    const ordenados = [...lancs].sort((a, b) => (a.dataInicio || "").localeCompare(b.dataInicio || ""));
    const clusters = [];
    for (const l of ordenados) {
      const ultimo = clusters[clusters.length - 1];
      const fim = l.dataFim || l.dataInicio || "";
      if (ultimo && (l.dataInicio || "") <= ultimo.fimMax) {
        ultimo.itens.push(l);
        if (fim > ultimo.fimMax) ultimo.fimMax = fim;
      } else {
        clusters.push({ itens: [l], fimMax: fim });
      }
    }
    for (const c of clusters) {
      resultado.push(c.itens.reduce(melhorEntre));
    }
  }
  return resultado;
}

function diaSeguinte(iso) {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + 1);
  return toISO(dt);
}

/* Duração de um intervalo em dias (fim - início) — usado pra saber qual
   de dois lançamentos sobrepostos é mais "específico" (menor). */
function spanDias(inicio, fim) {
  if (!inicio) return Infinity;
  return Math.round((parseISO(fim || inicio) - parseISO(inicio)) / 86400000);
}

/* ============================================================
   Semana da plataforma: sempre segunda a domingo (nunca domingo a
   sábado) — usado em presets de período, agrupamento de gráficos e
   no calendário da Base de Dados. Única fonte de verdade pra essa
   convenção; qualquer tela que precise de "semana" importa daqui em
   vez de calcular com getDay() na mão.
   ============================================================ */

/* Segunda-feira (ISO) da semana que contém `dt` (Date, padrão hoje). */
export function inicioSemanaISO(dt = new Date()) {
  const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diaSemana = d.getDay(); // 0=dom..6=sáb
  d.setDate(d.getDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
  return toISO(d);
}
/* Domingo (ISO) da semana que contém `dt`. */
export function fimSemanaISO(dt = new Date()) {
  const d = parseISO(inicioSemanaISO(dt));
  d.setDate(d.getDate() + 6);
  return toISO(d);
}
/* Segunda-feira (ISO) da semana à qual uma data ISO qualquer pertence
   — chave de agrupamento pros gráficos "por semana". */
export function chaveSemana(iso) {
  return inicioSemanaISO(parseISO(iso));
}
const MES_ABREV_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/* Rótulo curto pro eixo dos gráficos: "23/jun". */
export function rotuloSemanaCurto(iniISO) {
  const [, m, d] = iniISO.split("-");
  return `${d}/${MES_ABREV_CURTO[parseInt(m, 10) - 1]}`;
}

/* Pra cada dia do mês/ano pedidos, diz se algum lançamento cobre esse
   dia ("ok", verde) ou se dois ou mais lançamentos DO MESMO parceiro
   com períodos sobrepostos cobrem ("sobreposto", amarelo — mesmo
   critério de sobreposição que dedupLancamentos já usa pras contas do
   Dashboard, só que aqui devolve os dias em vez do "vencedor").
   Linha sem parceiro (faturamento da loja) vira seu próprio grupo. */
export function statusDiasDoMes(lancamentos, ano, mes) {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const primeiroDoMes = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const ultimoDoMes = `${ano}-${String(mes).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;

  const porGrupo = new Map();
  for (const l of lancamentos) {
    const chave = l.parceiroId || "__loja__";
    if (!porGrupo.has(chave)) porGrupo.set(chave, []);
    porGrupo.get(chave).push(l);
  }

  const diasOk = new Set();
  const diasSobrepostos = new Set();
  for (const lancs of porGrupo.values()) {
    const ordenados = [...lancs].sort((a, b) => (a.dataInicio || "").localeCompare(b.dataInicio || ""));
    const clusters = [];
    for (const l of ordenados) {
      const fim = l.dataFim || l.dataInicio || "";
      const ultimo = clusters[clusters.length - 1];
      if (ultimo && (l.dataInicio || "") <= ultimo.fimMax) {
        ultimo.itens.push(l);
        if (fim > ultimo.fimMax) ultimo.fimMax = fim;
      } else {
        clusters.push({ itens: [l], inicioMin: l.dataInicio || "", fimMax: fim });
      }
    }
    for (const c of clusters) {
      const destino = c.itens.length > 1 ? diasSobrepostos : diasOk;
      const inicio = c.inicioMin < primeiroDoMes ? primeiroDoMes : c.inicioMin;
      const fim = c.fimMax > ultimoDoMes ? ultimoDoMes : c.fimMax;
      for (let d = inicio; d <= fim; d = diaSeguinte(d)) destino.add(d);
    }
  }

  return Array.from({ length: ultimoDia }, (_, i) => {
    const dia = i + 1;
    const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    if (diasSobrepostos.has(iso)) return { dia, status: "sobreposto" };
    if (diasOk.has(iso)) return { dia, status: "ok" };
    return { dia, status: "vazio" };
  });
}

/* Decide o que gravar quando um novo lançamento (avulso ou linha de
   lote) se sobrepõe a lançamentos já existentes do MESMO parceiro.
   Assume que os números do relatório de origem são cumulativos desde
   o início do período (ex.: "1 a 20/jul" já inclui o que aconteceu de
   "1 a 14/jul") — por isso, quando o novo período começa no mesmo dia
   de um já lançado e vai mais longe, grava só a diferença (o pedaço
   novo), sem tocar no lançamento antigo. Qualquer sobreposição fora
   desse padrão (datas de início diferentes, período igual ou mais
   curto) é ambígua demais pra resolver sozinho — devolve o motivo pra
   quem chamou decidir (normalmente bloqueando o formulário).

   Exceção: se o novo período é mais ESPECÍFICO (menor, em dias) que
   TODOS os lançamentos com quem se sobrepõe — ex.: lançar um dia
   específico dentro de uma semana já lançada —, não tem como calcular
   delta (não é uma continuação cumulativa do mesmo relatório) nem faz
   sentido bloquear: deixa os dois coexistirem como registros
   independentes. dedupLancamentos (acima) resolve isso na hora de
   agregar, sempre priorizando o mais específico.

   faturamentoTotal não entra nessa conta — não é mais coletado por
   cupom no lançamento avulso/lote (ver abrirFaturamentoLoja). */
export function calcularEntradaLancamento(existentesDoParceiro, novo) {
  const fimNovo = novo.dataFim || novo.dataInicio;
  const sobrepostos = existentesDoParceiro.filter((l) => {
    const fimL = l.dataFim || l.dataInicio || "";
    return fimL >= novo.dataInicio && (l.dataInicio || "") <= fimNovo;
  });

  if (sobrepostos.length === 0) {
    return { tipo: "novo", dataInicio: novo.dataInicio, dataFim: fimNovo, quantidadeUso: novo.quantidadeUso, faturamentoCupom: novo.faturamentoCupom };
  }

  const spanNovo = spanDias(novo.dataInicio, fimNovo);
  const maisEspecificoQueTodos = sobrepostos.every((l) => spanDias(l.dataInicio, l.dataFim) > spanNovo);
  if (maisEspecificoQueTodos) {
    return { tipo: "novo", dataInicio: novo.dataInicio, dataFim: fimNovo, quantidadeUso: novo.quantidadeUso, faturamentoCupom: novo.faturamentoCupom };
  }

  const mesmoInicio = sobrepostos.filter((l) => l.dataInicio === novo.dataInicio);
  if (mesmoInicio.length !== 1 || sobrepostos.length > 1) {
    return { tipo: "ambiguo", motivo: `O período ${formatDataBR(novo.dataInicio)}–${formatDataBR(fimNovo)} se sobrepõe a ${sobrepostos.length} lançamento(s) existente(s) que não começam no mesmo dia — ajuste as datas ou resolva manualmente antes.` };
  }

  const base = mesmoInicio[0];
  const fimBase = base.dataFim || base.dataInicio;
  if (fimNovo === fimBase) {
    return { tipo: "ambiguo", motivo: `Já existe um lançamento exatamente pra esse período (${formatDataBR(base.dataInicio)}–${formatDataBR(fimBase)}) — edite-o em vez de criar outro.` };
  }
  if (fimNovo < fimBase) {
    return { tipo: "ambiguo", motivo: `Já existe um lançamento mais longo pra esse período (${formatDataBR(base.dataInicio)}–${formatDataBR(fimBase)}) — não dá pra lançar um período menor sobreposto.` };
  }

  const deltaUso = novo.quantidadeUso - (base.quantidadeUso || 0);
  const deltaFat = novo.faturamentoCupom - (base.faturamentoCupom || 0);
  if (deltaUso < 0 || deltaFat < 0) {
    return { tipo: "ambiguo", motivo: `O período informado se sobrepõe a um lançamento existente (${formatDataBR(base.dataInicio)}–${formatDataBR(fimBase)}), mas os números novos são menores — confira os valores ou edite/exclua o lançamento antigo.` };
  }
  return { tipo: "delta", dataInicio: diaSeguinte(fimBase), dataFim: fimNovo, quantidadeUso: deltaUso, faturamentoCupom: deltaFat };
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
