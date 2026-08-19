/* Cupons — percentual de desconto, período de validade e grupos de
   cada cupom. O desconto de um cupom só pode ser 20% (padrão) ou 50%
   (especial) — nunca um valor livre. Estratégia de aumento em grupos:
   cada grupo (1-4) tem seu próprio período de desconto especial,
   escalonado; enquanto a data de hoje não estiver dentro do período do
   grupo, o cupom fica nos 20% padrão. Uso/faturamento por cupom,
   filtrado por período, pra acompanhar o desempenho de cada grupo.

   Consolidação por código de cupom: quando duas empresas parceiras
   compartilham o mesmo código (ex.: "PARCEIRO20" oferecido a mais de
   uma empresa), elas contam como um cupom só aqui — uso/faturamento
   somados, grupo e desconto em sincronia entre as empresas. Só a aba
   Parceiros mostra cada empresa separadamente. */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { dedupLancamentos, lancamentoNoPeriodo } from "../util/periodo.js";
import { agruparParceirosPorCupom, chaveCupom, descontoAtual, statusCupomEfetivo } from "../util/cupom.js";
import { usuarioAtual } from "../data/auth.js";
import { openModal, fieldText, readValue } from "../ui/modal.js";

const NUM_GRUPOS = 4;
const DESCONTO_PADRAO = 20;
const DESCONTO_ESPECIAL = 50;
const DESCRICAO_EXPORT = "50% de desconto em todos os produtos no LM";

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function diaAnteriorISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function diaSeguinteISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// garante que a loja atual já tem os 4 grupos (cria na primeira vez)
async function garantirGrupos() {
  let grupos = await store.listGrupos();
  if (grupos.length === 0) {
    grupos = [];
    for (let n = 1; n <= NUM_GRUPOS; n++) {
      const novo = await store.addGrupo({ numero: n, nome: `Grupo ${n}`, inicio: "", fim: "" });
      grupos.push(novo);
    }
  }
  return grupos.sort((a, b) => a.numero - b.numero);
}

// período correspondente a um percentual específico (20% → vigência do
// próprio cupom, 50% → período especial configurado no grupo do cupom) —
// usado pra alternar o texto de vigência quando o usuário troca a lista
// suspensa de desconto, sem depender de qual dos dois está "ativo hoje".
function periodoParaPercentual(rep, porIdGrupo, percentual) {
  if (percentual === DESCONTO_ESPECIAL) {
    const g = porIdGrupo[String(rep.grupoCupom || "")];
    return { inicio: g?.inicio || "", fim: g?.fim || "" };
  }
  return { inicio: rep.dataInicio || "", fim: rep.dataVencimento || "" };
}

function statsPorCupom(lancamentos, de, ate, chavePorParceiroId) {
  const mapa = new Map();
  for (const l of lancamentos) {
    if (!lancamentoNoPeriodo(l, de, ate)) continue;
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, { uso: 0, fat: 0 });
    const a = mapa.get(chave);
    a.uso += l.quantidadeUso;
    a.fat += l.faturamentoCupom;
  }
  return mapa;
}

/* Classifica um lançamento em EXATAMENTE um dos 3 baldes (pré/período/pós
   50% do grupo) — "Pré 50%"/"Período 50%"/"Pós 50%" precisam ser
   mutuamente exclusivos (senão a soma dos três passa do Total). Um
   lançamento cujo intervalo (dataInicio–dataFim) atravessa a fronteira do
   período especial (ex.: uma semana que começa antes e termina dentro)
   não pode contar em dois baldes ao mesmo tempo — prioridade pro período
   especial se ele toca o intervalo de qualquer jeito (mesmo critério já
   usado pelo Dashboard pra classificar 20%/50%, ver cupomEhEspecial em
   dashboard.js); só cai em "pre50"/"pos50" quando não toca o período
   especial de jeito nenhum. */
function classificarBalde50(l, g) {
  if (!g?.inicio || !g?.fim || !l.dataInicio) return null;
  if (lancamentoNoPeriodo(l, g.inicio, g.fim)) return "periodo50";
  const fim = l.dataFim || l.dataInicio;
  return fim < g.inicio ? "pre50" : "pos50";
}
function statsPorCupomBalde50(lancamentos, balde, g, chavePorParceiroId) {
  const mapa = new Map();
  for (const l of lancamentos) {
    if (classificarBalde50(l, g) !== balde) continue;
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, { uso: 0, fat: 0 });
    const a = mapa.get(chave);
    a.uso += l.quantidadeUso;
    a.fat += l.faturamentoCupom;
  }
  return mapa;
}

function baixarCSV(linhas, nome) {
  const csv = linhas.map((linha) => linha.map(csvCampo).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function csvCampo(valor) {
  const texto = String(valor ?? "");
  return /[",;\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export async function renderCupons(app) {
  const podeEditar = !!usuarioAtual();
  const [parceiros, grupos, lancamentosBrutos] = await Promise.all([
    store.listParceirosFechados(),
    garantirGrupos(),
    store.listLancamentos(),
  ]);
  const lancamentos = dedupLancamentos(lancamentosBrutos);
  const porIdGrupo = Object.fromEntries(grupos.map((g) => [String(g.numero), g]));

  const linhasCupom = agruparParceirosPorCupom(parceiros);
  const chavePorParceiroId = Object.fromEntries(parceiros.map((p) => [p.id, chaveCupom(p)]));
  const linhasPorChave = new Map(linhasCupom.map((lc) => [lc.chave, lc]));

  let periodo = "total"; // "pre50" | "periodo50" | "custom" | "total"
  let aba = "todos"; // "todos" | "1".."4"
  let busca = "";
  const ordem = { chave: "cupom", dir: "asc" };
  const customPeriodo = { de: "", ate: "" };

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Cupons</h1>
        <div class="page-sub">${linhasCupom.length} cupons · 20% padrão ou 50% no período especial de cada grupo</div>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
        <div class="filter-row" id="periodo-cupons" style="margin-bottom:0">
          <button class="chip" data-p="pre50" id="chip-pre50" title="Selecione um grupo pra usar este filtro" disabled>Pré 50%</button>
          <button class="chip" data-p="periodo50" id="chip-periodo50" title="Selecione um grupo pra usar este filtro" disabled>Período 50%</button>
          <button class="chip" data-p="pos50" id="chip-pos50" title="Selecione um grupo pra usar este filtro" disabled>Pós 50%</button>
          <button class="chip active" data-p="total">Total</button>
        </div>
        <div class="field" style="margin-bottom:0"><label>De</label><input class="input" type="date" id="cupons-de" style="width:auto"></div>
        <div class="field" style="margin-bottom:0"><label>Até</label><input class="input" type="date" id="cupons-ate" style="width:auto"></div>
      </div>
    </div>

    <div class="filter-row" id="aba-grupos">
      <button class="chip active" data-aba="todos">Todos</button>
      ${grupos.map((g) => `<button class="chip" data-aba="${g.numero}">${esc(g.nome)}</button>`).join("")}
      <button class="btn btn-ghost btn-sm edit-only" id="grp-novo">+ Novo grupo</button>
    </div>

    <div id="grupo-painel"></div>

    <div class="toolbar" style="margin-bottom:14px">
      <input class="input" id="busca-cupom" type="search" placeholder="Buscar por cupom…" style="flex:1;min-width:200px" />
    </div>

    <div class="chart-card" style="padding:0">
      <table class="rank-table" id="tabela-cupons">
        <thead>
          <tr>
            <th data-sort="cupom">Cupom</th>
            <th data-sort="uso" class="num">Usos no período</th>
            <th data-sort="fat" class="num">Faturamento no período</th>
            <th>Desconto atual</th>
            <th>Início – término do desconto</th>
            <th>Grupo</th>
          </tr>
        </thead>
        <tbody id="lista-cupons"></tbody>
      </table>
    </div>

    <div class="viz-tooltip" id="viz-tip-cupons" role="tooltip"></div>
  `;

  const painel = app.querySelector("#grupo-painel");
  const lista = app.querySelector("#lista-cupons");

  function periodoAtual() {
    if (periodo === "pre50") {
      const g = aba !== "todos" ? porIdGrupo[aba] : null;
      // "todo o período anterior" à data cadastrada — sem limite inicial,
      // só até o dia anterior ao começo do 50%.
      return g?.inicio ? ["", diaAnteriorISO(g.inicio)] : ["", ""];
    }
    if (periodo === "periodo50") {
      const g = aba !== "todos" ? porIdGrupo[aba] : null;
      return [g?.inicio || "", g?.fim || ""];
    }
    if (periodo === "pos50") {
      const g = aba !== "todos" ? porIdGrupo[aba] : null;
      // "todo o período depois" — sem limite final, só a partir do dia
      // seguinte ao fim do 50%.
      return g?.fim ? [diaSeguinteISO(g.fim), ""] : ["", ""];
    }
    if (periodo === "custom") return [customPeriodo.de, customPeriodo.ate];
    return ["", ""]; // total
  }
  // os chips "Pré 50%"/"Período 50%"/"Pós 50%" só fazem sentido com um
  // grupo específico selecionado (cada grupo tem seu próprio período de
  // 50%) — desabilita em "Todos" e, se algum dos três estava ativo,
  // volta pro filtro "Total".
  function atualizarChipsGrupo() {
    const habilitado = aba !== "todos";
    ["#chip-pre50", "#chip-periodo50", "#chip-pos50"].forEach((sel) => {
      const chip = app.querySelector(sel);
      chip.disabled = !habilitado;
      chip.title = habilitado ? "" : "Selecione um grupo pra usar este filtro";
    });
    if (!habilitado && (periodo === "pre50" || periodo === "periodo50" || periodo === "pos50")) {
      periodo = "total";
      app.querySelectorAll("#periodo-cupons .chip").forEach((c) => c.classList.toggle("active", c.dataset.p === "total"));
    }
  }

  // Painel do período de 50% do grupo — visual bem mais discreto que o
  // de seleção de período no topo (texto simples + "editar"), pra não
  // parecer mais um seletor de data igual ao De/Até. Só vira o form de
  // edição (com os inputs de data de verdade) quando clicado.
  function desenharPainel() {
    if (aba === "todos") { painel.innerHTML = ""; return; }
    desenharPainelView(porIdGrupo[aba]);
  }

  function exportarGrupo(g) {
    const vigencia = g.inicio && g.fim ? `${formatDataBR(g.inicio)} – ${formatDataBR(g.fim)}` : "";
    const cuponsDoGrupo = linhasCupom
      .filter((lc) => String(lc.parceiros[0].grupoCupom || "") === aba)
      .sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));
    const linhasArquivo = [
      ["Cupom", "Descrição", "Início – término"],
      ...cuponsDoGrupo.map((lc) => [lc.cupom, DESCRICAO_EXPORT, vigencia]),
    ];
    baixarCSV(linhasArquivo, `cupons-${g.nome.toLowerCase().replace(/\s+/g, "-")}-${hojeISO()}.csv`);
  }

  function desenharPainelView(g) {
    const periodoTxt = g.inicio && g.fim ? `${formatDataBR(g.inicio)} – ${formatDataBR(g.fim)}` : "não definido";
    painel.innerHTML = `
      <div class="muted" style="font-size:12.5px; margin-bottom:14px; display:flex; align-items:center; gap:12px; flex-wrap:wrap">
        <span>Período 50% — ${esc(g.nome)}: <strong style="color:var(--text)">${esc(periodoTxt)}</strong></span>
        <button type="button" class="btn-link edit-only" id="grp-editar">editar</button>
        <span style="margin-left:auto; display:flex; gap:16px">
          <button type="button" class="btn-link" id="grp-exportar">exportar tabela</button>
          <button type="button" class="btn-link btn-link-danger edit-only" id="grp-excluir">excluir grupo</button>
        </span>
      </div>
    `;
    painel.querySelector("#grp-excluir").addEventListener("click", () => excluirGrupo(g));
    painel.querySelector("#grp-exportar").addEventListener("click", () => exportarGrupo(g));
    painel.querySelector("#grp-editar")?.addEventListener("click", () => desenharPainelEdicao(g));
  }

  function desenharPainelEdicao(g) {
    painel.innerHTML = `
      <div class="toolbar" style="margin-bottom:16px; gap:10px; flex-wrap:wrap">
        <strong style="font-size:13.5px">Período desconto 50% — ${esc(g.nome)}:</strong>
        <input class="input" type="date" id="grp-inicio" value="${g.inicio || ""}" style="width:auto">
        <span class="muted">até</span>
        <input class="input" type="date" id="grp-fim" value="${g.fim || ""}" style="width:auto">
        <button class="btn btn-primary btn-sm" id="grp-salvar">Salvar</button>
        <button class="btn btn-ghost btn-sm" id="grp-cancelar">Cancelar</button>
      </div>
    `;
    painel.querySelector("#grp-cancelar").addEventListener("click", () => desenharPainelView(g));
    painel.querySelector("#grp-salvar").addEventListener("click", async () => {
      const campos = {
        inicio: painel.querySelector("#grp-inicio").value,
        fim: painel.querySelector("#grp-fim").value,
      };
      await store.updateGrupo(g.id, campos);
      Object.assign(g, campos);
      desenharPainelView(g);
      desenharLista(); // o desconto atual de cada linha pode ter mudado
    });
  }

  function linhasVisiveis() {
    let stats;
    if (periodo === "pre50" || periodo === "periodo50" || periodo === "pos50") {
      const g = aba !== "todos" ? porIdGrupo[aba] : null;
      stats = statsPorCupomBalde50(lancamentos, periodo, g, chavePorParceiroId);
    } else {
      const [de, ate] = periodoAtual();
      stats = statsPorCupom(lancamentos, de, ate, chavePorParceiroId);
    }
    const termo = busca.trim().toLowerCase();

    const arr = linhasCupom
      .filter((lc) => (aba === "todos" || String(lc.parceiros[0].grupoCupom || "") === aba))
      .filter((lc) => !termo || (lc.cupom || "").toLowerCase().includes(termo))
      .map((lc) => ({ lc, uso: stats.get(lc.chave)?.uso || 0, fat: stats.get(lc.chave)?.fat || 0 }));

    const mul = ordem.dir === "asc" ? 1 : -1;
    const val = (l) => {
      if (ordem.chave === "uso") return l.uso;
      if (ordem.chave === "fat") return l.fat;
      return (l.lc.cupom || "").toLowerCase();
    };
    return arr.sort((a, b) => {
      const va = val(a), vb = val(b);
      if (typeof va === "string") return va.localeCompare(vb, "pt-BR") * mul;
      return (va - vb) * mul;
    });
  }

  function desenharLista() {
    const arr = linhasVisiveis();
    lista.innerHTML = arr.length
      ? arr.map((l) => rowHtml(l.lc, l.uso, l.fat)).join("")
      : `<tr><td colspan="6" class="empty">Nenhum cupom encontrado.</td></tr>`;

    app.querySelectorAll("#tabela-cupons th[data-sort]").forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sort === ordem.chave);
      th.dataset.sortDir = th.dataset.sort === ordem.chave ? ordem.dir : "";
    });

    wireTooltipCupons();
  }

  /* Ao passar o mouse (ou focar, via teclado) no nome do cupom, mostra
     um mini menu com empresa + responsável de cada parceiro daquele
     cupom — útil quando o cupom é compartilhado por mais de uma
     empresa. Reaproveita o mesmo componente visual dos gráficos do
     Dashboard (.viz-tooltip). */
  function wireTooltipCupons() {
    const tip = app.querySelector("#viz-tip-cupons");
    lista.querySelectorAll(".cupom-nome-hover").forEach((el) => {
      const lc = linhasPorChave.get(el.dataset.chave);
      if (!lc) return;
      function mostrar() {
        tip.innerHTML = "";
        lc.parceiros.forEach((p) => {
          const linha = document.createElement("div");
          linha.textContent = p.responsavel ? `${p.nome} — ${p.responsavel}` : p.nome;
          tip.appendChild(linha);
        });
        const r = el.getBoundingClientRect();
        tip.style.left = `${r.left + r.width / 2}px`;
        tip.style.top = `${r.top}px`;
        tip.classList.add("show");
      }
      function esconder() { tip.classList.remove("show"); }
      el.addEventListener("mouseenter", mostrar);
      el.addEventListener("mouseleave", esconder);
      el.addEventListener("focus", mostrar);
      el.addEventListener("blur", esconder);
    });
  }

  function fmtPeriodo(per) {
    return per.inicio && per.fim ? `${formatDataBR(per.inicio)} – ${formatDataBR(per.fim)}` : "—";
  }

  function rowHtml(lc, uso, fat) {
    const rep = lc.parceiros[0];
    const pausado = statusCupomEfetivo(rep) === "Pausado";
    const d = descontoAtual(rep, grupos);
    const periodoTxt = fmtPeriodo(d);
    const empresas = lc.parceiros.map((p) => p.nome).join(", ");
    return `<tr class="rank-row">
      <td>
        <strong class="cupom-nome-hover${d.percentual === DESCONTO_ESPECIAL ? " cupom-codigo--50" : ""}${pausado ? " cupom-pausado" : ""}" data-chave="${esc(lc.chave)}" tabindex="0">${esc(lc.cupom)}</strong>
        ${pausado ? `<span class="muted" style="font-size:11px"> · fora do ar</span>` : ""}
        ${lc.parceiros.length > 1 ? `<div class="muted" style="font-size:11.5px">${esc(empresas)}</div>` : ""}
      </td>
      <td class="num">${uso}</td>
      <td class="num">${esc(formatMoeda(fat))}</td>
      <td>
        <select class="input cupom-desconto ${d.percentual === DESCONTO_ESPECIAL ? "cupom-desconto--50" : "cupom-desconto--20"}" data-chave="${esc(lc.chave)}" style="width:80px">
          <option value="20" ${d.percentual === DESCONTO_PADRAO ? "selected" : ""}>20%</option>
          <option value="50" ${d.percentual === DESCONTO_ESPECIAL ? "selected" : ""}>50%</option>
        </select>
      </td>
      <td class="muted cupom-periodo" style="font-size:12.5px">${esc(periodoTxt)}</td>
      <td>
        <select class="input cupom-grupo" data-chave="${esc(lc.chave)}" style="width:140px" ${podeEditar ? "" : "disabled"}>
          <option value="">Sem grupo</option>
          ${grupos.map((g) => `<option value="${g.numero}" ${String(rep.grupoCupom || "") === String(g.numero) ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}
        </select>
      </td>
    </tr>`;
  }

  atualizarChipsGrupo();
  desenharPainel();
  desenharLista();

  app.querySelector("#periodo-cupons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-p]");
    if (!btn) return;
    periodo = btn.dataset.p;
    app.querySelectorAll("#periodo-cupons .chip").forEach((c) => c.classList.toggle("active", c === btn));
    // mostra nos campos De/Até a data que o chip calculou (só exibição —
    // continuam editáveis, e editar troca pro filtro personalizado).
    const [de, ate] = periodoAtual();
    app.querySelector("#cupons-de").value = de;
    app.querySelector("#cupons-ate").value = ate;
    desenharLista();
  });

  ["#cupons-de", "#cupons-ate"].forEach((sel) => {
    app.querySelector(sel).addEventListener("change", () => {
      customPeriodo.de = app.querySelector("#cupons-de").value;
      customPeriodo.ate = app.querySelector("#cupons-ate").value;
      periodo = "custom";
      app.querySelectorAll("#periodo-cupons .chip").forEach((c) => c.classList.remove("active"));
      desenharLista();
    });
  });

  app.querySelector("#aba-grupos").addEventListener("click", (e) => {
    if (e.target.closest("#grp-novo")) return abrirNovoGrupo();
    const btn = e.target.closest("[data-aba]");
    if (!btn) return;
    aba = btn.dataset.aba;
    app.querySelectorAll("#aba-grupos .chip").forEach((c) => c.classList.toggle("active", c === btn));
    atualizarChipsGrupo();
    // se "Pré 50%"/"Período 50%"/"Pós 50%" continua (ou passou a ficar)
    // ativo, os campos De/Até precisam refletir o período do grupo
    // recém-selecionado.
    if (periodo === "pre50" || periodo === "periodo50" || periodo === "pos50" || periodo === "total") {
      const [de, ate] = periodoAtual();
      app.querySelector("#cupons-de").value = de;
      app.querySelector("#cupons-ate").value = ate;
    }
    desenharPainel();
    desenharLista();
  });

  function abrirNovoGrupo() {
    const proximoNumero = Math.max(0, ...grupos.map((g) => g.numero)) + 1;
    openModal({
      title: "Novo grupo",
      subtitle: "Cria um grupo com período de desconto especial próprio",
      submitLabel: "Criar",
      bodyHtml: fieldText("nome", "Nome do grupo", { required: true, value: `Grupo ${proximoNumero}` }),
      onSubmit: async (form) => {
        const nome = readValue(form, "nome");
        if (!nome) throw new Error("Informe o nome do grupo.");
        await store.addGrupo({ numero: proximoNumero, nome, inicio: "", fim: "" });
        window.dispatchEvent(new CustomEvent("data-changed"));
      },
    });
  }

  async function excluirGrupo(g) {
    if (!confirm(`Excluir "${g.nome}"?\n\nOs cupons vinculados a esse grupo voltam pra "Sem grupo".`)) return;
    const afetados = parceiros.filter((p) => String(p.grupoCupom || "") === String(g.numero));
    await Promise.all(afetados.map((p) => store.updateParceiro(p.id, { grupoCupom: "" })));
    await store.removeGrupo(g.id);
    window.dispatchEvent(new CustomEvent("data-changed"));
  }

  app.querySelector("#busca-cupom").addEventListener("input", (e) => { busca = e.target.value; desenharLista(); });

  app.querySelector("#tabela-cupons thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const chave = th.dataset.sort;
    if (ordem.chave === chave) ordem.dir = ordem.dir === "asc" ? "desc" : "asc";
    else { ordem.chave = chave; ordem.dir = "desc"; }
    desenharLista();
  });

  lista.addEventListener("change", async (e) => {
    const descSel = e.target.closest(".cupom-desconto");
    if (descSel) {
      const chave = descSel.dataset.chave;
      const lc = linhasPorChave.get(chave);
      if (!lc) return;
      const percentual = Number(descSel.value);
      const per = periodoParaPercentual(lc.parceiros[0], porIdGrupo, percentual);
      const tr = descSel.closest("tr");
      tr.querySelector(".cupom-periodo").textContent = fmtPeriodo(per);
      descSel.classList.toggle("cupom-desconto--50", percentual === DESCONTO_ESPECIAL);
      descSel.classList.toggle("cupom-desconto--20", percentual === DESCONTO_PADRAO);
      return;
    }
    const grupoSel = e.target.closest(".cupom-grupo");
    if (grupoSel) {
      const chave = grupoSel.dataset.chave;
      const lc = linhasPorChave.get(chave);
      if (!lc) return;
      const valor = grupoSel.value ? Number(grupoSel.value) : "";
      await Promise.all(lc.parceiros.map((p) => store.updateParceiro(p.id, { grupoCupom: valor })));
      lc.parceiros.forEach((p) => { p.grupoCupom = valor; });
      if (aba !== "todos") desenharLista(); // some da aba do grupo antigo
    }
  });
}
