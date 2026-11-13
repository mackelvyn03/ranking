// Lê os 5 gráficos do painel "(Kelvyn) Black 2026 - Ranking automático" do SunHub (Ploomes)
// pela API e grava dados.json no mesmo formato que o ranking já usa.
// Uso: PLOOMES_USER_KEY=... node scripts/atualiza-sunhub.mjs
import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.PLOOMES_USER_KEY;
if (!KEY) { console.error("Falta o segredo PLOOMES_USER_KEY."); process.exit(1); }

const BASES = (process.env.PLOOMES_API || "https://api2.ploomes.com,https://public-api2.ploomes.com")
  .split(",").map(s => s.trim().replace(/\/$/, ""));
const FONTE = "SunHub · painel (Kelvyn) Black 2026 - Ranking automático";
const ARQ = process.env.DADOS_ARQ || "dados.json";

// Ids dos gráficos e das métricas (colunas), na ordem em que aparecem no painel.
const GRAFICOS = [
  { id: 1317871, titulo: "Black 2026 - Resultado por consultor (R$)", tipo: "tabela",
    colunas: [[1674176, "Em aberto (R$)"], [1669425, "Parados (R$)"], [1669426, "Perdidos (R$)"], [1669427, "Fechados (R$)"]] },
  { id: 1317873, titulo: "Black 2026 - Funil de venda solar em aberto (R$)", tipo: "funil", metrica: 1669431 },
  { id: 1317876, titulo: "Black 2026 - Geração compartilhada por consultor (kWh)", tipo: "tabela",
    colunas: [[1674178, "Em aberto (kWh)"], [1669436, "Parados (kWh)"], [1669437, "Perdidos (kWh)"], [1669438, "Fechados (kWh)"]] },
  { id: 1318795, titulo: "Black 2026 - O&M", tipo: "tabela",
    colunas: [[1674179, "Em aberto (kWh)"], [1670592, "Parados (kWh)"], [1670593, "Perdidos (kWh)"], [1670594, "Fechados (kWh)"]] },
  { id: 1321323, titulo: "Black 2026 - Propostas por consultor", tipo: "tabela",
    colunas: [[1674100, "Propostas montadas"]] },
];

const dormir = ms => new Promise(r => setTimeout(r, ms));

async function calcula(chartId) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    for (const base of BASES) {
      try {
        const r = await fetch(`${base}/Reports`, {
          method: "POST",
          headers: { "User-Key": KEY, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ChartId: chartId, ActivePanelsFilters: [], Timezone: "America/Sao_Paulo", ForceRefresh: true }),
        });
        const txt = await r.text();
        if (!r.ok) throw new Error(`${base} respondeu ${r.status}: ${txt.slice(0, 300)}`);
        const json = JSON.parse(txt);
        if (!Array.isArray(json.value)) throw new Error(`${base}: resposta sem "value"`);
        return json.value;
      } catch (e) { ultimoErro = e; }
    }
    await dormir(3000 * tentativa);
  }
  throw new Error(`Gráfico ${chartId}: ${ultimoErro?.message}`);
}

const valorDe = v => Number(v.AggregationValue ?? 0) || 0;
const nomeDe = v => (v.DimensionValue?.[0]?.Value ?? "").trim();
const limpaEtapa = s => s.replace(/^[^A-Za-zÀ-ú]+/, "").trim();
const arred = n => Math.round(n * 100) / 100;

function montaTabela(g, metricas) {
  const porId = new Map(metricas.map(m => [m.MetricId, m]));
  for (const [mid] of g.colunas) if (!porId.has(mid)) throw new Error(`${g.titulo}: métrica ${mid} não veio na resposta (o gráfico mudou?)`);
  const nomes = [];
  for (const [mid] of g.colunas) for (const v of porId.get(mid).Values || []) { const n = nomeDe(v); if (n && !nomes.includes(n)) nomes.push(n); }
  const linhas = nomes.map(nome => {
    const l = { consultor: nome };
    for (const [mid, col] of g.colunas) {
      const v = (porId.get(mid).Values || []).find(x => nomeDe(x) === nome);
      l[col] = v ? arred(valorDe(v)) : 0;
    }
    return l;
  });
  // mesma ordem do painel: maior valor na primeira coluna primeiro
  const c0 = g.colunas[0][1];
  linhas.sort((a, b) => b[c0] - a[c0] || a.consultor.localeCompare(b.consultor, "pt-BR"));
  return { vazio: linhas.length === 0, linhas, ok: true };
}

function montaFunil(g, metricas) {
  const m = metricas.find(x => x.MetricId === g.metrica) || metricas[0];
  if (!m) throw new Error(`${g.titulo}: sem métricas na resposta`);
  const etapas = (m.Values || []).map(v => ({ etapa: limpaEtapa(nomeDe(v)), valor: arred(valorDe(v)) }))
    .filter(e => e.etapa).sort((a, b) => b.valor - a.valor);
  return etapas.length ? { vazio: false, etapas, ok: true } : { vazio: true, ok: true };
}

const graficos = {};
for (const g of GRAFICOS) {
  const metricas = await calcula(g.id);
  graficos[g.titulo] = g.tipo === "funil" ? montaFunil(g, metricas) : montaTabela(g, metricas);
}

const novo = { fonte: FONTE, lidoEm: new Date().toISOString(), graficos };
let antigo = null;
try { antigo = JSON.parse(await readFile(ARQ, "utf8")); } catch {}
const mudou = !antigo || JSON.stringify(antigo.graficos) !== JSON.stringify(graficos);
await writeFile(ARQ, JSON.stringify(novo, null, 2) + "\n");
console.log(`${ARQ} gravado (${mudou ? "números mudaram" : "sem mudança nos números"}) · lidoEm ${novo.lidoEm}`);
for (const [t, g] of Object.entries(graficos)) console.log(`- ${t}: ${(g.linhas || g.etapas || []).length} linhas`);
