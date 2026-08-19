/* Parceiros — guia com sub-guias (rota #/parceiros/:subguia). A
   navegação entre sub-guias acontece pela lista expansível na sidebar
   (ver #nav-parceiros-sub em index.html + atualizarNavParceiros em
   app.js) — este arquivo só despacha pra view certa, sem chrome
   próprio. Cada sub-guia reaproveita uma view já existente e
   autocontida, sem precisar mudar nada nela. */

import { renderProspeccao } from "./prospeccao.js";
import { renderParceiros } from "./parceiros-list.js";

export async function renderParceirosHub(app, subguia) {
  if (subguia === "ativos") return renderParceiros(app);
  return renderProspeccao(app);
}
