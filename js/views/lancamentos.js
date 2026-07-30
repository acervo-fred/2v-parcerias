/* Base de Dados (global) — todos os lançamentos de todos os parceiros,
   com o nome/cupom sempre resolvido pelo parceiroId (nunca duplicado
   no lançamento). Ponto de entrada principal pro lançamento em lote:
   um período, vários cupons de uma vez — jeito real de uso. */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { abrirLancamentoLote, abrirNovoLancamento, abrirFaturamentoLoja } from "./cadastros.js";
import { dedupLancamentos, statusDiasDoMes, MES_NOMES } from "../util/periodo.js";
import { agruparParceirosPorCupom, chaveCupom } from "../util/cupom.js";
import { openModal } from "../ui/modal.js";

export async function renderLancamentos(app) {
  const [lancamentos, parceiros] = await Promise.all([
    store.listLancamentos(),
    store.listParceiros(),
  ]);
  const porId = Object.fromEntries(parceiros.map((p) => [p.id, p]));
  // cupom compartilhado por mais de uma empresa conta como um só no filtro
  // (ver js/util/cupom.js) — mesmo padrão já usado no Dashboard e em Cupons
  const chavePorParceiroId = Object.fromEntries(parceiros.map((p) => [p.id, chaveCupom(p)]));
  const gruposCupom = agruparParceirosPorCupom(parceiros.filter((p) => p.ehParceiro))
    .sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));

  let busca = "";
  let filtroCupom = "";

  // os totais do topo não contam duplicata (mesmo parceiro+data) duas vezes,
  // mas a lista abaixo continua mostrando todos os lançamentos de verdade —
  // se houver duplicata, dá pra ver e excluir manualmente
  const semDuplicata = dedupLancamentos(lancamentos);
  const totalUso = semDuplicata.reduce((s, l) => s + l.quantidadeUso, 0);
  const totalCupom = semDuplicata.reduce((s, l) => s + l.faturamentoCupom, 0);

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Base de dados</h1>
        <div class="page-sub">${lancamentos.length} lançamentos registrados</div>
      </div>
      <div class="row-end">
        <button class="btn btn-ghost" id="btn-mes"><span class="ni-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span> Registros por mês</button>
        <div class="toolbar edit-only">
          <button class="btn btn-ghost" data-act="loja">+ Faturamento da loja</button>
          <button class="btn btn-ghost" data-act="avulso">+ Lançamento avulso</button>
          <button class="btn btn-primary" data-act="lote">+ Lançamento em lote</button>
        </div>
      </div>
    </div>

    <div class="stat-grid">
      ${stat(totalUso, "Usos registrados")}
      ${stat(formatMoeda(totalCupom), "Faturamento via cupom (total)")}
      ${stat(parceiros.filter((p) => p.ehParceiro).length, "Parceiros com cupom")}
    </div>

    <div class="toolbar" style="margin-bottom:16px; gap:10px">
      <input class="input" id="busca" type="search" placeholder="Buscar por parceiro, cupom ou rótulo do período…" style="flex:1;min-width:200px" />
      <select class="input" id="filtro-parceiro" style="width:auto">
        <option value="">Todos os cupons</option>
        ${gruposCupom.map((lc) => `<option value="${esc(lc.chave)}">${esc(lc.cupom)} — ${esc(lc.parceiros.map((p) => p.nome).join(", "))}</option>`).join("")}
      </select>
    </div>

    <div class="list-card" id="lista"></div>
  `;

  const lista = app.querySelector("#lista");
  const lPorId = Object.fromEntries(lancamentos.map((l) => [l.id, l]));

  function desenhar() {
    const termo = busca.trim().toLowerCase();
    const arr = lancamentos.filter((l) => {
      const p = porId[l.parceiroId];
      const okBusca = !termo
        || (p?.nome || "").toLowerCase().includes(termo)
        || (p?.cupom || "").toLowerCase().includes(termo)
        || (l.periodoLabel || "").toLowerCase().includes(termo)
        || (!l.parceiroId && "faturamento da loja".includes(termo));
      const okParceiro = !filtroCupom || chavePorParceiroId[l.parceiroId] === filtroCupom;
      return okBusca && okParceiro;
    }).sort((a, b) => {
      const nomeA = a.parceiroId ? (porId[a.parceiroId]?.nome || "") : "Faturamento da loja";
      const nomeB = b.parceiroId ? (porId[b.parceiroId]?.nome || "") : "Faturamento da loja";
      return nomeA.localeCompare(nomeB, "pt-BR") || (a.dataInicio || "").localeCompare(b.dataInicio || "");
    });

    lista.innerHTML = arr.length
      ? arr.map((l) => row(l, porId[l.parceiroId])).join("")
      : `<div class="empty">Nenhum lançamento encontrado.</div>`;
  }
  desenhar();

  app.querySelector("#busca").addEventListener("input", (e) => { busca = e.target.value; desenhar(); });
  app.querySelector("#filtro-parceiro").addEventListener("change", (e) => { filtroCupom = e.target.value; desenhar(); });

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='lote']")) return abrirLancamentoLote();
    if (e.target.closest("[data-act='avulso']")) return abrirNovoLancamento();
    if (e.target.closest("[data-act='loja']")) return abrirFaturamentoLoja();
  });
  app.querySelector("#btn-mes").addEventListener("click", () => abrirCalendarioMes(lancamentos));

  lista.addEventListener("click", async (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    const l = lPorId[id];
    if (!l) return;
    if (e.target.dataset.action === "editar") {
      return l.parceiroId ? abrirNovoLancamento(l.parceiroId, l) : abrirFaturamentoLoja(l);
    }
    if (e.target.dataset.action === "excluir") {
      if (!confirm("Excluir este lançamento?")) return;
      await store.removeLancamento(id);
      window.dispatchEvent(new CustomEvent("data-changed"));
    }
  });
}

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function abrirCalendarioMes(lancamentos) {
  const hoje = new Date();
  let ano = hoje.getFullYear(), mes = hoje.getMonth() + 1;
  if (lancamentos.length) {
    const maisRecente = lancamentos.reduce((a, b) =>
      (b.dataFim || b.dataInicio || "") > (a.dataFim || a.dataInicio || "") ? b : a
    );
    const [y, m] = (maisRecente.dataFim || maisRecente.dataInicio || "").split("-");
    if (y && m) { ano = Number(y); mes = Number(m); }
  }

  openModal({
    title: "Lançamentos por dia",
    subtitle: "Verde: dia com lançamento. Amarelo: dias cobertos por lançamentos sobrepostos do mesmo parceiro (ignorados nas contas do Dashboard).",
    submitLabel: "Fechar",
    bodyHtml: `
      <div class="cal-nav">
        <button type="button" class="btn btn-ghost btn-sm" id="cal-prev">‹</button>
        <strong id="cal-titulo"></strong>
        <button type="button" class="btn btn-ghost btn-sm" id="cal-next">›</button>
      </div>
      <div class="calendario-mes">
        ${DIAS_SEMANA.map((d) => `<div class="cal-dia cal-dia--cabecalho">${d}</div>`).join("")}
      </div>
      <div class="calendario-mes" id="cal-grid"></div>
    `,
    onMount: (form) => {
      const titulo = form.querySelector("#cal-titulo");
      const grid = form.querySelector("#cal-grid");
      function desenhar() {
        titulo.textContent = `${MES_NOMES[mes - 1]} / ${ano}`;
        const dias = statusDiasDoMes(lancamentos, ano, mes);
        const offset = new Date(ano, mes - 1, 1).getDay();
        const celulas = [];
        for (let i = 0; i < offset; i++) celulas.push(`<div class="cal-dia cal-dia--fora"></div>`);
        dias.forEach((d) => celulas.push(`<div class="cal-dia cal-dia--${d.status}">${d.dia}</div>`));
        grid.innerHTML = celulas.join("");
      }
      form.querySelector("#cal-prev").addEventListener("click", () => {
        mes--; if (mes < 1) { mes = 12; ano--; }
        desenhar();
      });
      form.querySelector("#cal-next").addEventListener("click", () => {
        mes++; if (mes > 12) { mes = 1; ano++; }
        desenhar();
      });
      desenhar();
    },
    onSubmit: async () => {},
  });
}

function stat(num, label) {
  return `<div class="stat">
    <div class="stat-num">${num}</div>
    <div class="stat-label">${esc(label)}</div>
  </div>`;
}

function row(l, parceiro) {
  const periodo = l.dataInicio === l.dataFim || !l.dataFim
    ? formatDataBR(l.dataInicio)
    : `${formatDataBR(l.dataInicio)} – ${formatDataBR(l.dataFim)}`;
  const sub = !l.parceiroId
    ? `${periodo}${l.periodoLabel ? ` · ${l.periodoLabel}` : ""} · ${formatMoeda(l.faturamentoTotal)} faturamento total${l.faturamentoDelivery ? ` · ${formatMoeda(l.faturamentoDelivery)} via delivery` : ""}`
    : `${periodo}${l.periodoLabel ? ` · ${l.periodoLabel}` : ""} · ${l.quantidadeUso} usos · ${formatMoeda(l.faturamentoCupom)} via cupom · ${formatMoeda(l.faturamentoTotal)} faturamento total${l.faturamentoDelivery ? ` · ${formatMoeda(l.faturamentoDelivery)} via delivery` : ""} · ticket médio ${formatMoeda(l.ticketMedio)}`;
  const nomeParceiro = !l.parceiroId
    ? "Faturamento da loja"
    : parceiro ? `${parceiro.cupom} — ${parceiro.nome}` : "(parceiro removido)";
  return `<div class="list-row">
    <div class="lr-main">
      <div class="lr-title">${esc(nomeParceiro)}</div>
      <div class="lr-sub">${esc(sub)}</div>
    </div>
    <span class="lr-actions edit-only">
      <button class="icon-btn" data-action="editar" data-id="${esc(l.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(l.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}
