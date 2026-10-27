/* Cupons — esboço (2026-10-26) do novo modelo, publicado pra uso:

   - Cada cupom tem um DESCONTO BASE próprio (15/20/30/50%, campo
     descontoBase no parceiro, padrão 20%) — o que vale fora de qualquer
     ação especial.
   - GRUPOS são ações de aumento de desconto: cada grupo tem UM período
     (inicio/fim), um percentual (padrão 50%) e uma lista de cupons
     (grupo.cupons, códigos). Um cupom pode estar em vários grupos ao
     longo do tempo — é assim que ele vai e volta do 50%. Uma ação
     pontual de um cupom só é só um grupo com um cupom.
     Grupos antigos (sem grupo.cupons) continuam lendo a lista a partir
     do grupoCupom dos parceiros, até alguém editar os membros.
   - Aba "Todos os cupons": De/Até + "Período 50%"/"Período 20%", que
     compilam TODOS os períodos em que cada cupom esteve (ou não) em
     desconto especial — não é mais um intervalo contínuo.
   - Aba "Grupos": uma sub-aba por grupo, com período, percentual e
     membros editáveis.

   Consolidação por código de cupom: empresas que compartilham o mesmo
   código contam como um cupom só (ver js/util/cupom.js). */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { dedupLancamentos, lancamentoNoPeriodo } from "../util/periodo.js";
import { agruparParceirosPorCupom, chaveCupom, normalizarCupom, statusCupomEfetivo, periodosDoCupom } from "../util/cupom.js";
import { usuarioAtual } from "../data/auth.js";
import { openModal, fieldText, fieldSelect, readValue } from "../ui/modal.js";
import { abrirCupomDoParceiro } from "./cadastros.js";

const DESCONTOS_BASE = [15, 20, 30, 50];
const DESCONTO_BASE_PADRAO = 20;
const PERCENTUAL_GRUPO_PADRAO = 50;
const DESCRICAO_EXPORT = "50% de desconto em todos os produtos no LM";

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function fmtIntervalo(inicio, fim) {
  return inicio && fim ? `${formatDataBR(inicio)} – ${formatDataBR(fim)}` : "período não definido";
}
function fmtIntervaloCurto(inicio, fim) {
  const curto = (iso) => formatDataBR(iso).slice(0, 5);
  return `${curto(inicio)}–${curto(fim)}`;
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
  const [parceiros, gruposBrutos, lancamentosBrutos, listas] = await Promise.all([
    store.listParceirosFechados(),
    store.listGrupos(),
    store.listLancamentos(),
    store.getListas(),
  ]);
  const lancamentos = dedupLancamentos(lancamentosBrutos);
  const grupos = gruposBrutos.sort((a, b) => a.numero - b.numero);

  const linhasCupom = agruparParceirosPorCupom(parceiros);
  const chavePorParceiroId = Object.fromEntries(parceiros.map((p) => [p.id, chaveCupom(p)]));
  const linhasPorChave = new Map(linhasCupom.map((lc) => [lc.chave, lc]));

  /* ---------- modelo ---------- */

  // códigos (chaves) dos cupons de um grupo — lista própria do grupo se
  // já existir, senão o legado (parceiros com grupoCupom = número)
  function membrosDoGrupo(g) {
    if (Array.isArray(g.cupons)) return new Set(g.cupons.map(normalizarCupom));
    return new Set(linhasCupom
      .filter((lc) => lc.parceiros.some((p) => String(p.grupoCupom || "") === String(g.numero)))
      .map((lc) => lc.chave));
  }
  let membrosPorGrupo = new Map(grupos.map((g) => [g.id, membrosDoGrupo(g)]));

  // todos os períodos de desconto de um cupom: um por grupo do qual ele
  // participa + os do próprio cupom (calendário do modal "Editar
  // cupom", ver periodosDoCupom), em ordem de data
  function periodosEspeciais(chave) {
    const lista = [];
    for (const g of grupos) {
      if (!g.inicio || !g.fim || !membrosPorGrupo.get(g.id)?.has(chave)) continue;
      lista.push({ inicio: g.inicio, fim: g.fim, percentual: g.percentual || PERCENTUAL_GRUPO_PADRAO, origem: g.nome });
    }
    const rep = linhasPorChave.get(chave)?.parceiros[0];
    for (const per of periodosDoCupom(rep)) lista.push({ ...per, origem: "do cupom" });
    return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
  }
  function descontoBase(lc) {
    return Number(lc.parceiros[0].descontoBase) || DESCONTO_BASE_PADRAO;
  }
  function descontoHoje(lc) {
    const hoje = hojeISO();
    const per = periodosEspeciais(lc.chave).filter((p) => hoje >= p.inicio && hoje <= p.fim).at(-1);
    if (!per) return { percentual: descontoBase(lc), especial: null };
    return { percentual: per.percentual, especial: per.percentual > descontoBase(lc) ? per : null };
  }
  // "Período 50%" = qualquer período com desconto acima do base do cupom
  function lancamentoEspecial(l, chave) {
    const lc = linhasPorChave.get(chave);
    const base = lc ? descontoBase(lc) : DESCONTO_BASE_PADRAO;
    return periodosEspeciais(chave).some((per) => per.percentual > base && lancamentoNoPeriodo(l, per.inicio, per.fim));
  }

  // uso/faturamento por cupom dentro de De/Até, opcionalmente só nos
  // períodos especiais ("50") ou só fora deles ("20")
  function statsPorCupom(de, ate, faixa) {
    const mapa = new Map();
    for (const l of lancamentos) {
      if (!lancamentoNoPeriodo(l, de, ate)) continue;
      const chave = chavePorParceiroId[l.parceiroId];
      if (!chave) continue;
      if (faixa !== "todos" && lancamentoEspecial(l, chave) !== (faixa === "50")) continue;
      if (!mapa.has(chave)) mapa.set(chave, { uso: 0, fat: 0 });
      const a = mapa.get(chave);
      a.uso += l.quantidadeUso;
      a.fat += l.faturamentoCupom;
    }
    return mapa;
  }

  /* ---------- estado da tela ---------- */

  let abaPrincipal = "todos"; // "todos" | "grupos"
  let grupoSel = grupos[grupos.length - 1]?.id || null;
  let faixa = "todos"; // "todos" | "50" | "20"
  let de = "", ate = "";
  let busca = "";
  const ordem = { chave: "cupom", dir: "asc" };

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Cupons</h1>
        <div class="page-sub">${linhasCupom.length} cupons · desconto base próprio de cada cupom, aumentado nos períodos dos grupos <span class="badge badge--amber" style="margin-left:6px">esboço</span></div>
      </div>
    </div>

    <div class="tabs" id="abas-cupons">
      <button class="tab-btn active" data-aba="todos">Todos os cupons</button>
      <button class="tab-btn" data-aba="grupos">Grupos</button>
    </div>

    <div id="conteudo-cupons"></div>
    <div class="viz-tooltip" id="viz-tip-cupons" role="tooltip"></div>
  `;
  const conteudo = app.querySelector("#conteudo-cupons");

  app.querySelector("#abas-cupons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-aba]");
    if (!btn) return;
    abaPrincipal = btn.dataset.aba;
    app.querySelectorAll("#abas-cupons .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    desenhar();
  });

  function desenhar() {
    if (abaPrincipal === "todos") desenharTodos();
    else desenharGrupos();
  }

  /* ================= Aba "Todos os cupons" ================= */

  function desenharTodos() {
    conteudo.innerHTML = `
      <div class="toolbar" style="margin-bottom:14px; gap:10px; flex-wrap:wrap; align-items:flex-end">
        <div class="field" style="margin-bottom:0"><label>De</label><input class="input" type="date" id="cupons-de" value="${de}" style="width:auto"></div>
        <div class="field" style="margin-bottom:0"><label>Até</label><input class="input" type="date" id="cupons-ate" value="${ate}" style="width:auto"></div>
        <div class="filter-row" id="faixa-cupons" style="margin-bottom:0">
          <button class="chip ${faixa === "todos" ? "active" : ""}" data-f="todos">Todos os dias</button>
          <button class="chip ${faixa === "50" ? "active" : ""}" data-f="50" title="Soma só os lançamentos que caem em algum período especial (grupo) de cada cupom">Período 50%</button>
          <button class="chip ${faixa === "20" ? "active" : ""}" data-f="20" title="Soma só os lançamentos fora de qualquer período especial — o cupom no desconto base">Período 20%</button>
        </div>
        <input class="input" id="busca-cupom" type="search" placeholder="Buscar por cupom…" value="${esc(busca)}" style="flex:1;min-width:180px" />
      </div>
      <div class="muted" id="resumo-faixa" style="font-size:12.5px; margin-bottom:10px"></div>

      <div class="chart-card" style="padding:0">
        <table class="rank-table" id="tabela-cupons">
          <thead>
            <tr>
              <th data-sort="cupom">Cupom</th>
              <th data-sort="uso" class="num">Usos no período</th>
              <th data-sort="fat" class="num">Faturamento no período</th>
              <th data-sort="desc">Desconto atual</th>
              <th>Desconto base</th>
              <th>Períodos especiais</th>
            </tr>
          </thead>
          <tbody id="lista-cupons"></tbody>
        </table>
      </div>
    `;

    conteudo.querySelector("#cupons-de").addEventListener("change", (e) => { de = e.target.value; desenharLista(); });
    conteudo.querySelector("#cupons-ate").addEventListener("change", (e) => { ate = e.target.value; desenharLista(); });
    conteudo.querySelector("#faixa-cupons").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-f]");
      if (!btn) return;
      faixa = btn.dataset.f;
      conteudo.querySelectorAll("#faixa-cupons .chip").forEach((c) => c.classList.toggle("active", c === btn));
      desenharLista();
    });
    conteudo.querySelector("#busca-cupom").addEventListener("input", (e) => { busca = e.target.value; desenharLista(); });
    conteudo.querySelector("#tabela-cupons thead").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      if (ordem.chave === th.dataset.sort) ordem.dir = ordem.dir === "asc" ? "desc" : "asc";
      else { ordem.chave = th.dataset.sort; ordem.dir = th.dataset.sort === "cupom" ? "asc" : "desc"; }
      desenharLista();
    });

    const lista = conteudo.querySelector("#lista-cupons");
    lista.addEventListener("click", (e) => {
      const nomeEl = e.target.closest(".cupom-nome-hover");
      if (!nomeEl || !podeEditar) return;
      const lc = linhasPorChave.get(nomeEl.dataset.chave);
      if (lc) abrirCupomDoParceiro(lc.parceiros[0], lc.parceiros, grupos, listas);
    });
    lista.addEventListener("change", async (e) => {
      const sel = e.target.closest(".cupom-base");
      if (!sel) return;
      const lc = linhasPorChave.get(sel.dataset.chave);
      if (!lc) return;
      const valor = Number(sel.value);
      await Promise.all(lc.parceiros.map((p) => store.updateParceiro(p.id, { descontoBase: valor })));
      lc.parceiros.forEach((p) => { p.descontoBase = valor; });
      desenharLista();
    });

    desenharLista();
  }

  function desenharLista() {
    const stats = statsPorCupom(de, ate, faixa);
    const termo = busca.trim().toLowerCase();
    const arr = linhasCupom
      .filter((lc) => !termo || (lc.cupom || "").toLowerCase().includes(termo))
      .map((lc) => ({ lc, uso: stats.get(lc.chave)?.uso || 0, fat: stats.get(lc.chave)?.fat || 0, desc: descontoHoje(lc).percentual }));

    const mul = ordem.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (ordem.chave === "cupom") return (a.lc.cupom || "").localeCompare(b.lc.cupom || "", "pt-BR") * mul;
      return (a[ordem.chave] - b[ordem.chave]) * mul;
    });

    const lista = conteudo.querySelector("#lista-cupons");
    lista.innerHTML = arr.length
      ? arr.map((l) => rowHtml(l.lc, l.uso, l.fat)).join("")
      : `<tr><td colspan="6" class="empty">Nenhum cupom encontrado.</td></tr>`;

    conteudo.querySelectorAll("#tabela-cupons th[data-sort]").forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sort === ordem.chave);
      th.dataset.sortDir = th.dataset.sort === ordem.chave ? ordem.dir : "";
    });

    const totUso = arr.reduce((s, l) => s + l.uso, 0);
    const totFat = arr.reduce((s, l) => s + l.fat, 0);
    const rotuloFaixa = faixa === "50" ? "só nos períodos especiais" : faixa === "20" ? "só fora dos períodos especiais" : "todos os dias";
    const rotuloDatas = de || ate ? `${de ? formatDataBR(de) : "início"} a ${ate ? formatDataBR(ate) : "hoje"}` : "todo o histórico";
    conteudo.querySelector("#resumo-faixa").textContent =
      `${rotuloDatas} · ${rotuloFaixa} · ${totUso} usos · ${formatMoeda(totFat)}`;

    wireTooltipCupons(lista);
  }

  function rowHtml(lc, uso, fat) {
    const rep = lc.parceiros[0];
    const pausado = statusCupomEfetivo(rep) === "Pausado";
    const hoje = descontoHoje(lc);
    const base = descontoBase(lc);
    const periodos = periodosEspeciais(lc.chave);
    const empresas = lc.parceiros.map((p) => p.nome).join(", ");
    const periodosHtml = periodos.length
      ? periodos.map((p) => `<span class="badge ${p.inicio <= hojeISO() && hojeISO() <= p.fim ? "badge--amber" : "badge--gray"}" title="${esc(p.origem)}" style="margin:1px 3px 1px 0">${p.percentual}% · ${esc(fmtIntervaloCurto(p.inicio, p.fim))}</span>`).join("")
      : `<span class="muted">—</span>`;
    return `<tr class="rank-row">
      <td>
        <strong class="cupom-nome-hover${hoje.especial ? " cupom-codigo--50" : ""}${pausado ? " cupom-pausado" : ""}" data-chave="${esc(lc.chave)}" tabindex="0">${esc(lc.cupom)}</strong>
        ${pausado ? `<span class="muted" style="font-size:11px"> · fora do ar</span>` : ""}
        ${lc.parceiros.length > 1 ? `<div class="muted" style="font-size:11.5px">${esc(empresas)}</div>` : ""}
      </td>
      <td class="num">${uso}</td>
      <td class="num">${esc(formatMoeda(fat))}</td>
      <td>
        <span class="badge ${hoje.especial ? "cupom-desconto--50" : "cupom-desconto--20"}">${hoje.percentual}%</span>
        ${hoje.especial ? `<div class="muted" style="font-size:11px">${esc(hoje.especial.origem)} até ${esc(formatDataBR(hoje.especial.fim))}</div>` : ""}
      </td>
      <td>
        <select class="input cupom-base" data-chave="${esc(lc.chave)}" style="width:80px" ${podeEditar ? "" : "disabled"}>
          ${DESCONTOS_BASE.map((d) => `<option value="${d}" ${d === base ? "selected" : ""}>${d}%</option>`).join("")}
        </select>
      </td>
      <td style="font-size:11.5px">${periodosHtml}</td>
    </tr>`;
  }

  /* Ao passar o mouse no nome do cupom, mostra empresa + responsável de
     cada parceiro daquele cupom (mesmo componente .viz-tooltip). */
  function wireTooltipCupons(lista) {
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

  /* ================= Aba "Grupos" ================= */

  function desenharGrupos() {
    if (!grupos.some((g) => g.id === grupoSel)) grupoSel = grupos[grupos.length - 1]?.id || null;
    conteudo.innerHTML = `
      <div class="filter-row" id="sub-grupos">
        ${grupos.map((g) => `<button class="chip ${g.id === grupoSel ? "active" : ""}" data-g="${esc(g.id)}" title="${esc(fmtIntervalo(g.inicio, g.fim))}">${esc(g.nome)}</button>`).join("")}
        <button class="btn btn-ghost btn-sm edit-only" id="grp-novo">+ Novo grupo</button>
      </div>
      <div id="grupo-detalhe"></div>
    `;
    conteudo.querySelector("#sub-grupos").addEventListener("click", (e) => {
      if (e.target.closest("#grp-novo")) return abrirFormGrupo(null);
      const btn = e.target.closest("[data-g]");
      if (!btn) return;
      grupoSel = btn.dataset.g;
      desenharGrupos();
    });
    const g = grupos.find((x) => x.id === grupoSel);
    const det = conteudo.querySelector("#grupo-detalhe");
    if (!g) { det.innerHTML = `<div class="empty">Nenhum grupo ainda.</div>`; return; }

    const membros = [...(membrosPorGrupo.get(g.id) || [])]
      .map((ch) => linhasPorChave.get(ch))
      .filter(Boolean)
      .sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));
    const stats = g.inicio && g.fim ? statsPorCupom(g.inicio, g.fim, "todos") : new Map();
    const totUso = membros.reduce((s, lc) => s + (stats.get(lc.chave)?.uso || 0), 0);
    const totFat = membros.reduce((s, lc) => s + (stats.get(lc.chave)?.fat || 0), 0);
    const legado = !Array.isArray(g.cupons);

    det.innerHTML = `
      <div class="chart-card" style="margin-bottom:14px">
        <div style="display:flex; gap:24px; flex-wrap:wrap; align-items:center">
          <div><div class="muted" style="font-size:12px">Período especial</div><strong>${esc(fmtIntervalo(g.inicio, g.fim))}</strong></div>
          <div><div class="muted" style="font-size:12px">Desconto no período</div><strong>${g.percentual || PERCENTUAL_GRUPO_PADRAO}%</strong></div>
          <div><div class="muted" style="font-size:12px">Cupons</div><strong>${membros.length}</strong></div>
          <div><div class="muted" style="font-size:12px">No período</div><strong>${totUso} usos · ${esc(formatMoeda(totFat))}</strong></div>
          <span style="margin-left:auto; display:flex; gap:16px">
            <button type="button" class="btn-link edit-only" id="grp-editar">editar grupo</button>
            <button type="button" class="btn-link edit-only" id="grp-membros">adicionar/remover cupons</button>
            <button type="button" class="btn-link" id="grp-exportar">exportar tabela</button>
            <button type="button" class="btn-link btn-link-danger edit-only" id="grp-excluir">excluir grupo</button>
          </span>
        </div>
        ${legado ? `<div class="muted" style="font-size:11.5px; margin-top:8px">Membros lidos do campo antigo "Grupo" de cada cupom — ao editar os membros aqui, o grupo passa a guardar a própria lista.</div>` : ""}
      </div>

      <div class="chart-card" style="padding:0">
        <table class="rank-table">
          <thead>
            <tr>
              <th>Cupom</th>
              <th class="num">Usos no período do grupo</th>
              <th class="num">Faturamento no período do grupo</th>
              <th>Desconto base</th>
              <th>Outros períodos especiais</th>
            </tr>
          </thead>
          <tbody>
            ${membros.length ? membros.map((lc) => {
              const outros = periodosEspeciais(lc.chave).filter((p) => !(p.inicio === g.inicio && p.fim === g.fim && p.origem === g.nome));
              return `<tr class="rank-row">
                <td><strong>${esc(lc.cupom)}</strong>${lc.parceiros.length > 1 ? `<div class="muted" style="font-size:11.5px">${esc(lc.parceiros.map((p) => p.nome).join(", "))}</div>` : `<div class="muted" style="font-size:11.5px">${esc(lc.parceiros[0].nome)}</div>`}</td>
                <td class="num">${stats.get(lc.chave)?.uso || 0}</td>
                <td class="num">${esc(formatMoeda(stats.get(lc.chave)?.fat || 0))}</td>
                <td>${descontoBase(lc)}%</td>
                <td style="font-size:11.5px">${outros.length ? outros.map((p) => `<span class="badge badge--gray" title="${esc(p.origem)}" style="margin:1px 3px 1px 0">${p.percentual}% · ${esc(fmtIntervaloCurto(p.inicio, p.fim))}</span>`).join("") : `<span class="muted">—</span>`}</td>
              </tr>`;
            }).join("") : `<tr><td colspan="5" class="empty">Nenhum cupom neste grupo.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
    det.querySelector("#grp-editar")?.addEventListener("click", () => abrirFormGrupo(g));
    det.querySelector("#grp-membros")?.addEventListener("click", () => abrirMembros(g));
    det.querySelector("#grp-exportar").addEventListener("click", () => {
      const linhasArquivo = [
        ["Cupom", "Descrição", "Início – término"],
        ...membros.map((lc) => [lc.cupom, DESCRICAO_EXPORT, g.inicio && g.fim ? fmtIntervalo(g.inicio, g.fim) : ""]),
      ];
      baixarCSV(linhasArquivo, `cupons-${g.nome.toLowerCase().replace(/\s+/g, "-")}-${hojeISO()}.csv`);
    });
    det.querySelector("#grp-excluir")?.addEventListener("click", () => excluirGrupo(g));
  }

  function abrirFormGrupo(g) {
    const novo = !g;
    const proximoNumero = Math.max(0, ...grupos.map((x) => x.numero)) + 1;
    openModal({
      title: novo ? "Novo grupo" : `Editar ${g.nome}`,
      subtitle: "Período em que os cupons do grupo ganham desconto especial",
      submitLabel: novo ? "Criar" : "Salvar",
      bodyHtml: `
        ${fieldText("nome", "Nome do grupo", { required: true, value: novo ? `Grupo ${proximoNumero}` : g.nome })}
        <div class="field-2col">
          ${fieldText("inicio", "Início", { type: "date", value: g?.inicio || "" })}
          ${fieldText("fim", "Fim", { type: "date", value: g?.fim || "" })}
        </div>
        ${fieldSelect("percentual", "Desconto no período", DESCONTOS_BASE.map((d) => `${d}%`), { value: `${g?.percentual || PERCENTUAL_GRUPO_PADRAO}%` })}
      `,
      onSubmit: async (form) => {
        const campos = {
          nome: readValue(form, "nome"),
          inicio: readValue(form, "inicio"),
          fim: readValue(form, "fim"),
          percentual: parseInt(readValue(form, "percentual"), 10) || PERCENTUAL_GRUPO_PADRAO,
        };
        if (!campos.nome) throw new Error("Informe o nome do grupo.");
        if (campos.inicio && campos.fim && campos.fim < campos.inicio) throw new Error("O fim do período está antes do início.");
        if (novo) {
          const criado = await store.addGrupo({ numero: proximoNumero, ...campos, cupons: [] });
          grupos.push(criado);
          membrosPorGrupo.set(criado.id, new Set());
          grupoSel = criado.id;
        } else {
          await store.updateGrupo(g.id, campos);
          Object.assign(g, campos);
        }
        desenhar();
      },
    });
  }

  function abrirMembros(g) {
    const atuais = membrosPorGrupo.get(g.id) || new Set();
    const ordenados = [...linhasCupom].sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));
    openModal({
      title: `Cupons do ${g.nome}`,
      subtitle: fmtIntervalo(g.inicio, g.fim),
      submitLabel: "Salvar",
      wide: true,
      bodyHtml: `
        <input class="input" type="search" id="membros-busca" placeholder="Filtrar cupons…" style="margin-bottom:10px">
        <div id="membros-lista" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:6px 14px; max-height:50vh; overflow:auto">
          ${ordenados.map((lc) => `<label class="checkbox-inline" data-cupom="${esc((lc.cupom || "").toLowerCase())}"><input type="checkbox" name="membro" value="${esc(lc.chave)}" ${atuais.has(lc.chave) ? "checked" : ""}> ${esc(lc.cupom)}</label>`).join("")}
        </div>
      `,
      onMount: (overlay) => {
        overlay.querySelector("#membros-busca").addEventListener("input", (e) => {
          const t = e.target.value.trim().toLowerCase();
          overlay.querySelectorAll("#membros-lista [data-cupom]").forEach((el) => { el.style.display = !t || el.dataset.cupom.includes(t) ? "" : "none"; });
        });
      },
      onSubmit: async (form) => {
        const cupons = [...form.querySelectorAll('input[name="membro"]:checked')].map((el) => el.value);
        await store.updateGrupo(g.id, { cupons });
        g.cupons = cupons;
        membrosPorGrupo.set(g.id, new Set(cupons));
        desenhar();
      },
    });
  }

  async function excluirGrupo(g) {
    if (!confirm(`Excluir "${g.nome}"?\n\nOs cupons perdem esse período especial (o desconto base deles não muda).`)) return;
    await store.removeGrupo(g.id);
    grupos.splice(grupos.indexOf(g), 1);
    membrosPorGrupo.delete(g.id);
    grupoSel = null;
    desenhar();
  }

  desenhar();
}
