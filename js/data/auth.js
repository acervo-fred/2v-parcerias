/* Login com Google (Firebase Auth) — mesmo projeto Firebase do
   Firestore (vlm-c93c2). Leitura continua livre; escrita exige uma
   das contas autorizadas nas regras do Firestore (firestore.rules).
   Esse módulo só cuida da sessão/UI de login — quem barra de verdade
   é a regra do servidor. */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
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

export async function logout() {
  await signOut(auth);
}
