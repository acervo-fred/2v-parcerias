/* Dashboard — desempenho dos cupons, com período ajustável, comparação
   automática com o período anterior, KPIs de novos cupons e cupons por
   faixa de desconto (20%/50% — ver cupomEhEspecial), dois gráficos "por
   cupom" com toggle de desconto e granularidade (semana/mês), um card de
   Tendências (retidos vs. novos), uma tabela de ranking ordenável/
   pesquisável (com rolagem) com drill-down, e uma ferramenta de
   comparação (mesmo cupom em períodos diferentes, ou dois cupons
   quaisquer no mesmo período — os dois campos de período do comparador
   ficam sincronizados). Tudo calculado em cima de listLancamentos() +
   listParceirosFechados() + listGrupos(), sem nada gravado — puramente
   derivado.

   Consolidação por código de cupom: quando duas empresas parceiras
   compartilham o mesmo código de cupom, todo o desempenho (rankings,
   gráficos, tabela, comparador) é somado e tratado como um cupom só —
   ver js/util/cupom.js. Os filtros e o comparador operam sobre o código
   do cupom, não mais sobre o parceiro individual.

   Gráficos em SVG/HTML simples (sem biblioteca), seguindo a paleta
   validada em --chart-series-a/b (ver styles.css): verde vívido como
   série principal, azul da marca como segunda série (comparação). Para o
   gráfico de participação por cupom (mais de 2 séries) usamos a paleta
   categórica validada da skill de dataviz (blue/aqua/yellow/green/violet,
   ΔE de CVD adjacente ≥ 24 nessa ordem) + cinza neutro para "Outros". */

import { store } from "../data/store.js";
import { esc, formatMoeda } from "../ui/dom.js";
import { lancamentoNoPeriodo, dedupLancamentos, inicioSemanaISO, fimSemanaISO, chaveSemana, rotuloSemanaCurto, chaveMes, rotuloMesCurto } from "../util/periodo.js";
import { agruparParceirosPorCupom, chaveCupom, cupomEm50 } from "../util/cupom.js";

const MES_NOMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const TOP_N_CUPONS = 8;
// paleta categórica validada (slots 1-5 da ordem fixa: blue, aqua, yellow, green, violet)
const CORES_CATEGORICAS = ["#2a78d6", "#1baf7a", "#eda100", "#008300", "#4a3aa7"];
const COR_OUTROS = "var(--c-gray-fg)";

export async function renderDashboard(app) {
  const [lancamentosBrutos, parceiros, lojaAtual, grupos, listas] = await Promise.all([
    store.listLancamentos(),
    store.listParceirosFechados(),
    store.getLojaAtual(),
    store.listGrupos(),
    store.getListas(),
  ]);
  // mesmo parceiro+data lançado mais de uma vez → conta só o maior, não os dois
  const lancamentos = dedupLancamentos(lancamentosBrutos);
  const porId = Object.fromEntries(parceiros.map((p) => [p.id, p]));
  const porIdGrupo = Object.fromEntries(grupos.map((g) => [String(g.numero), g]));
  // consolidação por código de cupom (ver js/util/cupom.js): mais de uma
  // empresa pode compartilhar o mesmo cupom — aqui elas contam como um só
  const linhasCupom = agruparParceirosPorCupom(parceiros);
  const chavePorParceiroId = Object.fromEntries(parceiros.map((p) => [p.id, chaveCupom(p)]));
  const porChave = Object.fromEntries(linhasCupom.map((lc) => [lc.chave, lc]));
  const cuponsOrdenados = [...linhasCupom].sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));
  const tiposFiltro = ["Todos", ...listas.tipoNegocio.map((t) => t.valor)];
  let filtroTipo = "Todos";
  // "retidos" | "perdidos" — toggle do card de Tendências à esquerda
  let modoRetidos = "retidos";

  const [deInicial, ateInicial] = presetRange("mes");

  // estado da tabela de ranking (sobrevive a trocas de filtro/período)
  const tabelaState = { sortKey: "fat", sortDir: "desc", busca: "" };
  let linhasRanking = []; // recalculada a cada atualizarPeriodo()
  // estado dos dois gráficos "por cupom" (1.3/1.4) — cada um com seu
  // próprio filtro de desconto e granularidade, independentes
  const graficoFatState = { tier: "ambos", granularidade: "semana" };
  const graficoUsoState = { tier: "ambos", granularidade: "semana" };

  app.innerHTML = `
    <div class="page-head">
      <div><h1 class="page-title">Desempenho dos cupons 2V${lojaAtual ? ` - ${esc(lojaAtual.nome)}` : ""}</h1></div>
    </div>

    <div class="filter-row" id="presets" style="margin-bottom:14px; align-items:flex-end">
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        ${["semana", "semanapassada", "mes", "mespassado", "tudo"].map((p) =>
          `<button class="chip ${p === "mes" ? "active" : ""}" data-preset="${p}">${presetLabel(p)}</button>`
        ).join("")}
        <select class="input select-compact" id="f-tipo" style="width:auto">
          ${tiposFiltro.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
        </select>
      </div>
      <div class="field" style="margin-bottom:0"><label>De</label><input class="input" type="date" id="f-de" value="${deInicial}"></div>
      <div class="field" style="margin-bottom:0"><label>Até</label><input class="input" type="date" id="f-ate" value="${ateInicial}"></div>
    </div>
    <div class="muted" id="comparacao-nota" style="font-size:12px;margin-bottom:18px"></div>

    <div class="stat-grid" id="resumo"></div>
    <div class="stat-grid" id="resumo-desconto"></div>

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
            <h3>Faturamento com cupons <span class="muted" style="font-size:11px;font-weight:600">— histórico completo</span></h3>
            <button class="chart-toggle" id="toggle-mes" type="button">Ver tabela</button>
          </div>
          ${controlesGraficoCupomHtml("fat")}
          <div id="chart-mes"></div>
          <table class="chart-table" id="tabela-mes">
            <thead><tr><th>Período</th><th>Faturamento via cupom</th></tr></thead>
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
          <h3>Uso de Cupons <span class="muted" style="font-size:11px;font-weight:600">— histórico completo</span></h3>
          ${controlesGraficoCupomHtml("uso")}
          <div id="chart-uso"></div>
        </div>
        <div class="chart-card">
          <h3 style="margin-bottom:14px">Participação por cupom no período</h3>
          <div id="participacao"></div>
        </div>
      </div>

      <div class="dash-cols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;align-items:start">
        <div class="chart-card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:2px">
            <h3 style="margin-bottom:0" id="tendencias-retidos-titulo">Tendências — Retidos</h3>
            <div class="filter-row" id="toggle-retidos-perdidos" style="margin-bottom:0">
              <button class="chip chip-sm active" data-modo="retidos">Retidos</button>
              <button class="chip chip-sm" data-modo="perdidos">Perdidos</button>
            </div>
          </div>
          <div class="muted" style="font-size:11.5px;margin-bottom:12px" id="tendencias-retidos-desc"></div>
          <div id="tendencias-retidos"></div>
        </div>
        <div class="chart-card">
          <h3 style="margin-bottom:2px">Tendências — Novos</h3>
          <div class="muted" style="font-size:11.5px;margin-bottom:12px">Cupons usados pela primeira vez no período.<br>1: Cupons com 50% no período selecionado.<br>2: Cupons com 50% no período anterior.</div>
          <div id="tendencias-novos"></div>
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
                <th data-sort="parceiro">Empresas</th>
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
        ${compareColHtml("a", cuponsOrdenados, deInicial, ateInicial)}
        ${compareColHtml("b", cuponsOrdenados, deInicial, ateInicial)}
      </div>
      <button class="btn btn-primary" id="btn-comparar" style="margin-top:14px">Comparar</button>
      <div class="chart-card" id="compare-resultado" style="margin-top:14px; display:none"></div>
    </section>

    <div class="viz-tooltip" id="viz-tip" role="tooltip"></div>
  `;

  /* ---- filtros: período + dimensões (cupom / tipo) ---- */
  function lerFiltros() {
    return {
      de: app.querySelector("#f-de").value,
      ate: app.querySelector("#f-ate").value,
    };
  }

  function atualizarPeriodo() {
    const { de, ate } = lerFiltros();
    const comparavel = Boolean(de && ate);
    const [deAnt, ateAnt] = comparavel ? periodoAnterior(de, ate) : ["", ""];

    const lancamentosTipo = filtroTipo === "Todos" ? lancamentos : lancamentos.filter((l) => porId[l.parceiroId]?.tipo === filtroTipo);
    const primeiraDataCupom = primeiraDataPorCupom(lancamentosTipo, chavePorParceiroId);

    const doPeriodo = filtrarPeriodo(lancamentosTipo, de, ate);
    const doPeriodoAnterior = comparavel ? filtrarPeriodo(lancamentosTipo, deAnt, ateAnt) : [];

    app.querySelector("#comparacao-nota").textContent = comparavel
      ? `Comparado com o período imediatamente anterior de mesma duração (${formatDataBRlocal(deAnt)} – ${formatDataBRlocal(ateAnt)}).`
      : `Selecione um período (De/Até) para comparar com o período anterior.`;

    const kpisDesconto = calcularKpisDesconto(doPeriodo, de, ate, porId, porIdGrupo, chavePorParceiroId, primeiraDataCupom, porChave);
    desenharResumo(app, doPeriodo, doPeriodoAnterior, comparavel, kpisDesconto);
    desenharDonutCupom(app, doPeriodo);
    desenharRanking(app, doPeriodo, chavePorParceiroId, porChave, grupos);
    desenharRankingUsos(app, doPeriodo, chavePorParceiroId, porChave, grupos);
    desenharParticipacao(app, doPeriodo, chavePorParceiroId, porChave);
    desenharTendencias(app, doPeriodo, doPeriodoAnterior, comparavel, chavePorParceiroId, porChave, primeiraDataCupom, deAnt, ateAnt, modoRetidos, grupos, porId, porIdGrupo);

    // gráficos "por cupom" (Faturamento com cupons / Uso de Cupons): sempre
    // o histórico completo, independente do período selecionado no topo
    // (ver desenharGraficoCupons) — só reagem aos próprios toggles de
    // desconto (20%/50%/Ambos) e granularidade (Semana/Mês).
    desenharGraficoCupons(app, {
      containerId: "chart-uso", tabelaBodyId: null,
      lancamentosTotais: lancamentosTipo, porId, porIdGrupo, campo: "quantidadeUso",
      estado: graficoUsoState, formatValue: (v) => `${Math.round(v)} usos`, formatAxis: formatCompactNumero,
    });
    desenharGraficoCupons(app, {
      containerId: "chart-mes", tabelaBodyId: "tabela-mes-body",
      lancamentosTotais: lancamentosTipo, porId, porIdGrupo, campo: "faturamentoCupom",
      estado: graficoFatState, formatValue: formatMoeda, formatAxis: formatCompact,
    });

    linhasRanking = calcularLinhasRanking(doPeriodo, doPeriodoAnterior, chavePorParceiroId, porChave, comparavel);
    desenharTabela();
  }

  function desenharTabela() {
    const termo = tabelaState.busca.trim().toLowerCase();
    const filtradas = termo
      ? linhasRanking.filter((l) =>
          l.nomes.toLowerCase().includes(termo) || (l.linha.cupom || "").toLowerCase().includes(termo))
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

  app.querySelector("#toggle-retidos-perdidos").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-modo]");
    if (!btn) return;
    modoRetidos = btn.dataset.modo;
    app.querySelectorAll("#toggle-retidos-perdidos .chip").forEach((c) => c.classList.toggle("active", c === btn));
    atualizarPeriodo();
  });

  app.querySelector("#presets").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    app.querySelectorAll("[data-preset]").forEach((b) => b.classList.toggle("active", b === btn));
    const [de, ate] = presetRange(btn.dataset.preset);
    app.querySelector("#f-de").value = de;
    app.querySelector("#f-ate").value = ate;
    atualizarPeriodo();
  });
  app.querySelector("#f-tipo").addEventListener("change", (e) => {
    filtroTipo = e.target.value;
    atualizarPeriodo();
  });
  ["#f-de", "#f-ate"].forEach((sel) => {
    app.querySelector(sel).addEventListener("change", () => {
      app.querySelectorAll("[data-preset]").forEach((b) => b.classList.remove("active"));
      atualizarPeriodo();
    });
  });
  wireControlesGraficoCupom(app, "fat", graficoFatState, atualizarPeriodo);
  wireControlesGraficoCupom(app, "uso", graficoUsoState, atualizarPeriodo);
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
    compararEDesenhar(app, lancamentos, chavePorParceiroId, porChave);
  });
}

/* ---------- período: presets ---------- */
function presetLabel(p) {
  return { semana: "Esta semana", semanapassada: "Semana passada", mes: "Este mês", mespassado: "Mês passado", tudo: "Tudo" }[p] || p;
}
function presetRange(nome) {
  const hoje = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (nome === "semana") {
    return [inicioSemanaISO(hoje), fimSemanaISO(hoje)];
  }
  if (nome === "semanapassada") {
    const ref = new Date(hoje); ref.setDate(ref.getDate() - 7);
    return [inicioSemanaISO(ref), fimSemanaISO(ref)];
  }
  if (nome === "mes") {
    return [iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), iso(hoje)];
  }
  if (nome === "mespassado") {
    return [iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)), iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0))];
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
// intervalo real a usar nos gráficos "por semana": o período selecionado
// (De/Até), ou — sem período selecionado ("Tudo") — o intervalo entre o
// primeiro e o último lançamento, pra sempre ter limites concretos e dar
// pra enumerar toda semana do meio (mesmo as sem lançamento nenhum).
function limitesEfetivos(todosLancamentos, de, ate) {
  if (de && ate) return [de, ate];
  const datas = todosLancamentos.map((l) => l.dataInicio).filter(Boolean).sort();
  if (!datas.length) return ["", ""];
  return [de || datas[0], ate || datas[datas.length - 1]];
}
function proximaSemanaISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + 7);
  const yy = dt.getFullYear(), mm = String(dt.getMonth() + 1).padStart(2, "0"), dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
// toda segunda-feira (ISO) entre a semana de `de` e a semana de `ate`,
// inclusive — inclui semanas sem nenhum lançamento, pra elas aparecerem
// zeradas nos gráficos em vez de simplesmente sumirem do eixo.
function semanasNoPeriodo(de, ate) {
  if (!de || !ate) return [];
  const ultima = chaveSemana(ate);
  const semanas = [];
  let cursor = chaveSemana(de);
  let guarda = 0;
  while (cursor <= ultima && guarda++ < 1000) {
    semanas.push(cursor);
    cursor = proximaSemanaISO(cursor);
  }
  return semanas;
}
function proximoMesISO(chave) {
  const [y, m] = chave.split("-").map(Number);
  const novoMes = m === 12 ? 1 : m + 1;
  const novoAno = m === 12 ? y + 1 : y;
  return `${novoAno}-${String(novoMes).padStart(2, "0")}`;
}
// todo mês entre o mês de `de` e o mês de `ate`, inclusive — mesma ideia
// de semanasNoPeriodo, mas por mês (usado quando a granularidade do
// gráfico é "Mês").
function mesesNoPeriodo(de, ate) {
  if (!de || !ate) return [];
  const ultimo = chaveMes(ate);
  const meses = [];
  let cursor = chaveMes(de);
  let guarda = 0;
  while (cursor <= ultimo && guarda++ < 500) {
    meses.push(cursor);
    cursor = proximoMesISO(cursor);
  }
  return meses;
}

/* ---------- desconto 20%/50%: classificação por lançamento ----------
   Não existe registro histórico de qual desconto valia quando cada uso
   aconteceu — descontoAtual() (js/util/cupom.js) só sabe responder "hoje".
   Por isso, aqui, um lançamento conta como "50%" se a DATA DELE cai
   dentro do período (inicio–fim) configurado no grupo do cupom — mais
   fiel ao histórico do que aplicar a config atual pra tudo. Um cupom
   pode aparecer nos dois grupos (20% e 50%) num mesmo período, se teve
   lançamentos dos dois lados — é esperado, não é bug. */
function cupomEhEspecial(lancamento, parceiro, porIdGrupo) {
  if (!parceiro) return false;
  const g = porIdGrupo[String(parceiro.grupoCupom || "")];
  if (!g || !g.inicio || !g.fim) return false;
  return lancamentoNoPeriodo(lancamento, g.inicio, g.fim);
}
function filtrarPorTier(lancamentos, porId, porIdGrupo, tier) {
  if (tier === "ambos") return lancamentos;
  return lancamentos.filter((l) => {
    const especial = cupomEhEspecial(l, porId[l.parceiroId], porIdGrupo);
    return tier === "50" ? especial : !especial;
  });
}
// primeira data (ISO) em que cada cupom (chave) teve algum lançamento,
// olhando TODA a história — usado pro KPI "novos cupons" e por Tendências.
function primeiraDataPorCupom(todosLancamentos, chavePorParceiroId) {
  const mapa = new Map();
  for (const l of todosLancamentos) {
    if (!l.parceiroId || !l.dataInicio) continue;
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    const atual = mapa.get(chave);
    if (!atual || l.dataInicio < atual) mapa.set(chave, l.dataInicio);
  }
  return mapa;
}
// além da contagem de cupons por faixa, guarda quantos usos cada cupom
// teve em cada faixa — usado no tooltip das KPIs "Cupons usados a X%"
// (ver desenharResumo/wireStatTooltips).
function calcularKpisDesconto(doPeriodo, de, ate, porId, porIdGrupo, chavePorParceiroId, primeiraDataCupom, porChave) {
  const usos50 = new Map(), usos20 = new Map(), usosTotal = new Map();
  for (const l of doPeriodo) {
    if (!l.parceiroId) continue;
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    usosTotal.set(chave, (usosTotal.get(chave) || 0) + l.quantidadeUso);
    const mapa = cupomEhEspecial(l, porId[l.parceiroId], porIdGrupo) ? usos50 : usos20;
    mapa.set(chave, (mapa.get(chave) || 0) + l.quantidadeUso);
  }
  // "novos" só faz sentido com um período delimitado — sem De/Até
  // ("Tudo") qualquer cupom pareceria "novo" por falta de limite.
  const chavesNovas = de && ate
    ? [...usosTotal.keys()].filter((chave) => (primeiraDataCupom.get(chave) || "") >= de)
    : [];
  const novos = de && ate ? chavesNovas.length : null;
  const detalhes = (chaves, mapaUso) => chaves
    .map((chave) => ({ cupom: porChave[chave]?.cupom || chave, uso: mapaUso.get(chave) || 0 }))
    .sort((a, b) => b.uso - a.uso);
  return {
    cupons50: usos50.size, cupons20: usos20.size, novos,
    detalhes50: detalhes([...usos50.keys()], usos50),
    detalhes20: detalhes([...usos20.keys()], usos20),
    detalhesNovos: detalhes(chavesNovas, usosTotal),
  };
}

function formatDataBRlocal(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
/* ---------- agregações ---------- */
function filtrarPeriodo(lancamentos, de, ate) {
  return lancamentos.filter((l) => lancamentoNoPeriodo(l, de, ate));
}
// agrega lançamentos pelo código de cupom (consolidado) em vez de por
// parceiro individual — cupons compartilhados por mais de uma empresa
// somam uso/faturamento juntos
function agregarPorCupom(lista, chavePorParceiroId) {
  const mapa = new Map();
  for (const l of lista) {
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    if (!mapa.has(chave)) mapa.set(chave, { uso: 0, fatCupom: 0, fatSemCupom: 0 });
    const a = mapa.get(chave);
    a.uso += l.quantidadeUso;
    a.fatCupom += l.faturamentoCupom;
    a.fatSemCupom += l.faturamentoSemCupom;
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
  const totalSemCupom = lista.reduce((s, l) => s + l.faturamentoSemCupom, 0);
  const totalGeral = totalCupom + totalSemCupom;
  const pctCupom = totalGeral > 0 ? (totalCupom / totalGeral) * 100 : 0;
  const ticketMedio = totalUso > 0 ? totalCupom / totalUso : 0;
  return { totalUso, totalCupom, totalGeral, pctCupom, ticketMedio };
}
function desenharResumo(app, doPeriodo, doPeriodoAnterior, comparavel, kpisDesconto) {
  const atual = calcularResumo(doPeriodo);
  const anterior = calcularResumo(doPeriodoAnterior);
  const d = (a, b) => (comparavel ? pctDelta(a, b) : undefined);

  app.querySelector("#resumo").innerHTML = [
    stat(formatMoeda(atual.totalGeral), "Faturamento total", d(atual.totalGeral, anterior.totalGeral)),
    stat(formatMoeda(atual.totalCupom), "Faturamento via cupom", d(atual.totalCupom, anterior.totalCupom)),
    stat(`${atual.pctCupom.toFixed(1)}%`, "Cupom sobre faturamento total", d(atual.pctCupom, anterior.pctCupom)),
    stat(formatMoeda(atual.ticketMedio), "Ticket médio", d(atual.ticketMedio, anterior.ticketMedio)),
  ].join("");

  app.querySelector("#resumo-desconto").innerHTML = [
    stat(atual.totalUso, "Usos de cupom", d(atual.totalUso, anterior.totalUso)),
    stat(kpisDesconto.novos === null ? "—" : kpisDesconto.novos, "Novos cupons utilizados no período", undefined, "novos"),
    stat(kpisDesconto.cupons50, "Cupons usados a 50%", undefined, "50"),
    stat(kpisDesconto.cupons20, "Cupons usados a 20%", undefined, "20"),
  ].join("");

  wireStatTooltips(app, { novos: kpisDesconto.detalhesNovos, 50: kpisDesconto.detalhes50, 20: kpisDesconto.detalhes20 });
}
function stat(num, label, delta, tipId) {
  return `<div class="stat"${tipId ? ` data-stat-tip="${tipId}" tabindex="0"` : ""}><div class="stat-num">${num}</div><div class="stat-label">${esc(label)}</div>${deltaBadgeHtml(delta)}</div>`;
}
/* Hover (ou foco via teclado) nas KPIs "Cupons usados a X%" mostra
   quantos usos cada cupom daquela faixa teve no período — reaproveita
   o mesmo componente de tooltip dos gráficos (.viz-tooltip, #viz-tip). */
function wireStatTooltips(app, detalhesPorId) {
  const tip = app.querySelector("#viz-tip");
  app.querySelectorAll("[data-stat-tip]").forEach((el) => {
    const detalhes = detalhesPorId[el.dataset.statTip] || [];
    function mostrar() {
      tip.innerHTML = "";
      if (!detalhes.length) {
        tip.textContent = "Nenhum cupom nesse período.";
      } else {
        detalhes.forEach((d) => {
          const linha = document.createElement("div");
          linha.textContent = `${d.cupom}: ${d.uso} uso${d.uso === 1 ? "" : "s"}`;
          tip.appendChild(linha);
        });
      }
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

/* ---------- render: rosca (donut) — cupom + delivery vs faturamento total ---------- */
function desenharDonutCupom(app, doPeriodo) {
  const totalCupom = doPeriodo.reduce((s, l) => s + l.faturamentoCupom, 0);
  const totalSemCupom = doPeriodo.reduce((s, l) => s + l.faturamentoSemCupom, 0);
  const totalDelivery = doPeriodo.reduce((s, l) => s + (l.faturamentoDelivery || 0), 0);
  const totalGeral = totalCupom + totalSemCupom;
  const pctCupom = totalGeral > 0 ? (totalCupom / totalGeral) * 100 : 0;
  const pctDelivery = totalGeral > 0 ? (totalDelivery / totalGeral) * 100 : 0;

  app.querySelector("#donut-cupom").innerHTML = `
    <div class="viz-donut-wrap">${donutSVG(pctCupom, pctDelivery)}</div>
    <div class="viz-stack-legend">
      <div class="viz-stack-legend-item"><i style="background:var(--chart-series-a)"></i><span>Via cupom</span><strong>${esc(formatMoeda(totalCupom))} (${pctCupom.toFixed(1)}%)</strong></div>
      <div class="viz-stack-legend-item"><i style="background:var(--chart-series-b)"></i><span>Via delivery</span><strong>${esc(formatMoeda(totalDelivery))} (${pctDelivery.toFixed(1)}%)</strong></div>
    </div>
    <div class="viz-meter-legend"><span>${esc(formatMoeda(totalGeral))} faturamento total</span></div>
  `;
}
function donutSVG(pctCupom, pctDelivery) {
  const size = 168, stroke = 20, r = (size - stroke) / 2, c = size / 2;
  const circunferencia = 2 * Math.PI * r;
  const segCupom = (Math.min(100, Math.max(0, pctCupom)) / 100) * circunferencia;
  const segDelivery = (Math.min(100, Math.max(0, pctDelivery)) / 100) * circunferencia;
  return `<svg viewBox="0 0 ${size} ${size}" class="viz-donut" width="${size}" height="${size}" role="img" aria-label="${pctCupom.toFixed(1)}% via cupom, ${pctDelivery.toFixed(1)}% via delivery">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--chart-track)" stroke-width="${stroke}"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--chart-series-a)" stroke-width="${stroke}"
      stroke-dasharray="${segCupom.toFixed(1)} ${(circunferencia - segCupom).toFixed(1)}"
      stroke-linecap="butt" transform="rotate(-90 ${c} ${c})"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--chart-series-b)" stroke-width="${stroke}"
      stroke-dasharray="${segDelivery.toFixed(1)} ${(circunferencia - segDelivery).toFixed(1)}"
      stroke-dashoffset="${(-segCupom).toFixed(1)}"
      stroke-linecap="butt" transform="rotate(-90 ${c} ${c})"/>
    <text x="${c}" y="${c - 2}" text-anchor="middle" font-size="27" font-weight="700" fill="var(--text)">${pctCupom.toFixed(1)}%</text>
    <text x="${c}" y="${c + 18}" text-anchor="middle" font-size="11" fill="var(--chart-ink-muted)">via cupom</text>
  </svg>`;
}

// classe de destaque do rótulo do cupom quando ele está, HOJE, no
// período de 50% (ver util/cupom.js:cupomEm50) — usada em todos os
// lugares do Dashboard que mostram o código do cupom como rótulo
function labelClass50(linha, grupos) {
  const rep = linha?.parceiros?.[0];
  return rep && cupomEm50(rep, grupos) ? " cupom-codigo--50" : "";
}

/* ---------- render: ranking por cupom (barras horizontais) ---------- */
function desenharRanking(app, doPeriodo, chavePorParceiroId, porChave, grupos) {
  const agregados = agregarPorCupom(doPeriodo, chavePorParceiroId);
  const linhas = [...agregados.entries()]
    .map(([chave, a]) => ({ linha: porChave[chave], uso: a.uso, fat: a.fatCupom }))
    .filter((l) => l.linha && l.fat > 0)
    .sort((a, b) => b.fat - a.fat)
    .slice(0, TOP_N_CUPONS);

  const container = app.querySelector("#ranking-cupons");
  if (!linhas.length) {
    container.innerHTML = `<div class="empty">Nenhum lançamento nesse período.</div>`;
    return;
  }
  const max = Math.max(...linhas.map((l) => l.fat));
  container.innerHTML = linhas.map((l) => `
    <div class="viz-bar-row" data-id="${esc(l.linha.parceiros[0].id)}" tabindex="0" role="img" aria-label="${esc(l.linha.cupom)}: ${esc(formatMoeda(l.fat))}, ${l.uso} usos">
      <div class="viz-bar-label${labelClass50(l.linha, grupos)}" title="${esc(l.linha.cupom)} — ${esc(l.linha.parceiros.map((p) => p.nome).join(", "))}">${esc(l.linha.cupom)}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${Math.max(2, Math.round((l.fat / max) * 100))}%"></div></div>
      <div class="viz-bar-val">${esc(formatMoeda(l.fat))}</div>
    </div>
  `).join("");
  wireBarDrillDown(container);
}

/* ---------- render: ranking por usos (barras horizontais) ---------- */
function desenharRankingUsos(app, doPeriodo, chavePorParceiroId, porChave, grupos) {
  const agregados = agregarPorCupom(doPeriodo, chavePorParceiroId);
  const linhas = [...agregados.entries()]
    .map(([chave, a]) => ({ linha: porChave[chave], uso: a.uso, fat: a.fatCupom }))
    .filter((l) => l.linha && l.uso > 0)
    .sort((a, b) => b.uso - a.uso)
    .slice(0, TOP_N_CUPONS);

  const container = app.querySelector("#ranking-usos");
  if (!linhas.length) {
    container.innerHTML = `<div class="empty">Nenhum lançamento nesse período.</div>`;
    return;
  }
  const max = Math.max(...linhas.map((l) => l.uso));
  container.innerHTML = linhas.map((l) => `
    <div class="viz-bar-row" data-id="${esc(l.linha.parceiros[0].id)}" tabindex="0" role="img" aria-label="${esc(l.linha.cupom)}: ${l.uso} usos">
      <div class="viz-bar-label${labelClass50(l.linha, grupos)}" title="${esc(l.linha.cupom)} — ${esc(l.linha.parceiros.map((p) => p.nome).join(", "))}">${esc(l.linha.cupom)}</div>
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

/* ---------- render: Tendências — retidos/perdidos (uso nos dois
   períodos) vs novos que merecem atenção (uso só no período atual).
   Compara sempre o período selecionado com o imediatamente anterior de
   mesma duração (periodoAnterior, já usado pros deltas dos KPIs).

   "Retidos" e "Perdidos" partem do mesmo cohort — cupons que já
   apareceram como "Novos" no período anterior (primeiro uso deles caiu
   dentro de [deAnt, ateAnt], via primeiraDataCupom) — e respondem "desse
   cohort, quem continuou usando (retidos) e quem parou (perdidos)?".
   "Perdidos" mostra o faturamento que o cupom tinha no período anterior
   (não no atual, onde por definição ele não teve uso). Cada linha de
   "Perdidos"/"Novos" ganha marcadores sobrescritos ¹/² conforme o cupom
   teve algum uso dentro do período de 50% do grupo (cupomEhEspecial,
   mesmo critério do resto do Dashboard) no período selecionado (¹) e/ou
   no período anterior (²). */
function calcularTendencias(doPeriodo, doPeriodoAnterior, chavePorParceiroId, porChave, primeiraDataCupom, deAnt, ateAnt, porId, porIdGrupo) {
  const atualChaves = new Set();
  const fatAtualPorChave = new Map();
  const especialAtualPorChave = new Set();
  for (const l of doPeriodo) {
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    if (l.quantidadeUso > 0) atualChaves.add(chave);
    fatAtualPorChave.set(chave, (fatAtualPorChave.get(chave) || 0) + l.faturamentoCupom);
    if (cupomEhEspecial(l, porId[l.parceiroId], porIdGrupo)) especialAtualPorChave.add(chave);
  }
  const anteriorChaves = new Set();
  const fatAnteriorPorChave = new Map();
  const especialAnteriorPorChave = new Set();
  for (const l of doPeriodoAnterior) {
    const chave = chavePorParceiroId[l.parceiroId];
    if (!chave) continue;
    if (l.quantidadeUso > 0) anteriorChaves.add(chave);
    fatAnteriorPorChave.set(chave, (fatAnteriorPorChave.get(chave) || 0) + l.faturamentoCupom);
    if (cupomEhEspecial(l, porId[l.parceiroId], porIdGrupo)) especialAnteriorPorChave.add(chave);
  }
  const eraNovoNoAnterior = (chave) => {
    const primeira = primeiraDataCupom.get(chave);
    return !!primeira && !!deAnt && !!ateAnt && primeira >= deAnt && primeira <= ateAnt;
  };
  const linha = (chave, fatPorChave) => ({
    linha: porChave[chave], fat: fatPorChave.get(chave) || 0,
    marc50Atual: especialAtualPorChave.has(chave), marc50Anterior: especialAnteriorPorChave.has(chave),
  });
  const retidos = [...anteriorChaves]
    .filter((c) => eraNovoNoAnterior(c) && atualChaves.has(c))
    .map((c) => linha(c, fatAtualPorChave)).filter((l) => l.linha).sort((a, b) => b.fat - a.fat);
  const perdidos = [...anteriorChaves]
    .filter((c) => !atualChaves.has(c))
    .map((c) => linha(c, fatAnteriorPorChave)).filter((l) => l.linha).sort((a, b) => b.fat - a.fat);
  const novos = [...atualChaves].filter((c) => !anteriorChaves.has(c))
    .map((c) => linha(c, fatAtualPorChave)).filter((l) => l.linha).sort((a, b) => b.fat - a.fat);
  return { retidos, perdidos, novos };
}
function marcadores50Html(l) {
  let out = "";
  if (l.marc50Atual) out += `<sup title="Com desconto de 50% no período selecionado">1</sup>`;
  if (l.marc50Anterior) out += `<sup title="Com desconto de 50% no período anterior">2</sup>`;
  return out;
}
function listaTendenciaHtml(linhas, vazioTexto, grupos, mostrarMarcadores) {
  if (!linhas.length) return `<div class="empty">${esc(vazioTexto)}</div>`;
  const max = Math.max(...linhas.map((l) => l.fat), 1);
  return linhas.map((l) => `
    <div class="viz-bar-row" data-id="${esc(l.linha.parceiros[0].id)}" tabindex="0" role="img" aria-label="${esc(l.linha.cupom)}: ${esc(formatMoeda(l.fat))}">
      <div class="viz-bar-label${labelClass50(l.linha, grupos)}" title="${esc(l.linha.cupom)} — ${esc(l.linha.parceiros.map((p) => p.nome).join(", "))}">${esc(l.linha.cupom)}${mostrarMarcadores ? marcadores50Html(l) : ""}</div>
      <div class="viz-bar-track"><div class="viz-bar-fill" style="width:${Math.max(2, Math.round((l.fat / max) * 100))}%"></div></div>
      <div class="viz-bar-val">${esc(formatMoeda(l.fat))}</div>
    </div>
  `).join("");
}
function desenharTendencias(app, doPeriodo, doPeriodoAnterior, comparavel, chavePorParceiroId, porChave, primeiraDataCupom, deAnt, ateAnt, modoRetidos, grupos, porId, porIdGrupo) {
  const elRetidos = app.querySelector("#tendencias-retidos");
  const elNovos = app.querySelector("#tendencias-novos");
  const tituloEl = app.querySelector("#tendencias-retidos-titulo");
  const descEl = app.querySelector("#tendencias-retidos-desc");
  if (!comparavel) {
    const aviso = `<div class="empty">Selecione um período (De/Até) pra ver tendências.</div>`;
    elRetidos.innerHTML = aviso;
    elNovos.innerHTML = aviso;
    return;
  }
  const { retidos, perdidos, novos } = calcularTendencias(doPeriodo, doPeriodoAnterior, chavePorParceiroId, porChave, primeiraDataCupom, deAnt, ateAnt, porId, porIdGrupo);
  if (modoRetidos === "perdidos") {
    tituloEl.textContent = "Tendências — Perdidos";
    descEl.innerHTML = "Cupons usados no período anterior e não usados neste;<br>1: Cupons com 50% no período selecionado.<br>2: Cupons com 50% no período anterior.";
    elRetidos.innerHTML = listaTendenciaHtml(perdidos, "Nenhum cupom perdido nesse período.", grupos, true);
  } else {
    tituloEl.textContent = "Tendências — Retidos";
    descEl.textContent = "Cupons novos no período anterior que continuaram sendo usados neste";
    elRetidos.innerHTML = listaTendenciaHtml(retidos, "Nenhum cupom retido nesse período.", grupos, false);
  }
  elNovos.innerHTML = listaTendenciaHtml(novos, "Nenhum cupom novo nesse período.", grupos, true);
  wireBarDrillDown(elRetidos);
  wireBarDrillDown(elNovos);
}

/* ---------- render: participação por cupom (barra empilhada + legenda) ---------- */
function desenharParticipacao(app, doPeriodo, chavePorParceiroId, porChave) {
  const agregados = agregarPorCupom(doPeriodo, chavePorParceiroId);
  const linhas = [...agregados.entries()]
    .map(([chave, a]) => ({ linha: porChave[chave], fat: a.fatCupom }))
    .filter((l) => l.linha && l.fat > 0)
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
    label: l.linha.cupom, valor: l.fat, cor: CORES_CATEGORICAS[i],
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
function calcularLinhasRanking(doPeriodo, doPeriodoAnterior, chavePorParceiroId, porChave, comparavel) {
  const atual = agregarPorCupom(doPeriodo, chavePorParceiroId);
  const anterior = agregarPorCupom(doPeriodoAnterior, chavePorParceiroId);
  const totalGeral = [...atual.values()].reduce((s, a) => s + a.fatCupom, 0);

  return [...atual.entries()]
    .map(([chave, a]) => {
      const linha = porChave[chave];
      const ant = anterior.get(chave);
      const growth = comparavel ? pctDelta(a.fatCupom, ant ? ant.fatCupom : 0) : undefined;
      return {
        linha, nomes: linha ? linha.parceiros.map((p) => p.nome).join(", ") : "",
        uso: a.uso, fat: a.fatCupom,
        pct: totalGeral > 0 ? (a.fatCupom / totalGeral) * 100 : 0,
        ticket: a.uso > 0 ? a.fatCupom / a.uso : 0,
        growth,
      };
    })
    .filter((l) => l.linha && l.fat > 0);
}
function ordenarLinhas(linhas, key, dir) {
  const mul = dir === "asc" ? 1 : -1;
  const val = (l) => {
    switch (key) {
      case "cupom": return (l.linha.cupom || "").toLowerCase();
      case "parceiro": return l.nomes.toLowerCase();
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
  return `<tr class="rank-row" data-id="${esc(l.linha.parceiros[0].id)}" tabindex="0">
    <td>${esc(l.linha.cupom)}</td>
    <td>${esc(l.nomes)}</td>
    <td class="num">${l.uso}</td>
    <td class="num">${esc(formatMoeda(l.fat))}</td>
    <td class="num">${l.pct.toFixed(1)}%</td>
    <td class="num">${esc(formatMoeda(l.ticket))}</td>
    <td class="num">${deltaInlineHtml(l.growth)}</td>
  </tr>`;
}

/* ---------- render: chips de controle (20%/50%/Ambos + Semana/Mês) dos
   dois gráficos "por cupom" (Faturamento com cupons / Uso de Cupons) ---------- */
function controlesGraficoCupomHtml(prefixo) {
  return `
    <div style="display:flex; gap:14px; flex-wrap:wrap; margin-bottom:12px">
      <div class="filter-row" data-cupom-tier="${prefixo}" style="margin-bottom:0">
        <button class="chip chip-sm active" data-tier="ambos">Ambos</button>
        <button class="chip chip-sm" data-tier="20">20%</button>
        <button class="chip chip-sm" data-tier="50">50%</button>
      </div>
      <div class="filter-row" data-cupom-gran="${prefixo}" style="margin-bottom:0">
        <button class="chip chip-sm active" data-gran="semana">Semana</button>
        <button class="chip chip-sm" data-gran="mes">Mês</button>
      </div>
    </div>
  `;
}
function wireControlesGraficoCupom(app, prefixo, estado, redesenhar) {
  app.querySelector(`[data-cupom-tier="${prefixo}"]`).addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tier]");
    if (!btn) return;
    estado.tier = btn.dataset.tier;
    app.querySelectorAll(`[data-cupom-tier="${prefixo}"] .chip`).forEach((c) => c.classList.toggle("active", c === btn));
    redesenhar();
  });
  app.querySelector(`[data-cupom-gran="${prefixo}"]`).addEventListener("click", (e) => {
    const btn = e.target.closest("[data-gran]");
    if (!btn) return;
    estado.granularidade = btn.dataset.gran;
    app.querySelectorAll(`[data-cupom-gran="${prefixo}"] .chip`).forEach((c) => c.classList.toggle("active", c === btn));
    redesenhar();
  });
}

/* ---------- render: linha (SVG) — genérico, usado pelos dois gráficos
   "por cupom" (Faturamento com cupons / Uso de Cupons). Sempre histórico
   completo (limitesEfetivos com de/ate vazios), filtrado por tier
   (20%/50%/Ambos — ver cupomEhEspecial) e agrupado por semana ou mês
   conforme o estado de granularidade. ---------- */
function desenharGraficoCupons(app, opts) {
  const { containerId, tabelaBodyId, lancamentosTotais, porId, porIdGrupo, campo, estado, formatValue, formatAxis } = opts;
  const filtrados = filtrarPorTier(lancamentosTotais, porId, porIdGrupo, estado.tier);
  const [de, ate] = limitesEfetivos(lancamentosTotais, "", "");

  const porChaveTempo = new Map();
  for (const l of filtrados) {
    if (!l.dataInicio) continue;
    const chave = estado.granularidade === "mes" ? chaveMes(l.dataInicio) : chaveSemana(l.dataInicio);
    porChaveTempo.set(chave, (porChaveTempo.get(chave) || 0) + l[campo]);
  }
  const chaves = estado.granularidade === "mes" ? mesesNoPeriodo(de, ate) : semanasNoPeriodo(de, ate);
  const rotulo = estado.granularidade === "mes" ? rotuloMesCurto : rotuloSemanaCurto;
  const pontos = chaves.map((c) => ({ label: rotulo(c), value: porChaveTempo.get(c) || 0 }));

  const container = app.querySelector(`#${containerId}`);
  const tabelaBody = tabelaBodyId ? app.querySelector(`#${tabelaBodyId}`) : null;

  if (!pontos.length) {
    container.innerHTML = `<div class="empty">Sem lançamentos ainda.</div>`;
    if (tabelaBody) tabelaBody.innerHTML = "";
    return;
  }

  container.innerHTML = lineChartSVG(pontos, formatValue, formatAxis);
  wireLineChartHover(container, pontos, formatValue);

  if (tabelaBody) {
    tabelaBody.innerHTML = "";
    pontos.forEach((p) => {
      const tr = document.createElement("tr");
      const tdLabel = document.createElement("td");
      tdLabel.textContent = p.label;
      const tdValor = document.createElement("td");
      tdValor.textContent = formatValue(p.value);
      tr.append(tdLabel, tdValor);
      tabelaBody.appendChild(tr);
    });
  }
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
function compareColHtml(id, cupons, de, ate) {
  const opts = cupons.map((lc) => `<option value="${esc(lc.chave)}" title="${esc(lc.cupom)} — ${esc(lc.parceiros.map((p) => p.nome).join(", "))}">${esc(lc.cupom)}</option>`).join("");
  return `<div class="compare-col">
    <div class="field"><label>Cupom</label><select class="input" id="cmp-${id}-cupom">${opts}</select></div>
    <div class="field-2col">
      <div class="field"><label>De</label><input class="input" type="date" id="cmp-${id}-de" value="${de}"></div>
      <div class="field"><label>Até</label><input class="input" type="date" id="cmp-${id}-ate" value="${ate}"></div>
    </div>
  </div>`;
}

function calcularAgregado(lancamentos, chavePorParceiroId, cupomChave, de, ate) {
  const filtrado = lancamentos.filter((l) => chavePorParceiroId[l.parceiroId] === cupomChave && lancamentoNoPeriodo(l, de, ate));
  const uso = filtrado.reduce((s, l) => s + l.quantidadeUso, 0);
  const fat = filtrado.reduce((s, l) => s + l.faturamentoCupom, 0);
  return { uso, fat, ticket: uso > 0 ? fat / uso : 0 };
}
function totalCupomNoPeriodo(lancamentos, de, ate) {
  return lancamentos
    .filter((l) => lancamentoNoPeriodo(l, de, ate))
    .reduce((s, l) => s + l.faturamentoCupom, 0);
}
function serieMensal(lancamentos, chavePorParceiroId, cupomChave, de, ate) {
  const filtrado = lancamentos.filter((l) => chavePorParceiroId[l.parceiroId] === cupomChave && lancamentoNoPeriodo(l, de, ate));
  const mapa = new Map();
  for (const l of filtrado) {
    const mes = (l.dataInicio || "").slice(0, 7);
    if (!mes) continue;
    mapa.set(mes, (mapa.get(mes) || 0) + l.faturamentoCupom);
  }
  return mapa;
}

function compararEDesenhar(app, lancamentos, chavePorParceiroId, porChave) {
  const chaveA = app.querySelector("#cmp-a-cupom").value;
  const chaveB = app.querySelector("#cmp-b-cupom").value;
  const deA = app.querySelector("#cmp-a-de").value, ateA = app.querySelector("#cmp-a-ate").value;
  const deB = app.querySelector("#cmp-b-de").value, ateB = app.querySelector("#cmp-b-ate").value;
  const a = calcularAgregado(lancamentos, chavePorParceiroId, chaveA, deA, ateA);
  const b = calcularAgregado(lancamentos, chavePorParceiroId, chaveB, deB, ateB);
  const lcA = porChave[chaveA], lcB = porChave[chaveB];
  const nomeA = lcA ? lcA.cupom : "—";
  const nomeB = lcB ? lcB.cupom : "—";

  const totalPeriodoA = totalCupomNoPeriodo(lancamentos, deA, ateA);
  const totalPeriodoB = totalCupomNoPeriodo(lancamentos, deB, ateB);
  const pctA = totalPeriodoA > 0 ? (a.fat / totalPeriodoA) * 100 : 0;
  const pctB = totalPeriodoB > 0 ? (b.fat / totalPeriodoB) * 100 : 0;

  const maxUso = Math.max(a.uso, b.uso, 1);
  const maxFat = Math.max(a.fat, b.fat, 1);
  const maxPct = Math.max(pctA, pctB, 1);

  // evolução mensal sobreposta (uma série por lado, cada uma no seu próprio range)
  const mapaA = serieMensal(lancamentos, chavePorParceiroId, chaveA, deA, ateA);
  const mapaB = serieMensal(lancamentos, chavePorParceiroId, chaveB, deB, ateB);
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
