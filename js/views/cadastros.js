/* Abertura dos modais de cadastro/edição.
   Após gravar, dispara "data-changed" para a tela atual se re-renderizar. */

import { store } from "../data/store.js";
import { esc } from "../ui/dom.js";
import { openModal, fieldText, fieldTextarea, fieldSelect, readValue } from "../ui/modal.js";
import { PERIODO_TIPOS, PERIODO_MAP, rotuloTipoAtual, calcularDataFim, calcularRotulo } from "../util/periodo.js";

function avisarMudanca() {
  window.dispatchEvent(new CustomEvent("data-changed"));
}

/* Wireia o trio Tipo de período + Início + Fim + Rótulo dentro de um
   form já montado: o fim é auto-calculado a partir do tipo+início
   (exceto Personalizado, que o usuário escolhe à mão), e o rótulo
   sempre acompanha o tipo/intervalo atual. */
function wirePeriodo(form) {
  const tipoEl = form.elements["periodoTipo"];
  const iniEl = form.elements["dataInicio"];
  const fimEl = form.elements["dataFim"];
  const labelEl = form.elements["periodoLabel"];

  function tipoAtual() { return PERIODO_MAP[tipoEl.value] || "dia"; }

  function atualizarFim() {
    const tipo = tipoAtual();
    if (tipo === "personalizado") {
      fimEl.disabled = false;
      if (!fimEl.value) fimEl.value = iniEl.value;
    } else {
      fimEl.value = calcularDataFim(tipo, iniEl.value);
      fimEl.disabled = true;
    }
  }
  function atualizarLabel() {
    labelEl.value = calcularRotulo(tipoAtual(), iniEl.value, fimEl.value);
  }
  function recalcularTudo() { atualizarFim(); atualizarLabel(); }

  tipoEl.addEventListener("change", recalcularTudo);
  iniEl.addEventListener("change", recalcularTudo);
  fimEl.addEventListener("change", atualizarLabel);
  recalcularTudo();
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

  const dataInicioIni = l.dataInicio || l.data || new Date().toISOString().slice(0, 10);

  openModal({
    title: ed ? "Editar lançamento" : "Novo lançamento",
    submitLabel: ed ? "Salvar alterações" : "Adicionar",
    bodyHtml: `
      ${selectParceiroHtml(parceiros, parceiroSel)}
      ${fieldSelect("periodoTipo", "Tipo de período (duração)", PERIODO_TIPOS, { value: rotuloTipoAtual(l.periodoTipo) })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início do período", { type: "date", required: true, value: dataInicioIni })}
        ${fieldText("dataFim", "Fim do período", { type: "date", required: true, value: l.dataFim || dataInicioIni })}
      </div>
      ${fieldText("periodoLabel", "Rótulo do período", { value: l.periodoLabel || "", hint: "Preenchido automaticamente a partir do tipo e das datas — pode editar se quiser." })}
      <div class="field-2col">
        ${fieldText("quantidadeUso", "Qtd. de uso do cupom", { type: "number", required: true, value: l.quantidadeUso ?? "" })}
        ${fieldText("faturamentoCupom", "Faturamento via cupom (R$)", { type: "number", required: true, value: l.faturamentoCupom ?? "" })}
      </div>
      ${fieldText("faturamentoTotal", "Faturamento total da loja no período (R$)", { type: "number", required: true, value: l.faturamentoTotal ?? "", hint: "Tudo que a loja faturou no período, incluindo o que veio do cupom. O quanto foi sem cupom é calculado sozinho." })}
      ${fieldTextarea("observacoes", "Observações", { value: l.observacoes || "" })}
    `,
    onMount: (form) => wirePeriodo(form),
    onSubmit: async (form) => {
      const dataInicio = readValue(form, "dataInicio");
      const dataFim = readValue(form, "dataFim");
      const parceiroId = readValue(form, "parceiroId");
      if (!dataInicio) throw new Error("Informe o início do período.");
      if (!dataFim) throw new Error("Informe o fim do período.");
      if (!parceiroId) throw new Error("Selecione o parceiro/cupom.");
      const campos = {
        parceiroId,
        dataInicio,
        dataFim,
        periodoTipo: PERIODO_MAP[readValue(form, "periodoTipo")] || "dia",
        periodoLabel: readValue(form, "periodoLabel"),
        quantidadeUso: readValue(form, "quantidadeUso"),
        faturamentoCupom: readValue(form, "faturamentoCupom"),
        faturamentoTotal: readValue(form, "faturamentoTotal"),
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
    <input class="input lote-fat" type="number" min="0" step="0.01" placeholder="Faturamento cupom (R$)" value="${valores.faturamentoCupom ?? ""}">
    <input class="input lote-total" type="number" min="0" step="0.01" placeholder="Faturamento total (R$)" value="${valores.faturamentoTotal ?? ""}">
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
  const hoje = new Date().toISOString().slice(0, 10);

  openModal({
    title: "Lançamento em lote",
    subtitle: "Um período, vários cupons de uma vez",
    submitLabel: "Adicionar lançamentos",
    wide: true,
    bodyHtml: `
      ${fieldSelect("periodoTipo", "Tipo de período (duração)", PERIODO_TIPOS, { value: "Semana" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início do período", { type: "date", required: true, value: hoje })}
        ${fieldText("dataFim", "Fim do período", { type: "date", required: true, value: hoje })}
      </div>
      ${fieldText("periodoLabel", "Rótulo do período", { hint: "Preenchido automaticamente a partir do tipo e das datas — pode editar se quiser." })}
      <div class="field">
        <label>Cupons do período — uso, faturamento via cupom e faturamento total de cada loja</label>
        <div id="lote-rows">
          ${Array.from({ length: linhasIniciais }).map(() => loteRowHtml(parceiros)).join("")}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="lote-add" style="margin-top:6px">+ Adicionar linha</button>
      </div>
    `,
    onMount: (form) => {
      wirePeriodo(form);
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
      const dataInicio = readValue(form, "dataInicio");
      const dataFim = readValue(form, "dataFim");
      if (!dataInicio) throw new Error("Informe o início do período.");
      if (!dataFim) throw new Error("Informe o fim do período.");
      const periodoTipo = PERIODO_MAP[readValue(form, "periodoTipo")] || "dia";
      const periodoLabel = readValue(form, "periodoLabel");

      const linhas = [];
      form.querySelectorAll(".lote-row").forEach((row) => {
        const parceiroId = row.querySelector(".lote-parceiro").value;
        const quantidadeUso = row.querySelector(".lote-uso").value;
        const faturamentoCupom = row.querySelector(".lote-fat").value;
        const faturamentoTotal = row.querySelector(".lote-total").value;
        if (!parceiroId || (!quantidadeUso && !faturamentoCupom && !faturamentoTotal)) return;
        linhas.push({ parceiroId, dataInicio, dataFim, periodoTipo, periodoLabel, quantidadeUso, faturamentoCupom, faturamentoTotal });
      });
      if (!linhas.length) throw new Error("Preencha ao menos uma linha com uso ou faturamento.");

      await store.addLancamentosLote(linhas);
      avisarMudanca();
    },
  });
}
