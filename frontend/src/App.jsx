import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import AddonDialog from "./AddonDialog.jsx";
import CartPage from "./CartPage.jsx";
import HoursDialog from "./HoursDialog.jsx";
import { money } from "./parts.jsx";

// Pontos de fundo: tamanhos/posições aleatórios. As camadas são montadas por
// tamanho: os menores parecem estar mais longe — vão para a camada mais lenta
// do parallax e ficam um pouco menos opacos (sem exagero).
const BG_DOTS = (() => {
  const dots = Array.from({ length: 435 }, () => ({
    left: Math.random() * 100,
    top: Math.random() * 100,
    size: 1.5 + Math.random() * 5, // 1,5 – 6,5 px
  }));
  dots.sort((a, b) => a.size - b.size);
  const per = Math.ceil(dots.length / 3);
  return [0, 1, 2].map(layer => dots.slice(layer * per, layer * per + per).map(d => ({
    ...d,
    // Opacidade cresce de leve com o tamanho: pequenos = mais distantes.
    opacity: 0.175 + (d.size / 6.5) * 0.045 + Math.random() * 0.03,
  })));
})();

// Distância (px) do ponto até o texto → multiplicador de opacidade.
// A 15 px a bolinha fica totalmente escondida (100% de redução) e depois a
// opacidade volta aos poucos, mantendo as mesmas diferenças de pixels e %.
const DOT_FADE = [[15, 0], [23, 0.05], [33, 0.15], [47, 0.45], [61, 0.68], [77, 0.84], [95, 1]];

function dotFade(dist) {
  if (dist <= DOT_FADE[0][0]) return DOT_FADE[0][1];
  for (let i = 1; i < DOT_FADE.length; i++) {
    const [d0, f0] = DOT_FADE[i - 1];
    const [d1, f1] = DOT_FADE[i];
    if (dist <= d1) return f0 + ((dist - d0) / (d1 - d0)) * (f1 - f0);
  }
  return 1;
}

function BackgroundDots() {
  const ref = useRef(null);

  useEffect(() => {
    // Com scroll-driven animations o parallax roda no compositor, junto com o
    // scroll (sem atraso de 1 frame). O JS fica só como fallback.
    if (typeof CSS !== "undefined" && CSS.supports?.("animation-timeline: scroll()")) return;
    const layers = ref.current.children;
    let raf = 0;
    let last = -1;
    const move = () => {
      const y = window.scrollY;
      if (y !== last) {
        last = y;
        for (let k = 0; k < layers.length; k++) {
          layers[k].style.transform = `translate3d(0, ${y * (0.02 + k * 0.025)}px, 0)`;
        }
      }
      raf = requestAnimationFrame(move);
    };
    raf = requestAnimationFrame(move);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Reduz a opacidade dos pontos que estão perto das letras. A referência é a
  // caixa de cada linha de texto (não a caixa do bloco), então o efeito
  // acompanha o formato real do texto.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const spans = [...root.querySelectorAll(".bg-dots-layer > span")];
    const supportsTimeline = typeof CSS !== "undefined" && CSS.supports?.("animation-timeline: scroll()");
    const layerShiftVh = [5, 12, 22];
    let raf = 0;

    const update = () => {
      raf = 0;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const max = Math.max(document.documentElement.scrollHeight - h, 1);
      const progress = Math.min(window.scrollY / max, 1);

      const rects = [];
      document.querySelectorAll(".section h2, .section h3, .section p").forEach(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          if (r.width < 2 || r.bottom < -100 || r.top > h + 100) continue;
          rects.push(r);
        }
      });

      let i = 0;
      for (let layer = 0; layer < 3; layer++) {
        const shift = supportsTimeline
          ? progress * (layerShiftVh[layer] / 100) * h
          : window.scrollY * (0.02 + layer * 0.025);
        const top = -h / 2 + shift;
        for (const dot of BG_DOTS[layer]) {
          const x = (dot.left / 100) * w;
          const y = top + (dot.top / 100) * h * 2;
          let factor = 1;
          if (rects.length && y > -60 && y < h + 60) {
            let best = Infinity;
            for (const r of rects) {
              const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
              const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
              const d = Math.hypot(dx, dy);
              if (d < best) {
                best = d;
                if (d === 0) break;
              }
            }
            factor = dotFade(best);
          }
          const span = spans[i++];
          const value = dot.opacity * factor;
          if (Math.abs(value - (span._o ?? dot.opacity)) > 0.01) {
            span.style.opacity = value;
            span._o = value;
          }
        }
      }
    };

    const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(document.body);
    document.fonts?.ready.then(schedule).catch(() => {});
    const t = setTimeout(schedule, 500);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="bg-dots" ref={ref} aria-hidden="true">
      {BG_DOTS.map((dots, layer) => (
        <div className="bg-dots-layer" key={layer}>
          {dots.map((d, k) => (
            <span key={k} style={{
              left: `${d.left}%`, top: `${d.top}%`,
              width: `${d.size}px`, height: `${d.size}px`, opacity: d.opacity,
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

// O footer só entra quando a rolagem chega a 98% da página: sobe de baixo
// para cima. Em páginas curtas (sem rolagem suficiente) aparece de imediato.
function SiteFooter() {
  const { pathname } = useLocation();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      setRevealed(prev => (max <= 0 || y >= max * (prev ? 0.94 : 0.98)));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(raf);
    };
  }, [pathname]);

  return (
    <div className={"footer-reveal" + (revealed ? " revealed" : "")}>
      <footer id="contato">
        <div className="container">
          <span className="brand">Delícias Gourmet</span>
          <p>Biopark — Toledo e região</p>
          <p>Contato e WhatsApp: inserir os dados oficiais da empresa.</p>
        </div>
      </footer>
    </div>
  );
}

function ProductCard({ product: p, onAdd }) {
  return (
    <article className="product">
      <img src={`/assets/${p.image}`} alt={p.name} loading="lazy" />
      <div className="product-content">
        <h4>{p.name}</h4>
        <div className="product-bottom">
          <strong>{money(p.price_cents)}</strong>
          <button className="button" onClick={() => onAdd(p.id)} aria-label={`Adicionar ${p.name} ao carrinho`}>ADICIONAR</button>
        </div>
      </div>
    </article>
  );
}

// Uma seção por categoria cadastrada (ordem definida no painel). Categorias sem
// produtos disponíveis não aparecem no cardápio.
function Menu({ products, categories, onAdd }) {
  return categories.map(cat => {
    const items = products.filter(p => p.category_id === cat.id);
    if (!items.length) return null;
    return (
      <div key={cat.id}>
        <h3 className="category">{cat.name}</h3>
        <div className="grid">
          {items.map(p => <ProductCard key={p.id} product={p} onAdd={onAdd} />)}
        </div>
      </div>
    );
  });
}

function Home({ products, categories, loadError, onPick }) {
  const featured = products.filter(p => p.featured);
  return (
    <main id="inicio">
      {featured.length > 0 && (
        <section className="section container" id="destaques">
          <h2>Destaques</h2>
          <div className="grid">
            {featured.map(p => <ProductCard key={p.id} product={p} onAdd={onPick} />)}
          </div>
        </section>
      )}

      <section className="section container" id="cardapio">
        <div className="title-lines" aria-hidden="true"><span /><span /><span /></div>
        <h2>Cardápio</h2>
        {loadError
          ? <p className="error" role="alert">Não foi possível carregar o cardápio. Tente novamente em instantes.</p>
          : products.length === 0
            ? <p className="menu-empty">Nenhum produto disponível no momento.</p>
            : <Menu products={products} categories={categories} onAdd={onPick} />}
      </section>

      <section className="section container about" id="sobre">
          <div>
            <h2>Sobre Nós</h2>
            <p>A Delícias Gourmet iniciou a sua trajetória nas feiras do produtor, oferecendo doces e salgados confecionados com dedicação e elevada qualidade. Em 2016, a marca deu um grande passo com a aquisição do seu primeiro food truck, levando os seus produtos a eventos em Toledo e várias cidades da região, como Cascavel, Palotina e Marechal Cândido Rondon.</p>
            <p>Após uma pausa no final de 2019 e uma passagem pelo Mato Grosso a partir de 2020, a Delícias Gourmet retomou as suas atividades com o food truck em 2025, estabelecendo-se num ponto fixo no Biopark.</p>
            <p>Atualmente, oferecemos uma ampla variedade de produtos preparados na hora: shawarmas, crepes franceses, churros, pastéis, cafés e diversos doces, além de novidades constantes lançadas especialmente para os nossos clientes.</p>
          </div>
          <img src="/assets/food-truck.png" alt="Food truck da Delícias Gourmet" />
        </section>
    </main>
  );
}

function ScrollManager() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) requestAnimationFrame(() => document.querySelector(hash)?.scrollIntoView());
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  const { pathname } = useLocation();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [lines, setLines] = useState([]);
  const [picking, setPicking] = useState(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [toast, setToast] = useState("");
  const key = useRef(1);
  const byId = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  useEffect(() => {
    Promise.all([
      fetch("/api/products").then(r => (r.ok ? r.json() : Promise.reject())),
      fetch("/api/categories").then(r => (r.ok ? r.json() : [])).catch(() => []),
    ])
      .then(([menu, cats]) => {
        setProducts(menu);
        // Se a rota de categorias falhar, ainda agrupa o cardápio pelos dados
        // que vieram em cada produto.
        if (cats.length) setCategories(cats);
        else {
          const seen = new Map();
          for (const p of menu) {
            if (!seen.has(p.category_id)) {
              seen.set(p.category_id, {
                id: p.category_id,
                name: p.category_name || p.category,
                slug: p.category,
              });
            }
          }
          setCategories([...seen.values()]);
        }
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const add = (id, addons = [], note = "") => {
    const k = key.current++;
    const sig = [...addons].sort().join();
    setLines(ls => {
      const same = ls.find(l => l.id === id && [...l.addons].sort().join() === sig && l.note === note);
      return same ? ls.map(l => (l === same ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { key: k, id, qty: 1, addons, note }];
    });
    setToast("Produto adicionado ao carrinho.");
  };
  const onPick = id => (byId[id].addons.length ? setPicking(byId[id]) : add(id));
  const count = lines.reduce((s, l) => s + l.qty, 0);

  return (
    <>
      <ScrollManager />
      <BackgroundDots key={pathname} />
      <header>
        <div className="container navigation">
          <Link className="brand" to="/"><img src="/assets/logo.png" alt="Delícias Gourmet" /></Link>
          <nav aria-label="Navegação principal">
            <Link to="/#inicio">Início</Link>
            <Link to="/#cardapio">Cardápio</Link>
            <Link to="/#sobre">Sobre Nós</Link>
            <button className="nav-link" type="button" onClick={() => setHoursOpen(true)}>Horários</button>
            <Link to="/#contato">Contato</Link>
            <Link className="button gold" to="/carrinho">Carrinho ({count})</Link>
          </nav>
        </div>
      </header>

      <Routes>
        <Route path="/" element={<Home products={products} categories={categories} loadError={loadError} onPick={onPick} />} />
        <Route path="/carrinho" element={<CartPage lines={lines} setLines={setLines} byId={byId} onSent={() => setLines([])} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <SiteFooter />

      {picking && (
        <AddonDialog key={picking.id} product={picking} onClose={() => setPicking(null)} onConfirm={(addons, note) => add(picking.id, addons, note)} />
      )}
      {hoursOpen && <HoursDialog onClose={() => setHoursOpen(false)} />}
      <div className="status" role="status" aria-live="polite">{toast}</div>
    </>
  );
}
