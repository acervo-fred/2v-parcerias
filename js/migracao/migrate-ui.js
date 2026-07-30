/* ============================================================
   Migração Fase 1 — wiring da página migracao.html.

   Fluxo: exige login (Editor) → lê parceiros/lancamentos/lojas
   direto do servidor (todas as lojas de uma vez) → roda a
   transformação pura de transformar.js → mostra relatório (contagens
   + ambiguidades) → só libera "Gravar de verdade" depois que o
   dry-run rodou nesta sessão e o usuário digita "MIGRAR" → grava em
   lotes com IDs determinísticos (upsert seguro, pode rodar de novo)
   → grava um log de auditoria em config/migracaoFase1Log.

   Nunca apaga nem sobrescreve parceiros/lancamentos/lojas/grupos/config
   (config só ganha o novo doc de log, nada existente é tocado).
   ============================================================ */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDocsFromServer, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, COLLECTIONS } from "../config/firebase-config.js";
import { onAuthChange, loginComGoogle, logout } from "../data/auth.js";
import { esc } from "../ui/dom.js";
import { transformarTudo } from "./transformar.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const fdb = getFirestore(app);

const TAMANHO_LOTE = 400; // limite do Firestore é 500 escritas/batch

async function allDocs(coll) {
  const snap = await getDocsFromServer(collection(fdb, coll));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function hojeISO() { return new Date().toISOString().slice(0, 10); }

function baixarJSON(obj, nome) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function iniciarMigracao() {
  const gate = document.getElementById("login-gate");
  const conteudo = document.getElementById("conteudo");
  const userBox = document.getElementById("gate-user");

  let resultadoAtual = null; // preenchido pelo dry-run, exigido antes de gravar

  onAuthChange((usuario) => {
    gate.hidden = !!usuario;
    conteudo.hidden = !usuario;
    if (usuario) {
      userBox.innerHTML = `Logado como <strong>${esc(usuario.email)}</strong> · <button class="btn btn-sm" id="btn-logout-mig">Sair</button>`;
      userBox.querySelector("#btn-logout-mig").addEventListener("click", () => logout());
    }
  });

  document.getElementById("btn-login-gate").addEventListener("click", async () => {
    const erro = document.getElementById("gate-erro");
    erro.textContent = "";
    try { await loginComGoogle(); }
    catch (e) { console.error(e); erro.textContent = "Não foi possível entrar. Tente de novo."; }
  });

  const btnDryRun = document.getElementById("btn-dry-run");
  const relatorio = document.getElementById("relatorio");
  const btnBaixar = document.getElementById("btn-baixar-json");
  const painelGravar = document.getElementById("painel-gravar");
  const inputConfirma = document.getElementById("input-confirma");
  const btnGravar = document.getElementById("btn-gravar");
  const statusGravar = document.getElementById("status-gravar");

  btnDryRun.addEventListener("click", async () => {
    btnDryRun.disabled = true;
    btnDryRun.textContent = "Lendo dados…";
    relatorio.innerHTML = "";
    painelGravar.hidden = true;
    resultadoAtual = null;
    try {
      const [parceiros, lancamentos, lojas] = await Promise.all([
        allDocs(COLLECTIONS.parceiros),
        allDocs(COLLECTIONS.lancamentos),
        allDocs(COLLECTIONS.lojas),
      ]);
      const hoje = hojeISO();
      const resultado = transformarTudo({ parceiros, lancamentos }, hoje);
      resultadoAtual = { resultado, origem: { parceiros: parceiros.length, lancamentos: lancamentos.length, lojas: lojas.length }, hoje };
      desenharRelatorio(resultadoAtual);
      painelGravar.hidden = false;
    } catch (e) {
      console.error(e);
      relatorio.innerHTML = `<div class="empty">✗ Erro ao ler os dados: ${esc(e.message)}</div>`;
    } finally {
      btnDryRun.disabled = false;
      btnDryRun.textContent = "🔄 Rodar dry-run de novo";
    }
  });

  function desenharRelatorio({ resultado, origem, hoje }) {
    const c = resultado.contagens;
    relatorio.innerHTML = `
      <div class="page-sub" style="margin-bottom:14px">Lido em ${esc(hoje)} · origem: ${origem.parceiros} parceiros, ${origem.lancamentos} lançamentos, ${origem.lojas} lojas</div>
      <div class="stat-grid" style="margin-bottom:20px">
        ${stat(c.partners, "partners")}
        ${stat(c.interactions, "interactions")}
        ${stat(c.coupons, "coupons")}
        ${stat(c.couponPartners, "couponPartners")}
        ${stat(c.campaigns, "campaigns")}
        ${stat(c.campaignPartners, "campaignPartners")}
        ${stat(c.tasks, "tasks")}
      </div>
      <div class="chart-card">
        <h3 style="margin-bottom:10px">Casos ambíguos — revisar antes de gravar (${resultado.ambiguidades.length})</h3>
        ${resultado.ambiguidades.length === 0
          ? `<p class="muted">Nenhum caso ambíguo encontrado.</p>`
          : `<div class="list-card" style="max-height:360px;overflow:auto">${resultado.ambiguidades.map(linhaAmbiguidade).join("")}</div>`}
      </div>
    `;
    btnBaixar.hidden = false;
    btnBaixar.onclick = () => baixarJSON(resultado, `2v-migracao-fase1-dryrun-${hoje}.json`);
  }

  function stat(num, label) {
    return `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${esc(label)}</div></div>`;
  }
  function linhaAmbiguidade(a) {
    const contexto = a.nome || a.cupom || a.campaignId || "";
    return `<div class="list-row">
      <div class="lr-main">
        <div class="lr-title">${esc(a.tipo)}${contexto ? ` — ${esc(contexto)}` : ""}</div>
        <div class="lr-sub">${esc(a.detalhe)}</div>
      </div>
    </div>`;
  }

  inputConfirma.addEventListener("input", () => {
    btnGravar.disabled = inputConfirma.value.trim() !== "MIGRAR";
  });

  btnGravar.addEventListener("click", async () => {
    if (!resultadoAtual) return;
    if (!confirm("Confirma a gravação real no Firestore? Isso cria/atualiza as coleções novas (partners, campaigns, coupons, etc). As coleções antigas não são tocadas.")) return;
    btnGravar.disabled = true;
    inputConfirma.disabled = true;
    statusGravar.textContent = "Gravando…";
    try {
      const contagemGravada = await gravarTudo(resultadoAtual.resultado);
      await gravarLog(contagemGravada, resultadoAtual.hoje);
      statusGravar.textContent = `✓ Gravação concluída em ${new Date().toLocaleString("pt-BR")}. Pode rodar de novo com segurança (mesmos IDs, upsert).`;
    } catch (e) {
      console.error(e);
      statusGravar.textContent = `✗ Erro na gravação: ${e.message}`;
    } finally {
      inputConfirma.disabled = false;
      inputConfirma.value = "";
      btnGravar.disabled = true;
    }
  });

  async function gravarColecaoPlanaEmLotes(coll, itens) {
    for (let i = 0; i < itens.length; i += TAMANHO_LOTE) {
      const fatia = itens.slice(i, i + TAMANHO_LOTE);
      const batch = writeBatch(fdb);
      for (const item of fatia) {
        const { id, ...campos } = item;
        batch.set(doc(fdb, coll, id), campos);
      }
      await batch.commit();
    }
    return itens.length;
  }

  async function gravarInteractionsEmLotes(interactions) {
    for (let i = 0; i < interactions.length; i += TAMANHO_LOTE) {
      const fatia = interactions.slice(i, i + TAMANHO_LOTE);
      const batch = writeBatch(fdb);
      for (const item of fatia) {
        const { id, partnerId, ...campos } = item;
        batch.set(doc(fdb, COLLECTIONS.partners, partnerId, "interactions", id), { partnerId, ...campos });
      }
      await batch.commit();
    }
    return interactions.length;
  }

  async function gravarTudo(resultado) {
    const contagem = {};
    contagem.partners = await gravarColecaoPlanaEmLotes(COLLECTIONS.partners, resultado.partners);
    contagem.interactions = await gravarInteractionsEmLotes(resultado.interactions);
    contagem.coupons = await gravarColecaoPlanaEmLotes(COLLECTIONS.coupons, resultado.coupons);
    contagem.couponPartners = await gravarColecaoPlanaEmLotes(COLLECTIONS.couponPartners, resultado.couponPartners);
    contagem.campaigns = await gravarColecaoPlanaEmLotes(COLLECTIONS.campaigns, resultado.campaigns);
    contagem.campaignPartners = await gravarColecaoPlanaEmLotes(COLLECTIONS.campaignPartners, resultado.campaignPartners);
    return contagem;
  }

  async function gravarLog(contagemGravada, hoje) {
    const batch = writeBatch(fdb);
    batch.set(doc(fdb, COLLECTIONS.config, "migracaoFase1Log"), {
      executadoEm: new Date().toISOString(),
      dadosLidosEm: hoje,
      contagemGravada,
    });
    await batch.commit();
  }
}
