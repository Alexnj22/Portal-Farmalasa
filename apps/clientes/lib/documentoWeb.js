// En el navegador la PÁGINA se desplaza, no una caja adentro (2026-11-14).
//
// «el contenido sigue sin pasar bajo la barra … sigue fijo en un cuadrado.
// solo debe quedar fijo el menu y el header». Medido en el simulador (iPhone
// Air, iOS 27): Safari recorta todo lo que es `position: fixed` justo en el
// borde de su barra de estado y de su barra de direcciones; por debajo de ellas
// sólo pasa el contenido de la PÁGINA cuando se desplaza. Y la app, como en el
// teléfono, desplazaba una lista dentro de una pantalla fija.
//
// Así que en la web la lista de la pantalla visible (la que `Pantalla` de
// componentes/ui.js marca con `data-documento`) deja de ser una caja que se
// desplaza y crece con su contenido; sus contenedores, hasta `#root`, crecen
// con ella, y el documento es el que se desplaza:
//   - lo que flotaba encima en esos contenedores (`absolute`: la barra de
//     pestañas, la burbuja del chat, la aurora, avisos) pasa a `fixed`, así
//     queda en la pantalla y no al final de la página;
//   - el encabezado (va en el flujo, arriba) queda `sticky`: el contenido pasa
//     por debajo al subir;
//   - cada pantalla recuerda dónde quedó, y `scrollTo` de la lista mueve la
//     página (volver arriba al tocar la pestaña otra vez).
// Una pantalla sin la marca (las listas largas con FlatList, el chat) sigue
// como antes: con la caja de adentro, porque su lista virtual necesita los
// eventos de su propio desplazamiento.
//
// Todo se escribe en estilos en línea y se guarda el original: al cambiar de
// pantalla se deshace y se arma para la nueva.
const MARCA = '[data-documento="1"]';

let activo = null;          // la lista que hoy manda sobre el documento
const tocados = new Map();  // elemento → estilos originales
const posiciones = new WeakMap(); // lista → scrollY al dejarla

function guardarYPoner(el, estilos) {
  if (!tocados.has(el)) {
    const orig = {};
    for (const k of Object.keys(estilos)) orig[k] = el.style[k];
    tocados.set(el, orig);
  }
  // Sólo lo que cambia: escribir el mismo valor dispararía otra vez al
  // observador del árbol.
  for (const [k, v] of Object.entries(estilos)) if (el.style[k] !== v) el.style[k] = v;
}

function deshacer() {
  for (const [el, orig] of tocados) { Object.assign(el.style, orig); delete el.dataset.encabezado; }
  tocados.clear();
  if (activo) {
    posiciones.set(activo, window.scrollY);
    delete activo.scrollTo;
    delete activo.dataset.documentoActivo;
  }
  activo = null;
  document.documentElement.classList.remove('documento');
}

function visible(el) {
  if (!el.isConnected || !el.getClientRects().length) return false;
  // Una pestaña que no es la actual queda montada con aria-hidden.
  if (el.closest('[aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

// Las pantallas que no usan `Pantalla` (Cuenta, el detalle de un producto…):
// la caja que se desplaza más alta de lo visible, si ocupa al menos media
// pantalla. Nunca una lista virtual (FlatList: el catálogo, avisos, el chat),
// que se marca con `data-documento="no"`: sin los eventos de su propio
// desplazamiento no pintaría más que las primeras filas.
function buscarSola() {
  const raiz = document.getElementById('root');
  let mejor = null; let alto = window.innerHeight * 0.5;
  for (const el of raiz.querySelectorAll('div')) {
    if (el.clientHeight < alto) continue;
    const s = getComputedStyle(el);
    if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
    if (el.closest('[data-documento="no"]') || !visible(el)) continue;
    mejor = el; alto = el.clientHeight;
  }
  return mejor;
}

function armar(lista) {
  const raiz = document.getElementById('root');
  // La lista y su envoltorio: ScrollView arma dos cajas que se desplazan, y
  // la marca puede caer en la de afuera.
  let inicio = lista;
  while (inicio.firstElementChild && /(auto|scroll)/.test(getComputedStyle(inicio.firstElementChild).overflowY)) inicio = inicio.firstElementChild;
  for (let n = inicio; n && n !== raiz; n = n.parentElement) {
    const s = getComputedStyle(n);
    const desplaza = /(auto|scroll|hidden)/.test(s.overflowY) || /(auto|scroll|hidden)/.test(s.overflowX);
    const estilos = {};
    if (desplaza) { estilos.overflow = 'visible'; estilos.overflowX = 'visible'; estilos.overflowY = 'visible'; }
    if (s.position === 'absolute') estilos.position = 'relative';
    if (n === lista || lista.contains(n)) { estilos.flexGrow = '0'; estilos.flexShrink = '0'; estilos.flexBasis = 'auto'; }
    else estilos.flexBasis = 'auto';
    guardarYPoner(n, estilos);
  }
  activo = lista;
  lista.dataset.documentoActivo = '1';
  lista.scrollTo = (a, b) => {
    const y = typeof a === 'object' ? a?.top ?? a?.y ?? 0 : b ?? 0;
    window.scrollTo({ top: y, behavior: typeof a === 'object' && a?.behavior ? a.behavior : 'auto' });
  };
  document.documentElement.classList.add('documento');
  const y = posiciones.get(lista) ?? 0;
  window.scrollTo(0, y);
  // La página recién creció en este cuadro: si el alto no alcanzaba, otra vez.
  requestAnimationFrame(() => { if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y); });
}

// Lo que cuelga de la cadena sin ser parte de ella: lo que flotaba pasa a
// fijo, el encabezado se pega arriba. Se repite en cada cambio del árbol
// (un aviso que aparece después también tiene que quedar fijo).
function acomodarVecinos() {
  if (!activo) return;
  const raiz = document.getElementById('root');
  for (let n = activo; n && n !== raiz; n = n.parentElement) {
    const padre = n.parentElement;
    if (!padre) break;
    let antes = true;
    for (const v of padre.children) {
      if (v === n) { antes = false; continue; }
      const s = getComputedStyle(v);
      if (s.display === 'none') continue;
      if (s.position === 'absolute') guardarYPoner(v, { position: 'fixed' });
      else if (antes && s.position !== 'fixed' && s.position !== 'sticky' && v.getBoundingClientRect().height < 200 && n !== activo) {
        guardarYPoner(v, { position: 'sticky', top: '0px', zIndex: '20' });
        v.dataset.encabezado = '1';
      }
    }
  }
}

function elegir() {
  if (activo && visible(activo)) { acomodarVecinos(); return; }
  const listas = [...document.querySelectorAll(MARCA)].filter(visible);
  const lista = listas[listas.length - 1] ?? buscarSola();
  if (lista === activo) { acomodarVecinos(); return; }
  deshacer();
  if (lista) { armar(lista); acomodarVecinos(); }
}

export function anclarDocumento() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  let pendiente = false;
  const pronto = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; elegir(); });
  };
  const empezar = () => {
    const raiz = document.getElementById('root');
    if (!raiz) { setTimeout(empezar, 100); return; }
    new MutationObserver(pronto).observe(raiz, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('resize', pronto);
    // Al bajar, el encabezado se vuelve vidrio (index.html), como la barra
    // del iPhone: arriba del todo es transparente sobre la aurora.
    const html = document.documentElement;
    window.addEventListener('scroll', () => {
      const bajo = window.scrollY > 4;
      if (bajo !== html.classList.contains('desplazada')) html.classList.toggle('desplazada', bajo);
      const oscuro = getComputedStyle(html).backgroundColor === 'rgb(10, 9, 14)';
      if (oscuro !== html.classList.contains('oscura')) html.classList.toggle('oscura', oscuro);
    }, { passive: true });
    pronto();
  };
  empezar();
}

/** ¿Esta lista es hoy la que desplaza el documento? (TirarParaRefrescar, ui.js) */
export function esListaDelDocumento(el) {
  return !!activo && !!el && (el === activo || activo.contains(el) || el.contains(activo));
}
