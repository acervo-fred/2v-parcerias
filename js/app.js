/* Router por hash (#/...). Cada rota renderiza uma view dentro de #app. */

import { renderParceirosHub } from "./views/parceiros-hub.js";
import { renderFichaParceiro } from "./views/ficha-parceiro.js";
import { renderKanbanHub } from "./views/kanban-hub.js";
import { renderCupons } from "./views/cupons.js";
import { renderLancamentos } from "./views/lancamentos.js";
import { renderDashboard } from "./views/dashboard.js";
import { renderBackup } from "./views/backup.js";
import { renderAcessos } from "./views/acessos.js";
import { renderEquipe } from "./views/equipe.js";
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

/* Sub-lista (Parceiros: Prospecção/Parceiros Ativos; Kanban: Pipeline/
   Próximos passos) na sidebar: fica aberta e com o item certo
   destacado sempre que a rota atual é a dela — fecha sozinha em
   qualquer outra rota. Não guarda estado próprio — é sempre derivada
   do hash atual, então nunca fica "aberta" fora do lugar depois de
   navegar embora. */
function atualizarNavSub(id, subguia) {
  const sub = document.getElementById(id);
  if (!sub) return;
  sub.classList.toggle("open", !!subguia);
  sub.querySelectorAll("[data-nav-sub]").forEach((a) =>
    a.classList.toggle("active", a.dataset.navSub === subguia)
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
    atualizarNavSub("nav-parceiros-sub", null); // fecha por padrão — os cases donos reabrem
    atualizarNavSub("nav-kanban-sub", null);
    switch (rota) {
      case "":
      case undefined:
        setActiveNav("dashboard");
        await renderDashboard(app);
        break;
      case "parceiros": {
        setActiveNav("parceiros");
        const subguia = ["prospeccao", "ativos"].includes(param) ? param : "prospeccao";
        atualizarNavSub("nav-parceiros-sub", subguia);
        await renderParceirosHub(app, subguia);
        break;
      }
      case "parceiro":
        setActiveNav("parceiros");
        atualizarNavSub("nav-parceiros-sub", "ativos");
        await renderFichaParceiro(app, param);
        break;
      case "kanban": {
        setActiveNav("kanban");
        const subguia = ["pipeline", "proximos-passos"].includes(param) ? param : "pipeline";
        atualizarNavSub("nav-kanban-sub", subguia);
        await renderKanbanHub(app, subguia);
        break;
      }
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
      case "equipe":
        setActiveNav("equipe");
        await renderEquipe(app);
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
