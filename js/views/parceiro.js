/* Detalhe do Parceiro — dados da parceria + Base de Dados (lançamentos
   de desempenho do cupom naquela loja, alimentados manualmente a partir
   da plataforma interna de cada loja).

   A comparação "vs. período anterior" e o mini gráfico de evolução usam
   os próprios lançamentos como unidade de período (cada linha já é um
   período — semana/mês/personalizado — lançado em lote), comparando o
   mais recente com o imediatamente anterior. Não há um seletor de datas
   aqui como no dashboard porque, por parceiro, os lançamentos costumam
   ser poucos (um a cada lote lançado). */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { badge, badgeFromLista } from "../ui/badges.js";
import { abrirEditarParceiro, abrirNovoLancamento } from "./cadastros.js";
import { dedupLancamentos } from "../util/periodo.js";

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

  // mesma data lançada mais de uma vez pra este parceiro → conta só a
  // maior nas estatísticas/gráfico (a lista abaixo continua mostrando
  // tudo, pra dar pra ver e excluir a duplicata manualmente)
  const lancamentosStats = dedupLancamentos(lancamentos);

  const totalUso = lancamentosStats.reduce((s, l) => s + l.quantidadeUso, 0);
  const totalCupom = lancamentosStats.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = lancamentosStats.reduce((s, l) => s + l.faturamentoSemCupom, 0);
  const ticketMedioGeral = totalUso > 0 ? totalCupom / totalUso : 0;

  // comparação: lançamento mais recente vs. o imediatamente anterior
  const porData = [...lancamentosStats].sort((a, b) => (b.dataInicio || "").localeCompare(a.dataInicio || ""));
  const atual = porData[0], anterior = porData[1];
  const comparavel = Boolean(atual && anterior);
  const deltaUso = comparavel ? pctDelta(atual.quantidadeUso, anterior.quantidadeUso) : undefined;
  const deltaFat = comparavel ? pctDelta(atual.faturamentoCupom, anterior.faturamentoCupom) : undefined;
  const deltaTicket = comparavel ? pctDelta(atual.ticketMedio, anterior.ticketMedio) : undefined;

  // evolução: um ponto por lançamento, do mais antigo ao mais recente
  const pontosEvolucao = [...lancamentosStats]
    .sort((a, b) => (a.dataInicio || "").localeCompare(b.dataInicio || ""))
    .map((l) => ({ label: l.periodoLabel || formatDataBR(l.dataInicio), value: l.faturamentoCupom }));

  app.innerHTML = `
    <a class="back-link" href="#/parceiros">← Voltar para parceiros</a>

    <div class="detail-head">
      <div>
        <h1 class="page-title">${esc(parceiro.nome)}</h1>
        <div class="page-sub">Cupom <strong>${esc(parceiro.cupom)}</strong> · ${esc(parceiro.area || "—")}</div>
      </div>
      <div class="row-end">
        <div class="status-picker" id="status-picker">
          <button type="button" class="status-picker-trigger" id="status-picker-trigger" title="Clique para alterar o status do cupom">
            ${badgeFromLista(listas.statusCupom, parceiro.statusCupom)}
          </button>
          <div class="status-picker-menu" id="status-picker-menu" hidden>
            ${(listas.statusCupom || []).map((s) => `<button type="button" class="status-picker-opt" data-valor="${esc(s.valor)}">${badge(s.valor, s.cor)}</button>`).join("")}
          </div>
        </div>
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

    <!-- COMPARAÇÃO COM O LANÇAMENTO ANTERIOR -->
    <section class="section">
      <div class="section-head"><h2>Último período vs. anterior</h2></div>
      ${comparavel ? `
        <div class="note"><span class="note-i">ⓘ</span>
          Comparando <strong>${esc(atual.periodoLabel || formatDataBR(atual.dataInicio))}</strong> com
          <strong>${esc(anterior.periodoLabel || formatDataBR(anterior.dataInicio))}</strong>.</div>
        <div class="stat-grid">
          ${stat(atual.quantidadeUso, "Usos no último período", deltaUso)}
          ${stat(formatMoeda(atual.faturamentoCupom), "Faturamento no último período", deltaFat)}
          ${stat(formatMoeda(atual.ticketMedio), "Ticket médio no último período", deltaTicket)}
        </div>
      ` : `<div class="empty">É preciso pelo menos 2 lançamentos para comparar períodos.</div>`}
      ${pontosEvolucao.length > 1 ? `
        <div class="chart-card" style="margin-top:14px">
          <h3 style="margin-bottom:14px">Evolução do faturamento por período</h3>
          <div id="chart-evolucao"></div>
        </div>
      ` : ""}
    </section>

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

    <div class="viz-tooltip" id="viz-tip" role="tooltip"></div>
  `;

  if (pontosEvolucao.length > 1) {
    const chartContainer = app.querySelector("#chart-evolucao");
    chartContainer.innerHTML = miniLineChartSVG(pontosEvolucao, formatMoeda);
    wireMiniLineChartHover(chartContainer, pontosEvolucao, formatMoeda);
  }

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

  const statusMenu = app.querySelector("#status-picker-menu");
  app.querySelector("#status-picker-trigger").addEventListener("click", (e) => {
    e.stopPropagation();
    statusMenu.hidden = !statusMenu.hidden;
  });
  statusMenu.addEventListener("click", async (e) => {
    const opt = e.target.closest(".status-picker-opt");
    if (!opt) return;
    const novoStatus = opt.dataset.valor;
    statusMenu.hidden = true;
    if (novoStatus === parceiro.statusCupom) return;
    await store.updateParceiro(parceiro.id, { statusCupom: novoStatus });
    window.dispatchEvent(new CustomEvent("data-changed"));
  });

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

function stat(num, label, delta) {
  return `<div class="stat">
    <div class="stat-num">${num}</div>
    <div class="stat-label">${esc(label)}</div>
    ${deltaBadgeHtml(delta)}
  </div>`;
}

// % de variação de b (anterior) pra a (atual); null quando não há base de comparação
function pctDelta(atual, anteriorVal) {
  if (anteriorVal === 0) return atual === 0 ? 0 : null;
  return ((atual - anteriorVal) / anteriorVal) * 100;
}
function deltaBadgeHtml(delta) {
  if (delta === undefined) return "";
  if (delta === null) return `<div class="kpi-delta kpi-delta--neutral">novo</div>`;
  const up = delta >= 0;
  return `<div class="kpi-delta ${up ? "kpi-delta--up" : "kpi-delta--down"}">${up ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}% vs. período anterior</div>`;
}

/* ---------- mini gráfico de linha (evolução do faturamento por período) ---------- */
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
function miniLineChartSVG(pontos, formatValue) {
  const W = 640, H = 160;
  const padL = 54, padR = 16, padT = 16, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = pontos.length;
  const maxVal = Math.max(...pontos.map((p) => p.value), 1);
  const niceMax = niceCeil(maxVal);
  const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v) => padT + plotH - (v / niceMax) * plotH;

  const ticks = 3;
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
    `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10.5" fill="var(--chart-ink-muted)">${esc(p.label)}</text>`
  ).join("");

  const colW = n > 1 ? plotW / (n - 1) : plotW;
  const hitAreas = pontos.map((p, i) => {
    const cx = x(i);
    const left = n === 1 ? padL : Math.max(padL, cx - colW / 2);
    const width = n === 1 ? plotW : colW;
    return `<rect data-idx="${i}" data-cx="${cx.toFixed(1)}" x="${left.toFixed(1)}" y="${padT}" width="${width.toFixed(1)}" height="${plotH}" fill="transparent" tabindex="0"/>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H}" class="viz-svg" preserveAspectRatio="xMidYMid meet">
    ${gridLines}
    <path d="${areaPath}" fill="var(--chart-series-a)" opacity="0.10" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="var(--chart-series-a)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${xLabels}
    <line id="viz-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="var(--baseline, var(--border-strong))" stroke-width="1" style="display:none"/>
    ${hitAreas}
  </svg>`;
}
function wireMiniLineChartHover(container, pontos, formatValue) {
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

function lancamentoRow(l) {
  const rotulo = l.periodoLabel || PERIODO_LABEL[l.periodoTipo] || "";
  const periodo = l.dataInicio === l.dataFim || !l.dataFim
    ? formatDataBR(l.dataInicio)
    : `${formatDataBR(l.dataInicio)} – ${formatDataBR(l.dataFim)}`;
  return `<div class="list-row">
    <div class="lr-main">
      <div class="lr-title">${esc(periodo)} ${rotulo ? `<span class="muted" style="font-weight:400">· ${esc(rotulo)}</span>` : ""}</div>
      <div class="lr-sub">${l.quantidadeUso} usos · ${esc(formatMoeda(l.faturamentoCupom))} via cupom · ${esc(formatMoeda(l.faturamentoTotal))} faturamento total${l.faturamentoDelivery ? ` · ${esc(formatMoeda(l.faturamentoDelivery))} via delivery` : ""} · ticket médio ${esc(formatMoeda(l.ticketMedio))}</div>
      ${l.observacoes ? `<div class="lr-sub">${esc(l.observacoes)}</div>` : ""}
    </div>
    <span class="lr-actions">
      <button class="icon-btn" data-action="editar" data-id="${esc(l.id)}" title="Editar">✎</button>
      <button class="icon-btn danger" data-action="excluir" data-id="${esc(l.id)}" title="Excluir">🗑</button>
    </span>
  </div>`;
}
