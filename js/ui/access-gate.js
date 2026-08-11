/* Portão de acesso — a página só libera o conteúdo pra quem loga com
   uma conta Google autorizada (ver data/authorization.js). Quem loga
   mas não está autorizado cai numa tela de "acesso não autorizado"
   com a opção de pedir acesso (grava um pedido no Firestore pro
   admin aprovar na tela #/acessos, ver views/acessos.js). */

import { onAuthChange, loginComGoogle, logout } from "../data/auth.js";
import { estaAutorizado } from "../data/authorization.js";
import { pedirAcesso, minhaSolicitacao } from "../data/access-requests.js";
import { esc } from "./dom.js";

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
      <div class="gate-corpo"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function telaLogin(corpo, { erro = "" } = {}) {
  corpo.innerHTML = `
    <h1 class="gate-titulo">Entrar</h1>
    <p class="gate-texto">Acesso restrito. Entre com uma conta Google autorizada.</p>
    <button type="button" class="btn btn-primary" id="gate-btn-login">Entrar com Google</button>
    ${erro ? `<div class="gate-erro">${esc(erro)}</div>` : ""}
  `;
}

function telaBloqueado(corpo, usuario, { enviado = false, erro = "" } = {}) {
  corpo.innerHTML = `
    <h1 class="gate-titulo">Acesso não autorizado</h1>
    <p class="gate-texto">
      <strong>${esc(usuario.email)}</strong> não está liberado pra acessar a Plataforma 2V.
    </p>
    ${enviado
      ? `<p class="gate-texto gate-texto-ok">Pedido enviado. Você será avisado quando o acesso for liberado.</p>`
      : `<button type="button" class="btn btn-primary" id="gate-btn-pedir">Pedir acesso</button>`}
    ${erro ? `<div class="gate-erro">${esc(erro)}</div>` : ""}
    <button type="button" class="btn btn-ghost btn-sm gate-sair" id="gate-btn-sair">Sair / trocar de conta</button>
  `;
}

/* Resolve quando a pessoa pode seguir em frente (já está autorizada
   agora ou já estava logada com conta autorizada). Enquanto isso,
   cobre a tela inteira — chame antes de renderizar qualquer conteúdo. */
export async function iniciarPortaoAcesso() {
  const usuario = await primeiroEstadoAuth();
  if (usuario && (await estaAutorizado(usuario))) return;

  const overlay = montarOverlay();
  const corpo = overlay.querySelector(".gate-corpo");

  return new Promise((resolve) => {
    let usuarioAtual = usuario;

    async function desenharBloqueado(usr) {
      let jaEnviado = false;
      try {
        jaEnviado = !!(await minhaSolicitacao(usr));
      } catch (err) {
        console.error(err);
      }
      telaBloqueado(corpo, usr, { enviado: jaEnviado });
    }

    async function desenhar(usr) {
      if (usr && (await estaAutorizado(usr))) {
        unsub();
        overlay.remove();
        resolve();
        return;
      }
      if (usr) {
        desenharBloqueado(usr);
      } else {
        telaLogin(corpo);
      }
    }

    corpo.addEventListener("click", async (e) => {
      if (e.target.id === "gate-btn-login") {
        e.target.disabled = true;
        try {
          await loginComGoogle();
          // onAuthChange abaixo cuida de redesenhar
        } catch (err) {
          console.error(err);
          telaLogin(corpo, { erro: "Não foi possível entrar com o Google. Tente de novo." });
        }
        return;
      }
      if (e.target.id === "gate-btn-pedir") {
        e.target.disabled = true;
        try {
          await pedirAcesso(usuarioAtual);
          telaBloqueado(corpo, usuarioAtual, { enviado: true });
        } catch (err) {
          console.error(err);
          telaBloqueado(corpo, usuarioAtual, { erro: "Não foi possível enviar o pedido. Tente de novo." });
        }
        return;
      }
      if (e.target.id === "gate-btn-sair") {
        e.target.disabled = true;
        await logout();
      }
    });

    const unsub = onAuthChange((usr) => {
      usuarioAtual = usr;
      desenhar(usr);
    });
  });
}
