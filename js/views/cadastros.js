/* Abertura dos modais de cadastro/edição.
   Após gravar, dispara "data-changed" para a tela atual se re-renderizar. */

import { store } from "../data/store.js";
import { esc, parseNumeroBR, formatNumeroBR } from "../ui/dom.js";
import { openModal, fieldText, fieldTextarea, fieldSelect, readValue } from "../ui/modal.js";
import { PERIODO_TIPOS, PERIODO_MAP, rotuloTipoAtual, calcularDataFim, calcularRotulo, calcularEntradaLancamento } from "../util/periodo.js";
import { agruparParceirosPorCupom } from "../util/cupom.js";
import { garantirPartner } from "../data/funil.js";

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

/* ---------------- Prospecção (criar / editar dados-base) ----------------
   Só pra cadastrar lugares que podem virar parceiro — sem Área (a loja
   da página já resolve isso) nem Status (o estágio é sempre derivado
   do Kanban — ver js/views/kanban.js e js/views/prospeccao.js). */
export async function abrirNovoProspecto(existente = null) {
  const listas = await store.getListas();
  const ed = !!existente;
  const p = existente || {};
  openModal({
    title: ed ? "Editar prospecção" : "Nova prospecção",
    submitLabel: ed ? "Salvar alterações" : "Adicionar",
    bodyHtml: `
      <div class="field-2col">
        ${fieldSelect("tipo", "Tipo de negócio", listas.tipoNegocio, { value: p.tipo || listas.tipoNegocio[0]?.valor })}
        ${fieldText("tipoDetalhe", "Especificar (opcional)", { value: p.tipoDetalhe || "", placeholder: "Ex.: Pilates" })}
      </div>
      ${fieldText("nome", "Nome do negócio", { required: true, value: p.nome || "", placeholder: "Ex.: Salus Flamengo" })}
      ${fieldText("local", "Local / endereço", { value: p.local || "", placeholder: "Ex.: Praia do Flamengo, 154" })}
      <div class="field-2col">
        ${fieldText("responsavel", "Responsável", { value: p.responsavel || "", placeholder: "Nome de contato" })}
        ${fieldText("contato", "Contato", { value: p.contato || "", placeholder: "Telefone ou e-mail" })}
      </div>
      ${fieldTextarea("observacoes", "Observações", { value: p.observacoes || "", placeholder: "Contexto, indicação, próximos passos…" })}
    `,
    onSubmit: async (form) => {
      const nome = readValue(form, "nome");
      if (!nome) throw new Error("Informe o nome do negócio.");
      const campos = {
        tipo: readValue(form, "tipo"),
        tipoDetalhe: readValue(form, "tipoDetalhe"),
        nome,
        local: readValue(form, "local"),
        responsavel: readValue(form, "responsavel"),
        contato: readValue(form, "contato"),
        observacoes: readValue(form, "observacoes"),
      };
      if (ed) {
        await store.updateParceiro(p.id, campos);
      } else {
        const novo = await store.addParceiro(campos);
        // já nasce com doc espelho em `partners` (stage "lead") pra
        // Ficha do Parceiro funcionar desde o primeiro cadastro, sem
        // esperar o negócio "avançar" no Kanban (ver funil.js)
        await garantirPartner(novo.id, novo, {}, {});
      }
      avisarMudanca();
    },
  });
}

/* Fecha parceria a partir de um cadastro de Prospecção que já avançou
   pro estágio "Negociação / Em contato" no Kanban (ver
   js/views/kanban.js e js/views/prospeccao.js). Registra o cupom e
   marca ehParceiro=true no parceiro (store.fecharParceria, já
   existente); em seguida garante o doc espelho em `partners` com
   stage "ativo" — cria (mesmo id do parceiro) se ainda não existir
   (caso comum: negócio fechado direto de "Lead", sem passar por
   "Negociação" no Kanban), ou só atualiza o estágio se já existir. */
export async function abrirFecharParceria(parceiro) {
  const listas = await store.getListas();
  openModal({
    title: "Fechar parceria",
    subtitle: parceiro.nome,
    submitLabel: "Fechar parceria",
    wide: true,
    bodyHtml: `
      <div class="field-2col">
        ${fieldText("cupom", "Código do cupom", { required: true, value: "" })}
        ${fieldSelect("statusCupom", "Status do cupom", listas.statusCupom, { value: "Ativo" })}
      </div>
      ${fieldText("periodoDesconto", "Período de desconto", { value: "", placeholder: "Ex.: 50% até 15/05 / 20% até 31/08" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início da vigência", { type: "date", value: "" })}
        ${fieldText("dataVencimento", "Vencimento", { type: "date", value: "" })}
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
      const agora = new Date().toISOString().slice(0, 10);
      const partnerExistente = await store.getPartner(parceiro.id);
      if (partnerExistente) {
        await store.updatePartner(parceiro.id, { stage: "ativo", stageUpdatedAt: agora });
      } else {
        await store.addPartner(parceiro.id, {
          name: parceiro.nome, type: parceiro.tipo || "", typeDetalhe: parceiro.tipoDetalhe || "", address: parceiro.local || "",
          responsavel: parceiro.responsavel || "", contactRaw: parceiro.contato || "",
          stage: "ativo", stageUpdatedAt: agora,
        });
      }
      avisarMudanca();
    },
  });
}

/* ---------------- Novo parceiro (direto, sem passar por prospecção) ---------------- */
export async function abrirNovoParceiro() {
  const listas = await store.getListas();
  openModal({
    title: "Novo parceiro",
    submitLabel: "Adicionar",
    wide: true,
    bodyHtml: `
      <div class="field-2col">
        ${fieldSelect("tipo", "Tipo de negócio", listas.tipoNegocio, { value: listas.tipoNegocio[0]?.valor })}
        ${fieldText("tipoDetalhe", "Especificar (opcional)", { value: "", placeholder: "Ex.: Pilates" })}
      </div>
      ${fieldText("nome", "Nome do negócio", { required: true, value: "", placeholder: "Ex.: Salus Flamengo" })}
      ${fieldText("local", "Local / endereço", { value: "", placeholder: "Ex.: Praia do Flamengo, 154" })}
      <div class="field-2col">
        ${fieldText("responsavel", "Responsável", { value: "", placeholder: "Nome de contato" })}
        ${fieldText("contato", "Contato", { value: "", placeholder: "Telefone ou e-mail" })}
      </div>
      <div class="field-2col">
        ${fieldText("cupom", "Código do cupom", { required: true, value: "", placeholder: "Ex.: SALUS2V" })}
        ${fieldSelect("statusCupom", "Status do cupom", listas.statusCupom, { value: "Ativo" })}
      </div>
      ${fieldText("periodoDesconto", "Período de desconto", { value: "", placeholder: "Ex.: 50% até 15/05 / 20% até 31/08" })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início da vigência", { type: "date", value: "" })}
        ${fieldText("dataVencimento", "Vencimento", { type: "date", value: "" })}
      </div>
      ${fieldTextarea("observacoes", "Observações", { value: "" })}
    `,
    onSubmit: async (form) => {
      const nome = readValue(form, "nome");
      const cupom = readValue(form, "cupom");
      if (!nome) throw new Error("Informe o nome do negócio.");
      if (!cupom) throw new Error("Informe o código do cupom.");
      const novo = await store.addParceiro({
        tipo: readValue(form, "tipo"),
        tipoDetalhe: readValue(form, "tipoDetalhe"),
        nome,
        local: readValue(form, "local"),
        responsavel: readValue(form, "responsavel"),
        contato: readValue(form, "contato"),
        statusProspeccao: "Cadastrado",
      });
      await store.fecharParceria(novo.id, {
        cupom,
        statusCupom: readValue(form, "statusCupom"),
        periodoDesconto: readValue(form, "periodoDesconto"),
        dataInicio: readValue(form, "dataInicio"),
        dataVencimento: readValue(form, "dataVencimento"),
        observacoes: readValue(form, "observacoes"),
      });
      // já registrado como parceria fechada — nasce direto com Status
      // "Ativo" no Pipeline (ver funil.js:garantirPartner)
      await garantirPartner(novo.id, novo, {}, { stage: "ativo" });
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
        ${fieldSelect("tipo", "Tipo de negócio", listas.tipoNegocio, { value: p.tipo || listas.tipoNegocio[0]?.valor })}
        ${fieldText("tipoDetalhe", "Especificar (opcional)", { value: p.tipoDetalhe || "", placeholder: "Ex.: Pilates" })}
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
        tipo: readValue(form, "tipo"),
        tipoDetalhe: readValue(form, "tipoDetalhe"),
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

/* seletor de parceiro/cupom — value = id do parceiro, texto = "CUPOM — Nome" */
// Um cupom pode ser compartilhado por mais de uma empresa (ver
// js/util/cupom.js) — na Base de dados o cupom conta como um só, então a
// lista mostra 1 opção por cupom (não 1 por empresa); o valor gravado é
// sempre o id do representante do grupo (parceiros[0]), pra todo
// lançamento futuro daquele cupom acumular sob o mesmo parceiroId. Se o
// lançamento sendo editado já pertence a outra empresa do mesmo grupo,
// a opção certa ainda aparece selecionada (comparação por grupo, não só
// pelo id salvo).
function selectParceiroHtml(grupos, value) {
  const opts = grupos.map((lc) => {
    const rep = lc.parceiros[0];
    const nomes = lc.parceiros.map((p) => p.nome).join(", ");
    const selecionado = lc.parceiros.some((p) => p.id === value);
    return `<option value="${esc(rep.id)}" ${selecionado ? "selected" : ""}>${esc(lc.cupom)} — ${esc(nomes)}</option>`;
  }).join("");
  return `<div class="field">
    <label for="f_parceiroId">Parceiro / cupom *</label>
    <select id="f_parceiroId" name="parceiroId">${opts}</select>
  </div>`;
}

/* ---------------- Lançamento avulso (Base de Dados de 1 parceiro) ---------------- */
export async function abrirNovoLancamento(parceiroIdSugerido = "", existente = null) {
  const parceiros = await store.listParceirosFechados();
  const grupos = agruparParceirosPorCupom(parceiros)
    .sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));
  if (!grupos.length) {
    alert("Feche pelo menos uma parceria (com cupom) antes de lançar dados de desempenho.");
    return;
  }
  const ed = !!existente;
  const l = existente || {};
  const parceiroSel = l.parceiroId || parceiroIdSugerido || grupos[0].parceiros[0].id;

  const dataInicioIni = l.dataInicio || l.data || new Date().toISOString().slice(0, 10);

  openModal({
    title: ed ? "Editar lançamento" : "Novo lançamento",
    submitLabel: ed ? "Salvar alterações" : "Adicionar",
    bodyHtml: `
      ${selectParceiroHtml(grupos, parceiroSel)}
      ${fieldSelect("periodoTipo", "Tipo de período (duração)", PERIODO_TIPOS, { value: rotuloTipoAtual(l.periodoTipo) })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início do período", { type: "date", required: true, value: dataInicioIni })}
        ${fieldText("dataFim", "Fim do período", { type: "date", required: true, value: l.dataFim || dataInicioIni })}
      </div>
      ${fieldText("periodoLabel", "Rótulo do período", { value: l.periodoLabel || "", hint: "Preenchido automaticamente a partir do tipo e das datas — pode editar se quiser." })}
      <div class="field-2col">
        ${fieldText("quantidadeUso", "Qtd. de uso do cupom", { type: "number", required: true, value: l.quantidadeUso ?? "" })}
        ${fieldText("faturamentoCupom", "Faturamento via cupom (R$)", { required: true, value: formatNumeroBR(l.faturamentoCupom), placeholder: "Ex.: 1.234,56", inputmode: "decimal" })}
      </div>
      ${fieldTextarea("observacoes", "Observações", { value: l.observacoes || "" })}
    `,
    onMount: (form) => wirePeriodo(form),
    onSubmit: async (form) => {
      const dataInicioForm = readValue(form, "dataInicio");
      const dataFimForm = readValue(form, "dataFim");
      const parceiroId = readValue(form, "parceiroId");
      if (!dataInicioForm) throw new Error("Informe o início do período.");
      if (!dataFimForm) throw new Error("Informe o fim do período.");
      if (!parceiroId) throw new Error("Selecione o parceiro/cupom.");

      const quantidadeUso = Number(readValue(form, "quantidadeUso")) || 0;
      const faturamentoCupom = parseNumeroBR(readValue(form, "faturamentoCupom"));
      const periodoTipo = PERIODO_MAP[readValue(form, "periodoTipo")] || "dia";

      let dataInicio = dataInicioForm, dataFim = dataFimForm;
      let usoGravado = quantidadeUso, faturamentoGravado = faturamentoCupom;
      let periodoLabel = readValue(form, "periodoLabel");
      if (!ed) {
        const existentes = await store.lancamentosDoParceiro(parceiroId);
        const entrada = calcularEntradaLancamento(existentes, { dataInicio: dataInicioForm, dataFim: dataFimForm, quantidadeUso, faturamentoCupom });
        if (entrada.tipo === "ambiguo") throw new Error(entrada.motivo);
        dataInicio = entrada.dataInicio;
        dataFim = entrada.dataFim;
        usoGravado = entrada.quantidadeUso;
        faturamentoGravado = entrada.faturamentoCupom;
        if (entrada.tipo === "delta") periodoLabel = calcularRotulo(periodoTipo, dataInicio, dataFim);
      }

      const campos = {
        parceiroId,
        dataInicio,
        dataFim,
        periodoTipo,
        periodoLabel,
        quantidadeUso: usoGravado,
        faturamentoCupom: faturamentoGravado,
        faturamentoTotal: 0,
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
function loteRowHtml(grupos, valores = {}) {
  const opts = grupos.map((lc) => {
    const rep = lc.parceiros[0];
    const nomes = lc.parceiros.map((p) => p.nome).join(", ");
    const selecionado = lc.parceiros.some((p) => p.id === valores.parceiroId);
    return `<option value="${esc(rep.id)}" ${selecionado ? "selected" : ""}>${esc(lc.cupom)} — ${esc(nomes)}</option>`;
  }).join("");
  return `<div class="lote-row" data-row>
    <select class="input lote-parceiro">${opts}</select>
    <input class="input lote-uso" type="number" min="0" placeholder="Uso" value="${valores.quantidadeUso ?? ""}">
    <input class="input lote-fat" inputmode="decimal" placeholder="Faturamento cupom (R$) — ex.: 1.234,56" value="${formatNumeroBR(valores.faturamentoCupom)}">
    <button type="button" class="icon-btn danger lote-remove" title="Remover linha">🗑</button>
  </div>`;
}

/* ---------------- Faturamento da loja (avulso, sem cupom) ----------------
   Valor agregado de faturamento total (+ delivery) do período (ex.: "FAT.
   LOJA" do relatório), sem vínculo com um cupom/parceiro específico.
   Gravado como um lançamento comum com parceiroId vazio — não cria
   nenhum registro na Prospecção/Parceiros. */
export async function abrirFaturamentoLoja(existente = null) {
  const ed = !!existente;
  const l = existente || {};
  const dataInicioIni = l.dataInicio || new Date().toISOString().slice(0, 10);
  openModal({
    title: ed ? "Editar faturamento da loja" : "Faturamento da loja",
    subtitle: "Valor total do período, sem vínculo com um cupom específico",
    submitLabel: ed ? "Salvar alterações" : "Adicionar",
    bodyHtml: `
      ${fieldSelect("periodoTipo", "Tipo de período (duração)", PERIODO_TIPOS, { value: rotuloTipoAtual(l.periodoTipo || "semana") })}
      <div class="field-2col">
        ${fieldText("dataInicio", "Início do período", { type: "date", required: true, value: dataInicioIni })}
        ${fieldText("dataFim", "Fim do período", { type: "date", required: true, value: l.dataFim || dataInicioIni })}
      </div>
      ${fieldText("periodoLabel", "Rótulo do período", { value: l.periodoLabel || "", hint: "Preenchido automaticamente a partir do tipo e das datas — pode editar se quiser." })}
      ${fieldText("faturamentoTotal", "Faturamento total da loja (R$)", { required: true, value: formatNumeroBR(l.faturamentoTotal), placeholder: "Ex.: 84.281,93", inputmode: "decimal" })}
      ${fieldText("faturamentoDelivery", "Faturamento via delivery (R$)", { value: formatNumeroBR(l.faturamentoDelivery), placeholder: "Ex.: 6.684,28", inputmode: "decimal", hint: "Opcional — deixe em branco se o período não tiver esse dado." })}
    `,
    onMount: (form) => wirePeriodo(form),
    onSubmit: async (form) => {
      const dataInicio = readValue(form, "dataInicio");
      const dataFim = readValue(form, "dataFim");
      const faturamentoTotal = parseNumeroBR(readValue(form, "faturamentoTotal"));
      if (!dataInicio) throw new Error("Informe o início do período.");
      if (!dataFim) throw new Error("Informe o fim do período.");
      if (!faturamentoTotal) throw new Error("Informe o faturamento total da loja.");
      const campos = {
        parceiroId: "",
        dataInicio,
        dataFim,
        periodoTipo: PERIODO_MAP[readValue(form, "periodoTipo")] || "dia",
        periodoLabel: readValue(form, "periodoLabel"),
        quantidadeUso: 0,
        faturamentoCupom: 0,
        faturamentoTotal,
        faturamentoDelivery: parseNumeroBR(readValue(form, "faturamentoDelivery")),
      };
      if (ed) await store.updateLancamento(l.id, campos);
      else await store.addLancamento(campos);
      avisarMudanca();
    },
  });
}

export async function abrirLancamentoLote() {
  const parceiros = await store.listParceirosFechados();
  const grupos = agruparParceirosPorCupom(parceiros)
    .sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));
  if (!grupos.length) {
    alert("Feche pelo menos uma parceria (com cupom) antes de lançar dados de desempenho.");
    return;
  }
  const linhasIniciais = Math.min(4, grupos.length);
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
        <label>Cupons do período — uso e faturamento via cupom de cada loja</label>
        <div id="lote-rows">
          ${Array.from({ length: linhasIniciais }).map(() => loteRowHtml(grupos)).join("")}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="lote-add" style="margin-top:6px">+ Adicionar linha</button>
      </div>
    `,
    onMount: (form) => {
      wirePeriodo(form);
      const container = form.querySelector("#lote-rows");
      form.querySelector("#lote-add").addEventListener("click", () => {
        const wrap = document.createElement("div");
        wrap.innerHTML = loteRowHtml(grupos);
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
      const periodoLabelDigitado = readValue(form, "periodoLabel");

      const linhasBrutas = [];
      form.querySelectorAll(".lote-row").forEach((row) => {
        const parceiroId = row.querySelector(".lote-parceiro").value;
        const quantidadeUso = Number(row.querySelector(".lote-uso").value) || 0;
        const faturamentoCupom = parseNumeroBR(row.querySelector(".lote-fat").value);
        if (!parceiroId || (!quantidadeUso && !faturamentoCupom)) return;
        linhasBrutas.push({ parceiroId, quantidadeUso, faturamentoCupom });
      });
      if (!linhasBrutas.length) throw new Error("Preencha ao menos uma linha com uso ou faturamento.");

      // dry-run: resolve todas as linhas primeiro (contra o histórico de cada
      // parceiro) antes de gravar qualquer coisa — se alguma vier ambígua,
      // nada é salvo, igual a qualquer outra validação deste modal.
      const todosLancamentos = await store.listLancamentos();
      const porParceiro = new Map();
      for (const l of todosLancamentos) {
        if (!porParceiro.has(l.parceiroId)) porParceiro.set(l.parceiroId, []);
        porParceiro.get(l.parceiroId).push(l);
      }
      const nomePorId = Object.fromEntries(parceiros.map((p) => [p.id, `${p.cupom} — ${p.nome}`]));

      const erros = [];
      const linhas = linhasBrutas.map((lb) => {
        const entrada = calcularEntradaLancamento(porParceiro.get(lb.parceiroId) || [], { dataInicio, dataFim, quantidadeUso: lb.quantidadeUso, faturamentoCupom: lb.faturamentoCupom });
        if (entrada.tipo === "ambiguo") {
          erros.push(`${nomePorId[lb.parceiroId] || lb.parceiroId}: ${entrada.motivo}`);
          return null;
        }
        const periodoLabel = entrada.tipo === "delta" ? calcularRotulo(periodoTipo, entrada.dataInicio, entrada.dataFim) : periodoLabelDigitado;
        return { parceiroId: lb.parceiroId, dataInicio: entrada.dataInicio, dataFim: entrada.dataFim, periodoTipo, periodoLabel, quantidadeUso: entrada.quantidadeUso, faturamentoCupom: entrada.faturamentoCupom };
      });
      if (erros.length) throw new Error(erros.join("\n"));

      await store.addLancamentosLote(linhas);
      avisarMudanca();
    },
  });
}
