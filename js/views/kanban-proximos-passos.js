/* Próximos passos — "A Fazer": todas as próximas ações de qualquer
   negócio do funil (Lead, Negociação, Ativo ou Perdido — mesma base
   de js/data/funil.js:carregarFunil, pra nunca divergir do Pipeline),
   numa lista agrupada por responsável e num calendário-agenda do mês
   (barras coloridas por responsável, cobrindo o intervalo da ação).
   Cada negócio pode ter VÁRIAS ações em aberto ao mesmo tempo — a
   lista/calendário trabalham em cima de pares {card, acao} achatados
   (uma linha/barra por ação, não por negócio). Ao concluir, a ação não
   some: vai pro repositório "Concluídas" no fim da página. */

import { store } from "../data/store.js";
import { esc, formatDataBR } from "../ui/dom.js";
import { openModal, fieldText, fieldTextarea, readValue } from "../ui/modal.js";
import { fieldResponsavel, wireResponsavelField, readResponsavel } from "../ui/campo-responsavel.js";
import { acaoRowHtml } from "../ui/acao-row.js";
import {
  carregarFunil, garantirPartner, nivelUrgencia,
  criarAcao, adicionarAcao, editarAcao, concluirAcao, excluirAcao,
  corDe, bucketDe, MES_NOMES,
} from "../data/funil.js";

const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent("data-changed"));
}

// card sintético pras tasks "Geral" (sem negócio vinculado) — mesmo
// formato {id,name} de um card de verdade, pra reaproveitar toda a
// lógica de agrupamento/calendário sem precisar de um caso especial.
const CARD_GERAL = { id: "geral", name: "Geral" };

// achata todo card.nextActions + as tasks gerais num array de pares
// {card, acao}
function listarAcoesPendentes(todosCards, tasksGerais) {
  const out = [];
  for (const card of todosCards) for (const acao of card.nextActions) if (!acao.concluidaEm) out.push({ card, acao });
  for (const acao of tasksGerais) if (!acao.concluidaEm) out.push({ card: CARD_GERAL, acao });
  return out;
}
function listarAcoesConcluidas(todosCards, tasksGerais) {
  const out = [];
  for (const card of todosCards) for (const acao of card.nextActions) if (acao.concluidaEm) out.push({ card, acao });
  for (const acao of tasksGerais) if (acao.concluidaEm) out.push({ card: CARD_GERAL, acao });
  return out.sort((a, b) => (b.acao.concluidaEm || "").localeCompare(a.acao.concluidaEm || ""));
}
function agruparPorData(pares) {
  const mapa = new Map();
  for (const par of pares) {
    const d = par.acao.dueDate;
    if (!d) continue;
    if (!mapa.has(d)) mapa.set(d, []);
    mapa.get(d).push(par);
  }
  return [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
// agrupa em 4 blocos fixos (Fred/Manu/Laura/Outros) — "Outros" cobre
// nome personalizado e ações antigas sem responsável definido
function agruparPorResponsavel(pares) {
  const buckets = new Map([["Fred", []], ["Manu", []], ["Laura", []], ["Outros", []]]);
  for (const par of pares) buckets.get(bucketDe(par.acao.responsavel)).push(par);
  return [...buckets.entries()].filter(([, lista]) => lista.length);
}
function listaAgrupadaHtml(pares, vazioTexto, concluida) {
  const buckets = agruparPorResponsavel(pares);
  if (!buckets.length) return `<div class="empty">${esc(vazioTexto)}</div>`;
  return buckets.map(([responsavel, doResponsavel]) => {
    const grupos = agruparPorData(doResponsavel);
    return `
      <h3 class="acoes-responsavel-label"><span class="pp-cor-dot pp-cor-dot--${corDe(responsavel)}"></span> ${esc(responsavel)}</h3>
      ${grupos.map(([data, lista]) => {
        const nivel = !concluida ? nivelUrgencia(data) : "";
        return `
          <div class="acoes-data-label${nivel ? ` acoes-data-label--${nivel}` : ""}">${esc(formatDataBR(data))}</div>
          <div class="list-card" style="margin-bottom:14px">
            ${lista.map(({ card, acao }) => acaoRowHtml(card.id, acao, { concluida, nome: card.name })).join("")}
          </div>
        `;
      }).join("")}
    `;
  }).join("");
}

export async function renderProximosPassos(app) {
  const [{ parceiros, partnersById, todosCards }, tasksGerais] = await Promise.all([
    carregarFunil(),
    store.listTasksGerais(),
  ]);
  let mesRef = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">A Fazer</h1></div>
      <div class="toolbar edit-only">
        <button class="btn btn-primary" data-act="nova-acao">+ Cadastrar ação</button>
      </div>
    </div>

    <section class="section">
      <div id="pp-lista"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Calendário</h2></div>
      <div class="pp-legenda">
        ${["Fred", "Manu", "Laura", "Outros"].map((r) => `<span class="pp-legenda-item"><i class="pp-cor-dot pp-cor-dot--${corDe(r)}"></i>${esc(r)}</span>`).join("")}
      </div>
      <div class="cal-nav">
        <button type="button" class="btn btn-ghost btn-sm" id="pp-cal-prev">‹</button>
        <strong id="pp-cal-titulo"></strong>
        <button type="button" class="btn btn-ghost btn-sm" id="pp-cal-next">›</button>
      </div>
      <div id="pp-calendario"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Concluídas</h2></div>
      <div id="pp-concluidas"></div>
    </section>
  `;

  function desenharLista() {
    app.querySelector("#pp-lista").innerHTML = listaAgrupadaHtml(listarAcoesPendentes(todosCards, tasksGerais), "Nenhuma próxima ação pendente.", false);
  }
  function desenharConcluidas() {
    app.querySelector("#pp-concluidas").innerHTML = listaAgrupadaHtml(listarAcoesConcluidas(todosCards, tasksGerais), "Nenhuma ação concluída ainda.", true);
  }
  desenharLista();
  desenharConcluidas();

  async function onCliqueAcao(e) {
    const row = e.target.closest(".acao-row");
    if (!row) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const cardId = row.dataset.cardId;
    const acaoId = row.dataset.id;

    if (cardId === "geral") {
      const acao = tasksGerais.find((a) => a.id === acaoId);
      if (!acao) return;
      if (act === "concluir") {
        await store.updateTaskGeral(acaoId, { concluidaEm: new Date().toISOString().slice(0, 10) });
        avisarMudanca();
      } else if (act === "editar") {
        abrirFormAcao(todosCards, parceiros, partnersById, { card: CARD_GERAL, acao });
      } else if (act === "excluir") {
        if (!confirm(`Excluir a ação "${acao.description}"?`)) return;
        await store.removeTaskGeral(acaoId);
        avisarMudanca();
      }
      return;
    }

    const card = todosCards.find((c) => c.id === cardId);
    const partner = partnersById[cardId];
    const acao = card?.nextActions.find((a) => a.id === acaoId);
    if (!card || !partner || !acao) return;
    if (act === "concluir") {
      await concluirAcao(cardId, partner, acaoId);
      avisarMudanca();
    } else if (act === "editar") {
      abrirFormAcao(todosCards, parceiros, partnersById, { card, acao });
    } else if (act === "excluir") {
      if (!confirm(`Excluir a ação "${acao.description}"?`)) return;
      await excluirAcao(cardId, partner, acaoId);
      avisarMudanca();
    }
  }
  app.querySelector("#pp-lista").addEventListener("click", onCliqueAcao);
  app.querySelector("#pp-concluidas").addEventListener("click", onCliqueAcao);

  function desenharCalendario() {
    const ano = mesRef.getFullYear(), mes = mesRef.getMonth() + 1;
    app.querySelector("#pp-cal-titulo").textContent = `${MES_NOMES[mes - 1]} / ${ano}`;
    app.querySelector("#pp-calendario").innerHTML = calendarioHtml(todosCards, tasksGerais, ano, mes);
  }
  desenharCalendario();
  app.querySelector("#pp-cal-prev").addEventListener("click", () => {
    mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth() - 1, 1);
    desenharCalendario();
  });
  app.querySelector("#pp-cal-next").addEventListener("click", () => {
    mesRef = new Date(mesRef.getFullYear(), mesRef.getMonth() + 1, 1);
    desenharCalendario();
  });

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='nova-acao']")) abrirFormAcao(todosCards, parceiros, partnersById);
  });
}

/* ---------- calendário-agenda: grade de 7 colunas por semana, com
   uma ou mais "pistas" de barras (cada barra = uma ação pendente,
   cobrindo os dias entre dataInicio e dueDate) — sem biblioteca, mesmo
   espírito do calendário de js/views/lancamentos.js, mas com barras ao
   invés de células coloridas. Duas ações do mesmo negócio no mesmo dia
   viram duas barras em pistas separadas (estilo agenda). ---------- */
function isoDia(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// semanas (segunda a domingo) que cobrem o mês inteiro, incluindo os
// dias de fora que completam a primeira/última semana
function semanasDoMes(ano, mes) {
  const primeiro = new Date(ano, mes - 1, 1);
  const offsetInicio = (primeiro.getDay() + 6) % 7;
  const cursor = new Date(ano, mes - 1, 1 - offsetInicio);
  const fimMes = new Date(ano, mes, 0);
  const semanas = [];
  while (cursor <= fimMes) {
    const semana = [];
    for (let i = 0; i < 7; i++) {
      semana.push(isoDia(cursor.getFullYear(), cursor.getMonth() + 1, cursor.getDate()));
      cursor.setDate(cursor.getDate() + 1);
    }
    semanas.push(semana);
  }
  return semanas;
}
// cada ação pendente vira um item com intervalo [inicio,fim] — ações
// antigas sem dataInicio gravada viram evento de 1 dia só, na própria
// dueDate (fallback só de exibição, não reescreve o dado).
function listarAcoesCalendario(todosCards, tasksGerais) {
  return listarAcoesPendentes(todosCards, tasksGerais).map(({ card, acao }) => {
    const fim = acao.dueDate;
    const inicio = acao.dataInicio && acao.dataInicio <= fim ? acao.dataInicio : fim;
    return { id: acao.id, name: card.name, responsavel: acao.responsavel, description: acao.description, inicio, fim };
  });
}
function calendarioHtml(todosCards, tasksGerais, ano, mes) {
  const acoes = listarAcoesCalendario(todosCards, tasksGerais);
  const semanas = semanasDoMes(ano, mes);
  const hoje = new Date().toISOString().slice(0, 10);
  return `
    <div class="pp-cal-row pp-cal-dow">
      ${DIAS_SEMANA.map((d) => `<div>${d}</div>`).join("")}
    </div>
    ${semanas.map((semana) => semanaHtml(semana, acoes, mes, hoje)).join("")}
  `;
}
function semanaHtml(semana, acoes, mes, hoje) {
  const cabecalho = `<div class="pp-cal-row">
    ${semana.map((d) => {
      const foraDoMes = Number(d.slice(5, 7)) !== mes;
      const classes = ["pp-cal-daynum"];
      if (foraDoMes) classes.push("pp-cal-daynum--fora");
      if (d === hoje) classes.push("pp-cal-daynum--hoje");
      return `<div class="${classes.join(" ")}">${Number(d.slice(8, 10))}</div>`;
    }).join("")}
  </div>`;

  const daSemana = acoes
    .filter((a) => a.fim >= semana[0] && a.inicio <= semana[6])
    .sort((a, b) => a.inicio.localeCompare(b.inicio));

  const finalPorPista = [];
  const posicionadas = daSemana.map((a) => {
    const colStart = a.inicio <= semana[0] ? 0 : semana.indexOf(a.inicio);
    const colEnd = a.fim >= semana[6] ? 6 : semana.indexOf(a.fim);
    let pista = finalPorPista.findIndex((fim) => fim < colStart);
    if (pista === -1) { pista = finalPorPista.length; finalPorPista.push(colEnd); }
    else finalPorPista[pista] = colEnd;
    return { ...a, colStart, colEnd, pista };
  });

  const pistas = finalPorPista.map((_, pistaIdx) => `<div class="pp-cal-row pp-cal-lane">
    ${posicionadas.filter((a) => a.pista === pistaIdx).map((a) => `
      <div class="pp-bar pp-bar--${corDe(a.responsavel)}" style="grid-column:${a.colStart + 1}/${a.colEnd + 2}" title="${esc(a.name)} — ${esc(a.description)}" data-id="${esc(a.id)}">${esc(a.name)} — ${esc(a.description)}</div>
    `).join("")}
  </div>`).join("");

  return `<div class="pp-cal-week">${cabecalho}${pistas}</div>`;
}

/* ---------- modal "Cadastrar ação" / "Editar ação" ---------- */
function opcoesNegocioHtml(todosCards, valorAtual) {
  return [...todosCards]
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    .map((p) => `<option value="${esc(p.id)}" ${p.id === valorAtual ? "selected" : ""}>${esc(p.name)}</option>`).join("");
}
async function abrirFormAcao(todosCards, parceiros, partnersById, existente = null) {
  const ed = !!existente;
  const acao = existente?.acao || {};
  openModal({
    title: ed ? "Editar ação" : "Cadastrar ação",
    subtitle: ed ? existente.card.name : "",
    submitLabel: "Salvar",
    wide: true,
    bodyHtml: `
      ${ed ? "" : `
        <div class="field">
          <label for="f_negocioId">Parceiro</label>
          <select id="f_negocioId" name="negocioId">
            <option value="">Geral</option>
            ${opcoesNegocioHtml(todosCards)}
          </select>
        </div>
      `}
      ${fieldTextarea("description", "Descrição", { required: true, value: acao.description || "", placeholder: "Ex.: Ligar pra confirmar renovação do cupom" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início (opcional)", { type: "date", value: acao.dataInicio || "" })}
        ${fieldText("dueDate", "Prazo", { type: "date", required: true, value: acao.dueDate || "" })}
      </div>
      ${fieldResponsavel(acao.responsavel || "")}
    `,
    onMount: wireResponsavelField,
    onSubmit: async (form) => {
      const description = readValue(form, "description");
      const dueDate = readValue(form, "dueDate");
      const dataInicio = readValue(form, "dataInicio") || new Date().toISOString().slice(0, 10);
      const responsavel = readResponsavel(form);
      if (!description) throw new Error("Descreva a ação.");
      if (!dueDate) throw new Error("Informe o prazo.");
      if (ed) {
        if (existente.card.id === "geral") {
          await store.updateTaskGeral(existente.acao.id, { description, dueDate, dataInicio, responsavel });
        } else {
          const partner = partnersById[existente.card.id];
          await editarAcao(existente.card.id, partner, existente.acao.id, { description, dueDate, dataInicio, responsavel });
        }
      } else {
        const negocioId = readValue(form, "negocioId");
        if (!negocioId) {
          await store.addTaskGeral({ description, dueDate, dataInicio, responsavel });
        } else if (partnersById[negocioId]) {
          await adicionarAcao(negocioId, partnersById[negocioId], { description, dueDate, dataInicio, responsavel });
        } else {
          const origem = parceiros.find((p) => p.id === negocioId);
          await garantirPartner(negocioId, origem, partnersById, {
            nextActions: [criarAcao({ description, dueDate, dataInicio, responsavel })],
          });
        }
      }
      avisarMudanca();
    },
  });
}
