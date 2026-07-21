/* ============================================================
   Consolidação de cupons compartilhados por mais de uma empresa —
   duas linhas na aba Parceiros podem usar o mesmo código de cupom
   (ex.: "PARCEIRO20" oferecido a duas empresas diferentes). Pra
   desempenho/configuração (Cupons, Dashboard) elas devem se
   comportar como um cupom só: mesmo grupo, mesmo desconto, stats
   somadas. Só a aba Parceiros continua listando cada empresa à parte.
   ============================================================ */

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
