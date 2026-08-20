/* ============================================================
   Backend Firestore — implementa a MESMA API do localStore
   (ver store.js). Projeto Firebase dedicado ao 2V Parcerias.

   Leitura sempre direto do servidor (getDocsFromServer/getDoc),
   sem cache local do SDK — mesmo padrão do Acervo Giros Imagens,
   pra garantir que qualquer edição feita em outro dispositivo
   apareça na próxima navegação/recarga.

   Campo DERIVADO (nunca gravado): lancamento.ticketMedio.
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocFromServer, getDocsFromServer,
  addDoc, setDoc, updateDoc, deleteDoc, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, COLLECTIONS } from "../config/firebase-config.js";
import { listas as listasDefault } from "./mock.js";
import { getLojaAtualId, setLojaAtualId } from "./loja-atual.js";
import { usuarioAtual } from "./auth.js";

const app = initializeApp(firebaseConfig);
const fdb = getFirestore(app);

/* ---------- helpers ---------- */
async function allDocs(coll) {
  const snap = await getDocsFromServer(collection(fdb, coll));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function docsWhere(coll, campo, valor) {
  const snap = await getDocsFromServer(query(collection(fdb, coll), where(campo, "==", valor)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
// múltiplas condições de igualdade — Firestore resolve sem índice composto
async function docsWhereAll(coll, pares) {
  const snap = await getDocsFromServer(
    query(collection(fdb, coll), ...pares.map(([campo, valor]) => where(campo, "==", valor)))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// resolve a loja atual (localStorage) e cai pra primeira loja cadastrada
// se não houver seleção válida; cacheada pro resto da sessão (troca de
// loja recarrega a página, então não precisa invalidar em runtime).
let lojaCache;
async function lojaAtual() {
  if (lojaCache !== undefined) return lojaCache;
  const lojas = await allDocs(COLLECTIONS.lojas);
  let id = getLojaAtualId();
  let achada = lojas.find((l) => l.id === id);
  if (!achada && lojas.length) {
    achada = [...lojas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))[0];
    setLojaAtualId(achada.id);
  }
  lojaCache = achada || null;
  return lojaCache;
}
async function lojaAtualIdOuErro() {
  const l = await lojaAtual();
  if (!l) throw new Error("Nenhuma loja selecionada. Crie uma loja primeiro.");
  return l.id;
}
function enrichLancamento(l) {
  const faturamentoCupom = Number(l.faturamentoCupom) || 0;
  const faturamentoDelivery = Number(l.faturamentoDelivery) || 0;
  const dataInicio = l.dataInicio || l.data || "";
  const dataFim = l.dataFim || dataInicio;
  const faturamentoTotal = l.faturamentoTotal !== undefined
    ? Number(l.faturamentoTotal) || 0
    : faturamentoCupom + (Number(l.faturamentoTotalSemCupom) || 0);
  return {
    ...l,
    dataInicio, dataFim, faturamentoCupom, faturamentoTotal, faturamentoDelivery,
    faturamentoSemCupom: Math.max(0, faturamentoTotal - faturamentoCupom),
    ticketMedio: l.quantidadeUso > 0 ? faturamentoCupom / l.quantidadeUso : 0,
  };
}
function numOrZero(v) { return Number(v) || 0; }
function hojeISO() { return new Date().toISOString().slice(0, 10); }

export const firestoreStore = {
  /* ---------- lojas (venues) ---------- */
  async listLojas() { return allDocs(COLLECTIONS.lojas); },
  async getLojaAtual() { return lojaAtual(); },
  async addLoja(nome) {
    const novo = { nome, criadoEm: new Date().toISOString().slice(0, 10) };
    const ref = await addDoc(collection(fdb, COLLECTIONS.lojas), novo);
    return { id: ref.id, ...novo };
  },
  async updateLoja(id, campos) {
    await updateDoc(doc(fdb, COLLECTIONS.lojas, id), campos);
    return { id, ...campos };
  },
  // apaga só os lançamentos (Base de dados) da loja — mantém parceiros,
  // cupons e o pipeline intactos. Pra recomeçar o histórico de
  // desempenho sem perder o cadastro (ver caso real: "Largo Machado"
  // usada como recomeço limpo de "Largo do Machado", 2026-08-19).
  async wipeLancamentosDaLoja(id) {
    const docs = await docsWhere(COLLECTIONS.lancamentos, "lojaId", id);
    await Promise.all(docs.map((d) => deleteDoc(doc(fdb, COLLECTIONS.lancamentos, d.id))));
    return docs.length;
  },
  // apaga a loja e cascateia tudo que é dela (mesmo padrão de
  // removeParceiro cascateando lançamentos) — parceiros, lançamentos,
  // grupos de cupom, partners (CRM) e tasks "Geral"
  async removeLoja(id) {
    const colecoesDaLoja = [
      COLLECTIONS.parceiros, COLLECTIONS.lancamentos, COLLECTIONS.grupos,
      COLLECTIONS.partners, COLLECTIONS.tasks,
    ];
    for (const colecao of colecoesDaLoja) {
      const docs = await docsWhere(colecao, "lojaId", id);
      await Promise.all(docs.map((d) => deleteDoc(doc(fdb, colecao, d.id))));
    }
    await deleteDoc(doc(fdb, COLLECTIONS.lojas, id));
    // confere que o documento da loja realmente sumiu — já vimos esse
    // delete final "não pegar" mesmo com a cascata toda concluída
    // (causa nunca confirmada, possível hiccup de rede), deixando a
    // loja vazia mas ainda listada. Tenta mais uma vez antes de
    // desistir, e só reporta sucesso se de fato sumiu.
    let aindaExiste = await getDocFromServer(doc(fdb, COLLECTIONS.lojas, id));
    if (aindaExiste.exists()) {
      await deleteDoc(doc(fdb, COLLECTIONS.lojas, id));
      aindaExiste = await getDocFromServer(doc(fdb, COLLECTIONS.lojas, id));
      if (aindaExiste.exists()) {
        throw new Error("Os dados foram apagados, mas não foi possível remover o registro da loja. Tente excluir de novo.");
      }
    }
    return true;
  },

  /* ---------- grupos de cupons ---------- */
  async listGrupos() {
    const lojaId = await lojaAtualIdOuErro();
    return docsWhere(COLLECTIONS.grupos, "lojaId", lojaId);
  },
  async addGrupo(dados) {
    const lojaId = await lojaAtualIdOuErro();
    const novo = { lojaId, ...dados };
    const ref = await addDoc(collection(fdb, COLLECTIONS.grupos), novo);
    return { id: ref.id, ...novo };
  },
  async updateGrupo(id, campos) {
    await updateDoc(doc(fdb, COLLECTIONS.grupos, id), campos);
    return { id, ...campos };
  },
  async removeGrupo(id) { await deleteDoc(doc(fdb, COLLECTIONS.grupos, id)); return true; },

  /* ---------- listas de configuração ---------- */
  async getListas() {
    const snap = await getDoc(doc(fdb, COLLECTIONS.config, "listas"));
    const stored = snap.exists() ? snap.data() : {};
    return { ...structuredClone(listasDefault), ...stored };
  },
  async saveLista(chave, valores) {
    await setDoc(doc(fdb, COLLECTIONS.config, "listas"), { [chave]: valores }, { merge: true });
    return valores;
  },

  /* ---------- PARCEIROS ---------- */
  async listParceiros() {
    const lojaId = await lojaAtualIdOuErro();
    return docsWhere(COLLECTIONS.parceiros, "lojaId", lojaId);
  },
  async getParceiro(id) {
    const snap = await getDoc(doc(fdb, COLLECTIONS.parceiros, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async listParceirosFechados() {
    const lojaId = await lojaAtualIdOuErro();
    return docsWhereAll(COLLECTIONS.parceiros, [["lojaId", lojaId], ["ehParceiro", true]]);
  },
  async addParceiro(dados) {
    const lojaId = await lojaAtualIdOuErro();
    const novo = {
      lojaId,
      area: dados.area || "", nome: dados.nome, local: dados.local || "",
      contato: dados.contato || "", tipo: dados.tipo || "", responsavel: dados.responsavel || "",
      observacoes: dados.observacoes || "", statusProspeccao: dados.statusProspeccao || "Prospecção",
      dataCadastro: new Date().toISOString().slice(0, 10), ehParceiro: false,
      cupom: "", statusCupom: "", periodoDesconto: "", dataInicio: "", dataVencimento: "",
    };
    const ref = await addDoc(collection(fdb, COLLECTIONS.parceiros), novo);
    return { id: ref.id, ...novo };
  },
  async updateParceiro(id, campos) {
    await updateDoc(doc(fdb, COLLECTIONS.parceiros, id), campos);
    return { id, ...campos };
  },
  async removeParceiro(id) {
    const lancs = await docsWhere(COLLECTIONS.lancamentos, "parceiroId", id);
    await Promise.all(lancs.map((l) => deleteDoc(doc(fdb, COLLECTIONS.lancamentos, l.id))));
    await deleteDoc(doc(fdb, COLLECTIONS.parceiros, id));
    return true;
  },
  async fecharParceria(id, dadosCupom) {
    const campos = { ...dadosCupom, ehParceiro: true, statusProspeccao: "Fechado" };
    await updateDoc(doc(fdb, COLLECTIONS.parceiros, id), campos);
    return { id, ...campos };
  },

  /* ---------- LANÇAMENTOS (Base de Dados) ---------- */
  async lancamentosDoParceiro(parceiroId) {
    const lancs = await docsWhere(COLLECTIONS.lancamentos, "parceiroId", parceiroId);
    return lancs.map(enrichLancamento).sort((a, b) => (b.dataInicio || "").localeCompare(a.dataInicio || ""));
  },
  async listLancamentos() {
    const lojaId = await lojaAtualIdOuErro();
    const lancs = await docsWhere(COLLECTIONS.lancamentos, "lojaId", lojaId);
    return lancs.map(enrichLancamento);
  },
  async addLancamento(dados) {
    const lojaId = await lojaAtualIdOuErro();
    const novo = {
      lojaId,
      parceiroId: dados.parceiroId, dataInicio: dados.dataInicio, dataFim: dados.dataFim || dados.dataInicio,
      periodoTipo: dados.periodoTipo || "dia", periodoLabel: dados.periodoLabel || "",
      quantidadeUso: numOrZero(dados.quantidadeUso), faturamentoCupom: numOrZero(dados.faturamentoCupom),
      faturamentoTotal: numOrZero(dados.faturamentoTotal), faturamentoDelivery: numOrZero(dados.faturamentoDelivery),
      observacoes: dados.observacoes || "",
    };
    const ref = await addDoc(collection(fdb, COLLECTIONS.lancamentos), novo);
    return enrichLancamento({ id: ref.id, ...novo });
  },
  async addLancamentosLote(linhas) {
    const lojaId = await lojaAtualIdOuErro();
    const novos = await Promise.all(linhas.map(async (dados) => {
      const novo = {
        lojaId,
        parceiroId: dados.parceiroId, dataInicio: dados.dataInicio, dataFim: dados.dataFim || dados.dataInicio,
        periodoTipo: dados.periodoTipo || "dia", periodoLabel: dados.periodoLabel || "",
        quantidadeUso: numOrZero(dados.quantidadeUso), faturamentoCupom: numOrZero(dados.faturamentoCupom),
        faturamentoTotal: numOrZero(dados.faturamentoTotal), faturamentoDelivery: numOrZero(dados.faturamentoDelivery),
        observacoes: dados.observacoes || "",
      };
      const ref = await addDoc(collection(fdb, COLLECTIONS.lancamentos), novo);
      return { id: ref.id, ...novo };
    }));
    return novos.map(enrichLancamento);
  },
  async updateLancamento(id, campos) {
    const ref = doc(fdb, COLLECTIONS.lancamentos, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const atual = snap.data();
    const merged = {
      ...atual, ...campos,
      quantidadeUso: campos.quantidadeUso !== undefined ? numOrZero(campos.quantidadeUso) : atual.quantidadeUso,
      faturamentoCupom: campos.faturamentoCupom !== undefined ? numOrZero(campos.faturamentoCupom) : atual.faturamentoCupom,
      faturamentoTotal: campos.faturamentoTotal !== undefined ? numOrZero(campos.faturamentoTotal) : atual.faturamentoTotal,
      faturamentoDelivery: campos.faturamentoDelivery !== undefined ? numOrZero(campos.faturamentoDelivery) : atual.faturamentoDelivery,
    };
    await updateDoc(ref, merged);
    return enrichLancamento({ id, ...merged });
  },
  async removeLancamento(id) { await deleteDoc(doc(fdb, COLLECTIONS.lancamentos, id)); return true; },

  /* ---------- CRM (Fase 2/3 — Ficha do Parceiro + Kanban) ---------- */
  async listPartners() {
    const lojaId = await lojaAtualIdOuErro();
    return docsWhere(COLLECTIONS.partners, "lojaId", lojaId);
  },
  async getPartner(id) {
    const snap = await getDoc(doc(fdb, COLLECTIONS.partners, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  // cria um partner com ID escolhido por quem chama (não gerado pelo
  // Firestore) — pra poder compartilhar o mesmo id do parceiros/{id}
  // correspondente, mesmo padrão que a migração da Fase 1 já usa
  // (js/migracao/transformar.js). Ver js/views/cadastros.js:abrirFecharParceria
  // e js/views/kanban.js (drop de um card de "Lead" pra outro estágio).
  async addPartner(id, dados) {
    const lojaId = await lojaAtualIdOuErro();
    const autor = usuarioAtual()?.email || "desconhecido";
    const agora = hojeISO();
    const novo = {
      lojaId,
      name: dados.name || "", type: dados.type || "", area: dados.area || "",
      address: dados.address || "", contact: dados.contact || {}, contactRaw: dados.contactRaw || "",
      responsavel: dados.responsavel || "", stage: dados.stage || "ativo",
      stageUpdatedAt: agora, nextAction: dados.nextAction ?? null, tags: [], archived: false,
      createdAt: agora, createdBy: autor, updatedAt: agora, updatedBy: autor,
    };
    await setDoc(doc(fdb, COLLECTIONS.partners, id), novo);
    return { id, ...novo };
  },
  async updatePartner(id, campos) {
    const stamped = { ...campos, updatedAt: hojeISO(), updatedBy: usuarioAtual()?.email || "desconhecido" };
    await updateDoc(doc(fdb, COLLECTIONS.partners, id), stamped);
    return { id, ...stamped };
  },
  async removePartner(id) {
    const snap = await getDocsFromServer(collection(fdb, COLLECTIONS.partners, id, "interactions"));
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(fdb, COLLECTIONS.partners, id));
    return true;
  },
  async interactionsDoPartner(partnerId) {
    const snap = await getDocsFromServer(collection(fdb, COLLECTIONS.partners, partnerId, "interactions"));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  },
  async addInteraction(partnerId, dados) {
    const novo = {
      partnerId, type: dados.type, summary: dados.summary, date: dados.date,
      authorId: usuarioAtual()?.email || "desconhecido", createdAt: hojeISO(),
    };
    const ref = await addDoc(collection(fdb, COLLECTIONS.partners, partnerId, "interactions"), novo);
    return { id: ref.id, ...novo };
  },
  async removeInteraction(partnerId, interactionId) {
    await deleteDoc(doc(fdb, COLLECTIONS.partners, partnerId, "interactions", interactionId));
    return true;
  },
  async campaignPartnersDoPartner(partnerId) { return docsWhere(COLLECTIONS.campaignPartners, "partnerId", partnerId); },
  async getCampaign(id) {
    const snap = await getDoc(doc(fdb, COLLECTIONS.campaigns, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async couponPartnersDoPartner(partnerId) { return docsWhere(COLLECTIONS.couponPartners, "partnerId", partnerId); },
  async getCoupon(id) {
    const snap = await getDoc(doc(fdb, COLLECTIONS.coupons, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },

  /* ---------- TASKS (ações "Geral" — ligadas só à loja, sem negócio) ---------- */
  async listTasksGerais() {
    const lojaId = await lojaAtualIdOuErro();
    return docsWhere(COLLECTIONS.tasks, "lojaId", lojaId);
  },
  // sem filtro de loja — só pro mapa consolidado da aba Equipe
  async listTasksTodasLojas() { return allDocs(COLLECTIONS.tasks); },
  async addTaskGeral(dados) {
    // aceita lojaId explícito (tela Equipe, que não tem loja "atual" —
    // mostra todas de uma vez) ou cai pra loja selecionada no sidebar
    // (Kanban → Próximos Passos, dentro do contexto de uma loja só).
    const lojaId = dados.lojaId || await lojaAtualIdOuErro();
    const novo = {
      lojaId, description: dados.description || "", dueDate: dados.dueDate || "",
      dataInicio: dados.dataInicio || "", responsavel: dados.responsavel || "", concluidaEm: null,
    };
    const ref = await addDoc(collection(fdb, COLLECTIONS.tasks), novo);
    return { id: ref.id, ...novo };
  },
  async updateTaskGeral(id, campos) {
    await updateDoc(doc(fdb, COLLECTIONS.tasks, id), campos);
    return { id, ...campos };
  },
  async removeTaskGeral(id) {
    await deleteDoc(doc(fdb, COLLECTIONS.tasks, id));
    return true;
  },

  /* ---------- BACKUP ---------- */
  async exportAll() {
    const [parceiros, lancamentos, lojas, listas] = await Promise.all([
      allDocs(COLLECTIONS.parceiros), allDocs(COLLECTIONS.lancamentos), allDocs(COLLECTIONS.lojas), this.getListas(),
    ]);
    return { parceiros, lancamentos, lojas, listas };
  },
  async importAll(data) {
    const grava = async (chaveColl, itens) => {
      if (!Array.isArray(itens)) return;
      for (const item of itens) {
        const { id, ...campos } = item;
        const ref = id ? doc(fdb, chaveColl, id) : doc(collection(fdb, chaveColl));
        await setDoc(ref, campos);
      }
    };
    await grava(COLLECTIONS.parceiros, data.parceiros);
    await grava(COLLECTIONS.lancamentos, data.lancamentos);
    await grava(COLLECTIONS.lojas, data.lojas);
    if (data.listas) await setDoc(doc(fdb, COLLECTIONS.config, "listas"), data.listas);
  },
};
