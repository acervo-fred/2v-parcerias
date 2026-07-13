/* Backup e dados — exportar/importar JSON e migrar/popular o
   Firestore. Rota #/backup (link discreto na sidebar, não é uma
   aba principal). Mesmo propósito do admin.js da Plataforma Giros
   Imagens, enxuto pro modelo de dados do 2V (parceiros/lançamentos). */

import { store } from "../data/store.js";
import { USE_FIRESTORE } from "../config/firebase-config.js";
import * as mock from "../data/mock.js";

const LS_KEY = "2v-parcerias-db-v1";

function bundleExemplo() {
  return structuredClone({ parceiros: mock.parceiros, lancamentos: mock.lancamentos, listas: mock.listas });
}

function baixarJSON(obj, nome) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function renderBackup(app) {
  const backend = USE_FIRESTORE ? "Firestore (nuvem)" : "Local (neste navegador)";

  app.innerHTML = `
    <a class="back-link" href="#/">← Voltar</a>
    <div class="page-head"><div>
      <h1 class="page-title">Backup e dados</h1>
      <div class="page-sub">Backend atual: <strong>${backend}</strong></div>
    </div></div>

    <div class="dash-cols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="chart-card">
        <h3 style="margin-bottom:10px">Exportar backup</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Baixa um JSON com parceiros, lançamentos e listas. Faça isso periodicamente.</p>
        <button class="btn btn-primary" id="btn-export">⬇ Exportar JSON</button>
      </div>

      <div class="chart-card">
        <h3 style="margin-bottom:10px">Importar backup</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Restaura a partir de um JSON exportado. Registros são gravados pelos mesmos IDs.</p>
        <input type="file" id="file-import" accept="application/json" style="display:none" />
        <button class="btn" id="btn-import">⬆ Escolher arquivo…</button>
        <div id="import-status" class="muted" style="font-size:13px;margin-top:8px"></div>
      </div>

      <div class="chart-card">
        <h3 style="margin-bottom:10px">Migrar localStorage → Firestore</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Envia os dados salvos neste navegador para o Firestore. Use uma vez, depois de ligar USE_FIRESTORE.</p>
        <button class="btn btn-primary" id="btn-migrar">🔄 Migrar para Firestore</button>
        <div id="migrar-status" class="muted" style="font-size:13px;margin-top:8px"></div>
      </div>

      <div class="chart-card">
        <h3 style="margin-bottom:10px">Dados atuais (seed)</h3>
        <p class="muted" style="margin-top:0;font-size:13.5px">Grava o conjunto de dados atual (o já importado da planilha) no backend ativo. Sobrescreve itens de mesmo ID.</p>
        <button class="btn" id="btn-seed">Popular com dados atuais</button>
        <div id="seed-status" class="muted" style="font-size:13px;margin-top:8px"></div>
      </div>
    </div>
  `;

  app.querySelector("#btn-export").addEventListener("click", async () => {
    const dados = await store.exportAll();
    const carimbo = new Date().toISOString().slice(0, 10);
    baixarJSON({ versao: 1, exportadoEm: new Date().toISOString(), ...dados }, `2v-parcerias-backup-${carimbo}.json`);
  });

  const fileInput = app.querySelector("#file-import");
  const importStatus = app.querySelector("#import-status");
  app.querySelector("#btn-import").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (!confirm("Importar este backup? Itens com o mesmo ID serão sobrescritos.")) { fileInput.value = ""; return; }
    importStatus.textContent = "Importando…";
    try {
      const dados = JSON.parse(await file.text());
      await store.importAll(dados);
      importStatus.textContent = "✓ Importado. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      importStatus.textContent = "✗ Erro: " + err.message;
    }
    fileInput.value = "";
  });

  const migrarStatus = app.querySelector("#migrar-status");
  app.querySelector("#btn-migrar").addEventListener("click", async () => {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) { migrarStatus.textContent = "✗ Nenhum dado encontrado no localStorage."; return; }
    if (!confirm("Enviar todos os dados do localStorage para o Firestore? Itens com mesmo ID serão sobrescritos.")) return;
    migrarStatus.textContent = "Migrando…";
    try {
      const dados = JSON.parse(raw);
      await store.importAll(dados);
      migrarStatus.textContent = "✓ Migração concluída. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      migrarStatus.textContent = "✗ Erro: " + err.message;
    }
  });

  const seedStatus = app.querySelector("#seed-status");
  app.querySelector("#btn-seed").addEventListener("click", async () => {
    if (!confirm(`Gravar os dados atuais em: ${backend}?`)) return;
    seedStatus.textContent = "Gravando…";
    try {
      await store.importAll(bundleExemplo());
      seedStatus.textContent = "✓ Concluído. Recarregando…";
      setTimeout(() => { location.hash = "#/"; location.reload(); }, 600);
    } catch (err) {
      seedStatus.textContent = "✗ Erro: " + err.message;
    }
  });
}
