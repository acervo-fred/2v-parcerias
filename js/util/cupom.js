/* ============================================================
   Consolidação de cupons compartilhados por mais de uma empresa —
   duas linhas na aba Parceiros podem usar o mesmo código de cupom
   (ex.: "PARCEIRO20" oferecido a duas empresas diferentes). Pra
   desempenho/configuração (Cupons, Dashboard) elas devem se
   comportar como um cupom só: mesmo grupo, mesmo desconto, stats
   somadas. Só a aba Parceiros continua listando cada empresa à parte.
   ============================================================ */

import { formatDataBR } from "../ui/dom.js";

const DESCONTO_PADRAO = 20;
const DESCONTO_ESPECIAL = 50;

export function normalizarCupom(cupom) {
  return (cupom || "").trim().toUpperCase();
}

// chave de agrupamento: cupom vazio nunca se junta com outro vazio
// (cada parceiro sem cupom fica isolado, usando o próprio id)
export function chaveCupom(parceiro) {
  return normalizarCupom(parceiro.cupom) || `__sem-cupom__${parceiro.id}`;
}

// agrupa parceiros fechados pelo código do cupom — cada grupo carrega
// todos os parceiros que compartilham o código; o primeiro da lista é
// o "representante" pros campos que devem ficar em sincronia entre eles
// (grupo de desconto, vigência).
export function agruparParceirosPorCupom(parceiros) {
  const mapa = new Map();
  for (const p of parceiros) {
    const chave = chaveCupom(p);
    if (!mapa.has(chave)) mapa.set(chave, { chave, cupom: p.cupom, parceiros: [] });
    mapa.get(chave).parceiros.push(p);
  }
  return [...mapa.values()];
}

// desconto base do cupom (fora de qualquer período especial)
export function descontoBase(parceiro) {
  return Number(parceiro?.descontoBase) || DESCONTO_PADRAO;
}

/* Períodos de desconto gravados no próprio cupom (periodosDesconto,
   [{percentual, inicio, fim}] em ISO, editados no modal "Editar cupom"
   pelo calendário). O formato antigo periodos50Extra ([{inicio, fim}],
   sempre 50%) continua sendo lido até o cupom ser salvo de novo. */
export function periodosDoCupom(parceiro) {
  const lista = [];
  for (const per of parceiro?.periodosDesconto || []) {
    if (per?.inicio && per?.fim) lista.push({ percentual: Number(per.percentual) || DESCONTO_ESPECIAL, inicio: per.inicio, fim: per.fim });
  }
  for (const per of parceiro?.periodos50Extra || []) {
    if (per?.inicio && per?.fim) lista.push({ percentual: DESCONTO_ESPECIAL, inicio: per.inicio, fim: per.fim });
  }
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/* Todos os períodos especiais (desconto acima do base) do cupom: o do
   grupo legado (grupoCupom) mais os do próprio cupom. Ordenado do mais
   antigo pro mais novo. Usado pelo Desempenho pra separar 20%/50%. */
export function periodos50(parceiro, porIdGrupo) {
  const lista = [];
  const g = porIdGrupo[String(parceiro?.grupoCupom || "")];
  if (g && g.inicio && g.fim) lista.push({ percentual: Number(g.percentual) || DESCONTO_ESPECIAL, inicio: g.inicio, fim: g.fim });
  lista.push(...periodosDoCupom(parceiro));
  const base = descontoBase(parceiro);
  return lista.filter((p) => p.percentual > base).sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/* Desconto valendo hoje: o percentual do período especial (grupo ou do
   próprio cupom) que cobre hoje, senão o desconto base. Devolve também
   as datas de início/fim de qual estiver valendo. */
export function descontoAtual(parceiro, grupos) {
  const hoje = new Date().toISOString().slice(0, 10);
  const porIdGrupo = Object.fromEntries((grupos || []).map((g) => [String(g.numero), g]));
  const per = periodos50(parceiro, porIdGrupo).filter((p) => hoje >= p.inicio && hoje <= p.fim).at(-1);
  if (per) return { percentual: per.percentual, inicio: per.inicio, fim: per.fim, especial: true };
  return { percentual: descontoBase(parceiro), inicio: parceiro.dataInicio || "", fim: parceiro.dataVencimento || "", especial: false };
}

// hoje o cupom está num período especial (ver descontoAtual) — usado
// pra destacar visualmente o código do cupom onde ele aparece como rótulo
export function cupomEm50(parceiro, grupos) {
  return descontoAtual(parceiro, grupos).especial;
}

// Status "efetivo" pro cupom — some com um vencido (dataVencimento no
// passado) mesmo que ninguém tenha pausado manualmente: aparece como
// Pausado assim que a data passa, sem precisar mexer no campo à mão.
// Não sobrescreve statusCupom no banco, só o jeito que é exibido/usado
// pra decidir a ação do botão Pausar/Reativar.
export function statusCupomEfetivo(parceiro) {
  const hoje = new Date().toISOString().slice(0, 10);
  if (parceiro.dataVencimento && parceiro.dataVencimento < hoje) return "Pausado";
  return parceiro.statusCupom || "Ativo";
}

/* Texto "20% até DD/MM/AAAA / 50% até DD/MM/AAAA" — mesmo formato do
   campo livre "periodoDesconto" original, só que calculado ao vivo a
   partir da vigência do cupom (20%) e do período especial do grupo
   (50%), em vez de digitado à mão. Data ausente vira o placeholder
   literal "DD/MM/AAAA", sinalizando que falta preencher. */
export function validadeCupomTexto(parceiro, grupos) {
  const porIdGrupo = Object.fromEntries((grupos || []).map((g) => [String(g.numero), g]));
  const ultimo = periodos50(parceiro, porIdGrupo).at(-1);
  const fimPadrao = parceiro.dataVencimento ? formatDataBR(parceiro.dataVencimento) : "DD/MM/AAAA";
  const fimEspecial = ultimo ? formatDataBR(ultimo.fim) : "DD/MM/AAAA";
  return `${descontoBase(parceiro)}% até ${fimPadrao} / ${ultimo?.percentual || DESCONTO_ESPECIAL}% até ${fimEspecial}`;
}
