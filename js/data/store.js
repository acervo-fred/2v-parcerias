/* ============================================================
   Store — única fonte de acesso a dados das telas.
   Persistência em localStorage (sem backend). Todos os métodos
   são async de propósito (facilita trocar de backend depois sem
   mudar as views — mesma lógica da Plataforma Giros Imagens).

   Modelo: PARCEIROS é um único registro por negócio, que evolui de
   "prospecção" pra "parceiro fechado" (ehParceiro=true) quando ganha
   um cupom. LANÇAMENTOS são o desempenho por período de cada parceiro.

   Campo DERIVADO (nunca gravado): lancamento.ticketMedio = faturamento / uso.
   ============================================================ */

import * as mock from "./mock.js";

const LS_KEY = "2v-parcerias-db-v1";

function estadoInicial() {
  return {
    parceiros: structuredClone(mock.parceiros),
    lancamentos: structuredClone(mock.lancamentos),
    listas: structuredClone(mock.listas),
  };
}

function carregar() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Não consegui ler o armazenamento local; usando dados de exemplo.", e);
  }
  return estadoInicial();
}

const db = carregar();

function persistir() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(db));
  } catch (e) {
    console.warn("Falha ao salvar localmente.", e);
  }
}

function novoId(prefixo) {
  return `${prefixo}_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

function atualizar(colecao, id, campos) {
  const item = colecao.find((x) => x.id === id);
  if (!item) return null;
  Object.assign(item, campos);
  persistir();
  return structuredClone(item);
}

function remover(colecao, id) {
  const i = colecao.findIndex((x) => x.id === id);
  if (i === -1) return false;
  colecao.splice(i, 1);
  persistir();
  return true;
}

// enriquece um lançamento com o ticket médio (derivado, nunca gravado)
function enrichLancamento(l) {
  return {
    ...l,
    ticketMedio: l.quantidadeUso > 0 ? l.faturamentoCupom / l.quantidadeUso : 0,
  };
}

export const store = {
  /* ---------- listas de configuração ---------- */
  async getListas() { return structuredClone(db.listas); },
  async saveLista(chave, valores) {
    db.listas[chave] = structuredClone(valores);
    persistir();
    return structuredClone(db.listas[chave]);
  },

  /* ---------- PARCEIROS ---------- */
  async listParceiros() { return structuredClone(db.parceiros); },
  async getParceiro(id) {
    const p = db.parceiros.find((x) => x.id === id);
    return p ? structuredClone(p) : null;
  },
  // ainda não fecharam parceria
  async listProspeccao() {
    return db.parceiros.filter((p) => !p.ehParceiro).map((p) => structuredClone(p));
  },
  // já são parceiros ativos/fechados
  async listParceirosFechados() {
    return db.parceiros.filter((p) => p.ehParceiro).map((p) => structuredClone(p));
  },
  async addParceiro(dados) {
    const novo = {
      id: novoId("pc"),
      area: dados.area || "",
      nome: dados.nome,
      local: dados.local || "",
      contato: dados.contato || "",
      tipo: dados.tipo || "",
      responsavel: dados.responsavel || "",
      observacoes: dados.observacoes || "",
      statusProspeccao: dados.statusProspeccao || "Prospecção",
      dataCadastro: new Date().toISOString().slice(0, 10),
      ehParceiro: false,
      cupom: "", statusCupom: "", periodoDesconto: "",
      dataInicio: "", dataVencimento: "",
    };
    db.parceiros.push(novo);
    persistir();
    return structuredClone(novo);
  },
  async updateParceiro(id, campos) { return atualizar(db.parceiros, id, campos); },
  async removeParceiro(id) {
    db.lancamentos = db.lancamentos.filter((l) => l.parceiroId !== id);
    return remover(db.parceiros, id);
  },
  // transforma um prospecto em parceiro fechado (preenche os campos de cupom)
  async fecharParceria(id, dadosCupom) {
    return atualizar(db.parceiros, id, { ...dadosCupom, ehParceiro: true });
  },

  /* ---------- LANÇAMENTOS (Base de Dados) ---------- */
  async lancamentosDoParceiro(parceiroId) {
    return db.lancamentos
      .filter((l) => l.parceiroId === parceiroId)
      .map(enrichLancamento)
      .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  },
  async listLancamentos() {
    return db.lancamentos.map(enrichLancamento);
  },
  async addLancamento(dados) {
    const novo = {
      id: novoId("lz"),
      parceiroId: dados.parceiroId,
      data: dados.data,
      periodoTipo: dados.periodoTipo || "dia",
      periodoLabel: dados.periodoLabel || "",
      quantidadeUso: Number(dados.quantidadeUso) || 0,
      faturamentoCupom: Number(dados.faturamentoCupom) || 0,
      faturamentoTotalSemCupom: Number(dados.faturamentoTotalSemCupom) || 0,
      observacoes: dados.observacoes || "",
    };
    db.lancamentos.push(novo);
    persistir();
    return enrichLancamento(novo);
  },
  // grava vários lançamentos de uma vez (um período, vários cupons) — um só save no final
  async addLancamentosLote(linhas) {
    const novos = linhas.map((dados) => ({
      id: novoId("lz"),
      parceiroId: dados.parceiroId,
      data: dados.data,
      periodoTipo: dados.periodoTipo || "dia",
      periodoLabel: dados.periodoLabel || "",
      quantidadeUso: Number(dados.quantidadeUso) || 0,
      faturamentoCupom: Number(dados.faturamentoCupom) || 0,
      faturamentoTotalSemCupom: Number(dados.faturamentoTotalSemCupom) || 0,
      observacoes: dados.observacoes || "",
    }));
    db.lancamentos.push(...novos);
    persistir();
    return novos.map(enrichLancamento);
  },
  async updateLancamento(id, campos) {
    const l = db.lancamentos.find((x) => x.id === id);
    if (!l) return null;
    Object.assign(l, {
      ...campos,
      quantidadeUso: campos.quantidadeUso !== undefined ? Number(campos.quantidadeUso) : l.quantidadeUso,
      faturamentoCupom: campos.faturamentoCupom !== undefined ? Number(campos.faturamentoCupom) : l.faturamentoCupom,
      faturamentoTotalSemCupom: campos.faturamentoTotalSemCupom !== undefined ? Number(campos.faturamentoTotalSemCupom) : l.faturamentoTotalSemCupom,
    });
    persistir();
    return enrichLancamento(l);
  },
  async removeLancamento(id) { return remover(db.lancamentos, id); },

  /* ---------- BACKUP ---------- */
  async exportAll() {
    return structuredClone({ parceiros: db.parceiros, lancamentos: db.lancamentos, listas: db.listas });
  },
  async importAll(data) {
    ["parceiros", "lancamentos"].forEach((k) => {
      if (Array.isArray(data[k])) db[k] = structuredClone(data[k]);
    });
    if (data.listas) db.listas = structuredClone(data.listas);
    persistir();
  },
};
