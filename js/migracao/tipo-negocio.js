/* Migração pontual da taxonomia de "Tipo de negócio" (8 categorias
   antigas → 5 novas, mais largas). Remapeia o campo `tipo` (schema
   antigo, coleção `parceiros`) e `type` (schema novo/CRM, coleção
   `partners`) de todo mundo já cadastrado — sem isso, só o formulário
   passaria a mostrar as opções novas, mas quem já tinha um valor antigo
   gravado ficaria "órfão" da lista (não bate com nenhuma opção do
   select). Idempotente: rodar de novo depois de já migrado não muda
   nada (valor novo mapeia pra ele mesmo, exceto quando não reconhecido,
   que sempre cai em "Outro" — mesma regra tanto pra valor antigo quanto
   pra lixo/vazio). */

import { store } from "../data/store.js";

export const MAPA_TIPO_ANTIGO_PARA_NOVO = {
  "Empresas / escritórios": "Empresas, escritórios e capital privado",
  "Coworkings / consultórios compartilhados": "Empresas, escritórios e capital privado",
  "Particular": "Empresas, escritórios e capital privado",
  "Academia / bem estar": "Bem estar e saúde",
  "Escolas / cursos / educação": "Escolas e educação",
  "Hotel/Hostel": "Turismo e hospedagem",
  "Outro": "Outro",
};

export function mapearTipoNegocio(valorAntigo) {
  return MAPA_TIPO_ANTIGO_PARA_NOVO[valorAntigo] || "Outro";
}

// roda a migração de verdade: lê parceiros + partners da loja atual,
// recalcula tipo/type com mapearTipoNegocio, só grava quem realmente
// muda (evita escrita desnecessária em quem já está migrado ou já
// nasceu com a taxonomia nova). Devolve um resumo pra mostrar na tela.
export async function migrarTiposNegocio() {
  const [parceiros, partners] = await Promise.all([store.listParceiros(), store.listPartners()]);

  const porCategoria = {};
  const contar = (valor) => { porCategoria[valor] = (porCategoria[valor] || 0) + 1; };

  let parceirosAtualizados = 0;
  for (const p of parceiros) {
    const novoTipo = mapearTipoNegocio(p.tipo);
    contar(novoTipo);
    if (novoTipo !== p.tipo) {
      await store.updateParceiro(p.id, { tipo: novoTipo });
      parceirosAtualizados++;
    }
  }

  let partnersAtualizados = 0;
  for (const p of partners) {
    const novoTipo = mapearTipoNegocio(p.type);
    if (novoTipo !== p.type) {
      await store.updatePartner(p.id, { type: novoTipo });
      partnersAtualizados++;
    }
  }

  return {
    totalParceiros: parceiros.length, parceirosAtualizados,
    totalPartners: partners.length, partnersAtualizados,
    porCategoria,
  };
}
