/* Tela de administração de acessos — só o admin principal
   (ver ADMIN_PRINCIPAL em data/authorization.js) entra aqui. Aprova
   ou recusa pedidos de acesso (accessRequests) e gerencia direto a
   lista de e-mails liberados (authorizedEmails), sem precisar tocar
   no firestore.rules pra cada pessoa nova. Rota #/acessos. */

import { usuarioAtual, criarContaEmailSenha } from "../data/auth.js";
import { isAdminPrincipal } from "../data/authorization.js";
import {
  listarPedidos, aprovarPedido, recusarPedido,
  listarAutorizados, liberarAcesso, revogarAcesso,
} from "../data/access-requests.js";
import { esc } from "../ui/dom.js";

function gerarSenhaTemporaria() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function mensagemErroCriacaoConta(err) {
  const code = err && err.code;
  if (code === "auth/email-already-in-use") {
    return "Já existe uma conta de e-mail/senha pra esse e-mail. Se a pessoa esqueceu a senha, avise o Claude pra adicionar uma opção de redefinir.";
  }
  if (code === "auth/invalid-email") return "E-mail inválido.";
  return (err && err.message) || "Erro desconhecido.";
}

function formatData(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export async function renderAcessos(app) {
  const admin = usuarioAtual();
  if (!isAdminPrincipal(admin)) {
    app.innerHTML = `<a class="back-link" href="#/">← Voltar</a>
      <div class="empty">Esta tela é só do admin principal.</div>`;
    return;
  }

  app.innerHTML = `
    <a class="back-link" href="#/">← Voltar</a>
    <div class="page-head"><div>
      <h1 class="page-title">Acessos</h1>
      <div class="page-sub">Quem pode entrar na Plataforma 2V.</div>
    </div></div>

    <div class="chart-card" style="margin-bottom:20px">
      <h3 style="margin-bottom:12px">Pedidos pendentes</h3>
      <div id="lista-pedidos" class="muted">Carregando…</div>
    </div>

    <div class="chart-card" style="margin-bottom:20px">
      <h3 style="margin-bottom:12px">Liberar um e-mail direto</h3>
      <div style="display:flex; gap:8px">
        <input type="email" id="novo-email" class="input" placeholder="nome@exemplo.com" style="flex:1" />
        <button type="button" class="btn btn-primary" id="btn-liberar">Liberar acesso</button>
      </div>
      <div id="liberar-status" class="muted" style="font-size:13px;margin-top:8px"></div>
    </div>

    <div class="chart-card">
      <h3 style="margin-bottom:12px">Acessos liberados</h3>
      <div id="lista-autorizados" class="muted">Carregando…</div>
    </div>

    <div class="chart-card" style="margin-top:20px">
      <h3 style="margin-bottom:12px">Criar acesso por e-mail e senha</h3>
      <p class="muted" style="font-size:13px;margin-top:0">
        Alternativa ao login com Google, pra quem tem bloqueio de login corporativo (comum em contas Workspace tipo @grupotrigo.com.br).
        Gera uma senha temporária pra você compartilhar com a pessoa fora do app (WhatsApp, etc.) — ela só aparece uma vez aqui.
        Isso não libera o acesso sozinho: também cadastra o e-mail na lista "Acessos liberados" acima.
      </p>
      <div style="display:flex; gap:8px">
        <input type="email" id="conta-email" class="input" placeholder="nome@exemplo.com" style="flex:1" />
        <button type="button" class="btn btn-primary" id="btn-criar-conta">Criar conta</button>
      </div>
      <div id="conta-status" class="muted" style="font-size:13px;margin-top:8px"></div>
    </div>
  `;

  const elPedidos = app.querySelector("#lista-pedidos");
  const elAutorizados = app.querySelector("#lista-autorizados");

  async function carregarPedidos() {
    const pedidos = await listarPedidos();
    if (!pedidos.length) {
      elPedidos.innerHTML = `<span class="muted">Nenhum pedido pendente.</span>`;
      return;
    }
    elPedidos.innerHTML = pedidos.map((p) => `
      <div class="acesso-linha" data-uid="${esc(p.uid)}">
        <div>
          <strong>${esc(p.email)}</strong>${p.nome ? ` · ${esc(p.nome)}` : ""}
          <div class="muted" style="font-size:12px">${formatData(p.criadoEm)}</div>
        </div>
        <div class="acesso-acoes">
          <button type="button" class="btn btn-primary btn-sm" data-aprovar>Aprovar</button>
          <button type="button" class="btn btn-ghost btn-sm" data-recusar>Recusar</button>
        </div>
      </div>
    `).join("");

    elPedidos.querySelectorAll("[data-aprovar]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.closest(".acesso-linha").dataset.uid;
        const pedido = pedidos.find((p) => p.uid === uid);
        btn.disabled = true;
        try {
          await aprovarPedido(pedido, admin);
          await Promise.all([carregarPedidos(), carregarAutorizados()]);
        } catch (err) {
          alert("Não foi possível aprovar: " + err.message);
          btn.disabled = false;
        }
      });
    });
    elPedidos.querySelectorAll("[data-recusar]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const uid = btn.closest(".acesso-linha").dataset.uid;
        const pedido = pedidos.find((p) => p.uid === uid);
        if (!confirm(`Recusar o pedido de ${pedido.email}?`)) return;
        btn.disabled = true;
        try {
          await recusarPedido(pedido);
          await carregarPedidos();
        } catch (err) {
          alert("Não foi possível recusar: " + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  async function carregarAutorizados() {
    const lista = await listarAutorizados();
    const linhaAdmin = `
      <div class="acesso-linha">
        <div><strong>${esc(admin.email)}</strong> <span class="muted">(admin principal)</span></div>
      </div>`;
    const linhasLista = lista.map((a) => `
      <div class="acesso-linha" data-email="${esc(a.email)}">
        <div>
          <strong>${esc(a.email)}</strong>
          <div class="muted" style="font-size:12px">liberado em ${formatData(a.liberadoEm)}${a.liberadoPor ? ` por ${esc(a.liberadoPor)}` : ""}</div>
        </div>
        <div class="acesso-acoes">
          <button type="button" class="btn btn-danger btn-sm" data-revogar>Remover</button>
        </div>
      </div>
    `).join("");
    elAutorizados.innerHTML = linhaAdmin + linhasLista;

    elAutorizados.querySelectorAll("[data-revogar]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const email = btn.closest(".acesso-linha").dataset.email;
        if (!confirm(`Remover o acesso de ${email}?`)) return;
        btn.disabled = true;
        try {
          await revogarAcesso(email);
          await carregarAutorizados();
        } catch (err) {
          alert("Não foi possível remover: " + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  const liberarStatus = app.querySelector("#liberar-status");
  app.querySelector("#btn-liberar").addEventListener("click", async () => {
    const input = app.querySelector("#novo-email");
    const email = input.value.trim();
    if (!email || !email.includes("@")) {
      liberarStatus.textContent = "Digite um e-mail válido.";
      return;
    }
    liberarStatus.textContent = "Liberando…";
    try {
      await liberarAcesso(email, admin);
      input.value = "";
      liberarStatus.textContent = "✓ Liberado.";
      await carregarAutorizados();
    } catch (err) {
      liberarStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  const contaStatus = app.querySelector("#conta-status");
  app.querySelector("#btn-criar-conta").addEventListener("click", async () => {
    const input = app.querySelector("#conta-email");
    const email = input.value.trim();
    if (!email || !email.includes("@")) {
      contaStatus.textContent = "Digite um e-mail válido.";
      return;
    }
    const senha = gerarSenhaTemporaria();
    contaStatus.textContent = "Criando…";
    try {
      await criarContaEmailSenha(email, senha);
      await liberarAcesso(email, admin);
      input.value = "";
      contaStatus.innerHTML = `✓ Conta criada. Senha temporária: <code>${esc(senha)}</code> — copie e mande pra pessoa agora, ela não fica salva em nenhum lugar.`;
      await carregarAutorizados();
    } catch (err) {
      contaStatus.textContent = "✗ Erro: " + mensagemErroCriacaoConta(err);
    }
  });

  await Promise.all([carregarPedidos(), carregarAutorizados()]);
}
