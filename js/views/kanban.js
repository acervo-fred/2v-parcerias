/* Kanban — CRM (Fase 3): quadro dos estágios de partners
   (lead/negociação-contato/ativo/perdido), arrastar-e-soltar muda
   o estágio, filtro por tipo e por tempo parado no estágio atual.
   Abaixo do quadro, um painel lista todas as próximas ações
   pendentes (de qualquer estágio), agrupadas por data.

   Escopo deliberadamente isolado do schema antigo (parceiros/
   ehParceiro/cupom) — ver decisão registrada no plano da Fase 3.
   Arrastar um card pra "Ativo" aqui não fecha parceria de verdade;
   isso continua só na tela Prospecção. */

import { store } from "../data/store.js";
import { esc, formatDataBR } from "../ui/dom.js";

const STAGES = [
  { valor: "lead", label: "Lead" },
  { valor: "negociacao", label: "Negociação / Em contato" },
  { valor: "ativo", label: "Ativo" },
  { valor: "perdido", label: "Perdido / Sem resposta" },
];
const PRAZOS = [
  { valor: "0", label: "Todos" },
  { valor: "7", label: "7+ dias" },
  { valor: "14", label: "14+ dias" },
  { valor: "30", label: "30+ dias" },
  { valor: "60", label: "60+ dias" },
];

function isEditor() {
  return document.body.classList.contains("is-editor");
}
function diasNoEstagio(stageUpdatedAt) {
  if (!stageUpdatedAt) return null;
  const hoje = new Date().toISOString().slice(0, 10);
  return Math.max(0, Math.round((new Date(hoje) - new Date(stageUpdatedAt)) / 86400000));
}
// nível de urgência de uma data — cada lugar que usa formata a própria classe CSS em cima disso
function nivelUrgencia(dueDate) {
  if (!dueDate) return "";
  const hoje = new Date().toISOString().slice(0, 10);
  if (dueDate < hoje) return "overdue";
  const emSeteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (dueDate <= emSeteDias) return "soon";
  return "";
}
async function marcarAcaoFeita(partner) {
  await store.addInteraction(partner.id, {
    type: "nota", summary: `Ação concluída: ${partner.nextAction.description}`,
    date: new Date().toISOString().slice(0, 10),
  });
  await store.updatePartner(partner.id, { nextAction: null });
  window.dispatchEvent(new CustomEvent("data-changed"));
}

export async function renderKanban(app) {
  let partners = await store.listPartners();

  let filtroTipo = "Todos";
  let filtroDias = "0";

  const tiposDisponiveis = ["Todos", ...new Set(
    partners.map((p) => (p.type || "").trim()).filter(Boolean)
  )].sort((a, b) => a === "Todos" ? -1 : b === "Todos" ? 1 : a.localeCompare(b, "pt-BR"));

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Kanban</h1>
        <div class="page-sub">${partners.length} parceiros</div>
      </div>
    </div>

    <div class="filter-row" id="filtro-tipo">
      ${tiposDisponiveis.map((t) => `<button class="chip ${t === "Todos" ? "active" : ""}" data-tipo="${esc(t)}">${esc(t)}</button>`).join("")}
    </div>
    <div class="filter-row" id="filtro-dias" style="margin-bottom:16px">
      ${PRAZOS.map((p) => `<button class="chip ${p.valor === "0" ? "active" : ""}" data-dias="${esc(p.valor)}">${esc(p.label)}</button>`).join("")}
    </div>

    <div class="funil-board" id="kanban-board"></div>

    <section class="section" style="margin-top:28px">
      <div class="section-head"><h2>Próximas ações</h2></div>
      <div id="proximas-acoes"></div>
    </section>
  `;

  const board = app.querySelector("#kanban-board");

  function desenharBoard() {
    const filtrados = partners.filter((p) => {
      const okTipo = filtroTipo === "Todos" || (p.type || "").trim() === filtroTipo;
      const limiteDias = Number(filtroDias);
      const dias = diasNoEstagio(p.stageUpdatedAt);
      const okDias = limiteDias === 0 || (dias !== null && dias >= limiteDias);
      return okTipo && okDias;
    });

    board.innerHTML = STAGES.map((s) => {
      const doEstagio = filtrados.filter((p) => p.stage === s.valor)
        .sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
      return `<div class="funil-col">
        <div class="funil-col-head">
          <span>${esc(s.label)}</span>
          <span class="funil-col-count">${doEstagio.length}</span>
        </div>
        <div class="funil-col-body" data-stage="${s.valor}">
          ${doEstagio.length ? doEstagio.map(cardHtml).join("") : `<div class="empty">Nenhum parceiro.</div>`}
        </div>
      </div>`;
    }).join("");
  }
  desenharBoard();

  function desenharAcoes() {
    const grupos = agruparPorData(partners);
    const el = app.querySelector("#proximas-acoes");
    el.innerHTML = grupos.length ? grupos.map(([data, lista]) => {
      const nivel = nivelUrgencia(data);
      return `
        <div class="acoes-data-label${nivel ? ` acoes-data-label--${nivel}` : ""}">${esc(formatDataBR(data))}</div>
        <div class="list-card" style="margin-bottom:14px">
          ${lista.map((p) => `<div class="list-row">
            <div class="lr-main">
              <div class="lr-title">${esc(p.name)}</div>
              <div class="lr-sub">${esc(p.nextAction.description || "")}</div>
            </div>
            <button class="btn btn-ghost btn-sm edit-only" data-feita="${esc(p.id)}">✓ Feita</button>
          </div>`).join("")}
        </div>
      `;
    }).join("") : `<div class="empty">Nenhuma próxima ação pendente.</div>`;
  }
  desenharAcoes();
  app.querySelector("#proximas-acoes").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-feita]");
    if (!btn) return;
    const p = partners.find((x) => x.id === btn.dataset.feita);
    if (p) marcarAcaoFeita(p);
  });

  app.querySelector("#filtro-tipo").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroTipo = chip.dataset.tipo;
    chip.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    desenharBoard();
  });
  app.querySelector("#filtro-dias").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroDias = chip.dataset.dias;
    chip.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    desenharBoard();
  });

  /* ---------- drag-and-drop (delegado no board inteiro) ---------- */
  board.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".funil-card");
    if (!card) return;
    e.dataTransfer.setData("text/plain", card.dataset.id);
    card.classList.add("dragging");
  });
  board.addEventListener("dragend", (e) => {
    e.target.closest(".funil-card")?.classList.remove("dragging");
    board.querySelectorAll(".funil-col-body.drag-over").forEach((el) => el.classList.remove("drag-over"));
  });
  board.addEventListener("dragover", (e) => {
    const col = e.target.closest(".funil-col-body");
    if (!col) return;
    e.preventDefault();
    col.classList.add("drag-over");
  });
  board.addEventListener("dragleave", (e) => {
    e.target.closest(".funil-col-body")?.classList.remove("drag-over");
  });
  board.addEventListener("drop", async (e) => {
    const col = e.target.closest(".funil-col-body");
    if (!col) return;
    e.preventDefault();
    col.classList.remove("drag-over");
    const id = e.dataTransfer.getData("text/plain");
    const novoStage = col.dataset.stage;
    const p = partners.find((x) => x.id === id);
    if (!p || p.stage === novoStage) return;

    const stageAnterior = p.stage;
    const stageUpdatedAtAnterior = p.stageUpdatedAt;
    const agora = new Date().toISOString().slice(0, 10);
    p.stage = novoStage;
    p.stageUpdatedAt = agora;
    desenharBoard();
    try {
      await store.updatePartner(id, { stage: novoStage, stageUpdatedAt: agora });
    } catch (err) {
      console.error(err);
      p.stage = stageAnterior;
      p.stageUpdatedAt = stageUpdatedAtAnterior;
      desenharBoard();
      alert("Não foi possível mover o parceiro. Confira se você está logado com uma conta autorizada.");
    }
  });
}

function agruparPorData(partners) {
  const mapa = new Map();
  for (const p of partners) {
    if (!p.nextAction?.dueDate) continue;
    const d = p.nextAction.dueDate;
    if (!mapa.has(d)) mapa.set(d, []);
    mapa.get(d).push(p);
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function cardHtml(p) {
  const dias = diasNoEstagio(p.stageUpdatedAt);
  const na = p.nextAction;
  const nivel = na ? nivelUrgencia(na.dueDate) : "";
  return `<div class="funil-card" draggable="${isEditor() ? "true" : "false"}" data-id="${esc(p.id)}">
    <div class="funil-card-title">${esc(p.name)}</div>
    ${p.type ? `<div class="funil-card-sub">${esc(p.type)}</div>` : ""}
    <div class="funil-card-sub">${dias === null ? "—" : `há ${dias} dia${dias === 1 ? "" : "s"}`}</div>
    ${na && (na.description || na.dueDate) ? `<div class="funil-card-next${nivel ? ` funil-card-next--${nivel}` : ""}">${esc(na.description || "")}${na.dueDate ? ` · ${esc(formatDataBR(na.dueDate))}` : ""}</div>` : ""}
  </div>`;
}
