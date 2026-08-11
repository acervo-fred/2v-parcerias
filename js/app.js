/* Router por hash (#/...). Cada rota renderiza uma view dentro de #app. */

import { renderProspeccao } from "./views/prospeccao.js";
import { renderParceiros } from "./views/parceiros-list.js";
import { renderFichaParceiro } from "./views/ficha-parceiro.js";
import { renderKanban } from "./views/kanban.js";
import { renderCupons } from "./views/cupons.js";
import { renderLancamentos } from "./views/lancamentos.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderBackup } from "./views/backup.js";
import { renderAcessos } from "./views/acessos.js";
import { initLojaSwitcher } from "./ui/loja-switcher.js";
import { esc } from "./ui/dom.js";
import { onAuthChange, loginComGoogle, logout } from "./data/auth.js";
import { isAdminPrincipal } from "./data/authorization.js";
import { iniciarPortaoAcesso } from "./ui/access-gate.js";

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
        await renderFichaParceiro(app, param);
        break;
      case "kanban":
        setActiveNav("kanban");
        await renderKanban(app);
        break;
      case "cupons":
        setActiveNav("cupons");
        await renderCupons(app);
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
      case "acessos":
        await renderAcessos(app);
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

/* ---------- Login (Google) ---------- */
function renderAuthBox(usuario) {
  // controla via CSS todo botão/campo marcado com .edit-only (ver
  // css/styles.css) — registrado cedo o bastante (antes do primeiro
  // router()) pra já estar certo no primeiro desenho da página
  document.body.classList.toggle("is-editor", !!usuario);
  document.body.classList.toggle("is-admin", isAdminPrincipal(usuario));

  const box = document.getElementById("auth-box");
  if (!box) return;
  if (usuario) {
    box.innerHTML = `<button class="auth-chip" id="btn-logout" title="Sair">
      ${usuario.photoURL ? `<img src="${esc(usuario.photoURL)}" class="auth-avatar" alt="" />` : ""}
      <span>${esc(usuario.email)}</span>
    </button>`;
    box.querySelector("#btn-logout").addEventListener("click", async () => {
      if (!confirm("Sair da conta?")) return;
      await logout();
      // acesso agora exige login em todas as telas — recarrega pra
      // reaparecer o portão de acesso em vez de deixar a página aberta
      // sem permissão de leitura
      location.reload();
    });
  } else {
    // rede de segurança: na prática o portão de acesso já garante que
    // ninguém chega até aqui sem estar logado com conta autorizada
    box.innerHTML = `<button class="auth-link" id="btn-login">Entrar</button>`;
    box.querySelector("#btn-login").addEventListener("click", async () => {
      try {
        await loginComGoogle();
      } catch (e) {
        console.error(e);
        alert("Não foi possível entrar. Tente de novo.");
      }
    });
  }
}
onAuthChange(renderAuthBox);

// avisa quando uma escrita no Firestore falha por falta de login/permissão
// e ninguém tratou o erro (ex.: botões de excluir, que não passam por modal)
window.addEventListener("unhandledrejection", (e) => {
  if (e.reason && e.reason.code === "permission-denied") {
    alert("Você precisa estar logado com uma conta autorizada para editar.");
    e.preventDefault();
  }
});

window.addEventListener("hashchange", router);
window.addEventListener("data-changed", router);

// O portão de acesso (Leitor/Editor) cobre a tela inteira até a pessoa
// escolher — só depois disso a página em si é montada.
await iniciarPortaoAcesso();
initLojaSwitcher();
router();
