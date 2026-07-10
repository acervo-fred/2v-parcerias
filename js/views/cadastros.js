/* Abertura dos modais de cadastro/edição.
   Após gravar, dispara "data-changed" para a tela atual se re-renderizar. */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { openModal, fieldText, fieldTextarea, fieldSelect, readValue } from "../ui/modal.js";

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent("data-changed"));
}

const PERIODO_TIPOS = ["Dia", "Semana", "Mês", "Personalizado"];
const PERIODO_MAP = { Dia: "dia", Semana: "semana", "Mês": "mes", Personalizado: "personalizado" };
function periodoLabelAtual(tipo) {
  return Object.entries(PERIODO_MAP).find(([, v]) => v === tipo)?.[0] || "Semana";
}

/* ---------------- Prospecção (criar / editar dados-base) ---------------- */
export async function abrirNovoProspecto(existente = null) {
  const listas = await store.getListas();
  const ed = !!existente;
  const p = existente || {};
  openModal({
    title: ed ? "Editar prospecção" : "Nova prospecção",
    submitLabel: ed ? "Salvar alterações" : "Adicionar",
    bodyHtml: `
      <div class="field-2col">
        ${fieldSelect("area", "Área", listas.areas, { value: p.area || listas.areas[0] })}
        ${fieldSelect("tipo", "Tipo de negócio", listas.tipoNegocio, { value: p.tipo || listas.tipoNegocio[0]?.valor })}
      </div>
      ${fieldText("nome", "Nome do negócio", { required: true, value: p.nome || "", placeholder: "Ex.: Salus Flamengo" })}
      ${fieldText("local", "Local / endereço", { value: p.local || "", placeholder: "Ex.: Praia do Flamengo, 154" })}
      <div class="field-2col">
        ${fieldText("responsavel", "Responsável", { value: p.responsavel || "", placeholder: "Nome de contato" })}
        ${fieldText("contato", "Contato", { value: p.contato || "", placeholder: "Telefone ou e-mail" })}
      </div>
      ${fieldSelect("statusProspeccao", "Status da prospecção", listas.statusProspeccao, { value: p.statusProspeccao || listas.statusProspeccao[0]?.valor })}
      ${fieldTextarea("observacoes", "Observações", { value: p.observacoes || "", placeholder: "Contexto, indicação, próximos passos…" })}
    `,
    onSubmit: async (form) => {
      const nome = readValue(form, "nome");
      if (!nome) throw new Error("Informe o nome do negócio.");
      const campos = {
        area: readValue(form, "area"),
        tipo: readValue(form, "tipo"),
        nome,
        local: readValue(form, "local"),
        responsavel: readValue(form, "responsavel"),
        contato: readValue(form, "contato"),
        statusProspeccao: readValue(form, "statusProspeccao"),
        observacoes: readValue(form, "observacoes"),
      };
      if (ed) await store.updateParceiro(p.id, campos);
      else await store.addParceiro(campos);
      avisarMudanca();
    },
  });
}

/* ---------------- Fechar parceria (prospecto -> parceiro) ---------------- */
export async function abrirFecharParceria(parceiro) {
  const listas = await store.getListas();
  openModal({
    title: "Fechar parceria",
    subtitle: parceiro.nome,
    submitLabel: "Fechar parceria",
    bodyHtml: `
      <div class="field-2col">
        ${fieldText("cupom", "Código do cupom", { required: true, value: parceiro.cupom || "", placeholder: "Ex.: SALUS2V" })}
        ${fieldSelect("statusCupom", "Status do cupom", listas.statusCupom, { value: "Ativo" })}
      </div>
      ${fieldText("periodoDesconto", "Período de desconto", { value: parceiro.periodoDesconto || "", placeholder: "Ex.: 50% até 15/05 / 20% até 31/08" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início da vigência", { type: "date", value: parceiro.dataInicio || "" })}
        ${fieldText("dataVencimento", "Vencimento", { type: "date", value: parceiro.dataVencimento || "" })}
      </div>
    `,
    onSubmit: async (form) => {
      const cupom = readValue(form, "cupom");
      if (!cupom) throw new Error("Informe o código do cupom.");
      await store.fecharParceria(parceiro.id, {
        cupom,
        statusCupom: readValue(form, "statusCupom"),
        periodoDesconto: readValue(form, "periodoDesconto"),
        dataInicio: readValue(form, "dataInicio"),
        dataVencimento: readValue(form, "dataVencimento"),
      });
      avisarMudanca();
    },
  });
}

/* ---------------- Editar parceiro fechado (dados-base + cupom) ---------------- */
export async function abrirEditarParceiro(parceiro) {
  const listas = await store.getListas();
  const p = parceiro;
  openModal({
    title: "Editar parceiro",
    subtitle: p.nome,
    submitLabel: "Salvar alterações",
    wide: true,
    bodyHtml: `
      <div class="field-2col">
        ${fieldSelect("area", "Área", listas.areas, { value: p.area || listas.areas[0] })}
        ${fieldSelect("tipo", "Tipo de negócio", listas.tipoNegocio, { value: p.tipo || listas.tipoNegocio[0]?.valor })}
      </div>
      ${fieldText("nome", "Nome do negócio", { required: true, value: p.nome || "" })}
      ${fieldText("local", "Local / endereço", { value: p.local || "" })}
      <div class="field-2col">
        ${fieldText("responsavel", "Responsável", { value: p.responsavel || "" })}
        ${fieldText("contato", "Contato", { value: p.contato || "", placeholder: "Telefone ou e-mail" })}
      </div>
      <div class="field-2col">
        ${fieldText("cupom", "Código do cupom", { required: true, value: p.cupom || "" })}
        ${fieldSelect("statusCupom", "Status do cupom", listas.statusCupom, { value: p.statusCupom || "Ativo" })}
      </div>
      ${fieldText("periodoDesconto", "Período de desconto", { value: p.periodoDesconto || "" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início da vigência", { type: "date", value: p.dataInicio || "" })}
        ${fieldText("dataVencimento", "Vencimento", { type: "date", value: p.dataVencimento || "" })}
      </div>
      ${fieldTextarea("observacoes", "Observações", { value: p.observacoes || "" })}
    `,
    onSubmit: async (form) => {
      const nome = readValue(form, "nome");
      const cupom = readValue(form, "cupom");
      if (!nome) throw new Error("Informe o nome do negócio.");
      if (!cupom) throw new Error("Informe o código do cupom.");
      await store.updateParceiro(p.id, {
        area: readValue(form, "area"),
        tipo: readValue(form, "tipo"),
        nome,
        local: readValue(form, "local"),
        responsavel: readValue(form, "responsavel"),
        contato: readValue(form, "contato"),
        cupom,
        statusCupom: readValue(form, "statusCupom"),
        periodoDesconto: readValue(form, "periodoDesconto"),
        dataInicio: readValue(form, "dataInicio"),
        dataVencimento: readValue(form, "dataVencimento"),
        observacoes: readValue(form, "observacoes"),
      });
      avisarMudanca();
    },
  });
}

/* seletor de parceiro/cupom — value = id do parceiro, texto = "Nome — CUPOM" */
function selectParceiroHtml(parceiros, value) {
  const opts = parceiros.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === value ? "selected" : ""}>${esc(p.nome)} — ${esc(p.cupom)}</option>`
  ).join("");
  return `<div class="field">
    <label for="f_parceiroId">Parceiro / cupom *</label>
    <select id="f_parceiroId" name="parceiroId">${opts}</select>
  </div>`;
}

/* ---------------- Lançamento avulso (Base de Dados de 1 parceiro) ---------------- */
export async function abrirNovoLancamento(parceiroIdSugerido = "", existente = null) {
  const parceiros = await store.listParceirosFechados();
  if (!parceiros.length) {
    alert("Feche pelo menos uma parceria (com cupom) antes de lançar dados de desempenho.");
    return;
  }
  const ed = !!existente;
  const l = existente || {};
  const parceiroSel = l.parceiroId || parceiroIdSugerido || parceiros[0].id;

  openModal({
    title: ed ? "Editar lançamento" : "Novo lançamento",
    submitLabel: ed ? "Salvar alterações" : "Adicionar",
    bodyHtml: `
      ${selectParceiroHtml(parceiros, parceiroSel)}
      <div class="field-2col">
        ${fieldText("data", "Data de referência", { type: "date", required: true, value: l.data || new Date().toISOString().slice(0, 10) })}
        ${fieldSelect("periodoTipo", "Tipo de período", PERIODO_TIPOS, { value: periodoLabelAtual(l.periodoTipo) })}
      </div>
      ${fieldText("periodoLabel", "Rótulo do período", { value: l.periodoLabel || "", placeholder: "Ex.: Semana 27, Julho/2026, 01–07/07" })}
      <div class="field-2col">
        ${fieldText("quantidadeUso", "Qtd. de uso do cupom", { type: "number", required: true, value: l.quantidadeUso ?? "" })}
        ${fieldText("faturamentoCupom", "Faturamento do cupom (R$)", { type: "number", required: true, value: l.faturamentoCupom ?? "" })}
      </div>
      ${fieldText("faturamentoTotalSemCupom", "Faturamento total da loja no período, sem cupom (R$)", { type: "number", value: l.faturamentoTotalSemCupom || "", hint: "Opcional — permite comparar o quanto o cupom representa do faturamento total." })}
      ${fieldTextarea("observacoes", "Observações", { value: l.observacoes || "" })}
    `,
    onSubmit: async (form) => {
      const data = readValue(form, "data");
      const parceiroId = readValue(form, "parceiroId");
      if (!data) throw new Error("Informe a data de referência.");
      if (!parceiroId) throw new Error("Selecione o parceiro/cupom.");
      const campos = {
        parceiroId,
        data,
        periodoTipo: PERIODO_MAP[readValue(form, "periodoTipo")] || "dia",
        periodoLabel: readValue(form, "periodoLabel"),
        quantidadeUso: readValue(form, "quantidadeUso"),
        faturamentoCupom: readValue(form, "faturamentoCupom"),
        faturamentoTotalSemCupom: readValue(form, "faturamentoTotalSemCupom"),
        observacoes: readValue(form, "observacoes"),
      };
      if (ed) await store.updateLancamento(l.id, campos);
      else await store.addLancamento(campos);
      avisarMudanca();
    },
  });
}

/* ---------------- Lançamento em lote (1 período, vários cupons de uma vez) ----------------
   Fluxo real de uso: você exporta da plataforma interna de cada loja o
   desempenho de um período (dia/semana/mês) com vários cupons ao mesmo
   tempo, e lança tudo de uma vez aqui. */
function loteRowHtml(parceiros, valores = {}) {
  const opts = parceiros.map((p) =>
    `<option value="${esc(p.id)}" ${p.id === valores.parceiroId ? "selected" : ""}>${esc(p.nome)} — ${esc(p.cupom)}</option>`
  ).join("");
  return `<div class="lote-row" data-row>
    <select class="input lote-parceiro">${opts}</select>
    <input class="input lote-uso" type="number" min="0" placeholder="Uso" value="${valores.quantidadeUso ?? ""}">
    <input class="input lote-fat" type="number" min="0" step="0.01" placeholder="Faturamento (R$)" value="${valores.faturamentoCupom ?? ""}">
    <button type="button" class="icon-btn danger lote-remove" title="Remover linha">🗑</button>
  </div>`;
}

export async function abrirLancamentoLote() {
  const parceiros = await store.listParceirosFechados();
  if (!parceiros.length) {
    alert("Feche pelo menos uma parceria (com cupom) antes de lançar dados de desempenho.");
    return;
  }
  const linhasIniciais = Math.min(4, parceiros.length);

  openModal({
    title: "Lançamento em lote",
    subtitle: "Um período, vários cupons de uma vez",
    submitLabel: "Adicionar lançamentos",
    wide: true,
    bodyHtml: `
      <div class="field-2col">
        ${fieldText("data", "Data de referência do período", { type: "date", required: true, value: new Date().toISOString().slice(0, 10) })}
        ${fieldSelect("periodoTipo", "Tipo de período", PERIODO_TIPOS, { value: "Semana" })}
      </div>
      ${fieldText("periodoLabel", "Rótulo do período", { placeholder: "Ex.: Semana 27, Julho/2026, 01–07/07" })}
      <div class="field-hint" style="margin-bottom:10px">Faturamento total sem cupom fica de fora aqui — lance depois, avulso, se precisar dessa comparação num cupom específico.</div>
      <div class="field">
        <label>Cupons do período</label>
        <div id="lote-rows">
          ${Array.from({ length: linhasIniciais }).map(() => loteRowHtml(parceiros)).join("")}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="lote-add" style="margin-top:6px">+ Adicionar linha</button>
      </div>
    `,
    onMount: (form) => {
      const container = form.querySelector("#lote-rows");
      form.querySelector("#lote-add").addEventListener("click", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = loteRowHtml(parceiros);
        container.appendChild(wrap.firstElementChild);
      });
      container.addEventListener("click", (e) => {
        if (!e.target.closest(".lote-remove")) return;
        const rows = container.querySelectorAll(".lote-row");
        if (rows.length <= 1) return;
        e.target.closest(".lote-row").remove();
      });
    },
    onSubmit: async (form) => {
      const data = readValue(form, "data");
      if (!data) throw new Error("Informe a data de referência do período.");
      const periodoTipo = PERIODO_MAP[readValue(form, "periodoTipo")] || "dia";
      const periodoLabel = readValue(form, "periodoLabel");

      const linhas = [];
      form.querySelectorAll(".lote-row").forEach((row) => {
        const parceiroId = row.querySelector(".lote-parceiro").value;
        const quantidadeUso = row.querySelector(".lote-uso").value;
        const faturamentoCupom = row.querySelector(".lote-fat").value;
        if (!parceiroId || (!quantidadeUso && !faturamentoCupom)) return;
        linhas.push({ parceiroId, data, periodoTipo, periodoLabel, quantidadeUso, faturamentoCupom, faturamentoTotalSemCupom: 0 });
      });
      if (!linhas.length) throw new Error("Preencha ao menos uma linha com uso ou faturamento.");

      await store.addLancamentosLote(linhas);
      avisarMudanca();
    },
  });
}
