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

/* Todos os períodos de 50% que valem pro cupom: o do grupo (vale pra
   todo mundo do grupo, mas só guarda UM período — o mais recente) mais
   os períodos avulsos gravados no próprio parceiro (periodos50Extra,
   [{inicio, fim}] em ISO) — histórico de ações pontuais de 50% fora do
   grupo, que não podem sobrescrever o período do grupo sem apagar o
   registro das ações anteriores. Ordenado do mais antigo pro mais novo. */
export function periodos50(parceiro, porIdGrupo) {
  const lista = [];
  const g = porIdGrupo[String(parceiro?.grupoCupom || "")];
  if (g && g.inicio && g.fim) lista.push({ inicio: g.inicio, fim: g.fim });
  for (const per of parceiro?.periodos50Extra || []) {
    if (per?.inicio && per?.fim) lista.push({ inicio: per.inicio, fim: per.fim });
  }
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/* Texto <-> lista de períodos avulsos de 50%, pro campo do modal de
   cupom: uma linha por período, "DD/MM/AAAA a DD/MM/AAAA". */
export function periodos50ExtraTexto(parceiro) {
  return (parceiro?.periodos50Extra || []).map((per) => `${formatDataBR(per.inicio)} a ${formatDataBR(per.fim)}`).join("\n");
}
export function lerPeriodos50Extra(texto) {
  const paraISO = (br) => {
    const m = br.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
  };
  const lista = [];
  for (const linha of (texto || "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const partes = linha.split(/\s+(?:a|até|-|–)\s+/i);
    const inicio = paraISO(partes[0] || "");
    const fim = paraISO(partes[1] || "");
    if (partes.length !== 2 || !inicio || !fim) throw new Error(`Período de 50% inválido: "${linha}". Use DD/MM/AAAA a DD/MM/AAAA.`);
    if (fim < inicio) throw new Error(`Período de 50% com fim antes do início: "${linha}".`);
    lista.push({ inicio, fim });
  }
  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/* 20% por padrão (dentro da vigência do próprio cupom, dataInicio/
   dataVencimento) — 50% só enquanto hoje estiver dentro de algum
   período de 50% do cupom (do grupo ou avulso, ver periodos50). Devolve também as datas de
   início/fim de qual dos dois estiver valendo. */
export function descontoAtual(parceiro, grupos) {
  const hoje = new Date().toISOString().slice(0, 10);
  const porIdGrupo = Object.fromEntries((grupos || []).map((g) => [String(g.numero), g]));
  const p50 = periodos50(parceiro, porIdGrupo).find((per) => hoje >= per.inicio && hoje <= per.fim);
  if (p50) return { percentual: DESCONTO_ESPECIAL, inicio: p50.inicio, fim: p50.fim };
  return { percentual: DESCONTO_PADRAO, inicio: parceiro.dataInicio || "", fim: parceiro.dataVencimento || "" };
}

// hoje o cupom está no período de 50% (ver descontoAtual) — usado pra
// destacar visualmente o código do cupom onde ele aparece como rótulo
export function cupomEm50(parceiro, grupos) {
  return descontoAtual(parceiro, grupos).percentual === DESCONTO_ESPECIAL;
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
  const ultimo50 = periodos50(parceiro, porIdGrupo).at(-1);
  const fimPadrao = parceiro.dataVencimento ? formatDataBR(parceiro.dataVencimento) : "DD/MM/AAAA";
  const fimEspecial = ultimo50 ? formatDataBR(ultimo50.fim) : "DD/MM/AAAA";
  return `${DESCONTO_PADRAO}% até ${fimPadrao} / ${DESCONTO_ESPECIAL}% até ${fimEspecial}`;
}
