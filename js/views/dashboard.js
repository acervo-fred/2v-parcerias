/* Dashboard — desempenho dos cupons, com período ajustável, filtros globais
   (parceiro / tipo de parceiro), comparação automática com o período
   anterior, uma tabela de ranking ordenável/pesquisável (com rolagem) com
   drill-down, e uma ferramenta de comparação (mesmo cupom em períodos
   diferentes, ou dois cupons/parceiros quaisquer no mesmo período — os
   dois campos de período do comparador ficam sincronizados). Tudo
   calculado em cima de listLancamentos() + listParceirosFechados(), sem
   nada gravado — puramente derivado.

   Gráficos em SVG/HTML simples (sem biblioteca), seguindo a paleta
   validada em --chart-series-a/b (ver styles.css): verde vívido como
   série principal, azul da marca como segunda série (comparação). Para o
   gráfico de participação por cupom (mais de 2 séries) usamos a paleta
   categórica validada da skill de dataviz (blue/aqua/yellow/green/violet,
   ΔE de CVD adjacente ≥ 24 nessa ordem) + cinza neutro para "Outros". */

import { store } from "../data/store.js";
import { esc, formatMoeda } from "../ui/dom.js";

const MES_NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const TOP_N_CUPONS = 8;
// paleta categórica validada (slots 1-5 da ordem fixa: blue, aqua, yellow, green, violet)
const CORES_CATEGORICAS = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"];
const COR_OUTROS = "var(--c-gray-fg)";

export async function renderDashboard(app) {
  const [lancamentos, parceiros, listas] = await Promise.all([
    store.listLancamentos(),
    store.listParceirosFechados(),
    store.getListas(),
  ]);
  const porId = Object.fromEntries(parceiros.map((p) => [p.id, p]));
  const parceirosOrdenados = [...parceiros].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const [deInicial, ateInicial] = presetRange("mes");

  // estado da tabela de ranking (sobrevive a trocas de filtro/período)
  const tabelaState = { sortKey: "fat", sortDir: "desc", busca: "" };
  let linhasRanking = []; // recalculada a cada atualizarPeriodo()

  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Desempenho dos cupons 2V - Largo do Machado</h1></div>
    </div>

    <div class="filter-row" id="presets" style="margin-bottom:10px">
      ${["semana", "mes", "mespassado", "ano", "tudo"].map((p) =>
        `<button class="chip ${p === "mes" ? "active" : ""}" data-preset="${p}">${presetLabel(p)}</button>`
      ).join("")}
    </div>
    <div class="toolbar" style="margin-bottom:14px; gap:10px; align-items:flex-end; flex-wrap:wrap">
      <div class="field" style="margin-bottom:0"><label>Parceiro</label>
        <select class="input select-compact" id="f-parceiro">
          <option value="">Todos os parceiros</option>
          ${parceirosOrdenados.map((p) => `<option value="${esc(p.id)}" title="${esc(p.nome)} — ${esc(p.cupom)}">${esc(p.nome)} — ${esc(p.cupom)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="margin-bottom:0"><label>Tipo de parceiro</label>
        <select class="input select-compact" id="f-tipo">
          <option value="">Todos os tipos</option>
          ${(listas.tipoNegocio || []).map((t) => `<option value="${esc(t.valor)}">${esc(t.valor)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="margin-bottom:0"><label>De</label><input class="input" type="date" id="f-de" value="${deInicial}"></div>
      <div class="field" style="margin-bottom:0"><label>Até</label><input class="input" type="date" id="f-ate" value="${ateInicial}"></div>
    </div>
    <div class="muted" id="comparacao-nota" style="font-size:12px;margin-bottom:18px"></div>

    <div class="stat-grid" id="resumo"></div>

    <section class="section">
      <div class="section-head"><h2>Desempenho por cupom no período</h2></div>
      <div class="note"><span class="note-i">ⓘ</span>
        Top ${TOP_N_CUPONS} por faturamento e por usos. A lista completa (ordenável e pesquisável) está logo abaixo dos gráficos.</div>
      <div class="dash-cols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;align-items:start">
        <div class="chart-card"><h3 style="margin-bottom:14px">Faturamento por cupom</h3><div id="ranking-cupons"></div></div>
        <div class="chart-card"><h3 style="margin-bottom:14px">Usos por cupom</h3><div id="ranking-usos"></div></div>
      </div>

      <div class="dash-cols" style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:20px;align-items:start">
        <div class="chart-card">
          <div class="chart-card-head">
            <h3>Faturamento por mês <span class="muted" style="font-size:11px;font-weight:600">— histórico completo</span></h3>
            <button class="chart-toggle" id="toggle-mes" type="button">Ver tabela</button>
          </div>
          <div id="chart-mes"></div>
          <table class="chart-table" id="tabela-mes">
            <thead><tr><th>Mês</th><th>Faturamento via cupom</th></tr></thead>
            <tbody id="tabela-mes-body"></tbody>
          </table>
        </div>

        <div class="chart-card">
          <h3 style="margin-bottom:14px">Cupom sobre faturamento total</h3>
          <div id="donut-cupom"></div>
        </div>
      </div>

      <div class="dash-cols" style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:20px;align-items:start">
        <div class="chart-card">
          <h3>Evolução do uso de cupons <span class="muted" style="font-size:11px;font-weight:600">— histórico completo</span></h3>
          <div id="chart-uso"></div>
        </div>
        <div class="chart-card">
          <h3 style="margin-bottom:14px">Participação por cupom no período</h3>
          <div id="participacao"></div>
        </div>
      </div>

      <div class="toolbar" style="margin-bottom:10px">
        <input class="input" id="tabela-busca" type="search" placeholder="Buscar por cupom ou parceiro…" style="flex:1;min-width:200px" />
      </div>
      <div class="chart-card" style="padding:0">
        <div class="rank-table-scroll">
          <table class="rank-table" id="tabela-ranking">
            <thead>
              <tr>
                <th data-sort="cupom">Cupom</th>
                <th data-sort="parceiro">Parceiro</th>
                <th data-sort="uso" class="num">Usos</th>
                <th data-sort="fat" class="num">Receita</th>
                <th data-sort="pct" class="num">% do total</th>
                <th data-sort="ticket" class="num">Ticket médio</th>
                <th data-sort="growth" class="num">Crescimento</th>
              </tr>
            </thead>
            <tbody id="tabela-ranking-body"></tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Comparar</h2></div>
      <label class="checkbox-inline" style="margin-bottom:14px">
        <input type="checkbox" id="cmp-mesmo-periodo" checked> Mesmo período
      </label>
      <div class="compare-grid">
        ${compareColHtml("a", parceirosOrdenados, deInicial, ateInicial)}
        ${compareColHtml("b", parceirosOrdenados, deInicial, ateInicial)}
      </div>
      <button class="btn btn-primary" id="btn-comparar" style="margin-top:14px">Comparar</button>
      <div class="chart-card" id="compare-resultado" style="margin-top:14px; display:none"></div>
    </section>

    <div class="viz-tooltip" id="viz-tip" role="tooltip"></div>
  `;

  /* ---- filtros: período + dimensões (parceiro / tipo) ---- */
  function lerFiltros() {
    return {
      de: app.querySelector("#f-de").value,
      ate: app.querySelector("#f-ate").value,
      parceiroId: app.querySelector("#f-parceiro").value,
      tipo: app.querySelector("#f-tipo").value,
    };
  }

  function atualizarPeriodo() {
    const { de, ate, parceiroId, tipo } = lerFiltros();
    const dims = { parceiroId, tipo };
    const comparavel = Boolean(de && ate);
    const [deAnt, ateAnt] = comparavel ? periodoAnterior(de, ate) : ["", ""];

    const doPeriodo = filtrarTudo(lancamentos, porId, { de, ate, ...dims });
    const doPeriodoAnterior = comparavel ? filtrarTudo(lancamentos, porId, { de: deAnt, ate: ateAnt, ...dims }) : [];
    const lancamentosDim = filtrarDimensoes(lancamentos, porId, dims);

    app.querySelector("#comparacao-nota").textContent = comparavel
      ? `Comparado com o período imediatamente anterior de mesma duração (${formatDataBRlocal(deAnt)} – ${formatDataBRlocal(ateAnt)}).`
      : `Selecione um período (De/Até) para comparar com o período anterior.`;

    desenharResumo(app, doPeriodo, doPeriodoAnterior, comparavel);
    desenharDonutCupom(app, doPeriodo);
    desenharRanking(app, doPeriodo, porId);
    desenharRankingUsos(app, doPeriodo, porId);
    desenharParticipacao(app, doPeriodo, porId);
    desenharChartUsoMensal(app, lancamentosDim);
    desenharChartMes(app, lancamentosDim);

    linhasRanking = calcularLinhasRanking(doPeriodo, doPeriodoAnterior, porId, comparavel);
    desenharTabela();
  }

  function desenharTabela() {
    const termo = tabelaState.busca.trim().toLowerCase();
    const filtradas = termo
      ? linhasRanking.filter((l) =>
          l.parceiro.nome.toLowerCase().includes(termo) || (l.parceiro.cupom || "").toLowerCase().includes(termo))
      : linhasRanking;
    const ordenadas = ordenarLinhas(filtradas, tabelaState.sortKey, tabelaState.sortDir);
    const body = app.querySelector("#tabela-ranking-body");
    body.innerHTML = ordenadas.length
      ? ordenadas.map(tabelaRowHtml).join("")
      : `<tr><td colspan="7" class="empty">Nenhum resultado nesse período.</td></tr>`;

    app.querySelectorAll("#tabela-ranking th[data-sort]").forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sort === tabelaState.sortKey);
      th.dataset.sortDir = th.dataset.sort === tabelaState.sortKey ? tabelaState.sortDir : "";
    });
  }

  app.querySelector("#presets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    app.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b === btn));
    const [de, ate] = presetRange(btn.dataset.preset);
    app.querySelector("#f-de").value = de;
    app.querySelector("#f-ate").value = ate;
    atualizarPeriodo();
  });
  ["#f-de", "#f-ate"].forEach((sel) => {
    app.querySelector(sel).addEventListener("change", () => {
      app.querySelectorAll("[data-preset]").forEach((b) => b.classList.remove("active"));
      atualizarPeriodo();
    });
  });
  ["#f-parceiro", "#f-tipo"].forEach((sel) => {
    app.querySelector(sel).addEventListener("change", atualizarPeriodo);
  });
  atualizarPeriodo();

  /* ---- tabela: busca, ordenação, drill-down ---- */
  app.querySelector("#tabela-busca").addEventListener("input", (e) => {
    tabelaState.busca = e.target.value;
    desenharTabela();
  });
  app.querySelector("#tabela-ranking thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    if (tabelaState.sortKey === key) {
      tabelaState.sortDir = tabelaState.sortDir === "asc" ? "desc" : "asc";
    } else {
      tabelaState.sortKey = key;
      tabelaState.sortDir = "desc";
    }
    desenharTabela();
  });
  app.querySelector("#tabela-ranking-body").addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    location.hash = `#/parceiro/${row.dataset.id}`;
  });

  /* ---- toggle tabela/gráfico do faturamento por mês ---- */
  app.querySelector("#toggle-mes").addEventListener("click", (e) => {
    const svgWrap = app.querySelector("#chart-mes");
    const tabela = app.querySelector("#tabela-mes");
    const showingTable = tabela.classList.toggle("show");
    svgWrap.style.display = showingTable ? "none" : "";
    e.target.textContent = showingTable ? "Ver gráfico" : "Ver tabela";
  });

  /* ---- comparação: com "Mesmo período" marcado, as duas colunas ficam
     travadas na mesma data — mudar De/Até de um lado sincroniza o outro.
     Desmarcado, cada lado escolhe seu próprio período livremente. ---- */
  const mesmoPeriodo = () => app.querySelector("#cmp-mesmo-periodo").checked;
  app.querySelector("#cmp-a-de").addEventListener("change", (e) => { if (mesmoPeriodo()) app.querySelector("#cmp-b-de").value = e.target.value; });
  app.querySelector("#cmp-a-ate").addEventListener("change", (e) => { if (mesmoPeriodo()) app.querySelector("#cmp-b-ate").value = e.target.value; });
  app.querySelector("#cmp-b-de").addEventListener("change", (e) => { if (mesmoPeriodo()) app.querySelector("#cmp-a-de").value = e.target.value; });
  app.querySelector("#cmp-b-ate").addEventListener("change", (e) => { if (mesmoPeriodo()) app.querySelector("#cmp-a-ate").value = e.target.value; });
  app.querySelector("#cmp-mesmo-periodo").addEventListener("change", (e) => {
    if (!e.target.checked) return;
    app.querySelector("#cmp-b-de").value = app.querySelector("#cmp-a-de").value;
    app.querySelector("#cmp-b-ate").value = app.querySelector("#cmp-a-ate").value;
  });

  app.querySelector("#btn-comparar").addEventListener("click", () => {
    compararEDesenhar(app, lancamentos, porId);
  });
}

/* ---------- período: presets ---------- */
function presetLabel(p) {
  return { semana: "Esta semana", mes: "Este mês", mespassado: "Mês passado", ano: "Este ano", tudo: "Tudo" }[p] || p;
}
function presetRange(nome) {
  const hoje = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (nome === "semana") {
    const de = new Date(hoje); de.setDate(de.getDate() - 6);
    return [iso(de), iso(hoje)];
  }
  if (nome === "mes") {
    return [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), iso(hoje)];
  }
  if (nome === "mespassado") {
    return [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0))];
  }
  if (nome === "ano") {
    return [iso(new Date(hoje.getFullYear(), 0, 1)), iso(hoje)];
  }
  return ["", ""]; // tudo
}
// range imediatamente anterior, de mesma duração (em dias) que [de, ate]
function periodoAnterior(de, ate) {
  if (!de || !ate) return ["", ""];
  const iso = (d) => d.toISOString().slice(0, 10);
  const dDe = new Date(`${de}T00:00:00`), dAte = new Date(`${ate}T00:00:00`);
  const diasNoPeriodo = Math.max(0, Math.round((dAte - dDe) / 86400000));
  const anteriorAte = new Date(dDe); anteriorAte.setDate(anteriorAte.getDate() - 1);
  const anteriorDe = new Date(anteriorAte); anteriorDe.setDate(anteriorDe.getDate() - diasNoPeriodo);
  return [iso(anteriorDe), iso(anteriorAte)];
}
function formatDataBRlocal(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/* ---------- agregações ---------- */
function filtrarPeriodo(lancamentos, de, ate) {
  return lancamentos.filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate));
}
function filtrarDimensoes(lancamentos, porId, { parceiroId, tipo }) {
  if (!parceiroId && !tipo) return lancamentos;
  return lancamentos.filter((l) => {
    const p = porId[l.parceiroId];
    if (!p) return false;
    if (parceiroId && l.parceiroId !== parceiroId) return false;
    if (tipo && p.tipo !== tipo) return false;
    return true;
  });
}
function filtrarTudo(lancamentos, porId, { de, ate, parceiroId, tipo }) {
  return filtrarDimensoes(filtrarPeriodo(lancamentos, de, ate), porId, { parceiroId, tipo });
}
function agregarPorParceiro(lista) {
  const mapa = new Map();
  for (const l of lista) {
    if (!mapa.has(l.parceiroId)) mapa.set(l.parceiroId, { uso: 0, fatCupom: 0, fatSemCupom: 0 });
    const a = mapa.get(l.parceiroId);
    a.uso += l.quantidadeUso;
    a.fatCupom += l.faturamentoCupom;
    a.fatSemCupom += l.faturamentoTotalSemCupom;
  }
  return mapa;
}
function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}
function formatCompact(v) {
  if (Math.abs(v) >= 1000) return "R$" + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "K";
  return "R$" + Math.round(v);
}
// % de variação de b (anterior) pra a (atual); null quando não há base de comparação
function pctDelta(atual, anteriorVal) {
  if (anteriorVal === 0) return atual === 0 ? 0 : null;
  return ((atual - anteriorVal) / anteriorVal) * 100;
}
function deltaBadgeHtml(delta, sufixo = "vs. período anterior") {
  if (delta === undefined) return "";
  if (delta === null) return `<div class="kpi-delta kpi-delta--neutral">novo no período</div>`;
  const up = delta >= 0;
  return `<div class="kpi-delta ${up ? "kpi-delta--up" : "kpi-delta--down"}">${up ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}% ${esc(sufixo)}</div>`;
}
function deltaInlineHtml(delta) {
  if (delta === undefined) return `<span class="kpi-delta kpi-delta--neutral">—</span>`;
  if (delta === null) return `<span class="kpi-delta kpi-delta--neutral">novo</span>`;
  const up = delta >= 0;
  return `<span class="kpi-delta ${up ? "kpi-delta--up" : "kpi-delta--down"}">${up ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%</span>`;
}

/* ---------- render: resumo (stat tiles) com comparação de período ---------- */
function calcularResumo(lista) {
  const totalUso = lista.reduce((s, l) => s + l.quantidadeUso, 0);
  const totalCupom = lista.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = lista.reduce((s, l) => s + l.faturamentoTotalSemCupom, 0);
  const totalGeral = totalCupom + totalSemCupom;
  const pctCupom = totalGeral > 0 ? (totalCupom / totalGeral) * 100 : 0;
  const ticketMedio = totalUso > 0 ? totalCupom / totalUso : 0;
  return { totalUso, totalCupom, totalGeral, pctCupom, ticketMedio };
}
function desenharResumo(app, doPeriodo, doPeriodoAnterior, comparavel) {
  const atual = calcularResumo(doPeriodo);
  const anterior = calcularResumo(doPeriodoAnterior);
  const d = (a, b) => (comparavel ? pctDelta(a, b) : undefined);

  app.querySelector("#resumo").innerHTML = [
    stat(formatMoeda(atual.totalGeral), "Faturamento total", d(atual.totalGeral, anterior.totalGeral)),
    stat(formatMoeda(atual.totalCupom), "Faturamento via cupom", d(atual.totalCupom, anterior.totalCupom)),
    stat(`${atual.pctCupom.toFixed(1)}%`, "Cupom sobre faturamento total", d(atual.pctCupom, anterior.pctCupom)),
    stat(atual.totalUso, "Usos de cupom", d(atual.totalUso, anterior.totalUso)),
    stat(formatMoeda(atual.ticketMedio), "Ticket médio", d(atual.ticketMedio, anterior.ticketMedio)),
  ].join("");
}
function stat(num, label, delta) {
  return `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${esc(label)}</div>${deltaBadgeHtml(delta)}</div>`;
}

/* ---------- render: rosca (donut) — cupom vs faturamento total ---------- */
function desenharDonutCupom(app, doPeriodo) {
  const totalCupom = doPeriodo.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = doPeriodo.reduce((s, l) => s + l.faturamentoTotalSemCupom, 0);
  const totalGeral = totalCupom + totalSemCupom;
  const pct = totalGeral > 0 ? (totalCupom / totalGeral) * 100 : 0;

  app.querySelector("#donut-cupom").innerHTML = `
    <div class="viz-donut-wrap">${donutSVG(pct)}</div>
    <div class="viz-meter-legend">
      <span>${esc(formatMoeda(totalCupom))} via cupom</span>
      <span>${esc(formatMoeda(totalGeral))} total</span>
    </div>
  `;
}
function donutSVG(pct) {
  const size = 168, stroke = 20, r = (size - stroke) / 2, c = size / 2;
  const circunferencia = 2 * Math.PI * r;
  const preenchido = (Math.min(100, Math.max(0, pct)) / 100) * circunferencia;
  return `<svg viewBox="0 0 ${size} ${size}" class="viz-donut" width="${size}" height="${size}" role="img" aria-label="${pct.toFixed(1)}% do faturamento vem de cupom">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--chart-track)" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--chart-series-a)" stroke-width="${stroke}"
      stroke-dasharray="${preenchido.toFixed(1)} ${(circunferencia - preenchido).toFixed(1)}"
      stroke-linecap="round" transform="rotate(-90 ${c} ${c})"/>
    <text x="${c}" y="${c - 2}" text-anchor="middle" font-size="27" font-weight="700" fill="var(--text)">${pct.toFixed(1)}%</text>
    <text x="${c}" y="${c + 18}" text-anchor="middle" font-size="11" fill="var(--chart-ink-muted)">via cupom</text>
  </svg>`;
}

/* ---------- render: ranking por cupom (barras horizontais) ---------- */
function desenharRanking(app, doPeriodo, porId) {
  const agregados = agregarPorParceiro(doPeriodo);
  const linhas = [...agregados.entries()]
    .map(([pid, a]) => ({ parceiro: porId[pid], uso: a.uso, fat: a.fatCupom }))
    .filter((l) => l.parceiro && l.fat > 0)
    .sort((a, b) => b.fat - a.fat)
    .slice(0, TOP_N_CUPONS);

  const container = app.querySelector("#ranking-cupons");
  if (!linhas.length) {
    container.innerHTML = `<div class="empty">Nenhum lançamento nesse período.</div>`;
    return;
  }
  const max = Math.max(...linhas.map((l) => l.fat));
  container.innerHTML = linhas.map((l) => `
    <div class="viz-bar-row" data-id="${esc(l.parceiro.id)}" tabindex="0" role="img" aria-label="${esc(l.parceiro.nome)}: ${esc(formatMoeda(l.fat))}, ${l.uso} usos">
      <div class="viz-bar-label" title="${esc(l.parceiro.nome)}">${esc(l.parceiro.nome)}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${Math.max(2, Math.round((l.fat / max) * 100))}%"></div></div>
      <div class="viz-bar-val">${esc(formatMoeda(l.fat))}</div>
    </div>
  `).join("");
  wireBarDrillDown(container);
}

/* ---------- render: ranking por usos (barras horizontais) ---------- */
function desenharRankingUsos(app, doPeriodo, porId) {
  const agregados = agregarPorParceiro(doPeriodo);
  const linhas = [...agregados.entries()]
    .map(([pid, a]) => ({ parceiro: porId[pid], uso: a.uso, fat: a.fatCupom }))
    .filter((l) => l.parceiro && l.uso > 0)
    .sort((a, b) => b.uso - a.uso)
    .slice(0, TOP_N_CUPONS);

  const container = app.querySelector("#ranking-usos");
  if (!linhas.length) {
    container.innerHTML = `<div class="empty">Nenhum lançamento nesse período.</div>`;
    return;
  }
  const max = Math.max(...linhas.map((l) => l.uso));
  container.innerHTML = linhas.map((l) => `
    <div class="viz-bar-row" data-id="${esc(l.parceiro.id)}" tabindex="0" role="img" aria-label="${esc(l.parceiro.nome)}: ${l.uso} usos">
      <div class="viz-bar-label" title="${esc(l.parceiro.nome)}">${esc(l.parceiro.nome)}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${Math.max(2, Math.round((l.uso / max) * 100))}%"></div></div>
      <div class="viz-bar-val">${l.uso}</div>
    </div>
  `).join("");
  wireBarDrillDown(container);
}
function wireBarDrillDown(container) {
  container.querySelectorAll(".viz-bar-row[data-id]").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", () => { location.hash = `#/parceiro/${row.dataset.id}`; });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); location.hash = `#/parceiro/${row.dataset.id}`; }
    });
  });
}

/* ---------- render: participação por cupom (barra empilhada + legenda) ---------- */
function desenharParticipacao(app, doPeriodo, porId) {
  const agregados = agregarPorParceiro(doPeriodo);
  const linhas = [...agregados.entries()]
    .map(([pid, a]) => ({ parceiro: porId[pid], fat: a.fatCupom }))
    .filter((l) => l.parceiro && l.fat > 0)
    .sort((a, b) => b.fat - a.fat);

  const container = app.querySelector("#participacao");
  const total = linhas.reduce((s, l) => s + l.fat, 0);
  if (!total) {
    container.innerHTML = `<div class="empty">Nenhum lançamento nesse período.</div>`;
    return;
  }
  const top = linhas.slice(0, CORES_CATEGORICAS.length);
  const outros = linhas.slice(CORES_CATEGORICAS.length).reduce((s, l) => s + l.fat, 0);

  const segmentos = top.map((l, i) => ({
    label: `${l.parceiro.nome} — ${l.parceiro.cupom}`, valor: l.fat, cor: CORES_CATEGORICAS[i],
  }));
  if (outros > 0) segmentos.push({ label: "Outros", valor: outros, cor: COR_OUTROS });

  container.innerHTML = `
    <div class="viz-stack-bar">
      ${segmentos.map((s) => `<div class="viz-stack-seg" style="width:${Math.max(1, (s.valor / total) * 100).toFixed(2)}%;background:${s.cor}" title="${esc(s.label)}: ${esc(formatMoeda(s.valor))} (${((s.valor / total) * 100).toFixed(1)}%)"></div>`).join("")}
    </div>
    <div class="viz-stack-legend">
      ${segmentos.map((s) => `
        <div class="viz-stack-legend-item">
          <i style="background:${s.cor}"></i>
          <span>${esc(s.label)}</span>
          <strong>${((s.valor / total) * 100).toFixed(1)}%</strong>
        </div>`).join("")}
    </div>
  `;
}

/* ---------- tabela de ranking: cálculo de linhas (com crescimento) ---------- */
function calcularLinhasRanking(doPeriodo, doPeriodoAnterior, porId, comparavel) {
  const atual = agregarPorParceiro(doPeriodo);
  const anterior = agregarPorParceiro(doPeriodoAnterior);
  const totalGeral = [...atual.values()].reduce((s, a) => s + a.fatCupom, 0);

  return [...atual.entries()]
    .map(([pid, a]) => {
      const parceiro = porId[pid];
      const ant = anterior.get(pid);
      const growth = comparavel ? pctDelta(a.fatCupom, ant ? ant.fatCupom : 0) : undefined;
      return {
        parceiro, uso: a.uso, fat: a.fatCupom,
        pct: totalGeral > 0 ? (a.fatCupom / totalGeral) * 100 : 0,
        ticket: a.uso > 0 ? a.fatCupom / a.uso : 0,
        growth,
      };
    })
    .filter((l) => l.parceiro && l.fat > 0);
}
function ordenarLinhas(linhas, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  const val = (l) => {
    switch (key) {
      case "cupom": return (l.parceiro.cupom || "").toLowerCase();
      case "parceiro": return l.parceiro.nome.toLowerCase();
      case "uso": return l.uso;
      case "fat": return l.fat;
      case "pct": return l.pct;
      case "ticket": return l.ticket;
      case "growth": return l.growth === null || l.growth === undefined ? -Infinity : l.growth;
      default: return 0;
    }
  };
  return [...linhas].sort((a, b) => {
    const va = val(a), vb = val(b);
    if (typeof va === "string") return va.localeCompare(vb, "pt-BR") * mul;
    return (va - vb) * mul;
  });
}
function tabelaRowHtml(l) {
  return `<tr class="rank-row" data-id="${esc(l.parceiro.id)}" tabindex="0">
    <td>${esc(l.parceiro.cupom)}</td>
    <td>${esc(l.parceiro.nome)}</td>
    <td class="num">${l.uso}</td>
    <td class="num">${esc(formatMoeda(l.fat))}</td>
    <td class="num">${l.pct.toFixed(1)}%</td>
    <td class="num">${esc(formatMoeda(l.ticket))}</td>
    <td class="num">${deltaInlineHtml(l.growth)}</td>
  </tr>`;
}

/* ---------- render: linha (SVG) — genérico, usado por faturamento/mês e ticket médio ---------- */
function desenharChartMes(app, lancamentosDim) {
  const porMes = new Map();
  for (const l of lancamentosDim) {
    const mes = (l.data || "").slice(0, 7);
    if (!mes) continue;
    porMes.set(mes, (porMes.get(mes) || 0) + l.faturamentoCupom);
  }
  const meses = [...porMes.keys()].sort();
  const pontos = meses.map((m) => ({ label: mesLabel(m), value: porMes.get(m) }));

  const container = app.querySelector("#chart-mes");
  const tabelaBody = app.querySelector("#tabela-mes-body");

  if (!pontos.length) {
    container.innerHTML = `<div class="empty">Sem lançamentos ainda.</div>`;
    tabelaBody.innerHTML = "";
    return;
  }

  container.innerHTML = lineChartSVG(pontos, formatMoeda);
  wireLineChartHover(container, pontos, formatMoeda);

  tabelaBody.innerHTML = "";
  pontos.forEach((p) => {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = p.label;
    const tdValor = document.createElement("td");
    tdValor.textContent = formatMoeda(p.value);
    tr.append(tdLabel, tdValor);
    tabelaBody.appendChild(tr);
  });
}
function desenharChartUsoMensal(app, lancamentosDim) {
  const porMes = new Map();
  for (const l of lancamentosDim) {
    const mes = (l.data || "").slice(0, 7);
    if (!mes) continue;
    porMes.set(mes, (porMes.get(mes) || 0) + l.quantidadeUso);
  }
  const meses = [...porMes.keys()].sort();
  const pontos = meses.map((m) => ({ label: mesLabel(m), value: porMes.get(m) }));

  const container = app.querySelector("#chart-uso");
  if (!pontos.length) {
    container.innerHTML = `<div class="empty">Sem lançamentos ainda.</div>`;
    return;
  }
  const formatUso = (v) => `${Math.round(v)} usos`;
  container.innerHTML = lineChartSVG(pontos, formatUso, formatCompactNumero);
  wireLineChartHover(container, pontos, formatUso);
}
function formatCompactNumero(v) {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + "K";
  return String(Math.round(v));
}
function mesLabel(m) {
  const [y, mo] = m.split("-");
  return `${MES_NOMES[parseInt(mo, 10) - 1]}/${y.slice(2)}`;
}

function lineChartSVG(pontos, formatValue, formatAxis = formatCompact) {
  const W = 640, H = 220;
  const padL = 54, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = pontos.length;
  const maxVal = Math.max(...pontos.map((p) => p.value), 1);
  const niceMax = niceCeil(maxVal);
  const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;

  const ticks = 4;
  let gridLines = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax / ticks) * i;
    const yy = y(v);
    gridLines += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--chart-ink-muted)">${esc(formatAxis(v))}</text>`;
  }

  const linePath = pontos.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${x(n - 1).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${x(0).toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

  const dots = pontos.map((p, i) =>
    `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4" fill="var(--chart-series-a)" stroke="var(--surface)" stroke-width="2"/>`
  ).join("");

  const xLabels = pontos.map((p, i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--chart-ink-muted)">${esc(p.label)}</text>`
  ).join("");

  const last = pontos[n - 1];
  const lastLabel = `<text x="${x(n - 1).toFixed(1)}" y="${(y(last.value) - 12).toFixed(1)}" text-anchor="end" font-size="12" font-weight="700" fill="var(--text)">${esc(formatValue(last.value))}</text>`;

  const colW = n > 1 ? plotW / (n - 1) : plotW;
  const hitAreas = pontos.map((p, i) => {
    const cx = x(i);
    const left = n === 1 ? padL : Math.max(padL, cx - colW / 2);
    const width = n === 1 ? plotW : colW;
    return `<rect data-idx="${i}" data-cx="${cx.toFixed(1)}" x="${left.toFixed(1)}" y="${padT}" width="${width.toFixed(1)}" height="${plotH}" fill="transparent" tabindex="0" role="img" aria-label="${esc(p.label)}: ${esc(formatValue(p.value))}"/>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" preserveAspectRatio="xMidYMid meet">
    ${gridLines}
    <path d="${areaPath}" fill="var(--chart-series-a)" opacity="0.10" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="var(--chart-series-a)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
    ${lastLabel}
    <line id="viz-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--baseline, var(--border-strong))" stroke-width="1" style="display:none"/>
    ${hitAreas}
  </svg>`;
}

function wireLineChartHover(container, pontos, formatValue) {
  const svg = container.querySelector("svg");
  const crosshair = svg.querySelector("#viz-crosshair");
  const tip = document.getElementById("viz-tip");

  svg.querySelectorAll("rect[data-idx]").forEach((rect) => {
    const idx = Number(rect.dataset.idx);
    const p = pontos[idx];
    const cx = rect.dataset.cx;

    function mostrar() {
      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.style.display = "";
      tip.textContent = "";
      const strong = document.createElement("strong");
      strong.textContent = formatValue(p.value);
      const br = document.createElement("br");
      const span = document.createElement("span");
      span.textContent = p.label;
      tip.append(strong, br, span);
      const r = rect.getBoundingClientRect();
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top = `${r.top}px`;
      tip.classList.add("show");
    }
    function esconder() {
      crosshair.style.display = "none";
      tip.classList.remove("show");
    }
    rect.addEventListener("mouseenter", mostrar);
    rect.addEventListener("mousemove", mostrar);
    rect.addEventListener("mouseleave", esconder);
    rect.addEventListener("focus", mostrar);
    rect.addEventListener("blur", esconder);
  });
}

/* ---------- comparação (barras pareadas, 2 séries + linha sobreposta) ---------- */
function compareColHtml(id, parceiros, de, ate) {
  const opts = parceiros.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} — ${esc(p.cupom)}</option>`).join("");
  return `<div class="compare-col">
    <div class="field"><label>Cupom / parceiro</label><select class="input" id="cmp-${id}-parceiro">${opts}</select></div>
    <div class="field-2col">
      <div class="field"><label>De</label><input class="input" type="date" id="cmp-${id}-de" value="${de}"></div>
      <div class="field"><label>Até</label><input class="input" type="date" id="cmp-${id}-ate" value="${ate}"></div>
    </div>
  </div>`;
}

function calcularAgregado(lancamentos, parceiroId, de, ate) {
  const filtrado = lancamentos.filter((l) => l.parceiroId === parceiroId && (!de || l.data >= de) && (!ate || l.data <= ate));
  const uso = filtrado.reduce((s, l) => s + l.quantidadeUso, 0);
  const fat = filtrado.reduce((s, l) => s + l.faturamentoCupom, 0);
  return { uso, fat, ticket: uso > 0 ? fat / uso : 0 };
}
function totalCupomNoPeriodo(lancamentos, de, ate) {
  return lancamentos
    .filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate))
    .reduce((s, l) => s + l.faturamentoCupom, 0);
}
function serieMensal(lancamentos, parceiroId, de, ate) {
  const filtrado = lancamentos.filter((l) => l.parceiroId === parceiroId && (!de || l.data >= de) && (!ate || l.data <= ate));
  const mapa = new Map();
  for (const l of filtrado) {
    const mes = (l.data || "").slice(0, 7);
    if (!mes) continue;
    mapa.set(mes, (mapa.get(mes) || 0) + l.faturamentoCupom);
  }
  return mapa;
}

function compararEDesenhar(app, lancamentos, porId) {
  const pidA = app.querySelector("#cmp-a-parceiro").value;
  const pidB = app.querySelector("#cmp-b-parceiro").value;
  const deA = app.querySelector("#cmp-a-de").value, ateA = app.querySelector("#cmp-a-ate").value;
  const deB = app.querySelector("#cmp-b-de").value, ateB = app.querySelector("#cmp-b-ate").value;
  const a = calcularAgregado(lancamentos, pidA, deA, ateA);
  const b = calcularAgregado(lancamentos, pidB, deB, ateB);
  const pA = porId[pidA], pB = porId[pidB];
  const nomeA = pA ? `${pA.nome} — ${pA.cupom}` : "—";
  const nomeB = pB ? `${pB.nome} — ${pB.cupom}` : "—";

  const totalPeriodoA = totalCupomNoPeriodo(lancamentos, deA, ateA);
  const totalPeriodoB = totalCupomNoPeriodo(lancamentos, deB, ateB);
  const pctA = totalPeriodoA > 0 ? (a.fat / totalPeriodoA) * 100 : 0;
  const pctB = totalPeriodoB > 0 ? (b.fat / totalPeriodoB) * 100 : 0;

  const maxUso = Math.max(a.uso, b.uso, 1);
  const maxFat = Math.max(a.fat, b.fat, 1);
  const maxPct = Math.max(pctA, pctB, 1);

  // evolução mensal sobreposta (uma série por lado, cada uma no seu próprio range)
  const mapaA = serieMensal(lancamentos, pidA, deA, ateA);
  const mapaB = serieMensal(lancamentos, pidB, deB, ateB);
  const meses = [...new Set([...mapaA.keys(), ...mapaB.keys()])].sort();
  const labels = meses.map(mesLabel);
  const valoresA = meses.map((m) => mapaA.get(m) || 0);
  const valoresB = meses.map((m) => mapaB.get(m) || 0);

  const resultado = app.querySelector("#compare-resultado");
  resultado.style.display = "";
  resultado.innerHTML = `
    <div class="viz-legend">
      <span class="viz-legend-item"><i style="background:var(--chart-series-a)"></i>${esc(nomeA)}</span>
      <span class="viz-legend-item"><i style="background:var(--chart-series-b)"></i>${esc(nomeB)}</span>
    </div>
    ${cmpMetricHtml("Usos de cupom", a.uso, b.uso, maxUso, (v) => String(v))}
    ${cmpMetricHtml("Faturamento", a.fat, b.fat, maxFat, formatMoeda)}
    ${cmpMetricHtml("Participação no faturamento do período", pctA, pctB, maxPct, (v) => `${v.toFixed(1)}%`)}
    <div class="viz-cmp-metric">
      <div class="viz-cmp-metric-label">Ticket médio</div>
      <div class="lr-sub" style="margin-bottom:2px">${esc(nomeA)}: <strong>${esc(formatMoeda(a.ticket))}</strong></div>
      <div class="lr-sub">${esc(nomeB)}: <strong>${esc(formatMoeda(b.ticket))}</strong></div>
    </div>
    ${meses.length ? `
      <div class="viz-cmp-metric-label" style="margin-top:18px">Evolução mensal do faturamento</div>
      <div id="compare-chart"></div>
    ` : ""}
  `;

  if (meses.length) {
    const chartContainer = resultado.querySelector("#compare-chart");
    chartContainer.innerHTML = multiLineChartSVG(labels, [
      { color: "var(--chart-series-a)", values: valoresA },
      { color: "var(--chart-series-b)", values: valoresB },
    ]);
    wireMultiLineChartHover(chartContainer, labels, [
      { nome: nomeA, values: valoresA },
      { nome: nomeB, values: valoresB },
    ]);
  }
}

function cmpMetricHtml(label, valA, valB, max, formatFn) {
  return `<div class="viz-cmp-metric">
    <div class="viz-cmp-metric-label">${esc(label)}</div>
    <div class="viz-cmp-bar-row">
      <div class="viz-cmp-bar" style="width:${Math.max(2, Math.round((valA / max) * 60))}%;background:var(--chart-series-a)"></div>
      <span>${esc(formatFn(valA))}</span>
    </div>
    <div class="viz-cmp-bar-row">
      <div class="viz-cmp-bar" style="width:${Math.max(2, Math.round((valB / max) * 60))}%;background:var(--chart-series-b)"></div>
      <span>${esc(formatFn(valB))}</span>
    </div>
  </div>`;
}

/* ---------- gráfico de linha com 2 séries sobrepostas (só para o comparador) ---------- */
function multiLineChartSVG(labels, series) {
  const W = 640, H = 200;
  const padL = 54, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = labels.length;
  const maxVal = Math.max(...series.flatMap((s) => s.values), 1);
  const niceMax = niceCeil(maxVal);
  const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;

  const ticks = 4;
  let gridLines = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax / ticks) * i;
    const yy = y(v);
    gridLines += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="var(--chart-grid)" stroke-width="1"/>`;
    gridLines += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--chart-ink-muted)">${esc(formatCompact(v))}</text>`;
  }

  const seriesSvg = series.map((s) => {
    const linePath = s.values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
    const dots = s.values.map((v, i) =>
      `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`
    ).join("");
    return `<path d="${linePath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}`;
  }).join("");

  const xLabels = labels.map((l, i) =>
    `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--chart-ink-muted)">${esc(l)}</text>`
  ).join("");

  const colW = n > 1 ? plotW / (n - 1) : plotW;
  const hitAreas = labels.map((l, i) => {
    const cx = x(i);
    const left = n === 1 ? padL : Math.max(padL, cx - colW / 2);
    const width = n === 1 ? plotW : colW;
    return `<rect data-idx="${i}" data-cx="${cx.toFixed(1)}" x="${left.toFixed(1)}" y="${padT}" width="${width.toFixed(1)}" height="${plotH}" fill="transparent" tabindex="0"/>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" preserveAspectRatio="xMidYMid meet">
    ${gridLines}
    ${seriesSvg}
    ${xLabels}
    <line id="viz-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--baseline, var(--border-strong))" stroke-width="1" style="display:none"/>
    ${hitAreas}
  </svg>`;
}
function wireMultiLineChartHover(container, labels, series) {
  const svg = container.querySelector("svg");
  const crosshair = svg.querySelector("#viz-crosshair");
  const tip = document.getElementById("viz-tip");

  svg.querySelectorAll("rect[data-idx]").forEach((rect) => {
    const idx = Number(rect.dataset.idx);
    const cx = rect.dataset.cx;

    function mostrar() {
      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.style.display = "";
      tip.textContent = "";
      series.forEach((s) => {
        const strong = document.createElement("strong");
        strong.textContent = `${s.nome}: ${formatMoeda(s.values[idx])}`;
        tip.appendChild(strong);
        tip.appendChild(document.createElement("br"));
      });
      const span = document.createElement("span");
      span.textContent = labels[idx];
      tip.appendChild(span);
      const r = rect.getBoundingClientRect();
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top = `${r.top}px`;
      tip.classList.add("show");
    }
    function esconder() {
      crosshair.style.display = "none";
      tip.classList.remove("show");
    }
    rect.addEventListener("mouseenter", mostrar);
    rect.addEventListener("mousemove", mostrar);
    rect.addEventListener("mouseleave", esconder);
    rect.addEventListener("focus", mostrar);
    rect.addEventListener("blur", esconder);
  });
}
