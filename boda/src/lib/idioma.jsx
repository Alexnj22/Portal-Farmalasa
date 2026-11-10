// Idioma del sitio para los invitados. El panel de administración queda en
// español. Se elige por ?lang=en, por lo que el invitado eligió antes, o por
// el idioma de su teléfono; siempre dentro de `boda.idiomas`.
import { useSyncExternalStore } from 'react';
import { boda } from '../config';

export const IDIOMAS = boda.idiomas?.length ? boda.idiomas : ['es'];
const LS = 'boda-idioma';

function inicial() {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (IDIOMAS.includes(q)) return q;
    const g = localStorage.getItem(LS);
    if (IDIOMAS.includes(g)) return g;
  } catch { /* modo privado */ }
  const nav = (navigator.language || 'es').slice(0, 2);
  return IDIOMAS.includes(nav) ? nav : IDIOMAS[0];
}

let actual = inicial();
const oyentes = new Set();
if (typeof document !== 'undefined') document.documentElement.lang = actual;

export function cambiarIdioma(l) {
  if (!IDIOMAS.includes(l)) return;
  actual = l;
  try { localStorage.setItem(LS, l); } catch { /* modo privado */ }
  document.documentElement.lang = l;
  oyentes.forEach((f) => f());
}

export const idioma = () => actual;
export const locale = (l = actual) => (l === 'en' ? 'en-US' : 'es');

/** Vuelve a pintar el componente cuando cambia el idioma. */
export function useIdioma() {
  return useSyncExternalStore((f) => { oyentes.add(f); return () => oyentes.delete(f); }, () => actual);
}

/** t('Texto', 'Text'): la versión del idioma vigente (sin inglés, el español). */
export const t = (es, en) => (actual === 'en' && en != null ? en : es);

// Contenido del config en el idioma vigente: el bloque `en` se superpone al
// español, cruzando las listas por posición.
function superponer(base, extra) {
  if (extra == null) return base;
  if (Array.isArray(base)) return base.map((x, i) => superponer(x, Array.isArray(extra) ? extra[i] : undefined));
  if (base && typeof base === 'object') {
    const r = { ...base };
    for (const k of Object.keys(extra)) r[k] = k in base ? superponer(base[k], extra[k]) : extra[k];
    return r;
  }
  return extra;
}
const cache = {};
export function contenido(l = actual) {
  if (!cache[l]) cache[l] = l === 'es' ? boda : superponer(boda, boda[l]);
  return cache[l];
}

/** Los momentos del álbum se GUARDAN en español; esto sólo cambia el rótulo. */
export const rotuloMomento = (m) => {
  const i = boda.momentos.indexOf(m);
  return i >= 0 ? (contenido().momentos[i] ?? m) : m;
};

export function BotonIdioma() {
  const l = useIdioma();
  if (IDIOMAS.length < 2) return null;
  const otro = IDIOMAS[(IDIOMAS.indexOf(l) + 1) % IDIOMAS.length];
  return (
    <button type="button" className="btn claro chico idioma" onClick={() => cambiarIdioma(otro)}
      aria-label={otro === 'en' ? 'Switch to English' : 'Cambiar a español'}>
      {otro.toUpperCase()}
    </button>
  );
}
