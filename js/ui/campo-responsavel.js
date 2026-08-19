/* Campo "Responsável" da próxima ação (Fred/Manu/Laura ou nome
   personalizado) — usado em ficha-parceiro.js e parceiros-list.js,
   sempre com o mesmo comportamento: dropdown fixo + campo de texto
   que só aparece quando "Outro" é selecionado. */

import { esc } from "./dom.js";
import { fieldSelect, readValue } from "./modal.js";

const NOMES_FIXOS = ["Fred", "Manu", "Laura"];

export function fieldResponsavel(atual = "") {
  const isOutro = atual && !NOMES_FIXOS.includes(atual);
  return `
    ${fieldSelect("responsavel", "Responsável", [...NOMES_FIXOS, "Outro"], { value: isOutro ? "Outro" : atual })}
    <div class="field" data-campo-responsavel-outro style="display:${isOutro ? "block" : "none"}">
      <label for="f_responsavelOutro">Nome</label>
      <input type="text" id="f_responsavelOutro" name="responsavelOutro" value="${esc(isOutro ? atual : "")}" />
    </div>
  `;
}

export function wireResponsavelField(form) {
  const select = form.elements["responsavel"];
  const campoOutro = form.querySelector("[data-campo-responsavel-outro]");
  select.addEventListener("change", () => {
    campoOutro.style.display = select.value === "Outro" ? "block" : "none";
  });
}

export function readResponsavel(form) {
  const v = readValue(form, "responsavel");
  return v === "Outro" ? readValue(form, "responsavelOutro") : v;
}
