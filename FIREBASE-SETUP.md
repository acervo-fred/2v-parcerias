# Ativar o Firestore no 2V Parcerias

Projeto Firebase **dedicado** a este app (separado do `giros-imagens` usado no
Acervo). Passo a passo pra criar do zero.

## Passo 1 — Criar o projeto Firebase

1. Abra o [Console do Firebase](https://console.firebase.google.com/) e clique
   em **Adicionar projeto**.
2. Dê um nome (ex.: `2v-parcerias`). Pode desativar o Google Analytics (não é
   necessário).
3. Aguarde a criação.

## Passo 2 — Criar o Firestore

1. No menu lateral do projeto: **Build → Firestore Database**.
2. Clique em **Criar banco de dados**.
3. **Local (location):** escolha **`southamerica-east1` (São Paulo)**.
   ⚠️ A região é **permanente**, não dá pra mudar depois.
4. Modo de início: **modo de teste** (vamos publicar as regras certas no passo
   seguinte).

## Passo 3 — Publicar as regras de segurança

1. Em **Firestore Database → aba "Regras"**.
2. Cole o conteúdo do arquivo [`firestore.rules`](./firestore.rules) deste
   repositório.
3. **Publicar**.

> Regras temporárias: liberam leitura/escrita sem login até 31/12/2026. Antes
> de colocar dados sensíveis de verdade, trocar pelo bloco "COM LOGIN"
> (comentado no mesmo arquivo) com Firebase Auth.

## Passo 4 — Pegar a config do app web

1. No console, clique na engrenagem (⚙) → **Configurações do projeto**.
2. Na aba **Geral**, role até **Seus apps** → clique no ícone **`</>`** (Web)
   pra registrar um app novo (ex.: nome "2v-parcerias-web").
3. Não precisa configurar Hosting nessa etapa — só **Registrar app**.
4. Copie o objeto `firebaseConfig` mostrado (algo como):
   ```js
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```
5. Me envie esse objeto (ou os 6 valores) — eu colo em
   [`js/config/firebase-config.js`](./js/config/firebase-config.js) e viro
   `USE_FIRESTORE` para `true`.

## Depois disso

Eu vou:
1. Preencher a config real no código.
2. Abrir o app uma vez e usar **⚙ Backup e dados → Popular com dados atuais**
   (rota `#/backup`) pra gravar os parceiros e lançamentos já importados da
   planilha no Firestore.
3. Publicar o commit final (local + GitHub Pages já vão estar apontando pro
   mesmo Firestore, então editar em qualquer um dos dois aparece no outro na
   próxima navegação).

## Backup periódico

Em **⚙ Backup e dados → Exportar JSON**, baixe um backup de tempos em tempos.
