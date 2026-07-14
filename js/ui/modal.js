/* Framework de modal + widgets de formulário reutilizáveis.
   Um padrão único para todo cadastro/edição do sistema. */

import { esc } from "./dom.js";

const root = () => document.getElementById("modal-root");

/* Abre um modal. opts:
   - title, subtitle
   - bodyHtml: string (conteúdo do <form>)
   - submitLabel (padrão "Salvar")
   - onSubmit(formEl): pode lançar Error(msg) p/ exibir erro e não fechar;
     se resolver, o modal fecha. Pode ser async.
   - onMount(formEl): chamado após render (para hidratar widgets) */
export function openModal(opts) {
  const {
    title, subtitle = "", bodyHtml = "",
    submitLabel = "Salvar", onSubmit, onMount, wide = false,
  } = opts;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div>
          <h2>${esc(title)}</h2>
          ${subtitle ? `<div class="modal-sub">${esc(subtitle)}</div>` : ""}
        </div>
        <button class="modal-close" type="button" aria-label="Fechar">×</button>
      </div>
      <form novalidate>
        <div class="modal-body">
          <div class="form-error" style="display:none"></div>
          ${bodyHtml}
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>
    </div>`;

  root().appendChild(overlay);
  const form = overlay.querySelector("form");
  const errBox = overlay.querySelector(".form-error");

  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);

  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  overlay.querySelector(".modal-close").addEventListener("click", close);
  overlay.querySelector("[data-close]").addEventListener("click", close);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.style.display = "none";
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await onSubmit?.(form);
      close();
    } catch (err) {
      errBox.textContent = err.message || "Erro ao salvar.";
      errBox.style.display = "block";
      btn.disabled = false;
    }
  });

  onMount?.(form);
  form.querySelector("input, select, textarea")?.focus();
  return { close };
}

/* ---------- helpers de campo (HTML) ---------- */

export function fieldText(name, label, { value = "", type = "text", hint = "", required = false, placeholder = "", disabled = false } = {}) {
  return `<div class="field">
    <label for="f_${name}">${esc(label)}${required ? " *" : ""}</label>
    <input type="${type}" id="f_${name}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${disabled ? "disabled" : ""} />
    ${hint ? `<div class="field-hint">${esc(hint)}</div>` : ""}
  </div>`;
}

export function fieldTextarea(name, label, { value = "", hint = "", placeholder = "" } = {}) {
  return `<div class="field">
    <label for="f_${name}">${esc(label)}</label>
    <textarea id="f_${name}" name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>
    ${hint ? `<div class="field-hint">${esc(hint)}</div>` : ""}
  </div>`;
}

/* lista pode ser ["a","b"] ou [{valor,cor}] */
export function fieldSelect(name, label, lista, { value = "", required = false, hint = "" } = {}) {
  const opts = lista.map((it) => {
    const v = typeof it === "string" ? it : it.valor;
    return `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(v)}</option>`;
  }).join("");
  return `<div class="field">
    <label for="f_${name}">${esc(label)}${required ? " *" : ""}</label>
    <select id="f_${name}" name="${name}">${opts}</select>
    ${hint ? `<div class="field-hint">${esc(hint)}</div>` : ""}
  </div>`;
}

export function readValue(form, name) {
  const el = form.elements[name];
  return el ? el.value.trim() : "";
}
