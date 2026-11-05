export const money = (c) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function api(path, opts = {}) {
  const r = await fetch("/api/admin" + path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = data.detail;
    const message =
      (typeof data.error === "string" && data.error) ||
      (typeof detail === "string" && detail) ||
      (Array.isArray(detail) && detail[0]?.msg) ||
      "Erro inesperado.";
    throw Object.assign(new Error(message), { status: r.status });
  }
  return data;
}

// "12,50" ou "1.234,50" -> centavos (null se inválido)
export function toCents(s) {
  let t = String(s).replace(/[R$\s]/g, "");
  if (!t) return null;
  t = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
export const fromCents = (c) => (c / 100).toFixed(2).replace(".", ",");

async function obterImagemBitmap(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error("Não foi possível ler essa imagem.");
  return bmp;
}

function extensaoDeImagemValida(file) {
  return /^image\/(jpeg|png|webp)$/.test(file.type);
}

function criarCanvasReduzido(bmp, maxLado) {
  const k = Math.min(1, maxLado / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);

  return c;
}

function desenharImagemNoCanvas(c, bmp) {
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
}

async function armazenarImagemNoServidorDeManeiraTenebrosa(c) {
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
  const r = await fetch("/api/admin/uploads", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
  });
  return r;
}

// Reduz a foto no navegador (lado maior 1200 px, JPEG) e envia ao servidor. Devolve { image }.
export async function uploadImage(file) {
  if (!extensaoDeImagemValida(file))
    throw new Error("Use uma foto JPG, PNG ou WebP.");

  const bmp = await obterImagemBitmap(file);

  const c = criarCanvasReduzido(bmp, 1200);

  desenharImagemNoCanvas(c, bmp);

  const r = await armazenarImagemNoServidorDeManeiraTenebrosa(c);

  const data = await r.json().catch(() => ({}));

  if (!r.ok)
    throw Object.assign(
      new Error(data.error || "Não foi possível enviar a foto."),
      { status: r.status },
    );
  return data;
}
