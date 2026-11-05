export const money = c => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function Pills({ addons, selected, onToggle }) {
  if (!addons.length) return null;
  return (
    <>
      <p className="sub">Adicionais</p>
      <div className="pills">
        {addons.map(a => {
          const on = selected.includes(a.id);
          return (
            <button type="button" key={a.id} className="pill" aria-pressed={on} disabled={!a.priced} onClick={() => onToggle(a.id)}>
              <span>{a.name} ({!a.priced ? "preço a definir" : a.price_cents ? "+" + money(a.price_cents) : "grátis"})</span>
              <b aria-hidden="true">{on ? "✓" : "+"}</b>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function Notes({ id, value, onChange }) {
  return (
    <>
      <label className="obs" htmlFor={id}>Observações</label>
      <textarea id={id} className="obs-input" maxLength={200} placeholder="Ex: Sem cebola" value={value} onChange={e => onChange(e.target.value)} />
    </>
  );
}
