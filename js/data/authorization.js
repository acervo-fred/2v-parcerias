/* Quem pode acessar a Plataforma 2V. Duas camadas, iguais ao
   firestore.rules (têm que ficar em sincronia — ver função
   emailAutorizado() lá):

   1) Admin principal: e-mail fixo no código (bootstrap — sempre
      autorizado, mesmo se a coleção authorizedEmails estiver vazia
      ou ele mesmo tiver se removido dela por engano). É quem aprova
      pedidos de acesso na tela #/acessos.
   2) Coleção Firestore `authorizedEmails` (doc id = e-mail): todo
      mundo mais. Gerenciada pelo admin pela tela #/acessos — não
      precisa mais editar/republicar o firestore.rules pra liberar
      alguém novo. */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, COLLECTIONS } from "../config/firebase-config.js";

export const ADMIN_PRINCIPAL = "fredericoessinger@gmail.com";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const fdb = getFirestore(app);

export function isAdminPrincipal(usuario) {
  return !!usuario && usuario.email === ADMIN_PRINCIPAL;
}

export async function estaAutorizado(usuario) {
  if (!usuario) return false;
  if (isAdminPrincipal(usuario)) return true;
  try {
    const snap = await getDoc(doc(fdb, COLLECTIONS.authorizedEmails, usuario.email));
    return snap.exists();
  } catch (err) {
    console.error(err);
    return false;
  }
}
