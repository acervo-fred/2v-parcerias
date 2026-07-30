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

/* 20% por padrão (dentro da vigência do próprio cupom, dataInicio/
   dataVencimento) — 50% só enquanto hoje estiver dentro do período
   especial configurado no grupo do cupom. Devolve também as datas de
   início/fim de qual dos dois estiver valendo. */
export function descontoAtual(parceiro, grupos) {
  const hoje = new Date().toISOString().slice(0, 10);
  const porIdGrupo = Object.fromEntries((grupos || []).map((g) => [String(g.numero), g]));
  const g = porIdGrupo[String(parceiro.grupoCupom || "")];
  if (g && g.inicio && g.fim && hoje >= g.inicio && hoje <= g.fim) {
    return { percentual: DESCONTO_ESPECIAL, inicio: g.inicio, fim: g.fim };
  }
  return { percentual: DESCONTO_PADRAO, inicio: parceiro.dataInicio || "", fim: parceiro.dataVencimento || "" };
}

/* Texto "20% até DD/MM/AAAA / 50% até DD/MM/AAAA" — mesmo formato do
   campo livre "periodoDesconto" original, só que calculado ao vivo a
   partir da vigência do cupom (20%) e do período especial do grupo
   (50%), em vez de digitado à mão. Data ausente vira o placeholder
   literal "DD/MM/AAAA", sinalizando que falta preencher. */
export function validadeCupomTexto(parceiro, grupos) {
  const porIdGrupo = Object.fromEntries((grupos || []).map((g) => [String(g.numero), g]));
  const g = porIdGrupo[String(parceiro.grupoCupom || "")];
  const fimPadrao = parceiro.dataVencimento ? formatDataBR(parceiro.dataVencimento) : "DD/MM/AAAA";
  const fimEspecial = g?.fim ? formatDataBR(g.fim) : "DD/MM/AAAA";
  return `${DESCONTO_PADRAO}% até ${fimPadrao} / ${DESCONTO_ESPECIAL}% até ${fimEspecial}`;
}
