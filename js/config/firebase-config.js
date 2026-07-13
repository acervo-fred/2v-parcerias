/* ============================================================
   Configuração do Firebase — projeto dedicado ao 2V Parcerias
   (projeto Firebase separado do giros-imagens usado no Acervo).

   Para ativar: siga o FIREBASE-SETUP.md na raiz do projeto, cole
   a config do app web abaixo e troque USE_FIRESTORE para true.
   ============================================================ */

// Backend de dados.
//  false → modo LOCAL (localStorage do navegador) — dados ficam
//          salvos na máquina, sobrevivem a recarregar a página.
//  true  → Firestore — sincroniza entre qualquer dispositivo que
//          abrir o site (local ou publicado no GitHub Pages).
export const USE_FIRESTORE = false;

export const firebaseConfig = {
  apiKey: "COLOQUE_AQUI",
  authDomain: "COLOQUE_AQUI.firebaseapp.com",
  projectId: "COLOQUE_AQUI",
  storageBucket: "COLOQUE_AQUI.firebasestorage.app",
  messagingSenderId: "COLOQUE_AQUI",
  appId: "COLOQUE_AQUI",
};

/* Nomes das coleções (Firestore) + doc único de listas.
   Projeto dedicado a este app — sem prefixo, não precisa isolar
   de outro uso do mesmo Firestore. */
export const COLLECTIONS = {
  parceiros: "parceiros",
  lancamentos: "lancamentos",
  config: "config", // doc "listas" guarda todas as listas editáveis
};
