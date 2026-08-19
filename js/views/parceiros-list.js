/* Cadastro de Parceiros — negócios que já fecharam parceria (têm cupom).
   Clique na linha abre o detalhe do parceiro (dados + Base de Dados). */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { badgeFromLista } from "../ui/badges.js";
import { validadeCupomTexto, cupomEm50, chaveCupom, statusCupomEfetivo } from "../util/cupom.js";
import { openModal, fieldText, fieldTextarea, readValue } from "../ui/modal.js";
import { fieldResponsavel, wireResponsavelField, readResponsavel } from "../ui/campo-responsavel.js";
import { abrirNovoParceiro, abrirEditarParceiro } from "./cadastros.js";
import { adicionarAcao, garantirPartner, criarAcao } from "../data/funil.js";

export async function renderParceiros(app) {
  const [parceiros, listas, grupos, partners] = await Promise.all([
    store.listParceirosFechados(),
    store.getListas(),
    store.listGrupos(),
    store.listPartners(),
  ]);
  const partnersById = Object.fromEntries(partners.map((p) => [p.id, p]));

  let busca = "";
  let filtroStatus = "Todos";
  let ordem = "cupom";
  const selecionados = new Set();

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Parceiros</h1>
        <div class="page-sub">${parceiros.length} parceiros com cupom ativo</div>
      </div>
      <div class="toolbar edit-only">
        <button class="btn btn-ghost" data-act="proxima-acao-lote">Definir próxima ação</button>
        <button class="btn btn-primary" data-act="novo">+ Novo parceiro</button>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom:16px; gap:10px">
      <input class="input" id="busca" type="search" placeholder="Buscar por nome, cupom ou responsável…" style="flex:1;min-width:200px" />
      <select class="input" id="ordem" style="width:auto">
        <option value="cupom">Ordenar por cupom</option>
        <option value="nome">Ordenar por nome do parceiro</option>
      </select>
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
      const okStatus = filtroStatus === "Todos" || statusCupomEfetivo(p) === filtroStatus;
      return okBusca && okStatus;
    }).sort((a, b) => ordem === "cupom"
      ? (a.cupom || "").localeCompare(b.cupom || "", "pt-BR")
      : a.nome.localeCompare(b.nome, "pt-BR"));

    lista.innerHTML = arr.length
      ? arr.map((p) => row(p, listas, grupos, selecionados)).join("")
      : `<div class="empty">Nenhum parceiro encontrado.</div>`;
  }
  desenhar();

  app.querySelector("#busca").addEventListener("input", (e) => { busca = e.target.value; desenhar(); });
  app.querySelector("#ordem").addEventListener("change", (e) => { ordem = e.target.value; desenhar(); });
  filtros.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filtroStatus = chip.dataset.status;
    filtros.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c === chip));
    desenhar();
  });

  app.querySelector(".page-head .toolbar").addEventListener("click", (e) => {
    if (e.target.closest("[data-act='novo']")) return abrirNovoParceiro();
    if (e.target.closest("[data-act='proxima-acao-lote']")) {
      if (!selecionados.size) { alert("Selecione ao menos um parceiro."); return; }
      const ids = [...selecionados];
      const porId = Object.fromEntries(parceiros.map((p) => [p.id, p]));
      abrirProximaAcaoEmLote(ids, porId, partnersById, () => { selecionados.clear(); desenhar(); });
    }
  });

  lista.addEventListener("change", (e) => {
    const cb = e.target.closest(".row-select");
    if (!cb) return;
    if (cb.checked) selecionados.add(cb.dataset.id);
    else selecionados.delete(cb.dataset.id);
  });

  lista.addEventListener("click", async (e) => {
    if (e.target.closest(".row-select")) return;
    if (e.target.closest("[data-action='editar']")) {
      const row = e.target.closest("[data-id]");
      const p = parceiros.find((x) => x.id === row?.dataset.id);
      if (p) abrirEditarParceiro(p);
      return;
    }
    if (e.target.closest("[data-action='pausar']")) {
      const row = e.target.closest("[data-id]");
      const p = parceiros.find((x) => x.id === row?.dataset.id);
      if (!p) return;
      const novoStatus = statusCupomEfetivo(p) === "Pausado" ? "Ativo" : "Pausado";
      // pausa/reativa todo mundo que compartilha o mesmo código de cupom,
      // mesmo padrão de "cuponsIrmaos" já usado em ficha-parceiro.js
      const irmaos = parceiros.filter((x) => chaveCupom(x) === chaveCupom(p));
      await Promise.all(irmaos.map((x) => store.updateParceiro(x.id, { statusCupom: novoStatus })));
      window.dispatchEvent(new CustomEvent("data-changed"));
      return;
    }
    const row = e.target.closest("[data-id]");
    if (row) location.hash = `#/parceiro/${row.dataset.id}`;
  });
}

function row(p, listas, grupos, selecionados) {
  const contatoValidade = [p.contato, validadeCupomTexto(p, grupos)].filter(Boolean).join(" · ");
  const statusEfetivo = statusCupomEfetivo(p);
  const pausado = statusEfetivo === "Pausado";
  const classesCupom = [cupomEm50(p, grupos) ? "cupom-codigo--50" : "", pausado ? "cupom-pausado" : ""].filter(Boolean).join(" ");
  return `<div class="list-row clickable" data-id="${esc(p.id)}">
    <input type="checkbox" class="row-select edit-only" data-id="${esc(p.id)}" ${selecionados.has(p.id) ? "checked" : ""} />
    <div class="lr-main">
      <div class="lr-title lr-title-normal"><strong${classesCupom ? ` class="${classesCupom}"` : ""}>${esc((p.cupom || "").toUpperCase())}</strong> ${esc(p.nome)}${p.responsavel ? ` — ${esc(p.responsavel)}` : ""}</div>
      <div class="lr-sub">${esc(contatoValidade)}</div>
    </div>
    ${badgeFromLista(listas.statusCupom, statusEfetivo)}
    <button class="btn btn-sm btn-ghost edit-only" data-action="pausar" title="${pausado ? "Reativar cupom" : "Pausar cupom"}">${pausado ? "Reativar cupom" : "Pausar cupom"}</button>
    <button class="icon-btn edit-only" data-action="editar" title="Editar">✎</button>
    <span class="muted">›</span>
  </div>`;
}

async function abrirProximaAcaoEmLote(ids, porId, partnersById, aoTerminar) {
  const nomes = ids.map((id) => porId[id]?.nome).filter(Boolean);
  openModal({
    title: "Definir próxima ação",
    subtitle: `Aplicar pra ${ids.length} parceiro${ids.length === 1 ? "" : "s"} selecionado${ids.length === 1 ? "" : "s"}: ${nomes.join(", ")}`,
    submitLabel: "Salvar",
    bodyHtml: `
      ${fieldTextarea("description", "Descrição", { required: true, placeholder: "Ex.: Ligar pra confirmar renovação do cupom" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início (opcional)", { type: "date" })}
        ${fieldText("dueDate", "Prazo", { type: "date", required: true })}
      </div>
      ${fieldResponsavel()}
    `,
    onMount: wireResponsavelField,
    onSubmit: async (form) => {
      const description = readValue(form, "description");
      const dueDate = readValue(form, "dueDate");
      const dataInicio = readValue(form, "dataInicio") || new Date().toISOString().slice(0, 10);
      const responsavel = readResponsavel(form);
      if (!description) throw new Error("Descreva a próxima ação.");
      if (!dueDate) throw new Error("Informe o prazo da próxima ação.");
      const resultados = await Promise.allSettled(
        ids.map((id) => partnersById[id]
          ? adicionarAcao(id, partnersById[id], { description, dueDate, dataInicio, responsavel })
          : garantirPartner(id, porId[id], partnersById, { nextActions: [criarAcao({ description, dueDate, dataInicio, responsavel })] }))
      );
      const falhas = resultados
        .map((r, i) => (r.status === "rejected" ? porId[ids[i]]?.nome || ids[i] : null))
        .filter(Boolean);
      if (falhas.length) throw new Error(`Não deu pra salvar pra: ${falhas.join(", ")}.`);
      aoTerminar();
    },
  });
}
