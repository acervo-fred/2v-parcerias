/* ============================================================
   Migração Fase 1 — funções de transformação PURAS (sem I/O).

   Recebem os dados já lidos do Firestore (parceiros/lancamentos de
   UMA loja) e devolvem os documentos do schema novo + uma lista de
   "ambiguidades" (casos que o dry-run deve mostrar pra revisão
   humana antes de qualquer gravação real). Nada aqui grava nada —
   ver migrate-ui.js pra isso.

   IDs sempre determinísticos (nunca aleatórios) — é o que torna a
   gravação idempotente (rodar de novo não duplica nada).
   ============================================================ */

import { chaveCupom, normalizarCupom } from "../util/cupom.js";

const AUTOR_MIGRACAO = "migracao-fase1";
const EMAIL_RE = /^[^\s@/,]+@[^\s@/,]+\.[^\s@/,]+$/;
const PHONE_RE = /^[\d\s()+-]{8,20}$/;

/* ---------- helpers ---------- */

// contato original nunca é perdido (fica em contactRaw); só tenta
// separar em email/telefone quando o campo bate 100% com um valor
// único — "/" ou qualquer coisa fora do padrão fica só no raw,
// sinalizado como ambiguidade (não tenta adivinhar o split).
export function separarContato(contatoOriginal) {
  const raw = (contatoOriginal || "").trim();
  const vazio = { email: null, phone: null, social: null };
  if (!raw) return { contact: vazio, contactRaw: raw, ambiguo: false };
  if (raw.includes("/")) return { contact: vazio, contactRaw: raw, ambiguo: true };
  if (EMAIL_RE.test(raw)) return { contact: { ...vazio, email: raw }, contactRaw: raw, ambiguo: false };
  if (PHONE_RE.test(raw)) return { contact: { ...vazio, phone: raw }, contactRaw: raw, ambiguo: false };
  return { contact: vazio, contactRaw: raw, ambiguo: true };
}

const MAPA_STAGE = {
  "Prospectar": "lead",
  "Enviado": "contatado",
  "Em contato": "contatado",
  "Sem resposta": "contatado",
  "Cadastrado": "negociacao",
};

export function determinarStage(parceiro) {
  if (parceiro.ehParceiro) return { stage: "ativo", ambiguo: false };
  const sp = parceiro.statusProspeccao;
  if (sp in MAPA_STAGE) return { stage: MAPA_STAGE[sp], ambiguo: false };
  return { stage: "negociacao", ambiguo: true, motivo: `statusProspeccao fora da lista oficial: "${sp}"` };
}

/* ---------- partners + interactions ---------- */

export function transformarParceiro(p, hojeISO) {
  const ambiguidades = [];
  const { stage, ambiguo: stageAmbiguo, motivo: stageMotivo } = determinarStage(p);
  if (stageAmbiguo) ambiguidades.push({ tipo: "stage", parceiroId: p.id, nome: p.nome, detalhe: stageMotivo });

  const { contact, contactRaw, ambiguo: contatoAmbiguo } = separarContato(p.contato);
  if (contatoAmbiguo && contactRaw) {
    ambiguidades.push({ tipo: "contato", parceiroId: p.id, nome: p.nome, detalhe: `contato não separado automaticamente: "${contactRaw}"` });
  }

  if (p.descontoPadrao !== undefined) {
    ambiguidades.push({ tipo: "campo-orfao", parceiroId: p.id, nome: p.nome, detalhe: `campo "descontoPadrao"=${p.descontoPadrao} não migrado (redundante com periodoDesconto)` });
  }

  const criadoEm = p.dataCadastro || hojeISO;

  const partner = {
    id: p.id,
    lojaId: p.lojaId,
    name: p.nome || "",
    type: p.tipo || "",
    area: p.area || "",
    address: p.local || "",
    contact,
    contactRaw,
    responsavel: p.responsavel || "",
    stage,
    stageUpdatedAt: criadoEm,
    nextAction: null,
    tags: [],
    archived: false,
    createdAt: criadoEm,
    createdBy: AUTOR_MIGRACAO,
    updatedAt: hojeISO,
    updatedBy: AUTOR_MIGRACAO,
    _migradoDe: `parceiros/${p.id}`,
  };

  let interacao = null;
  if ((p.observacoes || "").trim()) {
    interacao = {
      id: `int_${p.id}_obs`,
      partnerId: p.id,
      type: "nota",
      summary: p.observacoes.trim(),
      date: criadoEm,
      authorId: AUTOR_MIGRACAO,
      createdAt: hojeISO,
      _migradoDe: `parceiros/${p.id}.observacoes`,
    };
  }

  return { partner, interacao, ambiguidades };
}

/* ---------- coupons + couponPartners ---------- */

// mesma regra de agrupamento por código já usada em cupons.js
// (util/cupom.js), restrita a parceiros fechados com cupom preenchido —
// não cria cupom fantasma pra quem não tem código. SEMPRE escopada por
// loja: cupons.js nunca vê esse problema porque só opera na loja atual
// de cada vez, mas aqui os dados de todas as lojas passam juntos, e um
// código genérico (ex. "PARCEIRO20") pode coincidir por acaso entre
// lojas diferentes sem ser o mesmo cupom — achado real nos dados.
export function agruparCupons(parceirosFechados) {
  const mapa = new Map();
  for (const p of parceirosFechados) {
    if (!(p.cupom || "").trim()) continue;
    const chave = `${p.lojaId}__${chaveCupom(p)}`;
    if (!mapa.has(chave)) mapa.set(chave, { chave, cupom: p.cupom, parceiros: [] });
    mapa.get(chave).parceiros.push(p);
  }
  return [...mapa.values()];
}

// quando o mesmo código está em mais de um parceiro com campos
// divergentes (visto em dados reais: BB2V com statusCupom
// Ativo/Pausado e grupoCupom 1/3 nos dois parceiros), usa o primeiro
// da lista como representante — mesmo critério que cupons.js já usa
// pra exibir "o" grupo/desconto de um código compartilhado — e
// sinaliza a divergência pro dry-run.
export function transformarCupom(grupo, lojaId, hojeISO) {
  const ambiguidades = [];
  const rep = grupo.parceiros[0];
  const camposSync = ["statusCupom", "grupoCupom", "periodoDesconto", "dataInicio", "dataVencimento"];
  if (grupo.parceiros.length > 1) {
    for (const campo of camposSync) {
      const valores = new Set(grupo.parceiros.map((p) => JSON.stringify(p[campo] ?? null)));
      if (valores.size > 1) {
        ambiguidades.push({
          tipo: "cupom-divergente",
          cupom: grupo.cupom,
          detalhe: `${campo} diverge entre parceiros que compartilham "${grupo.cupom}" — usado o valor de "${rep.nome}"`,
        });
      }
    }
  }

  const codigoNormalizado = normalizarCupom(grupo.cupom);
  const couponId = `cp_${lojaId}_${codigoNormalizado}`;
  const grupoCupomNormalizado = rep.grupoCupom === "" || rep.grupoCupom === undefined ? null : rep.grupoCupom;

  const coupon = {
    id: couponId,
    lojaId,
    code: codigoNormalizado,
    discount: rep.periodoDesconto || "",
    status: rep.statusCupom || "",
    vigenciaInicio: rep.dataInicio || "",
    vigenciaFim: rep.dataVencimento || "",
    grupoCupom: grupoCupomNormalizado,
    campaignId: null,
    usageCount: null,
    conversionCount: null,
    createdAt: hojeISO,
    createdBy: AUTOR_MIGRACAO,
    updatedAt: hojeISO,
    updatedBy: AUTOR_MIGRACAO,
    _migradoDeParceiroIds: grupo.parceiros.map((p) => p.id),
  };

  const couponPartners = grupo.parceiros.map((p) => ({
    id: `cpn_${couponId}_${p.id}`,
    couponId,
    partnerId: p.id,
    addedAt: p.dataInicio || p.dataCadastro || hojeISO,
    createdAt: hojeISO,
    createdBy: AUTOR_MIGRACAO,
    updatedAt: hojeISO,
    updatedBy: AUTOR_MIGRACAO,
  }));

  return { coupon, couponPartners, ambiguidades };
}

/* ---------- campaigns + campaignPartners ---------- */

// agrupamento exato — validado contra dados reais, produz 7 campanhas
// pros 202 lançamentos de hoje. Casos "quase iguais mas não idênticos"
// (ex.: dois grupos do Largo do Machado com datas de fim diferentes)
// viram campanhas separadas de propósito — ver detectarCampanhasSobrepostas.
export function agruparLancamentosPorCampanha(lancamentos) {
  const mapa = new Map();
  for (const l of lancamentos) {
    const chave = `${l.lojaId}__${l.dataInicio}__${l.dataFim}__${l.periodoTipo}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        lojaId: l.lojaId, dataInicio: l.dataInicio, dataFim: l.dataFim, periodoTipo: l.periodoTipo,
        periodoLabel: l.periodoLabel || "", itens: [],
      });
    }
    mapa.get(chave).itens.push(l);
  }
  return [...mapa.values()];
}

export function transformarCampanha(grupo, parceirosPorId, hojeISO) {
  const ambiguidades = [];
  const campaignId = `cp_${grupo.lojaId}_${grupo.dataInicio}_${grupo.dataFim}_${grupo.periodoTipo}`;

  const linhasLoja = grupo.itens.filter((l) => !l.parceiroId);
  const linhasParceiro = grupo.itens.filter((l) => l.parceiroId);
  if (linhasLoja.length > 1) {
    ambiguidades.push({
      tipo: "faturamento-loja-duplicado", campaignId,
      detalhe: `${linhasLoja.length} lançamentos sem parceiro (faturamento da loja) no mesmo grupo — usado só o primeiro`,
    });
  }
  const linhaLoja = linhasLoja[0] || null;

  const status = grupo.dataFim && grupo.dataFim < hojeISO ? "encerrado" : "em_andamento";

  const campaign = {
    id: campaignId,
    lojaId: grupo.lojaId,
    title: grupo.periodoLabel,
    periodoTipo: grupo.periodoTipo,
    dataInicio: grupo.dataInicio,
    dataFim: grupo.dataFim,
    releaseDate: grupo.dataInicio,
    status,
    faturamentoLojaTotal: linhaLoja ? Number(linhaLoja.faturamentoTotal) || 0 : 0,
    faturamentoLojaDelivery: linhaLoja ? Number(linhaLoja.faturamentoDelivery) || 0 : 0,
    faturamentoLojaObservacoes: linhaLoja ? (linhaLoja.observacoes || "") : "",
    createdAt: hojeISO,
    createdBy: AUTOR_MIGRACAO,
    updatedAt: hojeISO,
    updatedBy: AUTOR_MIGRACAO,
    _migradoDeLancamentoIds: grupo.itens.map((l) => l.id),
  };

  const campaignPartners = [];
  for (const l of linhasParceiro) {
    const parceiro = parceirosPorId[l.parceiroId];
    if (!parceiro) {
      ambiguidades.push({ tipo: "parceiro-nao-encontrado", campaignId, lancamentoId: l.id, detalhe: `lançamento ${l.id} referencia parceiroId "${l.parceiroId}" que não existe mais em parceiros` });
      continue;
    }
    campaignPartners.push({
      id: `cpn_${campaignId}_${l.id}`,
      campaignId,
      partnerId: l.parceiroId,
      role: "parceiro",
      addedAt: l.dataInicio,
      quantidadeUso: Number(l.quantidadeUso) || 0,
      faturamentoCupom: Number(l.faturamentoCupom) || 0,
      faturamentoTotal: Number(l.faturamentoTotal) || 0,
      faturamentoDelivery: Number(l.faturamentoDelivery) || 0,
      observacoes: l.observacoes || "",
      cupomCodigo: parceiro.cupom || "",
      createdAt: hojeISO,
      createdBy: AUTOR_MIGRACAO,
      updatedAt: hojeISO,
      updatedBy: AUTOR_MIGRACAO,
      _migradoDeLancamentoId: l.id,
    });
  }

  return { campaign, campaignPartners, ambiguidades };
}

// sinaliza pares de campanhas da mesma loja com período sobreposto mas
// não idêntico — não bloqueia a migração, só avisa pro dry-run (achado
// real: Largo do Machado tem 01/07→10/07 e 01/07→14/07 no mesmo mês).
export function detectarCampanhasSobrepostas(campaigns) {
  const ambiguidades = [];
  const porLoja = new Map();
  for (const c of campaigns) {
    if (!porLoja.has(c.lojaId)) porLoja.set(c.lojaId, []);
    porLoja.get(c.lojaId).push(c);
  }
  for (const lista of porLoja.values()) {
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        const sobrepoe = a.dataInicio <= b.dataFim && b.dataInicio <= a.dataFim;
        if (sobrepoe) {
          ambiguidades.push({
            tipo: "campanhas-sobrepostas",
            detalhe: `"${a.title || a.id}" (${a.dataInicio}–${a.dataFim}) e "${b.title || b.id}" (${b.dataInicio}–${b.dataFim}) se sobrepõem mas viraram campanhas separadas`,
          });
        }
      }
    }
  }
  return ambiguidades;
}

/* ---------- orquestração (ainda pura — recebe tudo, devolve tudo) ---------- */

// dados: { parceiros: [...todos, de todas as lojas], lancamentos: [...todos] }
// hojeISO: string "AAAA-MM-DD" (injetada, não lida de Date aqui dentro,
// pra manter a função pura/testável e a mesma "hoje" usada em todo o dry-run).
export function transformarTudo(dados, hojeISO) {
  const parceirosPorId = Object.fromEntries(dados.parceiros.map((p) => [p.id, p]));
  const ambiguidades = [];

  const partners = [];
  const interactions = [];
  for (const p of dados.parceiros) {
    const { partner, interacao, ambiguidades: amb } = transformarParceiro(p, hojeISO);
    partners.push(partner);
    if (interacao) interactions.push(interacao);
    ambiguidades.push(...amb);
  }

  const coupons = [];
  const couponPartners = [];
  const parceirosFechados = dados.parceiros.filter((p) => p.ehParceiro);
  const gruposCupom = agruparCupons(parceirosFechados);
  for (const grupo of gruposCupom) {
    const lojaId = grupo.parceiros[0].lojaId;
    const { coupon, couponPartners: cps, ambiguidades: amb } = transformarCupom(grupo, lojaId, hojeISO);
    coupons.push(coupon);
    couponPartners.push(...cps);
    ambiguidades.push(...amb);
  }

  const campaigns = [];
  const campaignPartners = [];
  const gruposCampanha = agruparLancamentosPorCampanha(dados.lancamentos);
  for (const grupo of gruposCampanha) {
    const { campaign, campaignPartners: cps, ambiguidades: amb } = transformarCampanha(grupo, parceirosPorId, hojeISO);
    campaigns.push(campaign);
    campaignPartners.push(...cps);
    ambiguidades.push(...amb);
  }
  ambiguidades.push(...detectarCampanhasSobrepostas(campaigns));

  return {
    partners, interactions, coupons, couponPartners, campaigns, campaignPartners,
    tasks: [],
    ambiguidades,
    contagens: {
      partners: partners.length,
      interactions: interactions.length,
      coupons: coupons.length,
      couponPartners: couponPartners.length,
      campaigns: campaigns.length,
      campaignPartners: campaignPartners.length,
      tasks: 0,
    },
  };
}
