/* Router por hash (#/...). Cada rota renderiza uma view dentro de #app. */

import { renderProspeccao } from "./views/prospeccao.js";
import { renderParceiros } from "./views/parceiros-list.js";
import { renderParceiro } from "./views/parceiro.js";
import { renderLancamentos } from "./views/lancamentos.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderBackup } from "./views/backup.js";
import { esc } from "./ui/dom.js";

const app = document.getElementById("app");

function setActiveNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) =>
    a.classList.toggle("active", a.dataset.nav === name)
  );
}

async function router() {
  if (!location.hash || location.hash === "#") {
    location.replace(location.pathname + "#/");
    return;
  }
  const hash = location.hash;
  const [rota, param] = hash.replace(/^#\//, "").split("/");

  window.scrollTo(0, 0);

  try {
    switch (rota) {
      case "":
      case undefined:
        setActiveNav("prospeccao");
        await renderProspeccao(app);
        break;
      case "parceiros":
        setActiveNav("parceiros");
        await renderParceiros(app);
        break;
      case "parceiro":
        setActiveNav("parceiros");
        await renderParceiro(app, param);
        break;
      case "lancamentos":
        setActiveNav("lancamentos");
        await renderLancamentos(app);
        break;
      case "dashboard":
        setActiveNav("dashboard");
        await renderDashboard(app);
        break;
      case "backup":
        await renderBackup(app);
        break;
      default:
        app.innerHTML = `<a class="back-link" href="#/">← Voltar</a>
          <div class="empty">Página não encontrada.</div>`;
    }
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="empty">Erro ao carregar a tela.<br><small>${esc(err.message)}</small></div>`;
  }
}

window.addEventListener("hashchange", router);
window.addEventListener("data-changed", router);

router();
