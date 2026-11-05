import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { money, Pills, Notes } from "./parts.jsx";

const TZ = "America/Sao_Paulo";
const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const pad = n => String(n).padStart(2, "0");

const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const weekdayOf = value => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

const minutesOf = value => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
};

// Mesma regra do backend, para avisar antes de enviar. O backend continua
// sendo a fonte da verdade (inclusive para fusos e horários virados).
function insideHours(hours, date, time) {
  if (!hours.length || !date || !time) return true;
  const weekday = weekdayOf(date);
  const minutes = minutesOf(time);

  const openInRow = (row, previous = false) => {
    if (!row?.open || !row.open_time || !row.close_time) return false;
    const opens = minutesOf(row.open_time);
    const closes = minutesOf(row.close_time);
    if (opens === closes) return false;
    if (opens < closes) return !previous && minutes >= opens && minutes < closes;
    return previous ? minutes < closes : minutes >= opens;
  };

  if (openInRow(hours.find(h => h.weekday === weekday))) return true;
  return openInRow(hours.find(h => h.weekday === (weekday + 6) % 7), true);
}

const scheduleLabel = value =>
  value
    ? new Date(value).toLocaleString("pt-BR", {
        timeZone: TZ,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

export default function CartPage({ lines, setLines, byId, onSent }) {
  const [form, setForm] = useState({ name: "", phone: "" });
  const [whenMode, setWhenMode] = useState("now");
  const [schedule, setSchedule] = useState({ date: "", time: "", type: "retirada", address: "" });
  const [hours, setHours] = useState([]);
  const [state, setState] = useState({ busy: false, error: "", done: null });
  const unit = l => byId[l.id].price_cents + byId[l.id].addons.filter(a => l.addons.includes(a.id)).reduce((s, a) => s + a.price_cents, 0);
  const total = lines.reduce((s, l) => s + unit(l) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const patch = (key, fn) => setLines(ls => ls.flatMap(l => (l.key === key ? fn(l) : [l])));
  const selectedDay = schedule.date ? hours.find(h => h.weekday === weekdayOf(schedule.date)) : null;

  useEffect(() => {
    let alive = true;
    fetch("/api/hours")
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (alive) setHours(Array.isArray(d) ? d : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function submit(e) {
    e.preventDefault();
    setState({ busy: true, error: "", done: null });

    if (whenMode === "later") {
      if (!schedule.date || !schedule.time) {
        setState({ busy: false, error: "Escolha a data e o horário do agendamento.", done: null });
        return;
      }
      const at = new Date(`${schedule.date}T${schedule.time}:00`);
      if (Number.isNaN(at.getTime()) || at <= new Date()) {
        setState({ busy: false, error: "Escolha uma data e um horário futuros.", done: null });
        return;
      }
      if (!insideHours(hours, schedule.date, schedule.time)) {
        setState({ busy: false, error: "Escolha um horário dentro dos nossos horários de funcionamento.", done: null });
        return;
      }
    }
    if (schedule.type === "entrega" && !schedule.address.trim()) {
      setState({ busy: false, error: "Informe o endereço de entrega.", done: null });
      return;
    }

    const scheduledAt = whenMode === "later" ? `${schedule.date}T${schedule.time}:00` : null;

    try {
      const r = await fetch("/api/orders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: form,
          items: lines.map(l => ({ productId: l.id, qty: l.qty, addonIds: l.addons, note: l.note })),
          delivery_type: schedule.type,
          delivery_at: scheduledAt,
          delivery_address: schedule.type === "entrega" ? schedule.address.trim() : null,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const message = data.error
          || (typeof data.detail === "string" && data.detail)
          || "Não foi possível enviar o pedido.";
        throw new Error(message);
      }
      setState({ busy: false, error: "", done: data });
      onSent();
    } catch (err) {
      setState({ busy: false, error: err.message, done: null });
    }
  }

  return (
    <main className="container cart-page">
      <div className="cart-panel">
        <h1 className="cart-title">
          <span className="cart-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8H18a1 1 0 0 0 1-.8L20.6 8H6" /></svg>
            {count > 0 && <span className="badge">{count}</span>}
          </span>
          Meu carrinho
        </h1>

        {state.done ? (
          <>
            <p className="success" role="status">Pedido #{state.done.id} recebido! Total: {money(state.done.total_cents)}.</p>
            <p className="success" role="status">
              {state.done.delivery_at
                ? `Agendado para ${scheduleLabel(state.done.delivery_at)}.`
                : "Vamos preparar o seu pedido o quanto antes."}
            </p>
            <Link className="button" to="/#cardapio">Voltar ao cardápio</Link>
          </>
        ) : lines.length === 0 ? (
          <>
            <p>Seu carrinho está vazio.</p>
            <Link className="button" to="/#cardapio">Ver cardápio</Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {lines.map(l => (
              <div className="cart-item" key={l.key}>
                <div className="cart-line">
                  <div className="item-head">
                    <img className="thumb" src={`/assets/${byId[l.id].image}`} alt="" />
                    <div><strong>{byId[l.id].name}</strong><div>Preço: {money(unit(l))}</div></div>
                  </div>
                  <div className="quantity">
                    <button type="button" aria-label={`Diminuir quantidade de ${byId[l.id].name}`} onClick={() => patch(l.key, x => (x.qty > 1 ? [{ ...x, qty: x.qty - 1 }] : []))}>−</button>
                    <span aria-live="polite">{l.qty}</span>
                    <button type="button" aria-label={`Aumentar quantidade de ${byId[l.id].name}`} disabled={l.qty >= 50} onClick={() => patch(l.key, x => [{ ...x, qty: x.qty + 1 }])}>+</button>
                  </div>
                  <strong>{money(unit(l) * l.qty)}</strong>
                </div>
                <Pills addons={byId[l.id].addons} selected={l.addons}
                  onToggle={id => patch(l.key, x => [{ ...x, addons: x.addons.includes(id) ? x.addons.filter(a => a !== id) : [...x.addons, id] }])} />
                <Notes id={`note-${l.key}`} value={l.note} onChange={v => patch(l.key, x => [{ ...x, note: v }])} />
                <p><button type="button" className="link-btn" onClick={() => patch(l.key, () => [])}>Remover item</button></p>
              </div>
            ))}
            <p className="total">Total: {money(total)}</p>
            <label className="field">Nome
              <input required autoComplete="name" maxLength={80} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">Telefone com DDD
              <input required type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </label>

            <section className="schedule" aria-labelledby="schedule-title">
              <h2 id="schedule-title">Quando receber?</h2>
              <div className="schedule-mode" role="group" aria-label="Horário do pedido">
                <button type="button" aria-pressed={whenMode === "now"} onClick={() => setWhenMode("now")}>O quanto antes</button>
                <button type="button" aria-pressed={whenMode === "later"} onClick={() => setWhenMode("later")}>Agendar</button>
              </div>

              {whenMode === "later" && (
                <>
                  <div className="schedule-fields">
                    <label className="field">Data
                      <input type="date" required min={todayInput()} value={schedule.date} onChange={e => setSchedule({ ...schedule, date: e.target.value })} />
                    </label>
                    <label className="field">Horário
                      <input type="time" required value={schedule.time} onChange={e => setSchedule({ ...schedule, time: e.target.value })} />
                    </label>
                  </div>
                  {schedule.date && (
                    <p className="schedule-hint" role="status">
                      {selectedDay?.open
                        ? `${WEEKDAYS[selectedDay.weekday]}: atendemos das ${selectedDay.open_time} às ${selectedDay.close_time}.`
                        : `${WEEKDAYS[weekdayOf(schedule.date)]}: fechado.`}
                    </p>
                  )}
                </>
              )}

              <fieldset className="choice-group">
                <legend>Forma de recebimento</legend>
                <label className="choice">
                  <input type="radio" name="delivery-type" value="retirada" checked={schedule.type === "retirada"} onChange={() => setSchedule({ ...schedule, type: "retirada" })} />
                  Retirada
                </label>
                <label className="choice">
                  <input type="radio" name="delivery-type" value="entrega" checked={schedule.type === "entrega"} onChange={() => setSchedule({ ...schedule, type: "entrega" })} />
                  Entrega
                </label>
              </fieldset>

              {schedule.type === "entrega" && (
                <label className="field">Endereço de entrega
                  <input required maxLength={255} placeholder="Rua, número, bairro e complemento" value={schedule.address} onChange={e => setSchedule({ ...schedule, address: e.target.value })} />
                </label>
              )}
            </section>

            {state.error && <p className="error" role="alert">{state.error}</p>}
            <p><button className="button" disabled={state.busy}>{state.busy ? "Enviando..." : whenMode === "later" ? "Agendar pedido" : "Finalizar pedido"}</button></p>
          </form>
        )}
      </div>
    </main>
  );
}
