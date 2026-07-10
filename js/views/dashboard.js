/* Dashboard — desempenho dos cupons, com período ajustável e uma
   ferramenta de comparação (mesmo cupom em períodos diferentes, ou
   dois cupons quaisquer). Tudo calculado em cima de listLancamentos()
   + listParceirosFechados(), sem nada gravado — puramente derivado.

   Gráficos em SVG/HTML simples (sem biblioteca), seguindo a paleta
   validada em --chart-series-a/b (ver styles.css): verde vívido como
   série principal, azul da marca como segunda série (comparação). */

import { store } from "../data/store.js";
import { esc, formatMoeda } from "../ui/dom.js";

const MES_NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const TOP_N_CUPONS = 8;

export async function renderDashboard(app) {
  const [lancamentos, parceiros] = await Promise.all([
    store.listLancamentos(),
    store.listParceirosFechados(),
  ]);
  const porId = Object.fromEntries(parceiros.map((p) => [p.id, p]));
  const parceirosOrdenados = [...parceiros].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const [deInicial, ateInicial] = presetRange("mes");

  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Dashboard</h1>
        <div class="page-sub">Desempenho dos cupons 2V</div></div>
    </div>

    <div class="filter-row" id="presets">
      ${["semana", "mes", "mespassado", "ano", "tudo"].map((p) =>
        `<button class="chip ${p === "mes" ? "active" : ""}" data-preset="${p}">${presetLabel(p)}</button>`
      ).join("")}
    </div>
    <div class="toolbar" style="margin-bottom:24px; gap:14px; align-items:flex-end">
      <div class="field" style="margin-bottom:0"><label>De</label><input class="input" type="date" id="f-de" value="${deInicial}"></div>
      <div class="field" style="margin-bottom:0"><label>Até</label><input class="input" type="date" id="f-ate" value="${ateInicial}"></div>
    </div>

    <div class="stat-grid" id="resumo"></div>

    <div class="dash-cols" style="display:grid;grid-template-columns:1.6fr 1fr;gap:20px;margin-bottom:26px;align-items:start">
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
        <div id="meter-cupom"></div>
      </div>
    </div>

    <section class="section">
      <div class="section-head"><h2>Desempenho por cupom no período</h2></div>
      <div class="note"><span class="note-i">ⓘ</span>
        Top ${TOP_N_CUPONS} por faturamento. A lista completa do período está logo abaixo do gráfico.</div>
      <div class="chart-card" style="margin-bottom:14px" id="ranking-cupons"></div>
      <div class="list-card" id="por-cupom"></div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Comparar</h2></div>
      <div class="note"><span class="note-i">ⓘ</span>
        Compare o mesmo cupom em dois períodos diferentes, ou dois cupons diferentes (no mesmo período ou não).</div>
      <div class="compare-grid">
        ${compareColHtml("a", parceirosOrdenados, deInicial, ateInicial)}
        ${compareColHtml("b", parceirosOrdenados, deInicial, ateInicial)}
      </div>
      <button class="btn btn-primary" id="btn-comparar" style="margin-top:14px">Comparar</button>
      <div class="chart-card" id="compare-resultado" style="margin-top:14px; display:none"></div>
    </section>

    <div class="viz-tooltip" id="viz-tip" role="tooltip"></div>
  `;

  /* ---- resumo + ranking (respeitam o filtro de período) ---- */
  function atualizarPeriodo() {
    const de = app.querySelector("#f-de").value;
    const ate = app.querySelector("#f-ate").value;
    const doPeriodo = filtrarPeriodo(lancamentos, de, ate);
    desenharResumo(app, doPeriodo);
    desenharMeter(app, doPeriodo);
    desenharRanking(app, doPeriodo, porId);
    desenharListaCompleta(app, doPeriodo, porId);
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
  atualizarPeriodo();

  /* ---- gráfico por mês: histórico completo, não filtra por período ---- */
  desenharChartMes(app, lancamentos);
  app.querySelector("#toggle-mes").addEventListener("click", (e) => {
    const svgWrap = app.querySelector("#chart-mes");
    const tabela = app.querySelector("#tabela-mes");
    const showingTable = tabela.classList.toggle("show");
    svgWrap.style.display = showingTable ? "none" : "";
    e.target.textContent = showingTable ? "Ver gráfico" : "Ver tabela";
  });

  /* ---- comparação ---- */
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

/* ---------- agregações ---------- */
function filtrarPeriodo(lancamentos, de, ate) {
  return lancamentos.filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate));
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

/* ---------- render: resumo (stat tiles) ---------- */
function desenharResumo(app, doPeriodo) {
  const totalUso = doPeriodo.reduce((s, l) => s + l.quantidadeUso, 0);
  const totalCupom = doPeriodo.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = doPeriodo.reduce((s, l) => s + l.faturamentoTotalSemCupom, 0);
  const totalGeral = totalCupom + totalSemCupom;
  const ticketMedio = totalUso > 0 ? totalCupom / totalUso : 0;

  app.querySelector("#resumo").innerHTML = [
    stat(totalUso, "Usos de cupom"),
    stat(formatMoeda(totalCupom), "Faturamento via cupom"),
    stat(formatMoeda(totalGeral), "Faturamento total (cupom + resto)"),
    stat(formatMoeda(ticketMedio), "Ticket médio geral"),
  ].join("");
}
function stat(num, label) {
  return `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${esc(label)}</div></div>`;
}

/* ---------- render: meter (cupom vs faturamento total) ---------- */
function desenharMeter(app, doPeriodo) {
  const totalCupom = doPeriodo.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = doPeriodo.reduce((s, l) => s + l.faturamentoTotalSemCupom, 0);
  const totalGeral = totalCupom + totalSemCupom;
  const pct = totalGeral > 0 ? (totalCupom / totalGeral) * 100 : 0;

  app.querySelector("#meter-cupom").innerHTML = `
    <div class="viz-meter-value">${pct.toFixed(1)}%</div>
    <div class="viz-meter-track"><div class="viz-meter-fill" style="width:${Math.min(100, pct)}%"></div></div>
    <div class="viz-meter-legend">
      <span>${esc(formatMoeda(totalCupom))} via cupom</span>
      <span>${esc(formatMoeda(totalGeral))} total</span>
    </div>
  `;
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
    <div class="viz-bar-row" tabindex="0" role="img" aria-label="${esc(l.parceiro.nome)}: ${esc(formatMoeda(l.fat))}, ${l.uso} usos">
      <div class="viz-bar-label" title="${esc(l.parceiro.nome)}">${esc(l.parceiro.nome)}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${Math.max(2, Math.round((l.fat / max) * 100))}%"></div></div>
      <div class="viz-bar-val">${esc(formatMoeda(l.fat))}</div>
    </div>
  `).join("");
}

/* ---------- render: lista completa (tabela-view do ranking) ---------- */
function desenharListaCompleta(app, doPeriodo, porId) {
  const agregados = agregarPorParceiro(doPeriodo);
  const linhas = [...agregados.entries()]
    .map(([pid, a]) => ({ parceiro: porId[pid], uso: a.uso, fat: a.fatCupom, ticket: a.uso > 0 ? a.fatCupom / a.uso : 0 }))
    .filter((l) => l.parceiro)
    .sort((a, b) => b.fat - a.fat);

  app.querySelector("#por-cupom").innerHTML = linhas.length
    ? linhas.map((l) => `<div class="list-row">
        <div class="lr-main">
          <div class="lr-title">${esc(l.parceiro.nome)} <span class="muted" style="font-weight:400">— ${esc(l.parceiro.cupom)}</span></div>
          <div class="lr-sub">${l.uso} ${l.uso === 1 ? "uso" : "usos"} · ticket médio ${esc(formatMoeda(l.ticket))}</div>
        </div>
        <strong>${esc(formatMoeda(l.fat))}</strong>
      </div>`).join("")
    : `<div class="empty">Nenhum lançamento nesse período.</div>`;
}

/* ---------- render: linha (SVG) — faturamento por mês, histórico completo ---------- */
function desenharChartMes(app, lancamentos) {
  const porMes = new Map();
  for (const l of lancamentos) {
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
function mesLabel(m) {
  const [y, mo] = m.split("-");
  return `${MES_NOMES[parseInt(mo, 10) - 1]}/${y.slice(2)}`;
}

function lineChartSVG(pontos, formatValue) {
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
    gridLines += `<text x="${padL - 8}" y="${yy + 4}" text-anchor="end" font-size="11" fill="var(--chart-ink-muted)">${esc(formatCompact(v))}</text>`;
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

/* ---------- comparação (barras pareadas, 2 séries) ---------- */
function compareColHtml(id, parceiros, de, ate) {
  const opts = parceiros.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} — ${esc(p.cupom)}</option>`).join("");
  return `<div class="compare-col">
    <div class="field"><label>Cupom</label><select class="input" id="cmp-${id}-parceiro">${opts}</select></div>
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

function compararEDesenhar(app, lancamentos, porId) {
  const pidA = app.querySelector("#cmp-a-parceiro").value;
  const pidB = app.querySelector("#cmp-b-parceiro").value;
  const a = calcularAgregado(lancamentos, pidA, app.querySelector("#cmp-a-de").value, app.querySelector("#cmp-a-ate").value);
  const b = calcularAgregado(lancamentos, pidB, app.querySelector("#cmp-b-de").value, app.querySelector("#cmp-b-ate").value);
  const pA = porId[pidA], pB = porId[pidB];
  const nomeA = pA ? `${pA.nome} — ${pA.cupom}` : "—";
  const nomeB = pB ? `${pB.nome} — ${pB.cupom}` : "—";
  const deltaFat = a.fat > 0 ? ((b.fat - a.fat) / a.fat) * 100 : (b.fat > 0 ? 100 : 0);
  const corDelta = deltaFat >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)";

  const maxUso = Math.max(a.uso, b.uso, 1);
  const maxFat = Math.max(a.fat, b.fat, 1);

  const resultado = app.querySelector("#compare-resultado");
  resultado.style.display = "";
  resultado.innerHTML = `
    <div class="viz-legend">
      <span class="viz-legend-item"><i style="background:var(--chart-series-a)"></i>${esc(nomeA)}</span>
      <span class="viz-legend-item"><i style="background:var(--chart-series-b)"></i>${esc(nomeB)}</span>
    </div>
    ${cmpMetricHtml("Usos de cupom", a.uso, b.uso, maxUso, (v) => String(v))}
    ${cmpMetricHtml("Faturamento", a.fat, b.fat, maxFat, formatMoeda)}
    <div class="viz-cmp-metric">
      <div class="viz-cmp-metric-label">Ticket médio</div>
      <div class="lr-sub" style="margin-bottom:2px">${esc(nomeA)}: <strong>${esc(formatMoeda(a.ticket))}</strong></div>
      <div class="lr-sub">${esc(nomeB)}: <strong>${esc(formatMoeda(b.ticket))}</strong></div>
    </div>
    <div class="lr-sub" style="margin-top:10px">Diferença de faturamento (B em relação a A):
      <strong style="color:${corDelta}">${deltaFat >= 0 ? "+" : ""}${deltaFat.toFixed(1)}%</strong>
    </div>
  `;
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
