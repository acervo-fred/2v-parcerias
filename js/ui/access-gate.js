/* Portão de acesso — antes de liberar a página, pergunta se a pessoa
   quer só ler (sem login) ou editar (login Google, contas
   autorizadas). "Leitor" fica lembrado neste navegador; "Editor" não
   precisa ser lembrado à parte porque o Firebase já mantém a sessão
   entre visitas — só reaparece o portão se a sessão não existir mais
   (nunca logou, ou saiu). */

import { onAuthChange, loginComGoogle } from "../data/auth.js";

const LS_KEY = "acesso_modo";

function primeiroEstadoAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthChange((usuario) => { unsub(); resolve(usuario); });
  });
}

function montarOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "gate-overlay";
  overlay.innerHTML = `
    <div class="gate-card">
      <div class="gate-logo"><span class="side-logo-badge">2V</span> Parcerias</div>
      <h1 class="gate-titulo">Como você quer entrar?</h1>
      <div class="gate-opcoes">
        <button type="button" class="gate-opcao" data-modo="leitor">
          <span class="gate-opcao-titulo">Leitor</span>
          <span class="gate-opcao-desc">Só visualizar, sem login.</span>
        </button>
        <button type="button" class="gate-opcao" data-modo="editor">
          <span class="gate-opcao-titulo">Editor</span>
          <span class="gate-opcao-desc">Entrar com Google para editar.</span>
        </button>
      </div>
      <div class="gate-erro" style="display:none"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/* Resolve quando a pessoa pode seguir em frente (escolheu um modo
   agora, ou já tinha escolhido/logado antes). Enquanto isso, cobre a
   tela inteira — chame antes de renderizar qualquer conteúdo. */
export async function iniciarPortaoAcesso() {
  const usuario = await primeiroEstadoAuth();
  if (usuario) return; // sessão de editor já ativa
  if (localStorage.getItem(LS_KEY) === "leitor") return;

  const overlay = montarOverlay();
  const erroEl = overlay.querySelector(".gate-erro");

  return new Promise((resolve) => {
    overlay.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-modo]");
      if (!btn) return;

      if (btn.dataset.modo === "leitor") {
        localStorage.setItem(LS_KEY, "leitor");
        overlay.remove();
        resolve();
        return;
      }

      // editor
      overlay.querySelectorAll("[data-modo]").forEach((b) => (b.disabled = true));
      erroEl.style.display = "none";
      try {
        await loginComGoogle();
        overlay.remove();
        resolve();
      } catch (err) {
        console.error(err);
        erroEl.textContent = "Não foi possível entrar com o Google. Tente de novo.";
        erroEl.style.display = "block";
        overlay.querySelectorAll("[data-modo]").forEach((b) => (b.disabled = false));
      }
    });
  });
}
