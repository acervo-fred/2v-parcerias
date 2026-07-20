/* Cupons — percentual de desconto, período de validade e grupos de
   cada cupom. O desconto de um cupom só pode ser 20% (padrão) ou 50%
   (especial) — nunca um valor livre. Estratégia de aumento em grupos:
   cada grupo (1-4) tem seu próprio período de desconto especial,
   escalonado; enquanto a data de hoje não estiver dentro do período do
   grupo, o cupom fica nos 20% padrão. Uso/faturamento por cupom,
   filtrado por período, pra acompanhar o desempenho de cada grupo. */

import { store } from "../data/store.js";
import { esc, formatMoeda, formatDataBR } from "../ui/dom.js";
import { dedupLancamentos, lancamentoNoPeriodo } from "../util/periodo.js";

const NUM_GRUPOS = 4;
const DESCONTO_PADRAO = 20;
const DESCONTO_ESPECIAL = 50;

function hojeISO() { return new Date().toISOString().slice(0, 10); }
function isoMenosDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
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

// 20% por padrão (dentro da vigência do próprio cupom, dataInicio/
// dataVencimento) — 50% só enquanto hoje estiver dentro do período
// especial configurado no grupo. Devolve também as datas de início/fim
// de qual dos dois estiver valendo, pra mostrar na lista.
function descontoAtual(p, porIdGrupo) {
  const hoje = hojeISO();
  const g = porIdGrupo[String(p.grupoCupom || "")];
  if (g && g.inicio && g.fim && hoje >= g.inicio && hoje <= g.fim) {
    return { percentual: DESCONTO_ESPECIAL, inicio: g.inicio, fim: g.fim };
  }
  return { percentual: DESCONTO_PADRAO, inicio: p.dataInicio || "", fim: p.dataVencimento || "" };
}

// período correspondente a um percentual específico (20% → vigência do
// próprio cupom, 50% → período especial configurado no grupo do cupom) —
// usado pra alternar o texto de vigência quando o usuário troca a lista
// suspensa de desconto, sem depender de qual dos dois está "ativo hoje".
function periodoParaPercentual(p, porIdGrupo, percentual) {
  if (percentual === DESCONTO_ESPECIAL) {
    const g = porIdGrupo[String(p.grupoCupom || "")];
    return { inicio: g?.inicio || "", fim: g?.fim || "" };
  }
  return { inicio: p.dataInicio || "", fim: p.dataVencimento || "" };
}

function statsPorParceiro(lancamentos, de, ate) {
  const mapa = new Map();
  for (const l of lancamentos) {
    if (!lancamentoNoPeriodo(l, de, ate)) continue;
    if (!l.parceiroId) continue;
    if (!mapa.has(l.parceiroId)) mapa.set(l.parceiroId, { uso: 0, fat: 0 });
    const a = mapa.get(l.parceiroId);
    a.uso += l.quantidadeUso;
    a.fat += l.faturamentoCupom;
  }
  return mapa;
}

export async function renderCupons(app) {
  const [parceiros, grupos, lancamentosBrutos] = await Promise.all([
    store.listParceirosFechados(),
    garantirGrupos(),
    store.listLancamentos(),
  ]);
  const lancamentos = dedupLancamentos(lancamentosBrutos);
  const porIdGrupo = Object.fromEntries(grupos.map((g) => [String(g.numero), g]));

  let periodo = "total"; // "mes" | "total"
  let aba = "todos"; // "todos" | "1".."4"
  let busca = "";
  const ordem = { chave: "cupom", dir: "asc" };

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Cupons</h1>
        <div class="page-sub">${parceiros.length} cupons · 20% padrão ou 50% no período especial de cada grupo</div>
      </div>
      <div class="filter-row" id="periodo-cupons" style="margin-bottom:0">
        <button class="chip" data-p="mes">Último mês</button>
        <button class="chip active" data-p="total">Total</button>
      </div>
    </div>

    <div class="filter-row" id="aba-grupos">
      <button class="chip active" data-aba="todos">Todos</button>
      ${grupos.map((g) => `<button class="chip" data-aba="${g.numero}">${esc(g.nome)}</button>`).join("")}
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
  `;

  const painel = app.querySelector("#grupo-painel");
  const lista = app.querySelector("#lista-cupons");

  function periodoAtual() {
    return periodo === "mes" ? [isoMenosDias(30), hojeISO()] : ["", ""];
  }

  function desenharPainel() {
    if (aba === "todos") { painel.innerHTML = ""; return; }
    const g = porIdGrupo[aba];
    painel.innerHTML = `
      <div class="toolbar" style="margin-bottom:16px; gap:10px; flex-wrap:wrap">
        <strong style="font-size:13.5px">Período desconto 50% — ${esc(g.nome)}:</strong>
        <input class="input" type="date" id="grp-inicio" value="${g.inicio || ""}" style="width:auto">
        <span class="muted">até</span>
        <input class="input" type="date" id="grp-fim" value="${g.fim || ""}" style="width:auto">
        <button class="btn btn-primary btn-sm" id="grp-salvar">Salvar</button>
        <span class="muted" id="grp-salvo" style="font-size:12px"></span>
      </div>
    `;
    painel.querySelector("#grp-salvar").addEventListener("click", async () => {
      const campos = {
        inicio: painel.querySelector("#grp-inicio").value,
        fim: painel.querySelector("#grp-fim").value,
      };
      await store.updateGrupo(g.id, campos);
      Object.assign(g, campos);
      painel.querySelector("#grp-salvo").textContent = "✓ salvo";
      setTimeout(() => { const s = painel.querySelector("#grp-salvo"); if (s) s.textContent = ""; }, 2000);
      desenharLista(); // o desconto atual de cada linha pode ter mudado
    });
  }

  function linhasVisiveis() {
    const [de, ate] = periodoAtual();
    const stats = statsPorParceiro(lancamentos, de, ate);
    const termo = busca.trim().toLowerCase();

    const arr = parceiros
      .filter((p) => (aba === "todos" || String(p.grupoCupom || "") === aba))
      .filter((p) => !termo || (p.cupom || "").toLowerCase().includes(termo))
      .map((p) => ({ p, uso: stats.get(p.id)?.uso || 0, fat: stats.get(p.id)?.fat || 0 }));

    const mul = ordem.dir === "asc" ? 1 : -1;
    const val = (l) => {
      if (ordem.chave === "uso") return l.uso;
      if (ordem.chave === "fat") return l.fat;
      return (l.p.cupom || "").toLowerCase();
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
      ? arr.map((l) => rowHtml(l.p, l.uso, l.fat)).join("")
      : `<tr><td colspan="6" class="empty">Nenhum cupom encontrado.</td></tr>`;

    app.querySelectorAll("#tabela-cupons th[data-sort]").forEach((th) => {
      th.classList.toggle("sort-active", th.dataset.sort === ordem.chave);
      th.dataset.sortDir = th.dataset.sort === ordem.chave ? ordem.dir : "";
    });
  }

  function fmtPeriodo(per) {
    return per.inicio && per.fim ? `${formatDataBR(per.inicio)} – ${formatDataBR(per.fim)}` : "—";
  }

  function rowHtml(p, uso, fat) {
    const d = descontoAtual(p, porIdGrupo);
    const periodoTxt = fmtPeriodo(d);
    return `<tr class="rank-row">
      <td><a href="#/parceiro/${esc(p.id)}" style="color:var(--accent);font-weight:700">${esc(p.cupom)}</a></td>
      <td class="num">${uso}</td>
      <td class="num">${esc(formatMoeda(fat))}</td>
      <td>
        <select class="input cupom-desconto ${d.percentual === DESCONTO_ESPECIAL ? "cupom-desconto--50" : "cupom-desconto--20"}" data-id="${esc(p.id)}" style="width:80px">
          <option value="20" ${d.percentual === DESCONTO_PADRAO ? "selected" : ""}>20%</option>
          <option value="50" ${d.percentual === DESCONTO_ESPECIAL ? "selected" : ""}>50%</option>
        </select>
      </td>
      <td class="muted cupom-periodo" style="font-size:12.5px">${esc(periodoTxt)}</td>
      <td>
        <select class="input cupom-grupo" data-id="${esc(p.id)}" style="width:140px">
          <option value="">Sem grupo</option>
          ${grupos.map((g) => `<option value="${g.numero}" ${String(p.grupoCupom || "") === String(g.numero) ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}
        </select>
      </td>
    </tr>`;
  }

  desenharPainel();
  desenharLista();

  app.querySelector("#periodo-cupons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-p]");
    if (!btn) return;
    periodo = btn.dataset.p;
    app.querySelectorAll("#periodo-cupons .chip").forEach((c) => c.classList.toggle("active", c === btn));
    desenharLista();
  });

  app.querySelector("#aba-grupos").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-aba]");
    if (!btn) return;
    aba = btn.dataset.aba;
    app.querySelectorAll("#aba-grupos .chip").forEach((c) => c.classList.toggle("active", c === btn));
    desenharPainel();
    desenharLista();
  });

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
      const id = descSel.dataset.id;
      const percentual = Number(descSel.value);
      const p = parceiros.find((x) => x.id === id);
      if (!p) return;
      const per = periodoParaPercentual(p, porIdGrupo, percentual);
      const tr = descSel.closest("tr");
      tr.querySelector(".cupom-periodo").textContent = fmtPeriodo(per);
      descSel.classList.toggle("cupom-desconto--50", percentual === DESCONTO_ESPECIAL);
      descSel.classList.toggle("cupom-desconto--20", percentual === DESCONTO_PADRAO);
      return;
    }
    const grupoSel = e.target.closest(".cupom-grupo");
    if (grupoSel) {
      const id = grupoSel.dataset.id;
      const valor = grupoSel.value ? Number(grupoSel.value) : "";
      await store.updateParceiro(id, { grupoCupom: valor });
      const p = parceiros.find((x) => x.id === id);
      if (p) p.grupoCupom = valor;
      if (aba !== "todos") desenharLista(); // some da aba do grupo antigo
    }
  });
}
