/* Ficha do Parceiro — CRM: cadastro do partner, próxima ação em
   destaque, timeline de interações e lançamentos vinculados (via
   campaignPartners) lêem o schema novo (partners/interactions/
   campaignPartners), populado pela migração da Fase 1.

   O "Cupom vinculado" é diferente: lê e edita direto o schema ANTIGO
   (parceiro.cupom/statusCupom/periodoDesconto/dataInicio/
   dataVencimento/grupoCupom) — o mesmo cupom que aparece nas telas
   Cupons e Parceiros, não uma cópia congelada. Editar aqui bulk-
   atualiza todo mundo que compartilha o mesmo código (mesmo padrão
   já usado em cupons.js pra grupo), e uso/faturamento são somados a
   partir dos lançamentos de verdade (dedupLancamentos), não de um
   valor gravado uma vez na migração. */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { badge, badgeFromLista } from "../ui/badges.js";
import { openModal, fieldText, fieldTextarea, fieldSelect, readValue } from "../ui/modal.js";
import { fieldResponsavel, wireResponsavelField, readResponsaveis } from "../ui/campo-responsavel.js";
import { acaoRowHtml } from "../ui/acao-row.js";
import { acoesDe, adicionarAcao, editarAcao, concluirAcao, excluirAcao, responsaveisDe, STAGE_META } from "../data/funil.js";
import { chaveCupom, validadeCupomTexto, cupomEm50 } from "../util/cupom.js";
import { dedupLancamentos } from "../util/periodo.js";

const INTERACTION_META = {
  email: { label: "E-mail", cor: "blue" },
  ligacao: { label: "Ligação", cor: "teal" },
  reuniao: { label: "Reunião", cor: "violet" },
  whatsapp: { label: "WhatsApp", cor: "green" },
  nota: { label: "Nota", cor: "gray" },
};
const INTERACTION_TIPOS = Object.entries(INTERACTION_META).map(([valor, m]) => ({ valor, label: m.label }));

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent("data-changed"));
}

export async function renderFichaParceiro(app, id) {
  const partner = await store.getPartner(id);
  if (!partner) {
    app.innerHTML = `<a class="back-link" href="#/parceiros/ativos">← Voltar para parceiros</a>
      <div class="empty">Parceiro não encontrado.</div>`;
    return;
  }

  const [interactions, campaignPartners, listas, parceiro, todosParceiros, grupos, lancamentosTodos] = await Promise.all([
    store.interactionsDoPartner(id),
    store.campaignPartnersDoPartner(id),
    store.getListas(),
    store.getParceiro(id),
    store.listParceiros(),
    store.listGrupos(),
    store.listLancamentos(),
  ]);

  const campaignIds = [...new Set(campaignPartners.map((cp) => cp.campaignId).filter(Boolean))];
  const campanhas = await Promise.all(campaignIds.map((cid) => store.getCampaign(cid)));
  const campanhaPorId = Object.fromEntries(campanhaPares(campaignIds, campanhas));

  const cuponsIrmaos = parceiro?.cupom ? todosParceiros.filter((p) => chaveCupom(p) === chaveCupom(parceiro)) : [];
  const lancamentosDoCupom = dedupLancamentos(lancamentosTodos.filter((l) => cuponsIrmaos.some((p) => p.id === l.parceiroId)));
  const usoCupom = lancamentosDoCupom.reduce((s, l) => s + l.quantidadeUso, 0);
  const fatCupom = lancamentosDoCupom.reduce((s, l) => s + l.faturamentoCupom, 0);

  const stageMeta = STAGE_META[partner.stage] || { label: partner.stage || "—", cor: "gray" };
  const acoesPendentes = acoesDe(partner).filter((a) => !a.concluidaEm);

  app.innerHTML = `
    <a class="back-link" href="#/parceiros/ativos">← Voltar para parceiros</a>

    <div class="detail-head">
      <div>
        <h1 class="page-title">${esc(partner.name)}</h1>
        <div class="page-sub">${badge(stageMeta.label, stageMeta.cor)} ${esc([partner.type, partner.typeDetalhe].filter(Boolean).join(" — ") || "—")}</div>
      </div>
      <div class="row-end">
        <button class="btn edit-only" data-act="editar-cadastro">Editar cadastro</button>
        <button class="btn btn-ghost btn-danger edit-only" data-act="excluir" title="Excluir parceiro">🗑</button>
      </div>
    </div>

    ${(partner.tags || []).length ? `<div class="row-end" style="margin-bottom:16px">${partner.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</div>` : ""}

    <div class="meta-grid">
      ${metaCell("Endereço", esc(partner.address || "—"))}
      ${metaCell("Responsável", esc(partner.responsavel || "—"))}
      ${metaCell("E-mail", esc(partner.contact?.email || "—"))}
      ${metaCell("Telefone", esc(partner.contact?.phone || "—"))}
      ${metaCell("Redes sociais", esc(partner.contact?.social || "—"))}
    </div>
    ${partner.contactRaw ? `<div class="note"><span class="note-i">ⓘ</span>Contato original: ${esc(partner.contactRaw)}</div>` : ""}

    <!-- PRÓXIMAS AÇÕES -->
    <section class="section">
      <div class="section-head"><h2>Próximas ações</h2>
        <button class="btn btn-ghost edit-only" data-act="nova-acao">+ Nova ação</button></div>
      <div class="list-card" id="proximas-acoes">
        ${acoesPendentes.length ? acoesPendentes.map((a) => acaoRowHtml(partner.id, a)).join("")
          : `<div class="empty">Nenhuma próxima ação definida.</div>`}
      </div>
    </section>

    <!-- TIMELINE DE INTERAÇÕES -->
    <section class="section">
      <div class="section-head"><h2>Timeline de interações</h2>
        <button class="btn btn-ghost edit-only" data-act="nova-interacao">+ Nova interação</button></div>
      <div class="list-card" id="interacoes">
        ${interactions.length ? interactions.map(interactionRow).join("")
          : `<div class="empty">Nenhuma interação registrada ainda.</div>`}
      </div>
    </section>

    <!-- LANÇAMENTOS VINCULADOS -->
    <section class="section">
      <div class="section-head"><h2>Lançamentos vinculados</h2></div>
      <div class="list-card">
        ${campaignPartners.length ? campaignPartners.map((cp) => campaignRow(cp, campanhaPorId[cp.campaignId])).join("")
          : `<div class="empty">Nenhum lançamento vinculado.</div>`}
      </div>
    </section>

    <!-- CUPOM VINCULADO -->
    <section class="section">
      <div class="section-head"><h2>Cupom vinculado</h2>
        <button class="btn btn-ghost edit-only" data-act="cupom">${parceiro?.cupom ? "Editar" : "+ Novo cupom"}</button></div>
      <div class="list-card">
        ${parceiro?.cupom ? couponRowAntigo(parceiro, cuponsIrmaos, listas, usoCupom, fatCupom, grupos)
          : `<div class="empty">Nenhum cupom vinculado.</div>`}
      </div>
    </section>
  `;

  const acoes = {
    "editar-cadastro": () => abrirEditarCadastro(partner),
    "nova-acao": () => abrirFormAcaoFicha(partner),
    "nova-interacao": () => abrirNovaInteracao(partner),
    "cupom": () => parceiro
      ? abrirCupomDoParceiro(parceiro, cuponsIrmaos, grupos, listas)
      : alert("Este parceiro não tem registro correspondente no cadastro (schema antigo) — não dá pra vincular cupom."),
    "excluir": async () => {
      if (!confirm(`Excluir "${partner.name}"?\n\nOs dados de lançamento do cupom em Base de dados também serão apagados. Não dá pra desfazer.\n\nDeseja prosseguir?`)) return;
      await store.removeParceiro(partner.id);
      await store.removePartner(partner.id);
      location.hash = "#/parceiros/ativos";
    },
  };
  app.querySelectorAll("[data-act]").forEach((btn) => {
    if (btn.closest("#proximas-acoes")) return; // linhas de ação têm seu próprio listener delegado abaixo — evita disparar 2 handlers pro mesmo data-act (ex.: "excluir" também é o botão de excluir o parceiro inteiro)
    btn.addEventListener("click", () => acoes[btn.dataset.act]?.());
  });

  app.querySelector("#interacoes").addEventListener("click", async (e) => {
    const iid = e.target.dataset.id;
    if (!iid || e.target.dataset.action !== "excluir") return;
    if (!confirm("Excluir esta interação?")) return;
    await store.removeInteraction(partner.id, iid);
    avisarMudanca();
  });

  app.querySelector("#proximas-acoes").addEventListener("click", async (e) => {
    const row = e.target.closest(".acao-row");
    if (!row) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const acaoId = row.dataset.id;
    if (act === "concluir") {
      await concluirAcao(partner.id, partner, acaoId);
      avisarMudanca();
    } else if (act === "editar") {
      const acao = acoesDe(partner).find((a) => a.id === acaoId);
      if (acao) abrirFormAcaoFicha(partner, acao);
    } else if (act === "excluir") {
      if (!confirm("Excluir esta ação?")) return;
      await excluirAcao(partner.id, partner, acaoId);
      avisarMudanca();
    }
  });
}

function campanhaPares(ids, campanhas) {
  return ids.map((id, i) => [id, campanhas[i]]);
}

function metaCell(label, valueHtml) {
  return `<div class="meta-cell">
    <div class="meta-label">${label}</div>
    <div class="meta-value">${valueHtml}</div>
  </div>`;
}

/* ---------- Timeline ---------- */
function interactionRow(i) {
  const meta = INTERACTION_META[i.type] || { label: i.type || "—", cor: "gray" };
  return `<div class="list-row">
    <div class="lr-main">
      <div class="lr-title">${badge(meta.label, meta.cor)} <span class="muted" style="font-weight:400">${esc(formatDataBR(i.date))}</span></div>
      <div class="lr-sub">${esc(i.summary || "")}</div>
    </div>
    <span class="lr-actions edit-only">
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(i.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}

/* ---------- Lançamentos vinculados ---------- */
function campaignRow(cp, campanha) {
  const titulo = campanha ? (campanha.title || formatDataBR(campanha.dataInicio)) : "Campanha removida";
  return `<div class="list-row">
    <div class="lr-main">
      <div class="lr-title">${esc(titulo)}</div>
      <div class="lr-sub">${cp.quantidadeUso ?? 0} usos · ${esc(formatMoeda(cp.faturamentoCupom))} via cupom · ${esc(formatMoeda(cp.faturamentoTotal))} faturamento total${cp.faturamentoDelivery ? ` · ${esc(formatMoeda(cp.faturamentoDelivery))} via delivery` : ""}</div>
      ${cp.observacoes ? `<div class="lr-sub">${esc(cp.observacoes)}</div>` : ""}
    </div>
  </div>`;
}

/* ---------- Cupom vinculado (schema antigo — o mesmo das telas Cupons/Parceiros) ---------- */
function couponRowAntigo(parceiro, cuponsIrmaos, listas, uso, fat, grupos) {
  const outros = cuponsIrmaos.filter((p) => p.id !== parceiro.id).map((p) => p.nome);
  return `<div class="list-row">
    <div class="lr-main">
      <div class="lr-title"><strong${cupomEm50(parceiro, grupos) ? ' class="cupom-codigo--50"' : ""}>${esc((parceiro.cupom || "").toUpperCase())}</strong> ${badgeFromLista(listas.statusCupom, parceiro.statusCupom)}</div>
      <div class="lr-sub">${esc(validadeCupomTexto(parceiro, grupos))}</div>
      <div class="lr-sub">${uso} usos · ${esc(formatMoeda(fat))} via cupom</div>
      ${outros.length ? `<div class="lr-sub">Também usado por (leads): ${esc(outros.join(", "))}</div>` : ""}
    </div>
  </div>`;
}

async function abrirCupomDoParceiro(parceiro, cuponsIrmaos, grupos, listas) {
  const novo = !parceiro.cupom;
  const outros = cuponsIrmaos.filter((p) => p.id !== parceiro.id).map((p) => p.nome);
  openModal({
    title: novo ? "Novo cupom" : "Editar cupom",
    subtitle: outros.length ? `Também vale pra (leads): ${outros.join(", ")}` : parceiro.nome,
    submitLabel: novo ? "Adicionar" : "Salvar alterações",
    wide: true,
    bodyHtml: `
      <div class="field-2col">
        ${fieldText("cupom", "Código do cupom", { required: true, value: parceiro.cupom || "" })}
        ${fieldSelect("statusCupom", "Status do cupom", listas.statusCupom, { value: parceiro.statusCupom || "Ativo" })}
      </div>
      ${fieldText("periodoDesconto", "Período de desconto", { value: parceiro.periodoDesconto || "", placeholder: "Ex.: 50% até 15/05 / 20% até 31/08" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início da vigência", { type: "date", value: parceiro.dataInicio || "" })}
        ${fieldText("dataVencimento", "Vencimento", { type: "date", value: parceiro.dataVencimento || "" })}
      </div>
      <div class="field">
        <label for="f_grupoCupom">Grupo</label>
        <select id="f_grupoCupom" name="grupoCupom">
          <option value="">Sem grupo</option>
          ${grupos.map((g) => `<option value="${g.numero}" ${String(parceiro.grupoCupom || "") === String(g.numero) ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}
        </select>
      </div>
    `,
    onSubmit: async (form) => {
      const cupom = readValue(form, "cupom");
      if (!cupom) throw new Error("Informe o código do cupom.");
      const grupoValor = readValue(form, "grupoCupom");
      const campos = {
        cupom,
        statusCupom: readValue(form, "statusCupom"),
        periodoDesconto: readValue(form, "periodoDesconto"),
        dataInicio: readValue(form, "dataInicio"),
        dataVencimento: readValue(form, "dataVencimento"),
        grupoCupom: grupoValor ? Number(grupoValor) : "",
      };
      if (novo) await store.fecharParceria(parceiro.id, campos);
      else await Promise.all(cuponsIrmaos.map((p) => store.updateParceiro(p.id, campos)));
      avisarMudanca();
    },
  });
}

/* ---------- Modais ---------- */
async function abrirEditarCadastro(partner) {
  const listas = await store.getListas();
  openModal({
    title: "Editar cadastro",
    subtitle: partner.name,
    submitLabel: "Salvar alterações",
    wide: true,
    bodyHtml: `
      ${fieldText("name", "Nome do negócio", { required: true, value: partner.name || "" })}
      <div class="field-2col">
        ${fieldSelect("type", "Tipo", listas.tipoNegocio, { value: partner.type || listas.tipoNegocio[0]?.valor })}
        ${fieldText("typeDetalhe", "Especificar (opcional)", { value: partner.typeDetalhe || "", placeholder: "Ex.: Pilates" })}
      </div>
      ${fieldText("address", "Endereço", { value: partner.address || "" })}
      ${fieldText("responsavel", "Responsável", { value: partner.responsavel || "" })}
      <div class="field-2col">
        ${fieldText("email", "E-mail", { value: partner.contact?.email || "" })}
        ${fieldText("phone", "Telefone", { value: partner.contact?.phone || "" })}
      </div>
      ${fieldText("social", "Redes sociais", { value: partner.contact?.social || "" })}
      ${fieldText("tags", "Tags", { value: (partner.tags || []).join(", "), hint: "Separadas por vírgula." })}
    `,
    onSubmit: async (form) => {
      const name = readValue(form, "name");
      if (!name) throw new Error("Informe o nome do negócio.");
      const tags = readValue(form, "tags").split(",").map((t) => t.trim()).filter(Boolean);
      await store.updatePartner(partner.id, {
        name,
        type: readValue(form, "type"),
        typeDetalhe: readValue(form, "typeDetalhe"),
        address: readValue(form, "address"),
        responsavel: readValue(form, "responsavel"),
        contact: {
          email: readValue(form, "email") || null,
          phone: readValue(form, "phone") || null,
          social: readValue(form, "social") || null,
        },
        tags,
      });
      avisarMudanca();
    },
  });
}

async function abrirFormAcaoFicha(partner, acaoExistente = null) {
  const ed = !!acaoExistente;
  const atual = acaoExistente || {};
  openModal({
    title: ed ? "Editar ação" : "Nova ação",
    subtitle: partner.name,
    submitLabel: "Salvar",
    bodyHtml: `
      ${fieldTextarea("description", "Descrição", { required: true, value: atual.description || "", placeholder: "Ex.: Ligar pra confirmar renovação do cupom" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início (opcional)", { type: "date", value: atual.dataInicio || "" })}
        ${fieldText("dueDate", "Prazo", { type: "date", required: true, value: atual.dueDate || "" })}
      </div>
      ${fieldResponsavel(responsaveisDe(atual))}
    `,
    onMount: wireResponsavelField,
    onSubmit: async (form) => {
      const description = readValue(form, "description");
      const dueDate = readValue(form, "dueDate");
      const dataInicio = readValue(form, "dataInicio") || new Date().toISOString().slice(0, 10);
      const responsaveis = readResponsaveis(form);
      if (!description) throw new Error("Descreva a ação.");
      if (!dueDate) throw new Error("Informe o prazo.");
      if (ed) await editarAcao(partner.id, partner, acaoExistente.id, { description, dueDate, dataInicio, responsaveis });
      else await adicionarAcao(partner.id, partner, { description, dueDate, dataInicio, responsaveis });
      avisarMudanca();
    },
  });
}

async function abrirNovaInteracao(partner) {
  const hoje = new Date().toISOString().slice(0, 10);
  openModal({
    title: "Nova interação",
    subtitle: partner.name,
    submitLabel: "Adicionar",
    bodyHtml: `
      ${fieldSelect("type", "Tipo", INTERACTION_TIPOS, { value: "nota" })}
      ${fieldTextarea("summary", "Resumo", { required: true, placeholder: "O que aconteceu…" })}
      ${fieldText("date", "Data", { type: "date", value: hoje })}
    `,
    onMount: (form) => {
      // fieldSelect só aceita {valor} — troca o texto exibido pelos rótulos em PT-BR
      const sel = form.elements["type"];
      [...sel.options].forEach((opt) => {
        opt.textContent = INTERACTION_META[opt.value]?.label || opt.value;
      });
    },
    onSubmit: async (form) => {
      const summary = readValue(form, "summary");
      if (!summary) throw new Error("Descreva a interação.");
      const date = readValue(form, "date") || hoje;
      await store.addInteraction(partner.id, { type: readValue(form, "type"), summary, date });
      avisarMudanca();
    },
  });
}
