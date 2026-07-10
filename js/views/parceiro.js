/* Detalhe do Parceiro — dados da parceria + Base de Dados (lançamentos
   de desempenho do cupom naquela loja, alimentados manualmente a partir
   da plataforma interna de cada loja). */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { badgeFromLista } from "../ui/badges.js";
import { abrirEditarParceiro, abrirNovoLancamento } from "./cadastros.js";

const PERIODO_LABEL = { dia: "Dia", semana: "Semana", mes: "Mês", personalizado: "Personalizado" };

export async function renderParceiro(app, id) {
  const parceiro = await store.getParceiro(id);
  if (!parceiro) {
    app.innerHTML = `<a class="back-link" href="#/parceiros">← Voltar para parceiros</a>
      <div class="empty">Parceiro não encontrado.</div>`;
    return;
  }

  const [listas, lancamentos] = await Promise.all([
    store.getListas(),
    store.lancamentosDoParceiro(id),
  ]);

  const totalUso = lancamentos.reduce((s, l) => s + l.quantidadeUso, 0);
  const totalCupom = lancamentos.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = lancamentos.reduce((s, l) => s + l.faturamentoTotalSemCupom, 0);
  const ticketMedioGeral = totalUso > 0 ? totalCupom / totalUso : 0;

  app.innerHTML = `
    <a class="back-link" href="#/parceiros">← Voltar para parceiros</a>

    <div class="detail-head">
      <div>
        <h1 class="page-title">${esc(parceiro.nome)}</h1>
        <div class="page-sub">Cupom <strong>${esc(parceiro.cupom)}</strong> · ${esc(parceiro.area || "—")}</div>
      </div>
      <div class="row-end">
        ${badgeFromLista(listas.statusCupom, parceiro.statusCupom)}
        <button class="btn" data-act="editar">Editar</button>
        <button class="btn btn-ghost btn-danger" data-act="excluir" title="Excluir parceiro">🗑</button>
      </div>
    </div>

    <div class="meta-grid">
      ${metaCell("Tipo", esc(parceiro.tipo || "—"))}
      ${metaCell("Local", esc(parceiro.local || "—"))}
      ${metaCell("Responsável", esc(parceiro.responsavel || "—"))}
      ${metaCell("Contato", esc(parceiro.contato || "—"))}
      ${metaCell("Período de desconto", esc(parceiro.periodoDesconto || "—"))}
      ${metaCell("Vigência", `${esc(formatDataBR(parceiro.dataInicio))} – ${esc(formatDataBR(parceiro.dataVencimento))}`)}
    </div>
    ${parceiro.observacoes ? `<div class="note"><span class="note-i">ⓘ</span>${esc(parceiro.observacoes)}</div>` : ""}

    <!-- RESUMO -->
    <div class="stat-grid">
      ${stat(totalUso, "Usos registrados")}
      ${stat(formatMoeda(totalCupom), "Faturamento via cupom")}
      ${stat(formatMoeda(totalSemCupom), "Faturamento total sem cupom")}
      ${stat(formatMoeda(ticketMedioGeral), "Ticket médio geral")}
    </div>

    <!-- BASE DE DADOS -->
    <section class="section">
      <div class="section-head"><h2>Base de dados</h2>
        <button class="btn btn-ghost" data-act="novo-lancamento">+ Novo lançamento</button></div>
      <div class="note"><span class="note-i">ⓘ</span>
        Desempenho do cupom por período, alimentado manualmente a partir da plataforma interna da loja.</div>
      <div class="list-card" id="lancamentos">
        ${lancamentos.length ? lancamentos.map((l) => lancamentoRow(l)).join("")
          : `<div class="empty">Nenhum lançamento registrado ainda.</div>`}
      </div>
    </section>
  `;

  const acoes = {
    "editar": () => abrirEditarParceiro(parceiro),
    "excluir": async () => {
      if (!confirm(`Excluir o parceiro "${parceiro.nome}"?\n\nIsto remove também todos os lançamentos da base de dados deste parceiro. Não dá para desfazer.`)) return;
      await store.removeParceiro(parceiro.id);
      location.hash = "#/parceiros";
    },
    "novo-lancamento": () => abrirNovoLancamento(parceiro.id),
  };
  app.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => acoes[btn.dataset.act]?.())
  );

  const porId = Object.fromEntries(lancamentos.map((l) => [l.id, l]));
  app.querySelector("#lancamentos").addEventListener("click", async (e) => {
    const lid = e.target.dataset.id;
    if (!lid) return;
    const l = porId[lid];
    if (!l) return;
    if (e.target.dataset.action === "editar") return abrirNovoLancamento(parceiro.id, l);
    if (e.target.dataset.action === "excluir") {
      if (!confirm("Excluir este lançamento?")) return;
      await store.removeLancamento(lid);
      window.dispatchEvent(new CustomEvent("data-changed"));
    }
  });
}

function metaCell(label, valueHtml) {
  return `<div class="meta-cell">
    <div class="meta-label">${label}</div>
    <div class="meta-value">${valueHtml}</div>
  </div>`;
}

function stat(num, label) {
  return `<div class="stat">
    <div class="stat-num">${num}</div>
    <div class="stat-label">${esc(label)}</div>
  </div>`;
}

function lancamentoRow(l) {
  const rotulo = l.periodoLabel || PERIODO_LABEL[l.periodoTipo] || "";
  return `<div class="list-row">
    <div class="lr-main">
      <div class="lr-title">${esc(formatDataBR(l.data))} ${rotulo ? `<span class="muted" style="font-weight:400">· ${esc(rotulo)}</span>` : ""}</div>
      <div class="lr-sub">${l.quantidadeUso} usos · ${esc(formatMoeda(l.faturamentoCupom))} no cupom · ticket médio ${esc(formatMoeda(l.ticketMedio))}</div>
      ${l.observacoes ? `<div class="lr-sub">${esc(l.observacoes)}</div>` : ""}
    </div>
    <span class="lr-actions">
      <button class="icon-btn" data-action="editar" data-id="${esc(l.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(l.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}
