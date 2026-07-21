/* Pequenos utilitários de DOM (sem framework). */

// Escapa texto para inserção segura via innerHTML
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Formata número como moeda BRL
export function formatMoeda(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Converte um valor digitado em formato brasileiro (milhar com ".", decimal
// com ",") pra Number — usado nos campos de faturamento, que são texto (não
// type="number") justamente pra aceitar vírgula em vez do ponto forçado
// pelo input nativo. Sem vírgula, um único "." ainda é aceito como decimal
// (compatível com o que já estava gravado no formato antigo).
export function parseNumeroBR(str) {
  const s = String(str ?? "").trim();
  if (!s) return 0;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  return Number(s) || 0;
}

// Inverso de parseNumeroBR — usado pra preencher o value= dos campos de
// faturamento ao editar um registro existente, já em formato brasileiro.
export function formatNumeroBR(n) {
  if (n === "" || n === null || n === undefined) return "";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formata data ISO (YYYY-MM-DD) como DD/MM/AAAA
export function formatDataBR(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
