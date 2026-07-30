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
import { chaveCupom, validadeCupomTexto } from "../util/cupom.js";
import { dedupLancamentos } from "../util/periodo.js";

const STAGE_META = {
  lead: { label: "Lead", cor: "gray" },
  negociacao: { label: "Negociação / Em contato", cor: "amber" },
  ativo: { label: "Ativo", cor: "green" },
  perdido: { label: "Perdido / Sem resposta", cor: "red" },
};
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
    app.innerHTML = `<a class="back-link" href="#/parceiros">← Voltar para parceiros</a>
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

  app.innerHTML = `
    <a class="back-link" href="#/parceiros">← Voltar para parceiros</a>

    <div class="detail-head">
      <div>
        <h1 class="page-title">${esc(partner.name)}</h1>
        <div class="page-sub">${badge(stageMeta.label, stageMeta.cor)} ${esc(partner.type || "—")}</div>
      </div>
      <div class="row-end">
        <button class="btn edit-only" data-act="editar-cadastro">Editar cadastro</button>
        <button class="btn btn-ghost btn-danger edit-only" data-act="excluir" title="Excluir parceiro">🗑</button>
      </div>
    </div>

    ${(partner.tags || []).length ? `<div class="row-end" style="margin-bottom:16px">${partner.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(" ")}</div>` : ""}

    <div class="meta-grid">
      ${metaCell("Área", esc(partner.area || "—"))}
      ${metaCell("Endereço", esc(partner.address || "—"))}
      ${metaCell("Responsável", esc(partner.responsavel || "—"))}
      ${metaCell("E-mail", esc(partner.contact?.email || "—"))}
      ${metaCell("Telefone", esc(partner.contact?.phone || "—"))}
      ${metaCell("Redes sociais", esc(partner.contact?.social || "—"))}
    </div>
    ${partner.contactRaw ? `<div class="note"><span class="note-i">ⓘ</span>Contato original: ${esc(partner.contactRaw)}</div>` : ""}

    ${nextActionHtml(partner.nextAction)}

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
    "editar-proxima-acao": () => abrirEditarProximaAcao(partner),
    "concluir-proxima-acao": async () => {
      await store.addInteraction(partner.id, {
        type: "nota", summary: `Ação concluída: ${partner.nextAction.description}`,
        date: new Date().toISOString().slice(0, 10),
      });
      await store.updatePartner(partner.id, { nextAction: null });
      avisarMudanca();
    },
    "excluir-proxima-acao": async () => {
      if (!confirm("Excluir esta próxima ação?")) return;
      await store.updatePartner(partner.id, { nextAction: null });
      avisarMudanca();
    },
    "nova-interacao": () => abrirNovaInteracao(partner),
    "cupom": () => parceiro
      ? abrirCupomDoParceiro(parceiro, cuponsIrmaos, grupos, listas)
      : alert("Este parceiro não tem registro correspondente no cadastro (schema antigo) — não dá pra vincular cupom."),
    "excluir": async () => {
      if (!confirm(`Excluir "${partner.name}"?\n\nOs dados de lançamento do cupom em Base de dados também serão apagados. Não dá pra desfazer.\n\nDeseja prosseguir?`)) return;
      await store.removeParceiro(partner.id);
      await store.removePartner(partner.id);
      location.hash = "#/parceiros";
    },
  };
  app.querySelectorAll("[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => acoes[btn.dataset.act]?.())
  );

  app.querySelector("#interacoes").addEventListener("click", async (e) => {
    const iid = e.target.dataset.id;
    if (!iid || e.target.dataset.action !== "excluir") return;
    if (!confirm("Excluir esta interação?")) return;
    await store.removeInteraction(partner.id, iid);
    avisarMudanca();
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

/* ---------- Próxima ação ---------- */
function nextActionUrgencia(dueDate) {
  if (!dueDate) return "";
  const hoje = new Date().toISOString().slice(0, 10);
  if (dueDate < hoje) return " next-action--overdue";
  const emSeteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (dueDate <= emSeteDias) return " next-action--soon";
  return "";
}
function nextActionHtml(nextAction) {
  const tem = nextAction && (nextAction.description || nextAction.dueDate);
  return `<div class="next-action${tem ? nextActionUrgencia(nextAction.dueDate) : ""}">
    <div>
      <div class="next-action-label">${tem ? "Próxima ação" : "Nenhuma próxima ação definida"}</div>
      ${tem ? `
        <div class="next-action-desc">${esc(nextAction.description || "—")}</div>
        <div class="next-action-date">${esc(formatDataBR(nextAction.dueDate))}</div>
      ` : ""}
    </div>
    ${tem ? `
      <div class="row-end">
        <button class="btn btn-ghost edit-only" data-act="concluir-proxima-acao">✓ Concluída</button>
        <button class="btn btn-ghost edit-only" data-act="editar-proxima-acao">Editar</button>
        <button class="btn btn-ghost btn-danger edit-only" data-act="excluir-proxima-acao" title="Excluir">🗑</button>
      </div>
    ` : `<button class="btn btn-ghost edit-only" data-act="editar-proxima-acao">+ Definir</button>`}
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
      <div class="lr-title"><strong>${esc((parceiro.cupom || "").toUpperCase())}</strong> ${badgeFromLista(listas.statusCupom, parceiro.statusCupom)}</div>
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
  openModal({
    title: "Editar cadastro",
    subtitle: partner.name,
    submitLabel: "Salvar alterações",
    wide: true,
    bodyHtml: `
      ${fieldText("name", "Nome do negócio", { required: true, value: partner.name || "" })}
      <div class="field-2col">
        ${fieldText("type", "Tipo", { value: partner.type || "", placeholder: "Ex.: imprensa, influencer, distribuidor…" })}
        ${fieldText("area", "Área", { value: partner.area || "" })}
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
        area: readValue(form, "area"),
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

async function abrirEditarProximaAcao(partner) {
  const atual = partner.nextAction || {};
  openModal({
    title: "Próxima ação",
    subtitle: partner.name,
    submitLabel: "Salvar",
    bodyHtml: `
      ${fieldTextarea("description", "Descrição", { value: atual.description || "", placeholder: "Ex.: Ligar pra confirmar renovação do cupom" })}
      ${fieldText("dueDate", "Data", { type: "date", value: atual.dueDate || "" })}
    `,
    onSubmit: async (form) => {
      const description = readValue(form, "description");
      const dueDate = readValue(form, "dueDate");
      if (description && !dueDate) throw new Error("Informe a data da próxima ação.");
      if (dueDate && !description) throw new Error("Informe a descrição da próxima ação.");
      await store.updatePartner(partner.id, {
        nextAction: description && dueDate ? { description, dueDate } : null,
      });
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
