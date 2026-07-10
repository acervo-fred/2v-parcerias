/* Cadastro de Parceiros — negócios que já fecharam parceria (têm cupom).
   Clique na linha abre o detalhe do parceiro (dados + Base de Dados). */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { badgeFromLista } from "../ui/badges.js";

export async function renderParceiros(app) {
  const [parceiros, listas] = await Promise.all([
    store.listParceirosFechados(),
    store.getListas(),
  ]);

  let busca = "";
  let filtroStatus = "Todos";

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Parceiros</h1>
        <div class="page-sub">${parceiros.length} parceiros com cupom ativo</div>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom:16px">
      <input class="input" id="busca" type="search" placeholder="Buscar por nome, cupom ou responsável…" />
    </div>
    <div class="filter-row" id="filtros"></div>

    <div class="list-card" id="lista"></div>
  `;

  const valoresStatus = ["Todos", ...listas.statusCupom.map((s) => s.valor)];
  const filtros = app.querySelector("#filtros");
  filtros.innerHTML = valoresStatus
    .map((v) => `<button class="chip ${v === "Todos" ? "active" : ""}" data-status="${esc(v)}">${esc(v)}</button>`)
    .join("");

  const lista = app.querySelector("#lista");

  function desenhar() {
    const termo = busca.trim().toLowerCase();
    const arr = parceiros.filter((p) => {
      const okBusca = !termo
        || p.nome.toLowerCase().includes(termo)
        || (p.cupom || "").toLowerCase().includes(termo)
        || (p.responsavel || "").toLowerCase().includes(termo);
      const okStatus = filtroStatus === "Todos" || p.statusCupom === filtroStatus;
      return okBusca && okStatus;
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    lista.innerHTML = arr.length
      ? arr.map((p) => row(p, listas)).join("")
      : `<div class="empty">Nenhum parceiro encontrado.</div>`;
  }
  desenhar();

  app.querySelector("#busca").addEventListener("input", (e) => { busca = e.target.value; desenhar(); });
  filtros.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroStatus = chip.dataset.status;
    filtros.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    desenhar();
  });

  lista.addEventListener("click", (e) => {
    const row = e.target.closest("[data-id]");
    if (row) location.hash = `#/parceiro/${row.dataset.id}`;
  });
}

function row(p, listas) {
  return `<div class="list-row clickable" data-id="${esc(p.id)}">
    <div class="lr-main">
      <div class="lr-title">${esc(p.nome)} <span class="muted" style="font-weight:400">· cupom ${esc(p.cupom)}</span></div>
      <div class="lr-sub">${esc([p.responsavel, p.periodoDesconto].filter(Boolean).join(" · "))}</div>
    </div>
    ${badgeFromLista(listas.statusCupom, p.statusCupom)}
    <span class="muted">›</span>
  </div>`;
}
