import { useCallback, useEffect, useRef, useState } from "react";
import { api, money } from "./api.js";

const when = iso => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const lineTotal = i => i.qty * (i.unit_price_cents + i.addons.reduce((s, a) => s + a.price_cents, 0));
const summary = o => o.items.map(i => `${i.qty}× ${i.name}`).join(", ");
const phoneFmt = p => (p.length >= 10 ? `(${p.slice(-11, -9)}) ${p.slice(-9, -4)}-${p.slice(-4)}` : p);
const deliveryLabel = value => (value === "entrega" ? "Entrega" : value === "retirada" ? "Retirada" : null);
const isScheduled = o => !!o.delivery_at;
const VIEWS = [["open", "Em andamento"], ["done", "Concluídos"], ["canceled", "Cancelados"]];
const EMPTY = { open: "Nenhum pedido em andamento. Novos pedidos aparecem aqui sozinhos.", done: "Nenhum pedido concluído ainda.", canceled: "Nenhum pedido cancelado." };

function Thumbs({ items }) {
  const shown = items.slice(0, 3);
  return (
    <span className="thumbs" aria-hidden="true">
      {shown.map(i => <img key={i.id} src={`/assets/${i.image}`} alt="" />)}
      {items.length > 3 && <span className="more">+{items.length - 3}</span>}
    </span>
  );
}

function CancelDialog({ order, onClose, onConfirm }) {
  const ref = useRef(null);
  const [lost, setLost] = useState(false);
  useEffect(() => { ref.current.showModal(); }, []);
  return (
    <dialog ref={ref} className="picker" onClose={onClose} aria-labelledby="cancel-title" onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="picker-top">
        <h2 id="cancel-title">Cancelar pedido #{order.id}?</h2>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => ref.current.close()}>×</button>
      </div>
      <p>{order.customer_name}: {summary(order)}</p>
      <label className="check"><input type="checkbox" checked={lost} onChange={e => setLost(e.target.checked)} /><span>O pedido já foi produzido: contar o custo como prejuízo</span></label>
      <p className="muted small">{lost ? "O custo dos itens entra como prejuízo no Administrativo e o estoque não volta." : "Se o produto controla estoque, as unidades voltam ao estoque."}</p>
      <div className="row">
        <button type="button" className="danger-btn solid" onClick={() => { onConfirm(order, lost); ref.current.close(); }}>Cancelar pedido</button>
        <button type="button" className="link" onClick={() => ref.current.close()}>Voltar</button>
      </div>
    </dialog>
  );
}

function Ticket({ o, onClose, onSet, onCancel, busy }) {
  return (
    <aside className="ticket" aria-label={`Pedido ${o.id}`}>
      <div className="ticket-top">
        <h2>Pedido #{o.id}</h2>
        <button type="button" className="icon-btn" aria-label="Fechar detalhes" onClick={onClose}>×</button>
      </div>
      <p className="ticket-meta">{when(o.created_at)}</p>
      {o.status === "cancelado" && <p className="cancel-note" role="status">Pedido cancelado. {o.cancel_loss ? "O custo foi contado como prejuízo." : "Nenhum custo foi contado."}</p>}
      <dl className="client">
        <div><dt>Cliente</dt><dd>{o.customer_name}</dd></div>
        <div><dt>Telefone</dt><dd><a href={`https://wa.me/55${o.customer_phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">{phoneFmt(o.customer_phone)}</a></dd></div>
      </dl>
      {(o.delivery_at || o.delivery_type || o.delivery_address || o.note) && (
        <dl className="delivery">
          {o.delivery_at && <div><dt>Agendado para</dt><dd>{when(o.delivery_at)}</dd></div>}
          {o.delivery_type && <div><dt>Forma de recebimento</dt><dd>{deliveryLabel(o.delivery_type)}</dd></div>}
          {o.delivery_address && <div className="wide"><dt>Endereço de entrega</dt><dd>{o.delivery_address}</dd></div>}
          {o.note && <div className="wide"><dt>Observação do pedido</dt><dd>{o.note}</dd></div>}
        </dl>
      )}
      <ul className="prod-list">
        {o.items.map(i => (
          <li key={i.id}>
            <img src={`/assets/${i.image}`} alt="" />
            <div>
              <strong><span className="qty">{i.qty}×</span> {i.name}</strong>
              {i.addons.length > 0 && <p className="adds">Adicionais: {i.addons.map(a => a.name).join(", ")}</p>}
              {i.note && <p className="note"><b>Observação:</b> {i.note}</p>}
            </div>
            <span className="line-total">{money(lineTotal(i))}</span>
          </li>
        ))}
      </ul>
      <p className="ticket-total"><span>Total</span><strong>{money(o.total_cents)}</strong></p>
      {o.status === "novo" ? (
        <>
          <button type="button" className="green" disabled={busy} onClick={() => onSet(o, "concluido")}>Concluir pedido</button>
          <button type="button" className="danger-btn wide" disabled={busy} onClick={() => onCancel(o)}>Cancelar pedido</button>
        </>
      ) : <button type="button" className="link" disabled={busy} onClick={() => onSet(o, "novo")}>Reabrir pedido</button>}
    </aside>
  );
}

export default function Pedidos({ onAuthError }) {
  const [view, setView] = useState("open");
  const [data, setData] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [cancelOrder, setCancelOrder] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fail = useCallback(e => (e.status === 401 ? onAuthError() : setError(e.message)), [onAuthError]);

  const load = useCallback(() => api(`/orders?status=${view}`).then(d => { setData(d); setError(""); }).catch(fail), [view, fail]);
  useEffect(() => { setData(null); setOpenId(null); load(); }, [view]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [load]);

  async function setStatus(o, status, loss = false) {
    setBusy(true);
    try {
      await api(`/orders/${o.id}`, { method: "PATCH", body: { status, loss } });
      setOpenId(id => (id === o.id ? null : id));
      setError("");
      await load();
    } catch (e) { fail(e); }
    setBusy(false);
  }

  const orders = data?.orders || [];
  const current = orders.find(o => o.id === openId);

  return (
    <>
      <h1 className="title">Pedidos</h1>
      <div className="seg" role="group" aria-label="Filtrar pedidos">
        {VIEWS.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}{data ? ` (${data.counts[id]})` : ""}</button>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className={"orders" + (current ? " with-ticket" : "")}>
        <section className="panel orders-list" aria-label="Lista de pedidos" aria-live="polite">
          {!data ? <p className="muted">Carregando...</p> : orders.length === 0 ? <p className="muted">{EMPTY[view]}</p> : (
            <ul>
              {orders.map(o => (
                <li key={o.id} className={o.id === openId ? "active" : ""}>
                  <button type="button" className="order-main" aria-pressed={o.id === openId} aria-label={`Ver detalhes do pedido ${o.id}, ${o.customer_name}`} onClick={() => setOpenId(o.id === openId ? null : o.id)}>
                    <Thumbs items={o.items} />
                    <span className="order-info">
                      <strong>#{o.id} · {o.customer_name}</strong>
                      <span className="order-items">{summary(o)}</span>
                      <span className="order-meta">
                        {when(o.created_at)} · {money(o.total_cents)}
                        {o.delivery_type ? ` · ${deliveryLabel(o.delivery_type)}` : ""}
                        {o.delivery_at ? ` · agendado ${when(o.delivery_at)}` : ""}
                        {o.status === "cancelado" && o.cancel_loss ? " · prejuízo registrado" : ""}
                      </span>
                    </span>
                    {isScheduled(o) && <span className="order-badge">Agendado</span>}
                  </button>
                  <span className="order-actions">
                    {view === "open" ? (
                      <>
                        <button type="button" className="green" disabled={busy} onClick={() => setStatus(o, "concluido")}>Concluir pedido</button>
                        <button type="button" className="danger-btn" disabled={busy} onClick={() => setCancelOrder(o)}>Cancelar</button>
                      </>
                    ) : <button type="button" className="link" disabled={busy} onClick={() => setStatus(o, "novo")}>Reabrir</button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {current && <Ticket o={current} busy={busy} onClose={() => setOpenId(null)} onSet={setStatus} onCancel={setCancelOrder} />}
      </div>
      {cancelOrder && <CancelDialog order={cancelOrder} onClose={() => setCancelOrder(null)} onConfirm={(o, lost) => setStatus(o, "cancelado", lost)} />}
    </>
  );
}
