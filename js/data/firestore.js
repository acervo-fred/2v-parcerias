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
  getFirestore, collection, doc, getDoc, getDocsFromServer,
  addDoc, setDoc, updateDoc, deleteDoc, query, where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, COLLECTIONS } from "../config/firebase-config.js";
import { listas as listasDefault } from "./mock.js";

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
function enrichLancamento(l) {
  const faturamentoCupom = Number(l.faturamentoCupom) || 0;
  const dataInicio = l.dataInicio || l.data || "";
  const dataFim = l.dataFim || dataInicio;
  const faturamentoTotal = l.faturamentoTotal !== undefined
    ? Number(l.faturamentoTotal) || 0
    : faturamentoCupom + (Number(l.faturamentoTotalSemCupom) || 0);
  return {
    ...l,
    dataInicio, dataFim, faturamentoCupom, faturamentoTotal,
    faturamentoSemCupom: Math.max(0, faturamentoTotal - faturamentoCupom),
    ticketMedio: l.quantidadeUso > 0 ? faturamentoCupom / l.quantidadeUso : 0,
  };
}
function numOrZero(v) { return Number(v) || 0; }

export const firestoreStore = {
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
  async listParceiros() { return allDocs(COLLECTIONS.parceiros); },
  async getParceiro(id) {
    const snap = await getDoc(doc(fdb, COLLECTIONS.parceiros, id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
  async listParceirosFechados() { return docsWhere(COLLECTIONS.parceiros, "ehParceiro", true); },
  async addParceiro(dados) {
    const novo = {
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
    const campos = { ...dadosCupom, ehParceiro: true };
    await updateDoc(doc(fdb, COLLECTIONS.parceiros, id), campos);
    return { id, ...campos };
  },

  /* ---------- LANÇAMENTOS (Base de Dados) ---------- */
  async lancamentosDoParceiro(parceiroId) {
    const lancs = await docsWhere(COLLECTIONS.lancamentos, "parceiroId", parceiroId);
    return lancs.map(enrichLancamento).sort((a, b) => (b.dataInicio || "").localeCompare(a.dataInicio || ""));
  },
  async listLancamentos() {
    const lancs = await allDocs(COLLECTIONS.lancamentos);
    return lancs.map(enrichLancamento);
  },
  async addLancamento(dados) {
    const novo = {
      parceiroId: dados.parceiroId, dataInicio: dados.dataInicio, dataFim: dados.dataFim || dados.dataInicio,
      periodoTipo: dados.periodoTipo || "dia", periodoLabel: dados.periodoLabel || "",
      quantidadeUso: numOrZero(dados.quantidadeUso), faturamentoCupom: numOrZero(dados.faturamentoCupom),
      faturamentoTotal: numOrZero(dados.faturamentoTotal), observacoes: dados.observacoes || "",
    };
    const ref = await addDoc(collection(fdb, COLLECTIONS.lancamentos), novo);
    return enrichLancamento({ id: ref.id, ...novo });
  },
  async addLancamentosLote(linhas) {
    const novos = await Promise.all(linhas.map(async (dados) => {
      const novo = {
        parceiroId: dados.parceiroId, dataInicio: dados.dataInicio, dataFim: dados.dataFim || dados.dataInicio,
        periodoTipo: dados.periodoTipo || "dia", periodoLabel: dados.periodoLabel || "",
        quantidadeUso: numOrZero(dados.quantidadeUso), faturamentoCupom: numOrZero(dados.faturamentoCupom),
        faturamentoTotal: numOrZero(dados.faturamentoTotal), observacoes: dados.observacoes || "",
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
    };
    await updateDoc(ref, merged);
    return enrichLancamento({ id, ...merged });
  },
  async removeLancamento(id) { await deleteDoc(doc(fdb, COLLECTIONS.lancamentos, id)); return true; },

  /* ---------- BACKUP ---------- */
  async exportAll() {
    const [parceiros, lancamentos, listas] = await Promise.all([
      allDocs(COLLECTIONS.parceiros), allDocs(COLLECTIONS.lancamentos), this.getListas(),
    ]);
    return { parceiros, lancamentos, listas };
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
    if (data.listas) await setDoc(doc(fdb, COLLECTIONS.config, "listas"), data.listas);
  },
};
