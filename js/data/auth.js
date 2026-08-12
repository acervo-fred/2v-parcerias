/* Login (Firebase Auth) — mesmo projeto Firebase do Firestore
   (vlm-c93c2). Leitura continua livre; escrita exige uma das contas
   autorizadas nas regras do Firestore (firestore.rules). Esse módulo
   só cuida da sessão/UI de login — quem barra de verdade é a regra
   do servidor (que olha só o e-mail, não importa o provedor).

   Dois jeitos de entrar:
   1) Google (padrão) — signInWithPopup.
   2) E-mail/senha — alternativa pra quem tem bloqueio de login
      corporativo no Google (comum em contas Workspace tipo
      @grupotrigo.com.br, quando o TI restringe apps de terceiros).
      Contas de e-mail/senha só existem se o admin criar uma pela
      tela #/acessos (ver criarContaEmailSenha abaixo) — não tem
      autocadastro. */

import { initializeApp, getApps, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "../config/firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

export function usuarioAtual() {
  return auth.currentUser;
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function loginComGoogle() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function loginComEmailSenha(email, senha) {
  await signInWithEmailAndPassword(auth, email, senha);
}

/* Cria uma conta de e-mail/senha SEM derrubar a sessão de quem está
   logado agora — createUserWithEmailAndPassword loga automaticamente
   como o usuário novo na instância que usar, então isso roda numa
   instância secundária descartável em vez da instância principal
   (`auth`, acima) que a página inteira depende. */
export async function criarContaEmailSenha(email, senha) {
  const appSecundario = initializeApp(firebaseConfig, "criar-conta-" + Date.now());
  const authSecundario = getAuth(appSecundario);
  try {
    await createUserWithEmailAndPassword(authSecundario, email, senha);
  } finally {
    await signOut(authSecundario).catch(() => {});
    await deleteApp(appSecundario).catch(() => {});
  }
}

export async function logout() {
  await signOut(auth);
}
