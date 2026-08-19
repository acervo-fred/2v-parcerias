/* Lista de Prospecção — cadastro simples de lugares que podem virar
   parceiro (só tipo/nome/local/responsável/contato/observações, sem
   Área nem Status). O estágio de cada negócio é sempre derivado do
   Kanban (ver js/views/kanban.js): sem nenhum registro em `partners`
   (ou stage "lead"), a linha aparece "crua"; assim que alguém arrasta
   o card pra "Negociação / Em contato" no Kanban, a linha aqui ganha
   o badge "Em contato". O botão "Fechar parceria" (que registra o
   cupom e marca ehParceiro=true — ver cadastros.js:abrirFecharParceria)
   fica disponível o tempo todo, desde o cadastro até fechar — não
   precisa esperar o card avançar no Kanban.

   "Ver parceiro →" aparece pra registros já fechados (ehParceiro=true);
   clicar em qualquer outro ponto da linha leva pra página do negócio. */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { badge } from "../ui/badges.js";
import { abrirNovoProspecto, abrirFecharParceria } from "./cadastros.js";

export async function renderProspeccao(app) {
  const [negocios, partners] = await Promise.all([store.listParceiros(), store.listPartners()]);
  const partnersById = Object.fromEntries(partners.map((p) => [p.id, p]));

  let busca = "";

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Prospecção</h1>
        <div class="page-sub" id="contador">${negocios.length} negócios</div>
      </div>
      <div class="toolbar edit-only">
        <button class="btn btn-primary" data-act="novo">+ Nova prospecção</button>
      </div>
    </div>

    <div class="toolbar" style="margin-bottom:16px">
      <input class="input" id="busca" type="search" placeholder="Buscar por nome, local ou responsável…" />
    </div>

    <div class="list-card" id="lista"></div>
  `;

  const lista = app.querySelector("#lista");
  const porId = Object.fromEntries(negocios.map((p) => [p.id, p]));

  function desenhar() {
    const termo = busca.trim().toLowerCase();
    const arr = negocios.filter((p) => !termo
      || p.nome.toLowerCase().includes(termo)
      || (p.local || "").toLowerCase().includes(termo)
      || (p.responsavel || "").toLowerCase().includes(termo)
      || (p.contato || "").toLowerCase().includes(termo)
    ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    lista.innerHTML = arr.length
      ? arr.map((p) => row(p, partnersById)).join("")
      : `<div class="empty">Nenhum negócio encontrado.</div>`;

    app.querySelector("#contador").textContent = `${arr.length} negócios`;
  }
  desenhar();

  app.querySelector("#busca").addEventListener("input", (e) => { busca = e.target.value; desenhar(); });

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
      return;
    }
    location.hash = `#/parceiro/${id}`;
  });
}

function row(p, partnersById) {
  const partes = [p.tipo, p.local, p.responsavel, p.contato].filter(Boolean);
  const stage = partnersById[p.id]?.stage;
  const acao = p.ehParceiro
    ? `<a class="btn btn-sm btn-ghost" href="#/parceiro/${esc(p.id)}">Ver parceiro →</a>`
    : `<button class="btn btn-sm btn-primary edit-only" data-action="fechar" data-id="${esc(p.id)}">Fechar parceria</button>`;
  const statusBadge = !p.ehParceiro && stage === "negociacao" ? badge("Em contato", "amber")
    : !p.ehParceiro && stage === "perdido" ? badge("Perdido", "red")
    : "";
  return `<div class="list-row" data-id="${esc(p.id)}">
    <div class="lr-main">
      <div class="lr-title">${esc(p.nome)} ${statusBadge}</div>
      <div class="lr-sub">${esc(partes.join(" · "))}</div>
      ${p.observacoes ? `<div class="lr-sub">${esc(p.observacoes)}</div>` : ""}
    </div>
    ${acao}
    <span class="lr-actions edit-only">
      <button class="icon-btn" data-action="editar" data-id="${esc(p.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(p.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}
