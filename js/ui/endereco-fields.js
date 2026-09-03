/* Campos de endereço (rua / número / CEP), reaproveitados no cadastro de
   loja (backup.js) e de parceiro (cadastros.js). Ao sair do campo CEP,
   busca o logradouro oficial na ViaCEP e substitui o que estiver no campo
   Rua — evita o erro mais comum de nome de rua incompleto (ex.: "Avenida
   Nossa Senhora" faltando "de Copacabana"), que fazia o pin cair no bairro
   errado (ver geocodeEnderecoEstruturado em util/geocoding.js). */

import { buscarCep } from "../util/geocoding.js";
import { esc } from "./dom.js";

export function htmlCamposEndereco({ rua = "", numero = "", cep = "" } = {}) {
  return `
    <div class="field-3col" style="grid-template-columns:2fr 1fr 1fr">
      <div class="field">
        <label for="f_enderecoRua">Rua</label>
        <input class="input" type="text" id="f_enderecoRua" name="enderecoRua" value="${esc(rua)}" placeholder="Ex.: Avenida Nossa Senhora de Copacabana" />
      </div>
      <div class="field">
        <label for="f_enderecoNumero">Número</label>
        <input class="input" type="text" id="f_enderecoNumero" name="enderecoNumero" value="${esc(numero)}" placeholder="Ex.: 1083" />
      </div>
      <div class="field">
        <label for="f_enderecoCep">CEP</label>
        <input class="input" type="text" id="f_enderecoCep" name="enderecoCep" value="${esc(cep)}" placeholder="Ex.: 22040-001" />
      </div>
    </div>
    <div class="field-hint" data-cep-status style="margin:-6px 0 8px"></div>
  `;
}

// bairroRef: objeto mutável { atual: "" } — guarda o bairro achado na
// ViaCEP pra quem for compor o endereço completo no submit (lerEnderecoComposto).
export function wireCamposEndereco(root, bairroRef = {}) {
  const cepInput = root.querySelector('[name="enderecoCep"]');
  const ruaInput = root.querySelector('[name="enderecoRua"]');
  const status = root.querySelector("[data-cep-status]");
  if (!cepInput || !ruaInput) return;

  cepInput.addEventListener("blur", async () => {
    const cep = cepInput.value.trim();
    if (!cep) { bairroRef.atual = ""; if (status) status.textContent = ""; return; }
    if (status) status.textContent = "Buscando CEP…";
    const info = await buscarCep(cep);
    if (!info) {
      bairroRef.atual = "";
      if (status) status.textContent = "✗ CEP não encontrado — confira o número ou preencha a rua manualmente.";
      return;
    }
    if (info.logradouro) ruaInput.value = info.logradouro;
    bairroRef.atual = info.bairro || "";
    if (status) {
      status.textContent = info.logradouro
        ? `✓ ${info.logradouro}${info.bairro ? " — " + info.bairro : ""}`
        : "✓ CEP encontrado (sem logradouro específico — confira a rua).";
    }
  });
}

export function lerEnderecoComposto(root, bairroRef = {}) {
  const rua = root.querySelector('[name="enderecoRua"]')?.value.trim() || "";
  const numero = root.querySelector('[name="enderecoNumero"]')?.value.trim() || "";
  const cep = root.querySelector('[name="enderecoCep"]')?.value.trim() || "";
  const bairro = bairroRef.atual || "";
  const local = [rua, numero].filter(Boolean).join(", ") + (bairro ? ` - ${bairro}` : "");
  return { rua, numero, cep, bairro, local };
}
