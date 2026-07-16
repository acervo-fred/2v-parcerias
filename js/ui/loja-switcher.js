/* Seletor de loja na sidebar (abaixo do logo, onde antes era o texto
   fixo "Largo do Machado"). Cada loja é um espaço totalmente separado
   — parceiros, cupons e base de dados próprios (ver js/data/loja-atual.js
   e o escopo por lojaId em store.js/firestore.js). Trocar de loja ou
   criar uma nova recarrega a página, pra garantir que toda view releia
   os dados já filtrados pela loja certa. */

import { store } from "../data/store.js";
import { esc } from "./dom.js";
import { openModal, fieldText, readValue } from "./modal.js";
import { setLojaAtualId } from "../data/loja-atual.js";

export async function initLojaSwitcher() {
  const el = document.getElementById("loja-switcher");
  if (!el) return;

  const [lojas, atual] = await Promise.all([store.listLojas(), store.getLojaAtual()]);
  const ordenadas = [...lojas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  el.innerHTML = `
    <button type="button" class="loja-switcher-trigger" id="loja-switcher-trigger">
      <span>${esc(atual?.nome || "Selecionar loja")}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="loja-switcher-menu" id="loja-switcher-menu" hidden>
      ${ordenadas.length
        ? ordenadas.map((l) => `<button type="button" class="loja-switcher-opt ${l.id === atual?.id ? "active" : ""}" data-id="${esc(l.id)}">${esc(l.nome)}</button>`).join("")
        : `<div class="loja-switcher-empty">Nenhuma loja cadastrada ainda</div>`}
      <div class="loja-switcher-sep"></div>
      <button type="button" class="loja-switcher-opt loja-switcher-new" id="loja-switcher-nova">+ Nova loja</button>
    </div>
  `;

  const trigger = el.querySelector("#loja-switcher-trigger");
  const menu = el.querySelector("#loja-switcher-menu");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { menu.hidden = true; });

  menu.addEventListener("click", (e) => {
    const opt = e.target.closest(".loja-switcher-opt[data-id]");
    if (opt) {
      if (opt.dataset.id !== atual?.id) trocarLoja(opt.dataset.id);
      return;
    }
    if (e.target.closest("#loja-switcher-nova")) abrirNovaLoja();
  });
}

function trocarLoja(id) {
  setLojaAtualId(id);
  location.hash = "#/";
  location.reload();
}

function abrirNovaLoja() {
  openModal({
    title: "Nova loja",
    subtitle: "Cria um espaço com parceiros, cupons e base de dados totalmente separados dos demais",
    submitLabel: "Criar e acessar",
    bodyHtml: fieldText("nome", "Nome da loja", { required: true, placeholder: "Ex.: Barra da Tijuca" }),
    onSubmit: async (form) => {
      const nome = readValue(form, "nome");
      if (!nome) throw new Error("Informe o nome da loja.");
      const nova = await store.addLoja(nome);
      trocarLoja(nova.id);
    },
  });
}
