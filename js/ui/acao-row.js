/* Linha de uma "próxima ação" — usada tanto na Ficha do Parceiro
   (escopo de um negócio só, sem precisar mostrar o nome) quanto em
   Próximos Passos (lista global "A Fazer"/"Concluídas", onde `nome`
   do negócio é passado pra identificar de quem é cada ação). Só
   renderiza HTML; quem inclui liga os cliques via delegação
   (data-act="concluir"/"editar"/"excluir" + data-id da ação +
   data-card-id do negócio dono dela). */

import { esc, formatDataBR } from "./dom.js";
import { nivelUrgencia, responsaveisDe } from "../data/funil.js";

export function acaoRowHtml(cardId, acao, { concluida = false, nome = "" } = {}) {
  const nivel = !concluida ? nivelUrgencia(acao.dueDate) : "";
  const subPartes = [formatDataBR(acao.dueDate), responsaveisDe(acao).join(", ")];
  if (concluida && acao.concluidaEm) subPartes.push(`concluída em ${formatDataBR(acao.concluidaEm)}`);
  const sub = esc(subPartes.filter(Boolean).join(" · "));

  return `<div class="list-row acao-row${nivel ? ` acao-row--${nivel}` : ""}" data-id="${esc(acao.id)}" data-card-id="${esc(cardId)}">
    <div class="lr-main">
      ${nome ? `
        <div class="lr-title">${esc(nome)}</div>
        <div class="lr-sub${concluida ? " acao-concluida" : ""}">${esc(acao.description || "")}</div>
        <div class="lr-sub">${sub}</div>
      ` : `
        <div class="lr-title${concluida ? " acao-concluida" : ""}">${esc(acao.description || "")}</div>
        <div class="lr-sub">${sub}</div>
      `}
    </div>
    ${!concluida ? `<button type="button" class="pp-check edit-only" data-act="concluir" title="Marcar como feita"></button>` : ""}
    <span class="lr-actions edit-only">
      <button class="icon-btn" data-act="editar" title="Editar">✎</button>
      <button class="icon-btn danger" data-act="excluir" title="Excluir">🗑</button>
    </span>
  </div>`;
}
