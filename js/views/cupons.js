/* Cupons — percentual de desconto, período de validade e grupos de
   cada cupom. Estratégia de aumento do percentual em grupos: cada
   grupo (1-4) tem seu próprio período de desconto especial (50%),
   escalonado; o desconto padrão (20%) fica valendo o resto do tempo.
   Uso/faturamento por cupom, filtrado por período, pra acompanhar o
   desempenho de cada grupo. */

import { store } from "../data/store.js";
import { esc, formatMoeda } from "../ui/dom.js";
import { dedupLancamentos, lancamentoNoPeriodo } from "../util/periodo.js";
import { openModal } from "../ui/modal.js";

const NUM_GRUPOS = 4;

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
      const novo = await store.addGrupo({ numero: n, nome: `Grupo ${n}`, descontoEspecial: 50, inicio: "", fim: "" });
      grupos.push(novo);
    }
  }
  return grupos.sort((a, b) => a.numero - b.numero);
}

// separa cupons já usados (ao menos 1 lançamento com uso>0) dos que nunca
// tiveram uso, e distribui os dois grupos em rodízio pelos 4 grupos —
// mantém a mesma proporção de "já usados" em cada grupo
function distribuirEmGrupos(parceiros, lancamentos) {
  const usados = new Set(lancamentos.filter((l) => l.quantidadeUso > 0).map((l) => l.parceiroId));
  const jaUsados = parceiros.filter((p) => usados.has(p.id));
  const naoUsados = parceiros.filter((p) => !usados.has(p.id));

  const porGrupo = { 1: [], 2: [], 3: [], 4: [] };
  jaUsados.forEach((p, i) => porGrupo[(i % NUM_GRUPOS) + 1].push(p.id));
  naoUsados.forEach((p, i) => porGrupo[(i % NUM_GRUPOS) + 1].push(p.id));
  return porGrupo;
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

  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">Cupons</h1>
        <div class="page-sub">${parceiros.length} cupons · percentual, período e grupos de desconto</div>
      </div>
      <div class="filter-row" id="periodo-cupons" style="margin-bottom:0">
        <button class="chip" data-p="mes">Último mês</button>
        <button class="chip active" data-p="total">Total</button>
      </div>
    </div>

    <div class="filter-row" id="aba-grupos">
      <button class="chip active" data-aba="todos">Todos</button>
      ${grupos.map((g) => `<button class="chip" data-aba="${g.numero}">${esc(g.nome)}</button>`).join("")}
      <button class="btn btn-ghost btn-sm" id="btn-distribuir" style="margin-left:auto">↻ Gerar divisão automática</button>
    </div>

    <div id="grupo-painel"></div>

    <div class="toolbar" style="margin-bottom:14px">
      <input class="input" id="busca-cupom" type="search" placeholder="Buscar por cupom…" style="flex:1;min-width:200px" />
    </div>

    <div class="list-card" id="lista-cupons"></div>
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
      <div class="chart-card" style="margin-bottom:16px">
        <h3 style="margin-bottom:14px">Período de desconto especial — ${esc(g.nome)}</h3>
        <div class="field-2col">
          <div class="field"><label>Desconto especial (%)</label><input class="input" type="number" min="0" max="100" id="grp-desconto" value="${g.descontoEspecial ?? 50}"></div>
          <div></div>
        </div>
        <div class="field-2col">
          <div class="field"><label>Início</label><input class="input" type="date" id="grp-inicio" value="${g.inicio || ""}"></div>
          <div class="field"><label>Fim</label><input class="input" type="date" id="grp-fim" value="${g.fim || ""}"></div>
        </div>
        <button class="btn btn-primary btn-sm" id="grp-salvar">Salvar período do grupo</button>
        <span class="muted" id="grp-salvo" style="font-size:12.5px;margin-left:10px"></span>
      </div>
    `;
    painel.querySelector("#grp-salvar").addEventListener("click", async () => {
      const campos = {
        descontoEspecial: Number(painel.querySelector("#grp-desconto").value) || 0,
        inicio: painel.querySelector("#grp-inicio").value,
        fim: painel.querySelector("#grp-fim").value,
      };
      await store.updateGrupo(g.id, campos);
      Object.assign(g, campos);
      painel.querySelector("#grp-salvo").textContent = "✓ salvo";
      setTimeout(() => { const s = painel.querySelector("#grp-salvo"); if (s) s.textContent = ""; }, 2000);
    });
  }

  function desenharLista() {
    const [de, ate] = periodoAtual();
    const stats = statsPorParceiro(lancamentos, de, ate);
    const termo = busca.trim().toLowerCase();

    const arr = parceiros
      .filter((p) => (aba === "todos" || String(p.grupoCupom || "") === aba))
      .filter((p) => !termo || (p.cupom || "").toLowerCase().includes(termo))
      .sort((a, b) => (a.cupom || "").localeCompare(b.cupom || "", "pt-BR"));

    lista.innerHTML = arr.length
      ? arr.map((p) => rowHtml(p, stats.get(p.id))).join("")
      : `<div class="empty">Nenhum cupom encontrado.</div>`;
  }

  function rowHtml(p, st) {
    const uso = st?.uso || 0;
    const fat = st?.fat || 0;
    return `<div class="list-row">
      <div class="lr-main">
        <a href="#/parceiro/${esc(p.id)}" class="lr-title" style="color:var(--accent)">${esc(p.cupom)}</a>
        <div class="lr-sub">${uso} usos · ${esc(formatMoeda(fat))} via cupom</div>
      </div>
      <div class="field" style="margin:0;width:90px">
        <input class="input cupom-desconto" type="number" min="0" max="100" step="1" data-id="${esc(p.id)}" value="${p.descontoPadrao ?? 20}" title="Desconto padrão (%)">
      </div>
      <select class="input cupom-grupo" data-id="${esc(p.id)}" style="width:140px">
        <option value="">Sem grupo</option>
        ${grupos.map((g) => `<option value="${g.numero}" ${String(p.grupoCupom || "") === String(g.numero) ? "selected" : ""}>${esc(g.nome)}</option>`).join("")}
      </select>
    </div>`;
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

  lista.addEventListener("change", async (e) => {
    const desconto = e.target.closest(".cupom-desconto");
    const grupoSel = e.target.closest(".cupom-grupo");
    if (desconto) {
      const id = desconto.dataset.id;
      const valor = Number(desconto.value) || 0;
      await store.updateParceiro(id, { descontoPadrao: valor });
      const p = parceiros.find((x) => x.id === id);
      if (p) p.descontoPadrao = valor;
    }
    if (grupoSel) {
      const id = grupoSel.dataset.id;
      const valor = grupoSel.value ? Number(grupoSel.value) : "";
      await store.updateParceiro(id, { grupoCupom: valor });
      const p = parceiros.find((x) => x.id === id);
      if (p) p.grupoCupom = valor;
      if (aba !== "todos") desenharLista(); // some da aba do grupo antigo
    }
  });

  app.querySelector("#btn-distribuir").addEventListener("click", () => {
    openModal({
      title: "Gerar divisão automática",
      subtitle: `Redistribui os ${parceiros.length} cupons entre os 4 grupos agora`,
      submitLabel: "Redistribuir",
      bodyHtml: `<p style="font-size:13.5px;color:var(--text-soft);line-height:1.6">
        Isso substitui o grupo atual de cada cupom. Os cupons já usados ficam
        espalhados igualmente entre os 4 grupos (mesma proporção em cada um),
        e o resto preenche o espaço restante. Não afeta o desconto padrão nem
        o período especial já configurado em cada grupo.
      </p>`,
      onSubmit: async () => {
        const porGrupo = distribuirEmGrupos(parceiros, lancamentos);
        await Promise.all(
          Object.entries(porGrupo).flatMap(([numero, ids]) =>
            ids.map((id) => store.updateParceiro(id, { grupoCupom: Number(numero) }))
          )
        );
        parceiros.forEach((p) => {
          const numero = Object.entries(porGrupo).find(([, ids]) => ids.includes(p.id))?.[0];
          if (numero) p.grupoCupom = Number(numero);
        });
        desenharLista();
      },
    });
  });
}
