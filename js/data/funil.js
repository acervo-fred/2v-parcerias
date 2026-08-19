/* Deriva a lista unificada de "cards" do funil (Lead virtual + partners
   reais) — mesma regra usada pelo Kanban (Pipeline) e por Próximos
   Passos, pra nunca divergir sobre o que conta como "Lead". Um negócio
   é Lead enquanto não tiver doc em `partners` (ou tiver, com
   stage:"lead") e ainda não for parceiro fechado (ehParceiro).

   Também é o dono do CRUD de "próximas ações" — cada partner guarda uma
   LISTA (`nextActions`), não uma ação única, pra dar pra ter várias em
   aberto ao mesmo tempo sem uma apagar a outra. */

import { store } from "./store.js";

// rótulo/cor de cada estágio — fonte única usada pelo Pipeline, pela
// Ficha do Parceiro e pelo badge de Status em Parceiros, pra nunca
// divergir do que o Kanban mostra.
export const STAGE_META = {
  lead: { label: "Lead", cor: "gray" },
  negociacao: { label: "Negociação / Em contato", cor: "amber" },
  ativo: { label: "Ativo", cor: "green" },
  perdido: { label: "Perdido / Sem resposta", cor: "red" },
};

// equipe fixa + cor de cada um — usada em Próximos Passos (lista +
// calendário) e no mapa consolidado da aba Equipe, pra nunca divergir
// a paleta entre as duas telas.
export const RESPONSAVEIS_FIXOS = ["Fred", "Manu", "Laura"];
export const COR_RESPONSAVEL = { Fred: "blue", Manu: "green", Laura: "violet" };
export const MES_NOMES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function corDe(responsavel) {
  return COR_RESPONSAVEL[responsavel] || "gray";
}
export function bucketDe(responsavel) {
  return RESPONSAVEIS_FIXOS.includes(responsavel) ? responsavel : "Outros";
}

export async function carregarFunil() {
  const [partners, parceiros] = await Promise.all([store.listPartners(), store.listParceiros()]);
  const partnersById = Object.fromEntries(partners.map((p) => [p.id, p]));

  const leadCards = parceiros
    .filter((p) => !p.ehParceiro && (!partnersById[p.id] || partnersById[p.id].stage === "lead"))
    .map((p) => ({
      id: p.id, name: p.nome, type: p.tipo || "", stage: "lead",
      stageUpdatedAt: partnersById[p.id]?.stageUpdatedAt || p.dataCadastro || "",
      nextActions: acoesDe(partnersById[p.id]),
    }));
  // acoesDe já é idempotente pra quem já é lista — dá pra rodar de novo
  // em cima da junção toda sem duplicar nada, só normaliza os partners
  // "de verdade" (leadCards já vem pronto).
  const todosCards = [...leadCards, ...partners.filter((p) => p.stage !== "lead")]
    .map((c) => ({ ...c, nextActions: acoesDe(c) }));

  return { partners, parceiros, partnersById, leadCards, todosCards };
}

/* Upsert do doc em `partners` — atualiza se já existir, cria (stage
   "lead" por padrão, `campos` pode sobrescrever) se ainda não existir.
   Usado tanto pelo drag-and-drop do Pipeline quanto pelo cadastro de
   ação em Próximos Passos, sempre com o mesmo id do parceiro de origem
   (padrão que a migração original já usa). */
export async function garantirPartner(id, parceiro, partnersById, campos) {
  if (partnersById[id]) {
    return store.updatePartner(id, campos);
  }
  return store.addPartner(id, {
    name: parceiro.nome, type: parceiro.tipo || "", address: parceiro.local || "",
    responsavel: parceiro.responsavel || "", contactRaw: parceiro.contato || "",
    stage: "lead", ...campos,
  });
}

/* ---------- próximas ações (lista, não mais um campo único) ----------
   `nextActions: [{id, description, dueDate, dataInicio, responsavel,
   concluidaEm}]`. concluidaEm fica null enquanto pendente — concluir só
   grava a data, não apaga (fica visível no repositório de concluídas).

   Compatibilidade: partners antigos só têm o campo único `nextAction`.
   acoesDe() normaliza os dois formatos pra sempre devolver uma lista; a
   primeira escrita nova daquele partner (via adicionar/editar/concluir/
   excluir) já grava tudo em `nextActions` e zera o campo antigo — sem
   precisar de script de migração. */
export function acoesDe(partner) {
  if (Array.isArray(partner?.nextActions)) return partner.nextActions;
  if (partner?.nextAction) return [{ id: "legacy", concluidaEm: null, ...partner.nextAction }];
  return [];
}

function novoIdAcao() {
  return `na_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}
export function criarAcao(dados) {
  return { id: novoIdAcao(), concluidaEm: null, ...dados };
}

export async function adicionarAcao(partnerId, partner, dados) {
  const nova = criarAcao(dados);
  await store.updatePartner(partnerId, { nextActions: [...acoesDe(partner), nova], nextAction: null });
  return nova;
}
export async function editarAcao(partnerId, partner, acaoId, dados) {
  const atualizadas = acoesDe(partner).map((a) => (a.id === acaoId ? { ...a, ...dados } : a));
  await store.updatePartner(partnerId, { nextActions: atualizadas, nextAction: null });
}
export async function concluirAcao(partnerId, partner, acaoId) {
  const acao = acoesDe(partner).find((a) => a.id === acaoId);
  await editarAcao(partnerId, partner, acaoId, { concluidaEm: new Date().toISOString().slice(0, 10) });
  if (acao) {
    await store.addInteraction(partnerId, {
      type: "nota", summary: `Ação concluída: ${acao.description}`,
      date: new Date().toISOString().slice(0, 10),
    });
  }
}
export async function excluirAcao(partnerId, partner, acaoId) {
  const restantes = acoesDe(partner).filter((a) => a.id !== acaoId);
  await store.updatePartner(partnerId, { nextActions: restantes, nextAction: null });
}

// nível de urgência de uma data — cada lugar que usa formata a própria
// classe CSS em cima disso (ex.: acoes-data-label--soon/overdue)
export function nivelUrgencia(dueDate) {
  if (!dueDate) return "";
  const hoje = new Date().toISOString().slice(0, 10);
  if (dueDate < hoje) return "overdue";
  const emSeteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  if (dueDate <= emSeteDias) return "soon";
  return "";
}
