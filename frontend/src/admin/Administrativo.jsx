import { useCallback, useEffect, useMemo, useState } from "react";
import { api, money } from "./api.js";

const TZ = "America/Sao_Paulo";
const local = iso => new Date(iso).toLocaleString("sv-SE", { timeZone: TZ }); // "AAAA-MM-DD HH:MM:SS"
const todayStr = () => local(new Date().toISOString()).slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const br = d => d.split("-").reverse().join("/");
const fold = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const num = n => n.toLocaleString("pt-BR");
const phoneFmt = p => (p.length >= 10 ? `(${p.slice(-11, -9)}) ${p.slice(-9, -4)}-${p.slice(-4)}` : p);
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const STATUS = { novo: "Em andamento", concluido: "Concluído", cancelado: "Cancelado" };
const PRESETS = [["today", "Hoje"], ["7", "7 dias"], ["30", "30 dias"], ["month", "Este mês"], ["all", "Tudo"], ["custom", "Período"]];
const METRICS = [["rev", "Faturamento"], ["profit", "Lucro"], ["loss", "Prejuízo"], ["qty", "Itens"]];
const CHARTS = [["time", "Por período"], ["top", "Mais vendidos"], ["weekday", "Dia da semana"], ["hour", "Horário"]];

const ORDER_COLS = [
  { k: "orderId", label: "Pedido", type: "num" }, { k: "day", label: "Data", type: "date", sort: "ts" }, { k: "time", label: "Hora" },
  { k: "customer", label: "Cliente" }, { k: "phone", label: "Telefone", type: "phone" }, { k: "itemsText", label: "Itens", type: "long" },
  { k: "qty", label: "Qtd", type: "num" }, { k: "rev", label: "Valor bruto", type: "money" }, { k: "cost", label: "Custo", type: "money" }, { k: "loss", label: "Prejuízo", type: "money" },
  { k: "profit", label: "Lucro líquido", type: "money" }, { k: "status", label: "Status", type: "status" },
];
const ITEM_COLS = [
  { k: "orderId", label: "Pedido", type: "num" }, { k: "day", label: "Data", type: "date", sort: "ts" }, { k: "time", label: "Hora" },
  { k: "customer", label: "Cliente" }, { k: "name", label: "Produto" }, { k: "category", label: "Categoria", type: "cat" },
  { k: "qty", label: "Qtd", type: "num" }, { k: "addons", label: "Adicionais", type: "long" }, { k: "note", label: "Observação", type: "long" },
  { k: "unit", label: "Valor unitário", type: "money" }, { k: "rev", label: "Valor bruto", type: "money" }, { k: "cost", label: "Custo", type: "money" }, { k: "loss", label: "Prejuízo", type: "money" },
  { k: "profit", label: "Lucro líquido", type: "money" }, { k: "status", label: "Status", type: "status" },
];

function range(preset, from, to) {
  const t = todayStr();
  if (preset === "today") return [t, t];
  if (preset === "7") return [addDays(t, -6), t];
  if (preset === "30") return [addDays(t, -29), t];
  if (preset === "month") return [t.slice(0, 8) + "01", t];
  if (preset === "custom") return [from || "0000-01-01", to || "9999-12-31"];
  return ["0000-01-01", "9999-12-31"];
}

function cellText(r, c) {
  const v = r[c.k] ?? "";
  if (c.type === "money") return (v / 100).toFixed(2).replace(".", ",");
  if (c.type === "date") return br(v);
  if (c.type === "status") return STATUS[v] || v;
  if (c.type === "cat") return v;
  if (c.type === "phone") return phoneFmt(String(v));
  const t = String(v);
  return c.type === "num" ? t : /^[=+\-@\t\r]/.test(t) ? "'" + t : t; // evita fórmulas vindas de texto digitado por clientes
}
function exportCsv(cols, rows, name) {
  const esc = v => `"${String(v).replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [cols.map(c => esc(c.label)), ...rows.map(r => cols.map(c => esc(cellText(r, c))))].map(a => a.join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Cell({ r, c }) {
  const v = r[c.k];
  if (c.type === "money") return <td className={"num" + ((c.k === "profit" && v < 0) || (c.k === "loss" && v > 0) ? " neg" : "")}>{money(v)}</td>;
  if (c.type === "num") return <td className="num">{v}</td>;
  if (c.type === "date") return <td>{br(v)}</td>;
  if (c.type === "phone") return <td>{phoneFmt(v)}</td>;
  if (c.type === "cat") return <td>{v}</td>;
  if (c.type === "status") return <td><span className={"chip " + v}>{STATUS[v] || v}</span></td>;
  return <td className={c.type === "long" ? "long" : ""} title={c.type === "long" ? v : undefined}>{v}</td>;
}

function VBar({ data, fmt, label, tone = "" }) {
  const W = 440, H = 230, pl = 6, pr = 6, pt = 18, pb = 30;
  const vals = data.map(d => d.value);
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals), span = max - min || 1;
  const y = v => pt + ((H - pt - pb) * (max - v)) / span;
  const bw = (W - pl - pr) / data.length, step = Math.ceil(data.length / 7);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label}>
      <text x={pl} y={11}>{fmt(max)}</text>
      <line x1={pl} x2={W - pr} y1={y(0)} y2={y(0)} className="axis" />
      {data.map((d, i) => (
        <g key={i}>
          <rect x={pl + i * bw + bw * 0.14} width={Math.max(1, bw * 0.72)} y={Math.min(y(d.value), y(0))} height={Math.abs(y(d.value) - y(0))} rx="2" className={d.value < 0 && !tone ? "bar neg" : "bar " + tone}><title>{d.label}: {fmt(d.value)}</title></rect>
          {i % step === 0 && <text x={pl + i * bw + bw / 2} y={H - 10} textAnchor="middle">{d.label}</text>}
        </g>
      ))}
    </svg>
  );
}

function HBar({ data, fmt, tone = "" }) {
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  return (
    <ol className="hbar">
      {data.map(d => (
        <li key={d.label}>
          <span className="hl" title={d.label}>{d.label}</span>
          <span className="track"><span className={"fill " + tone} style={{ width: `${(Math.max(0, d.value) / max) * 100}%` }} /></span>
          <span className="hv">{fmt(d.value)}</span>
        </li>
      ))}
    </ol>
  );
}

function makeSeries(lines, kind, val, preset, from, to) {
  if (!lines.length) return [];
  if (kind === "top") {
    const m = new Map();
    lines.forEach(l => m.set(l.name, (m.get(l.name) || 0) + val(l)));
    return [...m].map(([label, value]) => ({ label, value })).filter(d => d.value !== 0).sort((a, b) => b.value - a.value).slice(0, 8);
  }
  if (kind === "weekday") {
    const a = WEEK.map(label => ({ label, value: 0 }));
    lines.forEach(l => { a[l.wd].value += val(l); });
    return a;
  }
  if (kind === "hour") {
    const hs = lines.map(l => l.hour), lo = Math.min(...hs), hi = Math.max(...hs);
    const a = Array.from({ length: hi - lo + 1 }, (_, i) => ({ label: `${lo + i}h`, value: 0 }));
    lines.forEach(l => { a[l.hour - lo].value += val(l); });
    return a;
  }
  const days = lines.map(l => l.day).sort();
  let [start, end] = [days[0], days[days.length - 1]];
  if (preset !== "all" && preset !== "custom") [start, end] = range(preset);
  if (preset === "custom") { if (from) start = from; if (to) end = to; }
  const monthly = (new Date(end + "T12:00:00Z") - new Date(start + "T12:00:00Z")) / 864e5 > 62;
  const keys = [];
  if (monthly) {
    let [y, m] = start.slice(0, 7).split("-").map(Number);
    const [ey, em] = end.slice(0, 7).split("-").map(Number);
    while ((y < ey || (y === ey && m <= em)) && keys.length < 120) { keys.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  } else for (let d = start; d <= end && keys.length < 70; d = addDays(d, 1)) keys.push(d);
  const agg = new Map(keys.map(k => [k, 0]));
  lines.forEach(l => { const k = monthly ? l.day.slice(0, 7) : l.day; if (agg.has(k)) agg.set(k, agg.get(k) + val(l)); });
  return keys.map(k => ({ label: monthly ? `${k.slice(5)}/${k.slice(2, 4)}` : `${k.slice(8)}/${k.slice(5, 7)}`, value: agg.get(k) }));
}

export default function Administrativo({ onAuthError }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("30");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [status, setStatus] = useState("all"); const [cat, setCat] = useState("all"); const [prod, setProd] = useState("all");
  const [q, setQ] = useState("");
  const [view, setView] = useState("order");
  const [sort, setSort] = useState({ k: "day", dir: "desc" });
  const [shown, setShown] = useState(200);
  const [chart, setChart] = useState("time");
  const [metric, setMetric] = useState("rev");
  const [costView, setCostView] = useState("time");

  const load = useCallback(() => api("/sales").then(d => { setData(d); setError(""); })
    .catch(e => (e.status === 401 ? onAuthError() : setError(e.message))), [onAuthError]);
  useEffect(() => { load(); }, [load]);

  const { products, categories } = useMemo(() => {
    const items = (data?.orders || []).flatMap(o => o.items);
    return { products: [...new Set(items.map(i => i.name))].sort((a, b) => a.localeCompare(b, "pt-BR")), categories: [...new Set(items.map(i => i.category))] };
  }, [data]);

  // Uma linha por item de pedido, já com os filtros aplicados. Tudo (planilha e gráficos) deriva daqui.
  const lines = useMemo(() => {
    const [a, b] = range(preset, from, to);
    const term = fold(q.trim());
    const out = [];
    for (const o of data?.orders || []) {
      const L = local(o.created_at), day = L.slice(0, 10);
      if (day < a || day > b || (status !== "all" && o.status !== status)) continue;
      if (term && !fold(`${o.id} ${o.customer_name} ${o.customer_phone}`).includes(term)) continue;
      for (const i of o.items) {
        if ((cat !== "all" && i.category !== cat) || (prod !== "all" && i.name !== prod)) continue;
        const ap = i.addons.reduce((s, x) => s + x.price_cents, 0), ac = i.addons.reduce((s, x) => s + x.cost_cents, 0);
        const full = i.qty * (i.unit_cost_cents + ac), lost = o.status === "cancelado";
        const rev = lost ? 0 : i.qty * (i.unit_price_cents + ap), cost = lost ? 0 : full, loss = lost ? full : 0;
        out.push({ key: `${o.id}-${i.id}`, orderId: o.id, day, time: L.slice(11, 16), ts: L, hour: Number(L.slice(11, 13)), wd: new Date(day + "T12:00:00Z").getUTCDay(),
          customer: o.customer_name, phone: o.customer_phone, status: o.status, name: i.name, category: i.category_name || i.category, qty: i.qty, sold: lost ? 0 : i.qty,
          addons: i.addons.map(x => x.name).join(", "), note: i.note || "", unit: i.unit_price_cents + ap, rev, cost, loss, profit: rev - cost - loss });
      }
    }
    return out;
  }, [data, preset, from, to, status, cat, prod, q]);

  const orderRows = useMemo(() => {
    const m = new Map();
    for (const l of lines) {
      const r = m.get(l.orderId) || { key: l.orderId, orderId: l.orderId, day: l.day, time: l.time, ts: l.ts, customer: l.customer, phone: l.phone, status: l.status, items: [], qty: 0, sold: 0, rev: 0, cost: 0, loss: 0 };
      r.items.push(`${l.qty}× ${l.name}`); r.qty += l.qty; r.sold += l.sold; r.rev += l.rev; r.cost += l.cost; r.loss += l.loss;
      m.set(l.orderId, r);
    }
    return [...m.values()].map(r => ({ ...r, itemsText: r.items.join(", "), profit: r.rev - r.cost - r.loss }));
  }, [lines]);

  const cols = view === "order" ? ORDER_COLS : ITEM_COLS;
  const rows = view === "order" ? orderRows : lines;
  const sorted = useMemo(() => {
    const c = cols.find(x => x.k === sort.k) || cols[1], key = c.sort || c.k, f = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[key], y = b[key];
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true })) * f || (b.ts > a.ts ? 1 : -1);
    });
  }, [rows, cols, sort]);
  useEffect(() => setShown(200), [lines, view]);

  const totals = useMemo(() => rows.reduce((t, r) => ({ qty: t.qty + r.sold, rev: t.rev + r.rev, cost: t.cost + r.cost, loss: t.loss + r.loss, profit: t.profit + r.profit }), { qty: 0, rev: 0, cost: 0, loss: 0, profit: 0 }), [rows]);
  const kpi = useMemo(() => {
    const done = lines.filter(l => l.status === "concluido"), lost = lines.filter(l => l.status === "cancelado");
    const sum = (arr, k) => arr.reduce((s, l) => s + l[k], 0);
    const orders = new Set(done.map(l => l.orderId)).size;
    const rev = sum(done, "rev"), cost = sum(done, "cost"), loss = sum(lost, "loss");
    const below = done.filter(l => l.profit < 0);
    return { orders, qty: sum(done, "sold"), rev, cost, loss, profit: rev - cost - loss, avg: orders ? Math.round(rev / orders) : 0,
      lostOrders: new Set(lost.map(l => l.orderId)).size, belowCount: below.length, belowSum: -sum(below, "profit") };
  }, [lines]);

  const fmt = metric === "qty" ? num : money;
  const val = l => (metric === "rev" ? l.rev : metric === "profit" ? l.profit : metric === "loss" ? l.loss : l.sold);
  const chartData = useMemo(() => makeSeries(lines, chart, val, preset, from, to), [lines, chart, metric, preset, from, to]);
  const costData = useMemo(() => makeSeries(lines, costView, l => l.cost, preset, from, to), [lines, costView, preset, from, to]);
  const best = chartData.length ? chartData.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const metricName = METRICS.find(m => m[0] === metric)[1];
  const chartName = CHARTS.find(c => c[0] === chart)[1];

  const sortBy = c => setSort(s => ({ k: c.k, dir: s.k === c.k && s.dir === "desc" ? "asc" : "desc" }));

  return (
    <>
      <h1 className="title">Administrativo</h1>
      <section className="panel filters" aria-label="Filtros">
        <div className="seg" role="group" aria-label="Período">
          {PRESETS.map(([id, label]) => <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)}>{label}</button>)}
        </div>
        {preset === "custom" && <>
          <label>De<input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></label>
          <label>Até<input type="date" value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></label>
        </>}
        <label>Status
          <select value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos</option><option value="concluido">Concluídos</option><option value="cancelado">Cancelados com prejuízo</option></select>
        </label>
        <label>Categoria
          <select value={cat} onChange={e => setCat(e.target.value)}><option value="all">Todas</option>{categories.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </label>
        <label>Produto
          <select value={prod} onChange={e => setProd(e.target.value)}><option value="all">Todos</option>{products.map(p => <option key={p} value={p}>{p}</option>)}</select>
        </label>
        <label className="grow">Buscar
          <input type="search" placeholder="Cliente, telefone ou nº do pedido" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <button type="button" className="link" onClick={load}>Atualizar dados</button>
      </section>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="adm">
        <section className="panel sheet-panel" aria-label="Planilha de pedidos">
          <div className="sheet-bar">
            <div className="seg" role="group" aria-label="Agrupar planilha">
              <button type="button" aria-pressed={view === "order"} onClick={() => setView("order")}>Por pedido</button>
              <button type="button" aria-pressed={view === "item"} onClick={() => setView("item")}>Por item</button>
            </div>
            <span className="muted">{num(rows.length)} {view === "order" ? "pedidos" : "itens"}</span>
            <button type="button" className="gold" disabled={!rows.length} onClick={() => exportCsv(cols, sorted, `pedidos-${view === "order" ? "por-pedido" : "por-item"}-${todayStr()}.csv`)}>Baixar planilha (CSV)</button>
          </div>
          {!data ? <p className="muted">Carregando...</p> : rows.length === 0 ? (
            <p className="muted">Nenhum pedido com esses filtros. Amplie o período ou limpe a busca.</p>
          ) : (
            <>
              <div className="sheet" tabIndex={0} role="region" aria-label="Tabela de pedidos, role para ver mais">
                <table>
                  <thead>
                    <tr>{cols.map(c => (
                      <th key={c.k} scope="col" className={c.type === "money" || c.type === "num" ? "num" : ""} aria-sort={sort.k === c.k ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                        <button type="button" onClick={() => sortBy(c)}>{c.label}<span aria-hidden="true">{sort.k === c.k ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span></button>
                      </th>
                    ))}</tr>
                  </thead>
                  <tbody>{sorted.slice(0, shown).map(r => <tr key={r.key}>{cols.map(c => <Cell key={c.k} r={r} c={c} />)}</tr>)}</tbody>
                  <tfoot>
                    <tr>{cols.map((c, i) => i === 0 ? <td key={c.k}>Total</td> : totals[c.k] !== undefined
                      ? <td key={c.k} className="num">{c.type === "money" ? money(totals[c.k]) : num(totals[c.k])}</td> : <td key={c.k} />)}</tr>
                  </tfoot>
                </table>
              </div>
              {shown < sorted.length && <button type="button" className="link more-rows" onClick={() => setShown(n => n + 200)}>Mostrar mais ({num(sorted.length - shown)} restantes)</button>}
            </>
          )}
        </section>

        <aside className="panel charts" aria-label="Gráficos">
          <dl className="kpis">
            <div><dt>Pedidos concluídos</dt><dd>{num(kpi.orders)}</dd></div>
            <div><dt>Itens vendidos</dt><dd>{num(kpi.qty)}</dd></div>
            <div><dt>Ticket médio</dt><dd>{money(kpi.avg)}</dd></div>
            <div><dt>Faturamento</dt><dd>{money(kpi.rev)}</dd></div>
            <div><dt>Custos</dt><dd>{money(kpi.cost)}</dd></div>
            <div className="loss"><dt>Prejuízo</dt><dd>{money(kpi.loss)}</dd></div>
            <div className="wide-kpi"><dt>Lucro líquido (faturamento − custos − prejuízo)</dt><dd className={kpi.profit < 0 ? "neg" : ""}>{money(kpi.profit)}</dd></div>
          </dl>
          {kpi.lostOrders > 0 && <p className="muted small">Prejuízo: custo de {num(kpi.lostOrders)} {kpi.lostOrders === 1 ? "pedido cancelado" : "pedidos cancelados"} que já tinha(m) sido produzido(s).</p>}
          {kpi.belowCount > 0 && <p className="error small">{num(kpi.belowCount)} {kpi.belowCount === 1 ? "item vendido" : "itens vendidos"} abaixo do custo, perdendo {money(kpi.belowSum)}. Confira o preço na aba Produtos.</p>}
          {kpi.rev > 0 && kpi.cost === 0 && <p className="muted small">Os custos estão zerados, então o lucro é igual ao faturamento. Cadastre o custo de cada produto na aba Produtos.</p>}
          <div className="chart-controls">
            <label>Gráfico<select value={chart} onChange={e => setChart(e.target.value)}>{CHARTS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></label>
            <div className="seg" role="group" aria-label="Medida do gráfico">
              {METRICS.map(([id, l]) => <button key={id} type="button" aria-pressed={metric === id} onClick={() => setMetric(id)}>{l}</button>)}
            </div>
          </div>
          <h2 className="chart-title">{metricName}: {chartName.toLowerCase()}</h2>
          {chartData.length === 0 ? <p className="muted">Sem dados para mostrar com esses filtros.</p> : (
            <>
              {chart === "top"
                ? <HBar data={chartData} fmt={fmt} />
                : <VBar data={chartData} fmt={fmt} label={`${metricName} ${chartName.toLowerCase()}`} />}
              {best && best.value > 0 && <p className="muted small">Maior: {best.label} com {fmt(best.value)}. Total no gráfico: {fmt(chartData.reduce((s, d) => s + d.value, 0))}.</p>}
            </>
          )}
          <div className="sub-chart">
            <div className="sub-head">
              <h2 className="chart-title">Custos</h2>
              <span className="muted small">Total: {money(costData.reduce((s, d) => s + d.value, 0))}</span>
            </div>
            <div className="seg" role="group" aria-label="Agrupar custos">
              <button type="button" aria-pressed={costView === "time"} onClick={() => setCostView("time")}>Por período</button>
              <button type="button" aria-pressed={costView === "top"} onClick={() => setCostView("top")}>Por produto</button>
            </div>
            {costData.length === 0 || costData.every(d => d.value === 0)
              ? <p className="muted small">Sem custos para mostrar. Cadastre o custo dos produtos na aba Produtos.</p>
              : costView === "top" ? <HBar data={costData} fmt={money} tone="gold" /> : <VBar data={costData} fmt={money} tone="gold" label="Custos por período" />}
          </div>
        </aside>
      </div>
    </>
  );
}
