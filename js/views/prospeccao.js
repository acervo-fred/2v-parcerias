/* Lista de Prospecção — TODOS os negócios da área: os parceiros já
   fechados (ehParceiro=true) e os que ainda estão em prospecção.
   Busca, filtro por status, e ação de "Fechar parceria" (só nos que
   ainda não fecharam) ou "Ver parceiro" (nos que já fecharam). */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { badgeFromLista } from "../ui/badges.js";
import { abrirNovoProspecto, abrirFecharParceria } from "./cadastros.js";

export async function renderProspeccao(app) {
  const [negocios, listas] = await Promise.all([
    store.listParceiros(),
    store.getListas(),
  ]);

  let busca = "";
  let filtroStatus = "Todos";

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Prospecção</h1>
        <div class="page-sub" id="contador">${negocios.length} negócios</div>
      </div>
      <div class="toolbar">
        <button class="btn btn-primary" data-act="novo">+ Nova prospecção</button>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom:16px">
      <input class="input" id="busca" type="search" placeholder="Buscar por nome, local ou responsável…" />
    </div>
    <div class="filter-row" id="filtros"></div>

    <div class="list-card" id="lista"></div>
  `;

  const valoresStatus = ["Todos", ...listas.statusProspeccao.map((s) => s.valor)];
  const filtros = app.querySelector("#filtros");
  filtros.innerHTML = valoresStatus
    .map((v) => `<button class="chip ${v === "Todos" ? "active" : ""}" data-status="${esc(v)}">${esc(v)}</button>`)
    .join("");

  const lista = app.querySelector("#lista");
  const porId = Object.fromEntries(negocios.map((p) => [p.id, p]));

  function desenhar() {
    const termo = busca.trim().toLowerCase();
    const arr = negocios.filter((p) => {
      const okBusca = !termo
        || p.nome.toLowerCase().includes(termo)
        || (p.local || "").toLowerCase().includes(termo)
        || (p.responsavel || "").toLowerCase().includes(termo)
        || (p.contato || "").toLowerCase().includes(termo);
      const okStatus = filtroStatus === "Todos" || p.statusProspeccao === filtroStatus;
      return okBusca && okStatus;
    }).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    lista.innerHTML = arr.length
      ? arr.map((p) => row(p, listas)).join("")
      : `<div class="empty">Nenhum negócio encontrado.</div>`;

    const rotulo = filtroStatus === "Todos" ? "negócios" : `negócios — ${filtroStatus}`;
    app.querySelector("#contador").textContent = `${arr.length} ${rotulo}`;
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

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='novo']")) abrirNovoProspecto();
  });

  lista.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    const p = porId[id];
    if (!p) return;
    const action = e.target.dataset.action;
    if (action === "editar") return abrirNovoProspecto(p);
    if (action === "fechar") return abrirFecharParceria(p);
    if (action === "excluir") {
      if (!confirm(`Excluir "${p.nome}" da prospecção?`)) return;
      await store.removeParceiro(p.id);
      window.dispatchEvent(new CustomEvent("data-changed"));
    }
  });
}

function row(p, listas) {
  const partes = [p.tipo, p.local, p.responsavel, p.contato].filter(Boolean);
  const acao = p.ehParceiro
    ? `<a class="btn btn-sm btn-ghost" href="#/parceiro/${esc(p.id)}">Ver parceiro →</a>`
    : `<button class="btn btn-sm btn-primary" data-action="fechar" data-id="${esc(p.id)}">Fechar parceria</button>`;
  return `<div class="list-row" data-id="${esc(p.id)}">
    <div class="lr-main">
      <div class="lr-title">${esc(p.nome)}</div>
      <div class="lr-sub">${esc(partes.join(" · "))}</div>
      ${p.observacoes ? `<div class="lr-sub">${esc(p.observacoes)}</div>` : ""}
    </div>
    ${p.ehParceiro ? `<span class="badge badge--green">✓ Parceiro</span>` : badgeFromLista(listas.statusProspeccao, p.statusProspeccao)}
    ${acao}
    <span class="lr-actions">
      <button class="icon-btn" data-action="editar" data-id="${esc(p.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(p.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}
