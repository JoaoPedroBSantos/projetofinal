import { useEffect, useMemo, useRef, useState } from "react";

import { api, money } from "./api.js";
import Produtos from "./Produtos.jsx";
import Pedidos from "./Pedidos.jsx";
import Administrativo from "./Administrativo.jsx";
import Categorias from "./Categorias.jsx";

const fold = s => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const DAYS = [["SEG", 1, "Segunda-feira"], ["TER", 2, "Terça-feira"], ["QUA", 3, "Quarta-feira"], ["QUI", 4, "Quinta-feira"], ["SEX", 5, "Sexta-feira"], ["SAB", 6, "Sábado"], ["DOM", 0, "Domingo"]];
const TABS = ["Pedidos", "Empresa", "Categorias", "Produtos", "Administrativo"];

function Login({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [state, setState] = useState({ busy: false, error: "" });
  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, error: "" });
    try { onLogin(await api("/login", { method: "POST", body: form })); }
    catch (err) { setState({ busy: false, error: err.message }); }
  }
  return (
    <main className="login">
      <form onSubmit={submit}>
        <img src="/assets/logo.png" alt="Delícias Gourmet" />
        <h1>Entrar no gerenciamento</h1>
        <label>Usuário ou e-mail<input type="text" required autoComplete="username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
        <label>Senha<input type="password" required autoComplete="current-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <button className="primary" disabled={state.busy}>{state.busy ? "Entrando..." : "Entrar"}</button>
      </form>
    </main>
  );
}

function DayHoursDialog({ day, onClose, onSaved }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(day.open);
  const [start, setStart] = useState(day.open_time);
  const [end, setEnd] = useState(day.close_time);
  const [state, setState] = useState({ busy: false, error: "" });
  const full = DAYS.find(([, wd]) => wd === day.weekday)?.[2] || "";

  useEffect(() => { ref.current.showModal(); }, []);

  async function save(e) {
    e.preventDefault();
    if (end !== "00:00" && end <= start) return setState({ busy: false, error: "O término deve ser depois do início (00:00 = meia-noite)." });
    setState({ busy: true, error: "" });
    try {
      onSaved(await api(`/days/${day.weekday}`, { method: "PUT", body: { open, open_time: start, close_time: end } }));
      ref.current.close();
    } catch (err) {
      setState({ busy: false, error: err.message });
    }
  }

  return (
    <dialog ref={ref} className="picker" onClose={onClose} aria-labelledby="hours-title"
      onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="picker-top">
        <h2 id="hours-title">Horário de {full}</h2>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => ref.current.close()}>×</button>
      </div>
      <form className="hours-form" onSubmit={save}>
        <label className="check"><input type="checkbox" checked={open} onChange={e => setOpen(e.target.checked)} /><span>Aberto neste dia</span></label>
        <div className="time-grid">
          <label>Início<input type="time" required value={start} onChange={e => setStart(e.target.value)} /></label>
          <label>Término<input type="time" required value={end} onChange={e => setEnd(e.target.value)} /></label>
        </div>
        <p className="hint">Use 00:00 no término para meia-noite. Pedidos fora do horário são recusados automaticamente.</p>
        {state.error && <p className="error" role="alert">{state.error}</p>}
        <div className="row">
          <button className="primary" disabled={state.busy}>{state.busy ? "Salvando..." : "Salvar horário"}</button>
          <button type="button" className="link" onClick={() => ref.current.close()}>Cancelar</button>
        </div>
      </form>
    </dialog>
  );
}

function Empresa({ onAuthError }) {
  const [days, setDays] = useState(null);
  const [products, setProducts] = useState(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const fail = e => (e.status === 401 ? onAuthError() : setError(e.message));

  useEffect(() => {
    Promise.all([api("/days"), api("/products")]).then(([d, p]) => { setDays(d); setProducts(p); }).catch(fail);
  }, []);

  const toggleDay = async wd => {
    const cur = days.find(d => d.weekday === wd);
    const open = !cur.open;
    setError("");
    setDays(ds => ds.map(d => (d.weekday === wd ? { ...d, open } : d)));
    try { await api(`/days/${wd}`, { method: "PUT", body: { open, open_time: cur.open_time, close_time: cur.close_time } }); }
    catch (e) { setDays(ds => ds.map(d => (d.weekday === wd ? { ...d, open: !open } : d))); fail(e); }
  };
  const toggleProduct = async id => {
    const available = !products.find(p => p.id === id).available;
    setError("");
    setProducts(ps => ps.map(p => (p.id === id ? { ...p, available } : p)));
    try { await api(`/products/${id}`, { method: "PATCH", body: { available } }); }
    catch (e) { setProducts(ps => ps.map(p => (p.id === id ? { ...p, available: !available } : p))); fail(e); }
  };

  const shown = useMemo(() => (products || []).filter(p => fold(p.name).includes(fold(q.trim()))), [products, q]);

  return (
    <>
      <h1 className="title">Gerenciamento Delícias Gourmet</h1>
      <h2 className="section-title" id="disp">Disponibilidade</h2>
      <div className="days" role="group" aria-labelledby="disp">
        {DAYS.map(([short, wd, full]) => {
          const open = days?.find(d => d.weekday === wd)?.open;
          return <button key={wd} className="day" aria-pressed={!!open} aria-label={`${full}: ${open ? "aberto" : "fechado"}`} disabled={!days} onClick={() => toggleDay(wd)}>{short}</button>;
        })}
      </div>
      <p className="hint">Dias em vinho são dias de atendimento. Pedidos só são aceitos nesses dias, dentro do horário definido.</p>

      <ul className="hours" aria-label="Horários de atendimento por dia">
        {DAYS.map(([, wd, full]) => {
          const d = days?.find(x => x.weekday === wd);
          return (
            <li key={wd} className={d && !d.open ? "closed" : ""}>
              <span>{full}</span>
              <span className="hours-time">{!d ? "…" : d.open ? `${d.open_time} – ${d.close_time}` : "Fechado"}</span>
              <button type="button" className="link" disabled={!d} onClick={() => setEditing(wd)}>Editar horário</button>
            </li>
          );
        })}
      </ul>

      <div className="search">
        <input type="search" aria-label="Pesquisar produtos" placeholder="Pesquisar produtos" value={q} onChange={e => setQ(e.target.value)} />
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M16 16l5 5" /></svg>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      <section className="panel" aria-label="Produtos" aria-live="polite">
        {!products ? <p className="muted">Carregando...</p> : shown.length === 0 ? <p className="muted">Nenhum produto encontrado.</p> : (
          <ul>
            {shown.map(p => (
              <li key={p.id}>
                <img src={`/assets/${p.image}`} alt="" />
                <div className="info"><strong>{p.name}</strong><span>{money(p.price_cents)}</span></div>
                <label className="switch">
                  <input type="checkbox" role="switch" checked={p.available} onChange={() => toggleProduct(p.id)} />
                  <span>{p.available ? "Disponível" : "Indisponível"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing !== null && days && (
        <DayHoursDialog day={days.find(d => d.weekday === editing)} onClose={() => setEditing(null)}
          onSaved={saved => setDays(ds => ds.map(d => (d.weekday === saved.weekday ? saved : d)))} />
      )}
    </>
  );
}

export default function Admin() {
  const [user, setUser] = useState(undefined);
  const [tab, setTab] = useState("Empresa");
  useEffect(() => { api("/me").then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <p className="muted pad">Carregando...</p>;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <>
      <header className="bar">
        <a className="brand" href="/" aria-label="Delícias Gourmet: voltar para a página inicial"><img src="/assets/logo.png" alt="" /></a>
        <nav aria-label="Áreas do gerenciamento">
          {TABS.map(t => <button key={t} aria-current={t === tab ? "page" : undefined} onClick={() => setTab(t)}>{t}</button>)}
          <button onClick={async () => { await api("/logout", { method: "POST" }).catch(() => {}); setUser(null); }}>Sair</button>
        </nav>
      </header>
      <main className={"wrap" + (tab === "Administrativo" ? " wide" : "")}>
        {tab === "Empresa" ? <Empresa onAuthError={() => setUser(null)} /> : tab === "Produtos" ? <Produtos onAuthError={() => setUser(null)} /> : tab === "Pedidos" ? <Pedidos onAuthError={() => setUser(null)} /> : tab === "Categorias" ? <Categorias onAuthError={() => setUser(null)} /> : tab === "Administrativo" ? <Administrativo onAuthError={() => setUser(null)} /> : (
          <><h1 className="title">{tab}</h1><p className="muted">Esta área ainda será desenvolvida.</p></>
        )}
      </main>
    </>
  );
}
