/* Base de Dados (global) — todos os lançamentos de todos os parceiros,
   com o nome/cupom sempre resolvido pelo parceiroId (nunca duplicado
   no lançamento). Ponto de entrada principal pro lançamento em lote:
   um período, vários cupons de uma vez — jeito real de uso. */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { abrirLancamentoLote, abrirNovoLancamento, abrirFaturamentoLoja } from "./cadastros.js";
import { dedupLancamentos } from "../util/periodo.js";

export async function renderLancamentos(app) {
  const [lancamentos, parceiros] = await Promise.all([
    store.listLancamentos(),
    store.listParceiros(),
  ]);
  const porId = Object.fromEntries(parceiros.map((p) => [p.id, p]));

  let busca = "";
  let filtroParceiro = "";

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
      <div class="toolbar">
        <button class="btn btn-ghost" data-act="loja">+ Faturamento da loja</button>
        <button class="btn btn-ghost" data-act="avulso">+ Lançamento avulso</button>
        <button class="btn btn-primary" data-act="lote">+ Lançamento em lote</button>
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
        <option value="">Todos os parceiros</option>
        ${parceiros.filter((p) => p.ehParceiro).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
          .map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} — ${esc(p.cupom)}</option>`).join("")}
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
      const okParceiro = !filtroParceiro || l.parceiroId === filtroParceiro;
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
  app.querySelector("#filtro-parceiro").addEventListener("change", (e) => { filtroParceiro = e.target.value; desenhar(); });

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='lote']")) return abrirLancamentoLote();
    if (e.target.closest("[data-act='avulso']")) return abrirNovoLancamento();
    if (e.target.closest("[data-act='loja']")) return abrirFaturamentoLoja();
  });

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
    <span class="lr-actions">
      <button class="icon-btn" data-action="editar" data-id="${esc(l.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(l.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}
