import { useEffect, useState } from "react";
import { api } from "./api.js";

export default function Categorias({ onAuthError }) {
  const [categories, setCategories] = useState(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null); // { id, name, sort }
  const [state, setState] = useState({ busy: false, error: "", ok: "" });
  const fail = e => (e.status === 401 ? onAuthError() : setState({ busy: false, error: e.message, ok: "" }));

  useEffect(() => { api("/categories").then(setCategories).catch(fail); }, []);

  async function create(e) {
    e.preventDefault();
    if (!draft.trim()) return setState({ busy: false, error: "Informe o nome da categoria.", ok: "" });
    setState({ busy: true, error: "", ok: "" });
    try {
      const created = await api("/categories", { method: "POST", body: { name: draft } });
      setCategories(cs => [...(cs || []), created]);
      setDraft("");
      setState({ busy: false, error: "", ok: "Categoria criada." });
    } catch (err) { fail(err); }
  }

  async function save(e) {
    e.preventDefault();
    if (!editing.name.trim()) return setState({ busy: false, error: "Informe o nome da categoria.", ok: "" });
    setState({ busy: true, error: "", ok: "" });
    try {
      const saved = await api(`/categories/${editing.id}`, {
        method: "PUT",
        body: { name: editing.name, sort: Number(editing.sort) },
      });
      setCategories(cs => cs.map(c => (c.id === saved.id ? { ...c, ...saved } : c)));
      setEditing(null);
      setState({ busy: false, error: "", ok: "Categoria atualizada." });
    } catch (err) { fail(err); }
  }

  async function remove(category) {
    if (!window.confirm(`Excluir a categoria “${category.name}”?`)) return;
    setState({ busy: true, error: "", ok: "" });
    try {
      await api(`/categories/${category.id}`, { method: "DELETE" });
      setCategories(cs => cs.filter(c => c.id !== category.id));
      setState({ busy: false, error: "", ok: "Categoria excluída." });
    } catch (err) { fail(err); }
  }

  return (
    <>
      <h1 className="title">Gerenciamento Delícias Gourmet</h1>
      <h2 className="section-title">Categorias</h2>
      <p className="hint">Cada produto pertence a uma categoria. A ordem abaixo é a ordem em que as seções aparecem no cardápio.</p>

      <form className="box" onSubmit={create}>
        <div className="fields">
          <label className="f-name">Nova categoria
            <input required maxLength={40} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Ex.: Bebidas" />
          </label>
        </div>
        <div className="actions">
          <button className="primary" disabled={state.busy}>{state.busy ? "Salvando..." : "ADICIONAR CATEGORIA"}</button>
        </div>
      </form>

      <p className="status" role="status" aria-live="polite">{state.error ? <span className="error">{state.error}</span> : state.ok}</p>

      <section className="panel" aria-label="Categorias">
        {!categories ? <p className="muted">Carregando...</p> : categories.length === 0 ? (
          <p className="muted">Nenhuma categoria cadastrada.</p>
        ) : (
          <ul className="addon-list">
            {categories.map(category => (
              <li key={category.id} className="addon-row">
                {editing?.id === category.id ? (
                  <form className="addon-new" onSubmit={save}>
                    <label>Nome
                      <input autoFocus maxLength={40} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                    </label>
                    <label>Ordem
                      <input type="number" min="0" value={editing.sort} onChange={e => setEditing({ ...editing, sort: e.target.value })} />
                    </label>
                    <div className="row">
                      <button className="primary small" disabled={state.busy}>Salvar</button>
                      <button type="button" className="link" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="info">
                      <strong>{category.name}</strong>
                      <span className="muted">
                        {category.product_count === 1 ? "1 produto" : `${category.product_count ?? 0} produtos`} · /{category.slug}
                      </span>
                    </div>
                    <button type="button" className="link" onClick={() => setEditing({ id: category.id, name: category.name, sort: category.sort })}>Renomear</button>
                    <button type="button" className="link danger" disabled={(category.product_count ?? 0) > 0} title={(category.product_count ?? 0) > 0 ? "Mova os produtos para outra categoria antes de excluir." : ""} onClick={() => remove(category)}>Excluir</button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
