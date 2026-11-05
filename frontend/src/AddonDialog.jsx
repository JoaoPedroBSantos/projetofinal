import { useEffect, useRef, useState } from "react";
import { money, Pills, Notes } from "./parts.jsx";

export default function AddonDialog({ product, onClose, onConfirm }) {
  const ref = useRef(null);
  const [sel, setSel] = useState([]);
  const [note, setNote] = useState("");
  useEffect(() => { ref.current.showModal(); }, []);
  const total = product.price_cents + product.addons.filter(a => sel.includes(a.id)).reduce((s, a) => s + a.price_cents, 0);
  const toggle = id => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  return (
    <dialog ref={ref} className="bubble" onClose={onClose} aria-labelledby="addon-title"
      onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="cart-top">
        <h2 id="addon-title">{product.name}</h2>
        <button className="close" onClick={() => ref.current.close()} aria-label="Fechar">×</button>
      </div>
      <p>Preço: <strong>{money(product.price_cents)}</strong></p>
      <Pills addons={product.addons} selected={sel} onToggle={toggle} />
      <Notes id="addon-note" value={note} onChange={setNote} />
      <p className="total">Total: {money(total)}</p>
      <button className="button" onClick={() => { onConfirm(sel, note.trim()); ref.current.close(); }}>Confirmar pedido</button>
    </dialog>
  );
}
