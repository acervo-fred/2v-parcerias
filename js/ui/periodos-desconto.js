/* ============================================================
   Editor de períodos de desconto de um cupom (modal "Editar cupom").
   Em vez de digitar datas por extenso: digita só o percentual e clica
   no calendário o dia de início e o dia de fim — a lista resultante
   ([{percentual, inicio, fim}], datas ISO) é o que vai pro parceiro
   (campo periodosDesconto). Os períodos já cadastrados aparecem
   destacados no calendário e listados abaixo, com botão de remover.
   ============================================================ */

import { esc, formatDataBR } from "./dom.js";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

function isoDe(ano, mes, dia) {
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function htmlEditorPeriodos(percentualSugerido = 50) {
  return `
    <div class="field pd-editor">
      <label>Períodos de desconto</label>
      <div class="pd-lista" data-pd="lista"></div>
      <div class="pd-novo">
        <div class="pd-lado">
          <label class="pd-mini" for="pd-percentual">Percentual</label>
          <div class="pd-pct"><input class="input" type="number" id="pd-percentual" data-pd="percentual" min="1" max="100" step="1" value="${percentualSugerido}"><span>%</span></div>
          <div class="pd-sel muted" data-pd="sel">Clique no dia de início e depois no dia de fim.</div>
          <div class="pd-erro" data-pd="erro"></div>
          <button type="button" class="btn btn-primary btn-sm" data-pd="add" disabled>+ Adicionar período</button>
        </div>
        <div class="pd-cal" data-pd="cal"></div>
      </div>
      <div class="field-hint">Fora desses períodos o cupom fica no desconto base (20%, ou o definido na tela Cupons).</div>
    </div>
  `;
}

/* Liga o editor dentro de `raiz` (o form do modal). Devolve { valor() }
   com a lista atual, ordenada por data de início. */
export function wireEditorPeriodos(raiz, iniciais) {
  const el = (k) => raiz.querySelector(`[data-pd="${k}"]`);
  let periodos = (iniciais || []).map((p) => ({ ...p })).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const sel = { inicio: "", fim: "" };
  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth();

  function percentual() {
    const n = parseInt(el("percentual").value, 10);
    return n >= 1 && n <= 100 ? n : null;
  }
  function sobreposto(inicio, fim) {
    return periodos.find((p) => inicio <= p.fim && fim >= p.inicio);
  }

  function desenharLista() {
    el("lista").innerHTML = periodos.length
      ? periodos.map((p, i) => `
          <span class="pd-item">
            <strong>${p.percentual}%</strong> ${esc(formatDataBR(p.inicio))} – ${esc(formatDataBR(p.fim))}
            <button type="button" class="pd-remover" data-i="${i}" title="Remover período" aria-label="Remover período">×</button>
          </span>`).join("")
      : `<span class="muted" style="font-size:12.5px">Nenhum período especial cadastrado.</span>`;
  }

  function desenharCalendario() {
    const primeiro = new Date(ano, mes, 1);
    const offset = (primeiro.getDay() + 6) % 7; // segunda = 0
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const hojeISO = isoDe(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const celulas = [];
    for (let i = 0; i < offset; i++) celulas.push(`<span></span>`);
    for (let d = 1; d <= diasNoMes; d++) {
      const iso = isoDe(ano, mes, d);
      const classes = ["pd-dia"];
      if (periodos.some((p) => iso >= p.inicio && iso <= p.fim)) classes.push("pd-dia--salvo");
      const fimSel = sel.fim || sel.inicio;
      if (sel.inicio && iso >= sel.inicio && iso <= fimSel) classes.push("pd-dia--sel");
      if (iso === sel.inicio || iso === sel.fim) classes.push("pd-dia--ponta");
      if (iso === hojeISO) classes.push("pd-dia--hoje");
      celulas.push(`<button type="button" class="${classes.join(" ")}" data-dia="${iso}">${d}</button>`);
    }
    el("cal").innerHTML = `
      <div class="pd-cal-head">
        <button type="button" class="pd-nav" data-nav="-1" aria-label="Mês anterior">‹</button>
        <strong>${MESES[mes]} ${ano}</strong>
        <button type="button" class="pd-nav" data-nav="1" aria-label="Próximo mês">›</button>
      </div>
      <div class="pd-grade">
        ${DIAS_SEMANA.map((d) => `<span class="pd-dsem">${d}</span>`).join("")}
        ${celulas.join("")}
      </div>
    `;
  }

  function atualizarSelecao() {
    const pct = percentual();
    let msg = "Clique no dia de início e depois no dia de fim.";
    if (sel.inicio && !sel.fim) msg = `Início: ${formatDataBR(sel.inicio)} — agora clique no dia de fim.`;
    if (sel.inicio && sel.fim) msg = `${pct ?? "?"}% de ${formatDataBR(sel.inicio)} a ${formatDataBR(sel.fim)}`;
    el("sel").textContent = msg;
    const conflito = sel.inicio && sel.fim ? sobreposto(sel.inicio, sel.fim) : null;
    el("erro").textContent = conflito
      ? `Sobrepõe o período ${formatDataBR(conflito.inicio)} – ${formatDataBR(conflito.fim)} (${conflito.percentual}%).`
      : !pct ? "Informe um percentual entre 1 e 100." : "";
    el("add").disabled = !(sel.inicio && sel.fim && pct && !conflito);
  }

  raiz.addEventListener("click", (e) => {
    const nav = e.target.closest("[data-nav]");
    if (nav && raiz.contains(nav)) {
      mes += Number(nav.dataset.nav);
      if (mes < 0) { mes = 11; ano--; }
      if (mes > 11) { mes = 0; ano++; }
      desenharCalendario();
      return;
    }
    const dia = e.target.closest("[data-dia]");
    if (dia) {
      const iso = dia.dataset.dia;
      if (!sel.inicio || sel.fim) { sel.inicio = iso; sel.fim = ""; }
      else if (iso < sel.inicio) { sel.inicio = iso; }
      else { sel.fim = iso; }
      desenharCalendario();
      atualizarSelecao();
      return;
    }
    if (e.target.closest('[data-pd="add"]')) {
      periodos.push({ percentual: percentual(), inicio: sel.inicio, fim: sel.fim });
      periodos.sort((a, b) => a.inicio.localeCompare(b.inicio));
      sel.inicio = ""; sel.fim = "";
      desenharLista(); desenharCalendario(); atualizarSelecao();
      return;
    }
    const rem = e.target.closest(".pd-remover");
    if (rem) {
      periodos.splice(Number(rem.dataset.i), 1);
      desenharLista(); desenharCalendario(); atualizarSelecao();
    }
  });
  el("percentual").addEventListener("input", atualizarSelecao);
  // Enter no percentual não pode enviar o modal inteiro
  el("percentual").addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });

  desenharLista();
  desenharCalendario();
  atualizarSelecao();
  return { valor: () => periodos.map((p) => ({ ...p })) };
}
