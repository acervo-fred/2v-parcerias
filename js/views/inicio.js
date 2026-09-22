/* Início — visão consolidada da loja atual: KPIs rápidos (incluindo
   sinais de qualidade de dado, tipo "100% sem data de vencimento"), um
   alerta dinâmico sobre parceiros sem tipo de negócio identificado, o
   funil de prospecção CRU (contagem literal do campo statusProspeccao,
   sem normalizar — de propósito, pra expor inconsistência histórica do
   dado) e um comparativo de parceiros ativos entre todas as lojas.

   Nada é gravado aqui, é uma tela 100% de leitura — cada número vem
   direto dos mesmos dados que já alimentam Pipeline/Cupons/Prospecção/
   Base de dados, nunca duplicado ou pré-calculado à parte. */

import { store } from "../data/store.js";
import { esc, formatMoeda } from "../ui/dom.js";
import { corDoValor } from "../ui/badges.js";
import { statusCupomEfetivo, agruparParceirosPorCupom, chaveCupom } from "../util/cupom.js";
import { dedupLancamentos, lancamentoNoPeriodo } from "../util/periodo.js";
import { openModal } from "../ui/modal.js";

const DIAS_VENCENDO = 30;
const TOP_N_CUPONS = 12;

export async function renderInicio(app) {
  const [parceiros, listas, lancamentosBrutos, lojas, parceirosTodasLojas, lojaAtual] = await Promise.all([
    store.listParceiros(),
    store.getListas(),
    store.listLancamentos(),
    store.listLojas(),
    store.listParceirosTodasLojas(),
    store.getLojaAtual(),
  ]);

  const fechados = parceiros.filter((p) => p.ehParceiro);
  const lancamentos = dedupLancamentos(lancamentosBrutos);
  const semTipo = parceiros.filter((p) => p.tipo === "Outro");
  const { topCupons, topSemTipo } = cuponsAfetadosPorOutro(fechados, lancamentos);

  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Início</h1></div>
    </div>

    <div class="stat-grid">
      ${kpisHtml(parceiros, fechados, lancamentos)}
    </div>

    ${alertaOutroHtml(semTipo, topCupons, topSemTipo)}

    <section class="section">
      <div class="section-head"><h2>Funil de prospecção${lojaAtual ? ` — ${esc(lojaAtual.nome)}` : ""}</h2></div>
      ${funilBrutoHtml(parceiros, listas.statusProspeccao)}
    </section>

    <section class="section">
      <div class="section-head"><h2>Lojas com parceiros ativos</h2></div>
      <div class="lojas-grid">
        ${lojasHtml(lojas, parceirosTodasLojas)}
      </div>
    </section>
  `;

  const alertaEl = app.querySelector("#alerta-outro");
  alertaEl?.addEventListener("click", () => abrirDetalheOutro(semTipo, topSemTipo));
  alertaEl?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirDetalheOutro(semTipo, topSemTipo); }
  });
}

/* ---------- KPIs ---------- */
function kpisHtml(parceiros, fechados, lancamentos) {
  const cuponsAtivos = fechados.filter((p) => statusCupomEfetivo(p) === "Ativo");
  const cuponsComData = cuponsAtivos.filter((p) => p.dataVencimento);
  const pctSemData = cuponsAtivos.length ? Math.round(((cuponsAtivos.length - cuponsComData.length) / cuponsAtivos.length) * 100) : 0;

  const hoje = new Date().toISOString().slice(0, 10);
  const limiteVencendo = new Date(Date.now() + DIAS_VENCENDO * 86400000).toISOString().slice(0, 10);
  const cuponsVencendo = cuponsComData.filter((p) => p.dataVencimento >= hoje && p.dataVencimento <= limiteVencendo);

  const ha12Meses = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const lancamentos12m = lancamentos.filter((l) => lancamentoNoPeriodo(l, ha12Meses, hoje));
  const faturamento12m = lancamentos12m.reduce((s, l) => s + l.faturamentoCupom, 0);

  return [
    statCard(fechados.length, "Parceiros fechados", `de ${parceiros.length} cadastros no funil`),
    statCard(cuponsAtivos.length, "Cupons ativos", pctSemData > 0 ? `${pctSemData}% sem data de vencimento` : ""),
    cuponsComData.length
      ? statCard(cuponsVencendo.length, `Cupons vencendo em ${DIAS_VENCENDO} dias`)
      : statCard("—", `Cupons vencendo em ${DIAS_VENCENDO} dias`, "não rastreável hoje"),
    statCard(formatCompactMoeda(faturamento12m), "Faturamento via cupom (12 meses)", `${lancamentos12m.length} lançamentos semanais`),
  ].join("");
}
function statCard(num, label, sub) {
  return `<div class="stat">
    <div class="stat-num">${esc(String(num))}</div>
    <div class="stat-label">${esc(label)}</div>
    ${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}
  </div>`;
}
function formatCompactMoeda(v) {
  if (v >= 1000) return `R$ ${Math.round(v / 1000)}k`;
  return formatMoeda(v);
}

/* ---------- alerta: parceiros sem tipo de negócio identificado ----------
   Cruza com o ranking de cupons por faturamento (histórico completo, sem
   filtro de período) pra medir o impacto real do dado faltando, não só
   contar quantos registros estão incompletos. Um cupom compartilhado por
   mais de um parceiro (ver agruparParceirosPorCupom) conta como afetado
   se QUALQUER um dos parceiros daquele grupo estiver como "Outro" — não
   só o primeiro da lista, pra não citar cupom errado no aviso. */
function alertaOutroHtml(semTipo, topCupons, topSemTipo) {
  if (!semTipo.length) return "";

  const detalhe = topSemTipo.length
    ? ` — incluindo ${topSemTipo.length} dos ${topCupons.length} cupons de maior faturamento (${topSemTipo.map((lc) => esc(lc.cupom)).join(", ")}). O cupom existe, o parceiro por trás não foi identificado.`
    : ".";

  return `<div class="note note--warn note--clicavel" id="alerta-outro" role="button" tabindex="0" title="Clique pra ver a lista">
    <span class="note-i">⚠</span>
    <span><strong>${semTipo.length} parceiro${semTipo.length === 1 ? "" : "s"} ${semTipo.length === 1 ? "está cadastrado" : "estão cadastrados"} como "OUTRO"</strong>${detalhe}</span>
  </div>`;
}
function cuponsAfetadosPorOutro(fechados, lancamentos) {
  const chavePorParceiroId = Object.fromEntries(fechados.map((p) => [p.id, chaveCupom(p)]));
  const linhasCupom = agruparParceirosPorCupom(fechados);
  const fatPorChave = new Map();
  for (const l of lancamentos) {
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    fatPorChave.set(chave, (fatPorChave.get(chave) || 0) + l.faturamentoCupom);
  }
  const topCupons = linhasCupom
    .map((lc) => ({ ...lc, fat: fatPorChave.get(lc.chave) || 0 }))
    .sort((a, b) => b.fat - a.fat)
    .slice(0, TOP_N_CUPONS);
  const topSemTipo = topCupons.filter((lc) => lc.parceiros.some((p) => p.tipo === "Outro") && lc.fat > 0);
  return { topCupons, topSemTipo };
}

/* modal read-only: lista cada parceiro "Outro" com o(s) cupom(ns) que
   ele afeta, pra dar pra conferir e corrigir o campo Tipo na hora */
function abrirDetalheOutro(semTipo, topSemTipo) {
  const cuponsPorParceiroId = new Map();
  topSemTipo.forEach((lc) => lc.parceiros.forEach((p) => {
    if (p.tipo === "Outro") cuponsPorParceiroId.set(p.id, lc.cupom);
  }));
  const linhas = semTipo.map((p) => {
    const cupomAfetado = cuponsPorParceiroId.get(p.id);
    const sub = [p.responsavel || "sem responsável", p.cupom ? `cupom ${p.cupom.toUpperCase()}` : "sem cupom"].join(" · ");
    return `<div class="list-row">
      <div class="lr-main">
        <div class="lr-title">${esc(p.nome)}</div>
        <div class="lr-sub">${esc(sub)}</div>
        ${cupomAfetado ? `<div class="lr-sub" style="color:var(--c-amber-fg)">Está entre os ${TOP_N_CUPONS} cupons de maior faturamento</div>` : ""}
      </div>
    </div>`;
  }).join("");
  openModal({
    title: `Parceiros cadastrados como "Outro"`,
    subtitle: `${semTipo.length} parceiro${semTipo.length === 1 ? "" : "s"} sem tipo de negócio identificado — corrija o campo Tipo em "Editar" na ficha de cada um`,
    submitLabel: "Fechar",
    wide: true,
    bodyHtml: `<div class="list-card">${linhas || `<div class="empty">Nenhum.</div>`}</div>`,
  });
}
/* ---------- funil de prospecção CRU ----------
   Conta o valor exato do campo statusProspeccao de cada parceiro, sem
   normalizar — de propósito: expõe rótulos antigos/divergentes (ex.:
   "Cadastrado" ao lado de "Fechado") em vez de escondê-los atrás de uma
   contagem já limpa. Um rótulo que não é "Fechado" mas cujos parceiros
   são TODOS ehParceiro=true está, na prática, descrevendo o mesmo
   estágio sob outro nome — marcado com † pra chamar atenção. */
function funilBrutoHtml(parceiros, listaOficial) {
  if (!parceiros.length) return `<div class="chart-card"><div class="empty">Nenhum parceiro cadastrado ainda.</div></div>`;

  const contagem = new Map();
  const fechadosPorLabel = new Map();
  parceiros.forEach((p) => {
    const label = p.statusProspeccao || "(vazio)";
    contagem.set(label, (contagem.get(label) || 0) + 1);
    if (p.ehParceiro) fechadosPorLabel.set(label, (fechadosPorLabel.get(label) || 0) + 1);
  });
  const linhas = [...contagem.entries()]
    .map(([label, n]) => ({
      label, n,
      duplicataDeFechado: label !== "Fechado" && (fechadosPorLabel.get(label) || 0) === n,
    }))
    .sort((a, b) => b.n - a.n);

  const valoresOficiais = new Set((listaOficial || []).map((v) => (typeof v === "string" ? v : v.valor)));
  const nota = linhas.length !== valoresOficiais.size
    ? `<span class="section-hint">${linhas.length} valores distintos encontrados — a lista oficial define só ${valoresOficiais.size}</span>`
    : "";

  const max = Math.max(1, ...linhas.map((l) => l.n));
  return `<div class="chart-card">
    ${nota ? `<div style="margin-bottom:10px">${nota}</div>` : ""}
    ${linhas.map((l) => {
      const cor = corDoValor(listaOficial, l.label, "gray");
      const pct = Math.max(2, Math.round((l.n / max) * 100));
      return `<div class="viz-bar-row">
        <div class="viz-bar-label" title="${esc(l.label)}">${esc(l.label)}${l.duplicataDeFechado ? ` <span class="funil-bruto-dup" title="Todos os parceiros com esse rótulo já estão fechados (ehParceiro=true) — parece ser o mesmo estágio de &quot;Fechado&quot;, só que sob um nome antigo/divergente">†</span>` : ""}</div>
        <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${pct}%;background:var(--c-${cor}-fg)"></div></div>
        <div class="viz-bar-val">${l.n}</div>
      </div>`;
    }).join("")}
  </div>`;
}

/* ---------- lojas com parceiros ativos ---------- */
function lojasHtml(lojas, parceirosTodasLojas) {
  if (!lojas.length) return `<div class="empty">Nenhuma loja cadastrada.</div>`;
  const porLoja = new Map(lojas.map((l) => [l.id, 0]));
  parceirosTodasLojas.forEach((p) => {
    if (p.ehParceiro && porLoja.has(p.lojaId)) porLoja.set(p.lojaId, porLoja.get(p.lojaId) + 1);
  });
  const ordenadas = [...lojas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return ordenadas.map((l) => {
    const n = porLoja.get(l.id) || 0;
    const vazia = n === 0;
    const endereco = (l.endereco || "").trim();
    const sub = vazia ? `${endereco ? `${endereco} — ` : ""}loja nova` : endereco;
    return `<div class="stat loja-card${vazia ? " loja-card--vazia" : ""}">
      <div class="loja-card-nome">${esc(l.nome)}</div>
      <div class="loja-card-endereco">${esc(sub)}</div>
      <div class="loja-card-num">${n}</div>
      <div class="loja-card-label">Parceiros</div>
    </div>`;
  }).join("");
}
