/* Pedido de acesso — quem loga com o Google mas não está autorizado
   (ver authorization.js + firestore.rules) pode avisar o admin.
   Grava em accessRequests/{uid}: só o próprio usuário lê/escreve o
   próprio pedido; qualquer e-mail autorizado pode ver a fila, mas só
   o admin principal aprova/recusa (ver aprovarPedido/recusarPedido e
   a tela #/acessos). */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, getDocsFromServer, collection,
  setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, COLLECTIONS } from "../config/firebase-config.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const fdb = getFirestore(app);

export async function pedirAcesso(usuario) {
  await setDoc(doc(fdb, COLLECTIONS.accessRequests, usuario.uid), {
    email: usuario.email,
    nome: usuario.displayName || "",
    criadoEm: serverTimestamp(),
  }, { merge: true });
}

export async function minhaSolicitacao(usuario) {
  const snap = await getDoc(doc(fdb, COLLECTIONS.accessRequests, usuario.uid));
  return snap.exists() ? snap.data() : null;
}

/* ---------- admin: fila de pedidos + lista de liberados ---------- */

export async function listarPedidos() {
  const snap = await getDocsFromServer(collection(fdb, COLLECTIONS.accessRequests));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function aprovarPedido(pedido, admin) {
  await setDoc(doc(fdb, COLLECTIONS.authorizedEmails, pedido.email), {
    email: pedido.email,
    liberadoEm: serverTimestamp(),
    liberadoPor: admin.email,
  });
  await deleteDoc(doc(fdb, COLLECTIONS.accessRequests, pedido.uid));
}

export async function recusarPedido(pedido) {
  await deleteDoc(doc(fdb, COLLECTIONS.accessRequests, pedido.uid));
}

export async function listarAutorizados() {
  const snap = await getDocsFromServer(collection(fdb, COLLECTIONS.authorizedEmails));
  return snap.docs.map((d) => ({ email: d.id, ...d.data() }));
}

export async function liberarAcesso(email, admin) {
  await setDoc(doc(fdb, COLLECTIONS.authorizedEmails, email), {
    email,
    liberadoEm: serverTimestamp(),
    liberadoPor: admin.email,
  });
}

export async function revogarAcesso(email) {
  await deleteDoc(doc(fdb, COLLECTIONS.authorizedEmails, email));
}
