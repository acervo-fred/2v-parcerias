/* Kanban — guia com sub-guias (rota #/kanban/:subguia), mesmo padrão
   de parceiros-hub.js. Só despacha pra view certa, sem chrome próprio. */

import { renderKanbanPipeline } from "./kanban-pipeline.js";
import { renderProximosPassos } from "./kanban-proximos-passos.js";

export async function renderKanbanHub(app, subguia) {
  if (subguia === "proximos-passos") return renderProximosPassos(app);
  return renderKanbanPipeline(app);
}
