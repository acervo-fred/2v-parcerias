/* Loja selecionada no navegador — preferência de cliente, não dado do
   backend. Cada loja (venue) tem parceiros/cupons/base de dados
   totalmente separados; trocar de loja recarrega a página. */

const LS_KEY = "2v-loja-atual";

export function getLojaAtualId() {
  return localStorage.getItem(LS_KEY) || "";
}

export function setLojaAtualId(id) {
  localStorage.setItem(LS_KEY, id);
}
