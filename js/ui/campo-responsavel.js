/* Campo "Responsável" da próxima ação — usado em ficha-parceiro.js,
   parceiros-list.js, kanban-proximos-passos.js e equipe.js, sempre com
   o mesmo comportamento: checkboxes coloridos (Fred/Manu/Laura, mesma
   cor usada na lista/calendário/mapa) + "Outro" com campo de texto
   (nomes separados por vírgula) que só aparece quando marcado. Permite
   marcar mais de um responsável pra mesma ação — cada um continua
   aparecendo no seu próprio grupo/cor em quem lista as ações. */

import { esc } from "./dom.js";
import { RESPONSAVEIS_FIXOS, COR_RESPONSAVEL } from "../data/funil.js";

export function fieldResponsavel(atuais = []) {
  const lista = Array.isArray(atuais) ? atuais : [atuais].filter(Boolean);
  const outros = lista.filter((n) => !RESPONSAVEIS_FIXOS.includes(n));
  const temOutro = outros.length > 0;
  return `
    <div class="field">
      <label>Responsável (pode marcar mais de um)</label>
      <div class="campo-responsavel-opcoes">
        ${RESPONSAVEIS_FIXOS.map((nome) => `
          <label class="campo-responsavel-opcao">
            <input type="checkbox" name="responsavelFixo" value="${esc(nome)}" ${lista.includes(nome) ? "checked" : ""} />
            <span class="pp-cor-dot pp-cor-dot--${COR_RESPONSAVEL[nome]}"></span>${esc(nome)}
          </label>
        `).join("")}
        <label class="campo-responsavel-opcao">
          <input type="checkbox" data-campo-responsavel-outro-check ${temOutro ? "checked" : ""} />
          <span class="pp-cor-dot pp-cor-dot--gray"></span>Outro
        </label>
      </div>
    </div>
    <div class="field" data-campo-responsavel-outro style="display:${temOutro ? "block" : "none"}">
      <label for="f_responsavelOutro">Nome(s) — separe por vírgula se for mais de um</label>
      <input type="text" id="f_responsavelOutro" name="responsavelOutro" value="${esc(outros.join(", "))}" />
    </div>
  `;
}

export function wireResponsavelField(form) {
  const check = form.querySelector("[data-campo-responsavel-outro-check]");
  const campoOutro = form.querySelector("[data-campo-responsavel-outro]");
  check.addEventListener("change", () => {
    campoOutro.style.display = check.checked ? "block" : "none";
  });
}

export function readResponsaveis(form) {
  const fixos = [...form.querySelectorAll('input[name="responsavelFixo"]:checked')].map((el) => el.value);
  const outroCheck = form.querySelector("[data-campo-responsavel-outro-check]");
  const outros = outroCheck?.checked
    ? (form.elements["responsavelOutro"]?.value || "").split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return [...fixos, ...outros];
}
