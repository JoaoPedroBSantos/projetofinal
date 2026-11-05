import { useEffect, useMemo, useRef, useState } from "react";
import { api, money, toCents, fromCents, uploadImage } from "./api.js";

const BLANK = { name: "", category_id: "", price: "", cost: "0,00", track: false, stock: "0", available: true, featured: false, addons: [], image: "" };
const toForm = p => ({
  name: p.name, category_id: String(p.category_id), price: fromCents(p.price_cents), cost: fromCents(p.cost_cents),
  track: p.stock !== null, stock: String(p.stock ?? 0), available: p.available, featured: !!p.featured,
  addons: (p.addons || []).map(a => ({ addon_id: a.addon_id, price_cents: a.price_cents, cost_cents: a.cost_cents, priced: a.priced })),
  image: p.image,
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function Trash() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>;
}

function AddonRow({ addon, link, onToggle, onChange, onDelete, onAuth }) {
  const [price, setPrice] = useState(link?.priced ? fromCents(link.price_cents) : "");
  const [cost, setCost] = useState(link?.cost_cents ? fromCents(link.cost_cents) : "");
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setPrice(link?.priced ? fromCents(link.price_cents) : "");
    setCost(link?.cost_cents ? fromCents(link.cost_cents) : "");
  }, [link?.priced, link?.price_cents, link?.cost_cents]);

  function commitPrice() {
    if (!link) return;
    const cents = toCents(price);
    if (cents === null && price.trim() !== "") {
      setErr("Valor de venda inválido.");
      return;
    }
    setErr("");
    const isPriced = price.trim() !== "" && cents !== null;
    onChange({
      price_cents: cents ?? 0,
      cost_cents: toCents(cost) ?? link.cost_cents ?? 0,
      priced: isPriced,
    });
  }

  function commitCost() {
    if (!link) return;
    const cents = toCents(cost);
    if (cents === null && cost.trim() !== "") {
      setErr("Valor de custo inválido.");
      return;
    }
    setErr("");
    onChange({
      price_cents: toCents(price) ?? link.price_cents ?? 0,
      cost_cents: cents ?? 0,
      priced: link.priced,
    });
  }

  async function remove() {
    try {
      await api(`/addons/${addon.id}`, { method: "DELETE" });
      onDelete(addon.id);
    } catch (e) {
      e.status === 401 ? onAuth() : setErr(e.message);
      setConfirming(false);
    }
  }

  const isChecked = !!link;

  return (
    <li className="addon-row">
      <label className="check">
        <input type="checkbox" checked={isChecked} onChange={onToggle} />
        <span>{addon.name}</span>
      </label>
      {isChecked && (
        <>
          <label className="addon-price">
            <span className="sr">Valor de {addon.name}</span>
            R$ <input
              inputMode="decimal"
              placeholder="0,00"
              value={price}
              onChange={e => setPrice(e.target.value)}
              onBlur={commitPrice}
            />
          </label>
          <label className="addon-price">
            <span className="sr">Custo de {addon.name}</span>
            Custo R$ <input
              inputMode="decimal"
              placeholder="0,00"
              value={cost}
              onChange={e => setCost(e.target.value)}
              onBlur={commitCost}
            />
          </label>
        </>
      )}
      {confirming ? (
        <span className="confirm" role="alert">
          Excluir de todos os produtos?
          <button type="button" className="link danger" onClick={remove}>Excluir</button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>Cancelar</button>
        </span>
      ) : (
        <button type="button" className="icon-btn" aria-label={`Excluir adicional ${addon.name}`} onClick={() => setConfirming(true)}><Trash /></button>
      )}
      {(err || (isChecked && !link.priced)) && (
        <small className={err ? "error" : "muted"}>{err || "Defina o valor para aparecer ao cliente."}</small>
      )}
    </li>
  );
}

function AddonPicker({ productName, addons, setAddons, selected, setSelected, suggestions = new Set(), categoryName, onDeleted, onClose, onAuth }) {
  const ref = useRef(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "" });
  const [err, setErr] = useState("");
  useEffect(() => { ref.current.showModal(); }, []);

  async function create(e) {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name) return setErr("Informe o nome do adicional.");
    try {
      const a = await api("/addons", { method: "POST", body: { name } });
      setAddons(list => [...list, a]);
      setSelected(list => [...list, { addon_id: a.id, price_cents: 0, cost_cents: 0, priced: false }]);
      setDraft({ name: "" });
      setErr("");
      setCreating(false);
    } catch (e2) {
      e2.status === 401 ? onAuth() : setErr(e2.message);
    }
  }

  const suggested = addons.filter(a => suggestions.has(a.id));
  const others = addons.filter(a => !suggestions.has(a.id));
  const row = a => {
    const link = selected.find(s => s.addon_id === a.id);
    return (
      <AddonRow
        key={a.id}
        addon={a}
        link={link}
        onAuth={onAuth}
        onToggle={() => {
          if (link) {
            setSelected(list => list.filter(s => s.addon_id !== a.id));
          } else {
            setSelected(list => [...list, { addon_id: a.id, price_cents: 0, cost_cents: 0, priced: false }]);
          }
        }}
        onChange={patch => {
          setSelected(list => list.map(s => s.addon_id === a.id ? { ...s, ...patch } : s));
        }}
        onDelete={id => {
          setAddons(list => list.filter(x => x.id !== id));
          onDeleted(id);
        }}
      />
    );
  };

  return (
    <dialog ref={ref} className="picker" onClose={onClose} aria-labelledby="picker-title"
      onClick={e => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="picker-top">
        <h2 id="picker-title">Adicionais de {productName || "novo produto"}</h2>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={() => ref.current.close()}>×</button>
      </div>
      <p className="muted">Marque os adicionais deste produto e defina o valor/custo.</p>
      <div className="addon-groups">
        <section className="addon-group" aria-labelledby="suggested-title">
          <h3 id="suggested-title">Sugestões{categoryName ? ` · ${categoryName}` : ""}</h3>
          <p className="muted small">Adicionais já usados em outros produtos da mesma categoria.</p>
          <ul className="addon-list">
            {suggested.length === 0
              ? <li className="muted">Nenhum adicional sugerido para esta categoria ainda.</li>
              : suggested.map(row)}
          </ul>
        </section>
        <section className="addon-group" aria-labelledby="existing-title">
          <h3 id="existing-title">Adicionais existentes</h3>
          <p className="muted small">{suggested.length ? "Todos os demais adicionais já cadastrados." : "Todos os adicionais já cadastrados."}</p>
          <ul className="addon-list">
            {others.length === 0
              ? <li className="muted">{addons.length ? "Todos os adicionais já aparecem nas sugestões." : "Nenhum adicional criado ainda."}</li>
              : others.map(row)}
          </ul>
        </section>
      </div>
      {creating ? (
        <form className="addon-new" onSubmit={create}>
          <label>Nome do adicional<input autoFocus maxLength={60} value={draft.name} onChange={e => setDraft({ name: e.target.value })} /></label>
          <div className="row">
            <button className="primary small">Criar adicional</button>
            <button type="button" className="link" onClick={() => { setCreating(false); setErr(""); }}>Cancelar</button>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
        </form>
      ) : (
        <button type="button" className="round-add with-label" onClick={() => setCreating(true)}><b aria-hidden="true">+</b> Criar novo adicional</button>
      )}
      <button type="button" className="primary" onClick={() => ref.current.close()}>Concluir</button>
    </dialog>
  );
}

function Card({ p, active, onEdit }) {
  return (
    <article className={"pcard" + (active ? " active" : "") + (p.available ? "" : " off")}>
      <img src={`/assets/${p.image}`} alt="" />
      <div className="pcard-cap">
        <div><strong>{p.name}</strong><span>{money(p.price_cents)}</span></div>
        <button type="button" className="edit" aria-label={`Editar ${p.name}`} aria-pressed={active} onClick={onEdit}>EDITAR</button>
      </div>
    </article>
  );
}

export default function Produtos({ onAuthError }) {
  const [products, setProducts] = useState(null);
  const [addons, setAddons] = useState([]);
  const [categories, setCategories] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [sel, setSel] = useState(null);          // id | "new" | null
  const [form, setForm] = useState(BLANK);
  const [base, setBase] = useState(BLANK);
  const [picker, setPicker] = useState(false);
  const [status, setStatus] = useState({ busy: false, error: "", ok: "" });
  const editor = useRef(null);
  const fail = e => (e.status === 401 ? onAuthError() : setStatus({ busy: false, error: e.message, ok: "" }));

  useEffect(() => {
    Promise.all([api("/products"), api("/addons"), api("/categories")])
      .then(([p, a, c]) => { setProducts(p); setAddons(a); setCategories(c); }).catch(fail);
  }, []);

  const dirty = !same(form, base);
  const guard = () => !dirty || window.confirm("Você tem alterações não salvas. Descartar?");
  const open = (id, f) => { setSel(id); setForm(f); setBase(f); setStatus({ busy: false, error: "", ok: "" }); setTimeout(() => editor.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 0); };
  const edit = p => { if (p.id !== sel && guard()) open(p.id, toForm(p)); };
  const startNew = () => {
    if (!guard()) return;
    const first = categories[0];
    open("new", { ...BLANK, category_id: first ? String(first.id) : "" });
  };

  const current = products?.find(p => p.id === sel);
  const suggestionIds = useMemo(() => {
    const categoryId = Number(form.category_id);
    if (!categoryId) return new Set();
    const ids = new Set();
    for (const product of products || []) {
      if (product.category_id !== categoryId) continue;
      // Ao editar, o próprio produto não "sugere" os adicionais que já tem.
      if (sel !== "new" && product.id === sel) continue;
      for (const a of (product.addons || [])) {
        ids.add(typeof a === "object" ? a.addon_id : a);
      }
      for (const aId of (product.addonIds || [])) {
        ids.add(aId);
      }
    }
    return ids;
  }, [products, form.category_id, sel]);
  const categoryName = categories.find(c => c.id === Number(form.category_id))?.name;
  const priceC = toCents(form.price), costC = toCents(form.cost);
  const unitProfit = priceC !== null && costC !== null ? priceC - costC : null;
  const stats = current?.stats;
  const set = k => e => setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault();
    if (priceC === null) return setStatus({ busy: false, error: "Informe um preço válido.", ok: "" });
    if (costC === null) return setStatus({ busy: false, error: "Informe um custo válido.", ok: "" });
    if (!form.image) return setStatus({ busy: false, error: "Escolha a foto do produto.", ok: "" });
    if (!form.category_id) return setStatus({ busy: false, error: "Escolha a categoria do produto.", ok: "" });
    const stock = form.track ? Number(form.stock) : null;
    if (form.track && !(Number.isInteger(stock) && stock >= 0)) return setStatus({ busy: false, error: "O estoque deve ser um número inteiro.", ok: "" });
    setStatus({ busy: true, error: "", ok: "" });
    const body = {
      name: form.name,
      category_id: Number(form.category_id),
      price_cents: priceC,
      cost_cents: costC,
      stock,
      available: form.available,
      featured: form.featured,
      addons: form.addons,
      addonIds: form.addons.map(a => a.addon_id),
      image: form.image,
    };
    try {
      const saved = sel === "new" ? await api("/products", { method: "POST", body }) : await api(`/products/${sel}`, { method: "PUT", body });
      setProducts(ps => (sel === "new" ? [...ps, saved] : ps.map(p => (p.id === saved.id ? saved : p))));
      const f = toForm(saved);
      setSel(saved.id); setForm(f); setBase(f);
      setStatus({ busy: false, error: "", ok: sel === "new" ? "Produto adicionado." : "Alterações salvas." });
    } catch (err) { fail(err); }
  }

  const removeAddonEverywhere = id => {
    setProducts(ps => ps.map(p => ({
      ...p,
      addons: (p.addons || []).filter(x => (typeof x === "object" ? x.addon_id : x) !== id),
      addonIds: (p.addonIds || []).filter(x => x !== id),
    })));
    const strip = f => ({ ...f, addons: f.addons.filter(x => x.addon_id !== id) });
    setForm(strip); setBase(strip);
  };

  const chosen = form.addons.map(link => {
    const a = addons.find(x => x.id === link.addon_id);
    return a ? { ...a, price_cents: link.price_cents, cost_cents: link.cost_cents, priced: link.priced } : null;
  }).filter(Boolean);
  async function pickPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStatus({ busy: false, error: "", ok: "" }); setUploading(true);
    try { const { image } = await uploadImage(file); setForm(f => ({ ...f, image })); }
    catch (err) { fail(err); }
    setUploading(false);
  }
  const previewImg = form.image;

  return (
    <>
      <h1 className="title">Gerenciamento Delícias Gourmet</h1>
      <section className="panel big" aria-label="Produtos">
        {!products ? <p className="muted">Carregando...</p> : (
          <>
            <div className="pgrid">{products.map(p => <Card key={p.id} p={p} active={p.id === sel} onEdit={() => edit(p)} />)}</div>

            {sel === null ? (
              <div className="empty">
                <p className="muted">Escolha um produto em “Editar” para alterar preço, adicionais e estoque.</p>
                <button type="button" className="gold" onClick={startNew}>ADICIONAR PRODUTO <b aria-hidden="true">+</b></button>
              </div>
            ) : (
              <div className="editor" ref={editor}>
                {(
                  <div className="pcard preview">
                    {previewImg ? <img src={`/assets/${previewImg}`} alt="" /> : <div className="no-photo">Sem foto</div>}
                    <div className="pcard-cap"><div><strong>{form.name || "Novo produto"}</strong><span>{priceC !== null ? money(priceC) : "—"}</span></div></div>
                  </div>
                )}
                <form className="box" onSubmit={save} noValidate>
                  <h2>{sel === "new" ? "Novo produto" : `Editando: ${current.name}`}</h2>
                  <div className="fields">
                    <label className="f-name">Nome do produto<input required maxLength={80} value={form.name} onChange={set("name")} /></label>
                    <label>Categoria
                      <select required value={form.category_id} onChange={set("category_id")}>
                        {categories.length === 0 && <option value="">Cadastre uma categoria</option>}
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label>Preço de venda (R$)<input inputMode="decimal" placeholder="0,00" value={form.price} onChange={set("price")} /></label>
                    <label>Custo por unidade (R$)<input inputMode="decimal" placeholder="0,00" value={form.cost} onChange={set("cost")} /></label>
                    <div className="f-name photo-field">
                      <span>Foto do produto</span>
                      <div className="photo-row">
                        <label className="gold file-btn">
                          {uploading ? "Enviando..." : previewImg ? "Trocar foto" : "Escolher foto"}
                          <input type="file" className="file-input" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={pickPhoto} />
                        </label>
                        <span className="muted">JPG, PNG ou WebP. A foto é reduzida automaticamente. Vale ao salvar.</span>
                      </div>
                    </div>
                  </div>

                  <div className="group">
                    <div className="group-head">
                      <h3 id="add-h">Adicionais</h3>
                      <button type="button" className="round-add" aria-label="Escolher adicionais deste produto" aria-haspopup="dialog" onClick={() => setPicker(true)}><b aria-hidden="true">+</b></button>
                    </div>
                    {chosen.length ? (
                      <ul className="chips" aria-labelledby="add-h">
                        {chosen.map(a => (
                          <li key={a.id}>
                            {a.name} <em>{a.priced ? `+${money(a.price_cents)}` : "(a definir)"}</em>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="muted">Nenhum adicional neste produto.</p>}
                  </div>

                  <div className="group">
                    <h3>Estoque</h3>
                    <label className="check"><input type="checkbox" checked={form.track} onChange={set("track")} /> <span>Controlar estoque deste produto</span></label>
                    {form.track ? (
                      <div className="stepper">
                        <button type="button" aria-label="Diminuir estoque" onClick={() => setForm({ ...form, stock: String(Math.max(0, (Number(form.stock) || 0) - 1)) })}>−</button>
                        <input aria-label="Unidades em estoque" inputMode="numeric" value={form.stock} onChange={set("stock")} />
                        <button type="button" aria-label="Aumentar estoque" onClick={() => setForm({ ...form, stock: String((Number(form.stock) || 0) + 1) })}>+</button>
                        <span className="muted">unidades. Pedidos baixam o estoque e, em 0, o produto sai do cardápio.</span>
                      </div>
                    ) : <p className="muted">Sem controle: o produto aparece enquanto estiver disponível.</p>}
                    <label className="switch"><input type="checkbox" role="switch" checked={form.available} onChange={set("available")} /><span>{form.available ? "Disponível no cardápio" : "Indisponível no cardápio"}</span></label>
                    <label className="switch"><input type="checkbox" role="switch" checked={form.featured} onChange={set("featured")} /><span>{form.featured ? "Em destaque na página inicial" : "Sem destaque"}</span></label>
                  </div>

                  <dl className="numbers">
                    <div><dt>Valor bruto (unidade)</dt><dd>{priceC !== null ? money(priceC) : "—"}</dd></div>
                    <div><dt>Lucro líquido (unidade)</dt><dd className={unitProfit < 0 ? "neg" : ""}>{unitProfit !== null ? money(unitProfit) : "—"}</dd></div>
                    {stats && <>
                      <div><dt>Produtos vendidos</dt><dd>{stats.sold}</dd></div>
                      <div><dt>Total valor bruto</dt><dd>{money(stats.revenue_cents)}</dd></div>
                      <div><dt>Total soma dos custos</dt><dd>{money(stats.cost_cents)}</dd></div>
                      <div><dt>Lucro líquido total</dt><dd className={stats.revenue_cents - stats.cost_cents < 0 ? "neg" : ""}>{money(stats.revenue_cents - stats.cost_cents)}</dd></div>
                    </>}
                  </dl>
                  {stats && stats.cost_cents === 0 && stats.sold > 0 && <p className="muted">Os custos de vendas anteriores estão zerados porque o custo não estava cadastrado na época.</p>}

                  <p className="status" role="status" aria-live="polite">{status.error ? <span className="error">{status.error}</span> : status.ok}</p>
                  <div className="actions">
                    <button type="button" className="gold" onClick={startNew}>ADICIONAR PRODUTO <b aria-hidden="true">+</b></button>
                    <button className="primary save" disabled={status.busy || (!dirty && sel !== "new")}>{status.busy ? "SALVANDO..." : "SALVAR"}</button>
                  </div>
                </form>
              </div>
            )}
          </>
        )}
      </section>
      {status.error && sel === null && <p className="error" role="alert">{status.error}</p>}
      {picker && (
        <AddonPicker productName={form.name} addons={addons} setAddons={setAddons} onAuth={onAuthError}
          suggestions={suggestionIds} categoryName={categoryName}
          selected={form.addons} setSelected={fn => setForm(f => ({ ...f, addons: typeof fn === "function" ? fn(f.addons) : fn }))}
          onDeleted={removeAddonEverywhere} onClose={() => setPicker(false)} />
      )}
    </>
  );
}
