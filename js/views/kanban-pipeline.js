/* Pipeline — dono das etapas do funil. A coluna "Lead" é derivada
   direto da Prospecção (schema antigo, parceiros/ehParceiro): todo
   negócio ainda não fechado, sem doc em partners (ou com stage
   "lead"), aparece aqui sem precisar de nenhuma ação manual. Um
   negócio só ganha doc em `partners` quando avança pela primeira
   vez (arrastar no Kanban, ou "Fechar parceria" em Prospecção — ver
   js/views/cadastros.js:abrirFecharParceria), sempre com o mesmo id
   do parceiro de origem (padrão que a migração original já usa).

   Arrastar um card de "Lead" direto pra "Ativo"/"Perdido" (pulando
   "Negociação") é tecnicamente possível — mesmo comportamento
   genérico que já vale entre quaisquer colunas — mas não fecha
   parceria de verdade (sem cupom, ehParceiro continua false); só
   "Fechar parceria" faz isso de verdade. Aproximação aceita de
   propósito, mesmo espírito do painel de contagem abaixo.

   A lista de "Próximas ações" que ficava no rodapé desta tela agora
   é a sub-guia "Próximos passos" (ver kanban-proximos-passos.js). */

import { esc, formatDataBR } from "../ui/dom.js";
import { carregarFunil, garantirPartner, nivelUrgencia } from "../data/funil.js";
import { abrirFecharParceria } from "./cadastros.js";

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
function diasLabel(stageUpdatedAt) {
  const dias = diasNoEstagio(stageUpdatedAt);
  return dias === null ? "—" : `há ${dias} dia${dias === 1 ? "" : "s"}`;
}
// ação pendente (não concluída) com prazo mais próximo, pra mostrar no card
function proximaPendente(nextActions) {
  const pendentes = (nextActions || []).filter((a) => !a.concluidaEm && a.dueDate);
  if (!pendentes.length) return null;
  return [...pendentes].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

export async function renderKanbanPipeline(app) {
  const { partners, parceiros, partnersById, todosCards } = await carregarFunil();

  let filtroTipo = "Todos";
  let filtroDias = "0";

  const tiposDisponiveis = ["Todos", ...new Set(
    todosCards.map((p) => (p.type || "").trim()).filter(Boolean)
  )].sort((a, b) => a === "Todos" ? -1 : b === "Todos" ? 1 : a.localeCompare(b, "pt-BR"));

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Pipeline</h1>
        <div class="page-sub">${todosCards.length} parceiros</div>
      </div>
    </div>

    <div id="funil-progresso-wrap"></div>

    <div class="toolbar" style="margin-bottom:16px">
      <select class="input" id="filtro-tipo" style="max-width:220px">
        ${tiposDisponiveis.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
      </select>
      <div class="filter-row" id="filtro-dias">
        ${PRAZOS.map((p) => `<button class="chip ${p.valor === "0" ? "active" : ""}" data-dias="${esc(p.valor)}">${esc(p.label)}</button>`).join("")}
      </div>
    </div>

    <div class="funil-board" id="kanban-board"></div>
  `;

  const progressoWrap = app.querySelector("#funil-progresso-wrap");
  const board = app.querySelector("#kanban-board");

  // reconta em cima de todosCards (a mesma lista que o drag muda),
  // pra não depender de partners/parceiros ficarem sincronizados à parte.
  function desenharProgresso() {
    progressoWrap.innerHTML = funilProgressoHtml(todosCards);
  }
  desenharProgresso();

  function desenharBoard() {
    const filtrados = todosCards.filter((p) => {
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

  app.querySelector("#filtro-tipo").addEventListener("change", (e) => {
    filtroTipo = e.target.value;
    desenharBoard();
  });
  app.querySelector("#filtro-dias").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroDias = chip.dataset.dias;
    chip.parentElement.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    desenharBoard();
  });

  /* ---------- clique no card abre a ficha do parceiro (drag continua
     funcionando: dragstart só marca a intenção de arrastar, o clique
     em si dispara normalmente no dragend/click do mouse parado). ---------- */
  board.addEventListener("click", (e) => {
    const card = e.target.closest(".funil-card");
    if (!card) return;
    location.hash = `#/parceiro/${card.dataset.id}`;
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
    const p = todosCards.find((x) => x.id === id);
    if (!p || p.stage === novoStage) return;

    // mover pra "Ativo" é fechar parceria de verdade — sempre pelo mesmo
    // modal de cadastro de cupom que "Fechar parceria" usa em Prospecção
    // (cadastros.js:abrirFecharParceria), não só um drag direto. O card
    // só muda de coluna quando o modal é confirmado (dispara
    // "data-changed", que re-renderiza o Kanban do zero); cancelar não
    // move nada, porque nada foi tocado aqui.
    if (novoStage === "ativo") {
      const origem = parceiros.find((x) => x.id === id);
      if (origem) abrirFecharParceria(origem);
      return;
    }

    const stageAnterior = p.stage;
    const stageUpdatedAtAnterior = p.stageUpdatedAt;
    const agora = new Date().toISOString().slice(0, 10);
    p.stage = novoStage;
    p.stageUpdatedAt = agora;
    desenharBoard();
    desenharProgresso();
    try {
      const origem = parceiros.find((x) => x.id === id);
      const partner = await garantirPartner(id, origem, partnersById, { stage: novoStage, stageUpdatedAt: agora });
      partnersById[id] = partner;
    } catch (err) {
      console.error(err);
      p.stage = stageAnterior;
      p.stageUpdatedAt = stageUpdatedAtAnterior;
      desenharBoard();
      desenharProgresso();
      alert("Não foi possível mover o parceiro. Confira se você está logado com uma conta autorizada.");
    }
  });
}

/* ---------- funil horizontal com progresso (substitui o antigo
   .stat-grid) — só 4 nós (ícone + rótulo + número) ligados por seta;
   a lista de parceiros por estágio já mora no quadro arrastável logo
   abaixo, então esse painel não duplica os itens, só resume a
   contagem. Referência visual original: "Opção C" em
   Arquivos FRED/pipeline.png (sem o cartão de prévia). */
const ESTAGIOS_FUNIL = [
  {
    valor: "lead", label: "Prospecção", cor: "teal",
    icone: `<circle cx="9" cy="7" r="4"/><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/>`,
  },
  {
    valor: "negociacao", label: "Negociação / Contato", cor: "amber",
    icone: `<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"/>`,
  },
  {
    valor: "ativo", label: "Ativos", cor: "green",
    icone: `<polyline points="20 6 9 17 4 12"/>`,
  },
  {
    valor: "perdido", label: "Perdidos", cor: "red",
    icone: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>`,
  },
];
function funilProgressoHtml(todosCards) {
  const numeros = {
    lead: todosCards.filter((p) => p.stage === "lead").length,
    negociacao: todosCards.filter((p) => p.stage === "negociacao").length,
    ativo: todosCards.filter((p) => p.stage === "ativo").length,
    perdido: todosCards.filter((p) => p.stage === "perdido").length,
  };
  return `<div class="funil-progresso">
    ${ESTAGIOS_FUNIL.map((e, i) => `
      ${i > 0 ? `<div class="fp-seta">→</div>` : ""}
      <div class="fp-no">
        <div class="fp-icone fp-icone--${e.cor}"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${e.icone}</svg></div>
        <div class="fp-label fp-label--${e.cor}">${esc(e.label.toUpperCase())}</div>
        <div class="fp-numero fp-numero--${e.cor}">${numeros[e.valor]}</div>
      </div>
    `).join("")}
  </div>`;
}

function cardHtml(p) {
  const na = proximaPendente(p.nextActions);
  const nivel = na ? nivelUrgencia(na.dueDate) : "";
  return `<div class="funil-card" draggable="${isEditor() ? "true" : "false"}" data-id="${esc(p.id)}">
    <div class="funil-card-title">${esc(p.name)}</div>
    ${p.type ? `<div class="funil-card-sub">${esc(p.type)}</div>` : ""}
    <div class="funil-card-sub">${esc(diasLabel(p.stageUpdatedAt))}</div>
    ${na ? `<div class="funil-card-next${nivel ? ` funil-card-next--${nivel}` : ""}">${esc(na.description || "")}${na.dueDate ? ` · ${esc(formatDataBR(na.dueDate))}` : ""}</div>` : ""}
  </div>`;
}
