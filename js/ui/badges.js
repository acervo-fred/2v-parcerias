/* Helpers de badge: dado um valor de status e a lista correspondente
   (que carrega a cor de cada valor), devolve o HTML do badge.
   Se o valor não estiver na lista, cai para cinza. */

import { esc } from "./dom.js";

export function corDoValor(lista, valor, fallback = "gray") {
  if (!Array.isArray(lista)) return fallback;
  const item = lista.find((x) => (typeof x === "string" ? x : x.valor) === valor);
  return item && typeof item === "object" ? item.cor || fallback : fallback;
}

export function badge(valor, cor = "gray") {
  if (!valor) return "";
  return `<span class="badge badge--${esc(cor)}">${esc(valor)}</span>`;
}

export function badgeFromLista(lista, valor, fallback = "gray") {
  return badge(valor, corDoValor(lista, valor, fallback));
}
