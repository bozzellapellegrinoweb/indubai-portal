// Filigrana impressa nell'immagine della pagina, lato server, a ogni richiesta.
// Non e' uno strato sopra l'immagine: chi salva o fotografa la pagina si porta
// dietro nome, numero parziale, data e ora di apertura.

import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const FONT_URL = 'https://cdn.jsdelivr.net/fontsource/fonts/dm-sans@5.1.0/latin-700-normal.ttf';
let fontCache: Uint8Array | null = null;

async function font(): Promise<Uint8Array> {
  if (!fontCache) {
    const r = await fetch(FONT_URL);
    if (!r.ok) throw new Error('Font filigrana non disponibile');
    fontCache = new Uint8Array(await r.arrayBuffer());
  }
  return fontCache;
}

/** lines: due righe di testo; la seconda e' facoltativa. */
export async function watermarkJpeg(src: Uint8Array, lines: [string, string?]): Promise<Uint8Array> {
  const img = await Image.decode(src);
  const f = await font();
  const scale = Math.max(18, Math.round(img.width / 42));
  // 0xRRGGBBAA: grigio scuro, trasparenza ~20%
  const color = 0x3a3a3a34;
  const a = Image.renderText(f, scale, lines[0], color);
  const b = lines[1] ? Image.renderText(f, Math.round(scale * 0.8), lines[1], color) : null;

  const rowH = Math.round(img.height / 6);
  const stride = Math.max(a.width, b?.width ?? 0) + Math.round(scale * 3);
  let row = 0;
  for (let y = Math.round(rowH * 0.45); y < img.height - a.height; y += rowH, row++) {
    // Righe sfalsate: ogni riga parte da un punto diverso, cosi' non si
    // ritaglia via una colonna pulita.
    const offset = Math.round((row % 2 === 0 ? 0.1 : 0.55) * stride);
    for (let x = offset - stride; x < img.width; x += stride) {
      img.composite(a, x, y);
      if (b) img.composite(b, x + Math.round(scale * 0.2), y + a.height + 4);
    }
  }
  return await img.encodeJPEG(80);
}
