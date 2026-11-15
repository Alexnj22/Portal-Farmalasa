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
//   - el encabezado se queda en la página y sus partes (foto, logo, campana)
//     flotan sueltas (`flotarPartes`): el contenido pasa por debajo al subir;
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
  // El original de CADA propiedad, también de las que se tocan en una segunda
  // pasada: si no, al deshacer quedaba puesta (y al girar el teléfono la foto
  // y la campana se iban contra los bordes).
  if (!tocados.has(el)) tocados.set(el, {});
  const orig = tocados.get(el);
  for (const k of Object.keys(estilos)) if (!(k in orig)) orig[k] = el.style[k];
  // Sólo lo que cambia: escribir el mismo valor dispararía otra vez al
  // observador del árbol.
  for (const [k, v] of Object.entries(estilos)) if (el.style[k] !== v) el.style[k] = v;
}

function deshacer() {
  for (const [el, orig] of tocados) { Object.assign(el.style, orig); delete el.dataset.encabezado; delete el.dataset.flota; delete el.dataset.pegado; }
  document.querySelectorAll('[data-flota],[data-encabezado],[data-pegado]').forEach((e) => { delete e.dataset.flota; delete e.dataset.encabezado; delete e.dataset.pegado; });
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
      if (s.position === 'absolute') fijar(v);
      else if (s.position === 'fixed' && !tocados.has(v)) fondoEnLaPagina(v);
      else if (antes && !v.dataset.encabezado && s.position !== 'fixed' && v.getBoundingClientRect().height < 200 && n !== activo) {
        v.dataset.encabezado = '1';
        // Las piezas sueltas son SÓLO para Safari del iPhone, que es el que
        // pinta la franja de la hora si algo fijo va de lado a lado. En la
        // computadora (y en Android) el encabezado entero se pega arriba y
        // sus piezas se acomodan solas: medir y congelar posiciones ahí dejó
        // el logo encima de la foto y la campana afuera (2026-11-14).
        if (IPHONE_SAFARI) flotarPartes(v); else pegarArriba(v);
      }
    }
  }
}

// Lo que flotaba (absolute) pasa a fijo, salvo que ocupe el ANCHO entero:
// Safari toma algo fijo de lado a lado pegado a un borde como una barra y pinta
// su zona (la hora, la barra de direcciones) de un color liso — medido en el
// simulador. Así que:
//   - el fondo (la aurora, que tapa toda la pantalla) se queda en la página y
//     se estira con ella;
//   - una franja de lado a lado (la caja del menú de abajo, el indicador de
//     refrescar) queda fija pero sólo del ancho de lo que lleva adentro: el
//     menú es una pastilla con margen, como en la prueba que sí funcionó.
function fijar(v) {
  const W = window.innerWidth; const H = window.innerHeight;
  const r = v.getBoundingClientRect();
  if (r.width >= W * 0.9 && r.height >= H * 0.8) { fondoEnLaPagina(v); return; } // fondo
  if (r.width >= W * 0.9) {
    // Del tamaño de lo que lleva adentro, en los dos sentidos: la caja del
    // menú tiene relleno abajo y tocaba el borde.
    const hijos = [...v.children].map((c) => c.getBoundingClientRect()).filter((c) => c.width > 0);
    if (hijos.length) {
      const izq = Math.min(...hijos.map((c) => c.left)); const der = Math.max(...hijos.map((c) => c.right));
      const arr = Math.min(...hijos.map((c) => c.top)); const aba = Math.max(...hijos.map((c) => c.bottom));
      // Arriba (el buscador de la Tienda): se queda donde está, sólo más angosto.
      if (der - izq < W - 8 && r.top < H / 2) {
        guardarYPoner(v, { position: 'fixed', left: `${Math.round(izq - r.left)}px`, right: `${Math.round(r.right - der)}px`, paddingLeft: '0px', paddingRight: '0px' });
        sinDesenfoque(v);
        return;
      }
      if (der - izq < W - 8) {
        // Medido dentro de la caja: la caja ya está al final de la página, no
        // de la pantalla. Lo que la separa del borde de abajo se conserva.
        guardarYPoner(v, {
          position: 'fixed', left: `${Math.round(izq - r.left)}px`, right: `${Math.round(r.right - der)}px`,
          top: 'auto', bottom: `${Math.round(r.bottom - aba)}px`, height: `${Math.ceil(aba - arr)}px`,
          paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
        });
        sinDesenfoque(v);
        return;
      }
    }
  }
  guardarYPoner(v, { position: 'fixed' });
  sinDesenfoque(v);
}

// Medido en el simulador: un vidrio difuminado (`backdrop-filter`) cerca de un
// borde hace que Safari del iPhone pinte la franja de la hora o la de la barra
// de direcciones con el color liso de la página. Ahí, lo que flota lleva un
// fondo casi opaco en lugar del difuminado. En la computadora no cambia.
const IPHONE_SAFARI = typeof navigator !== 'undefined'
  && (/iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)))
  && !(typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true));
function sinDesenfoque(raiz) {
  if (!IPHONE_SAFARI) return;
  for (const el of [raiz, ...raiz.querySelectorAll('*')]) {
    const s = getComputedStyle(el);
    const bf = s.webkitBackdropFilter || s.backdropFilter;
    if (!bf || bf === 'none') continue;
    const m = s.backgroundColor.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    const estilos = { backdropFilter: 'none', webkitBackdropFilter: 'none' };
    if (m && Number(m[4] ?? 1) < 0.92) estilos.backgroundColor = `rgba(${m[1]}, ${m[2]}, ${m[3]}, 0.94)`;
    guardarYPoner(el, estilos);
  }
}

// La aurora (componentes/Aurora.js) es una capa opaca que tapa toda la
// pantalla. Medido en el simulador, ocultando una cosa por vez: con ella,
// Safari del iPhone pinta la zona de la hora y la de la barra de direcciones
// con su color liso, fija o no, opaca o transparente; sin ella, el contenido
// pasa por debajo de las dos. Ahí se oculta: el fondo de la página
// (public/index.html) ya trae las mismas manchas de la aurora. En la
// computadora se queda como está.
function fondoEnLaPagina(v) {
  if (!IPHONE_SAFARI) return;
  const r = v.getBoundingClientRect();
  if (r.width < window.innerWidth * 0.9 || r.height < window.innerHeight * 0.8) return;
  guardarYPoner(v, { display: 'none' });
}

// Las partes de un encabezado: la foto o «volver», el título y los botones
// de la derecha. Es el primer nivel con dos o más hijos angostos.
function partes(h) {
  const W = window.innerWidth;
  let nivel = [h];
  for (let i = 0; i < 8 && nivel.length; i++) {
    const sig = [];
    for (const n of nivel) {
      const hijos = [...n.children].filter((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && r.width > 0; });
      if (hijos.length >= 2 && hijos.every((c) => c.getBoundingClientRect().width < W * 0.7)) return hijos;
      sig.push(...hijos);
    }
    nivel = sig;
  }
  return [];
}

// Lo que se ve de cada parte (la foto, el logo, la campana): el primer hijo
// más chico que la parte. Ahí va el vidrio al bajar.
function pieza(p) {
  const r0 = p.getBoundingClientRect();
  for (let n = p; n; n = n.firstElementChild) {
    const r = n.getBoundingClientRect();
    if (r.width < r0.width - 1 || r.height < r0.height - 1) return n;
    if (n.children.length !== 1) return n;
  }
  return p;
}

// Medido en el simulador: una barra fija de lado a lado pegada arriba hace que
// Safari pinte la zona de la hora de un color liso (el contenido no pasa por
// debajo). Piezas chicas sueltas, no. Así que el encabezado se queda en la
// página (se va al bajar) y sus partes flotan, cada una por su cuenta, en el
// mismo lugar donde estaban — como el menú de abajo, que no toca los bordes.
function pegarArriba(h) {
  guardarYPoner(h, { position: 'sticky', top: '0px', zIndex: '20' });
  h.dataset.pegado = '1';
}

function flotarPartes(h) {
  const hr = h.getBoundingClientRect();
  const ps = partes(h);
  alinearUno(ps); // antes de medir: el margen de la computadora va adentro
  // Se fija lo que se VE de cada parte (la foto, el logo, la campana), no la
  // caja de 64 px de alto: la caja toca el borde de arriba y Safari vuelve a
  // pintar la franja. Todo se mide antes de mover nada.
  const lista = ps.map((p) => { const v = pieza(p); return { p, v, r: v.getBoundingClientRect(), rp: p.getBoundingClientRect() }; });
  // Si la fila todavía no se acomodó (piezas encimadas o fuera de la
  // pantalla), no se congela nada: se vuelve a intentar en un rato.
  const W = window.innerWidth;
  const conAlgo = lista.filter(({ r }) => r.width > 0);
  const malo = conAlgo.some(({ r }, i) => r.left < -1 || r.right > W + 1 || (i > 0 && r.left < conAlgo[i - 1].r.right - 1));
  if (malo) {
    delete h.dataset.encabezado;
    if ((h.__intentos = (h.__intentos ?? 0) + 1) < 10) setTimeout(() => { if (h.isConnected) acomodarVecinos(); }, 300);
    return;
  }
  for (const { p, v, r, rp } of lista) {
    // Una parte vacía (Cuenta no lleva foto a la izquierda) no flota: sería un
    // vidrio sin nada adentro.
    if (r.width <= 0 || (!v.textContent.trim() && !v.querySelector('img, svg, canvas'))) continue;
    // La parte guarda su lugar en la fila aunque su contenido se vaya.
    guardarYPoner(p, { width: `${Math.ceil(rp.width)}px`, height: `${Math.ceil(rp.height)}px`, flexShrink: '0', flexGrow: '0' });
    guardarYPoner(v, {
      // Los cuatro márgenes por separado, nunca `margin`: el original de la
      // foto es un `margin-left: 16px` en línea, y guardar el atajo (vacío) y
      // reponerlo lo borraba — al girar, la foto y la campana quedaban en 0.
      position: 'fixed', zIndex: '20', marginTop: '0px', marginRight: '0px', marginBottom: '0px', marginLeft: '0px',
      top: `${Math.round(r.top - hr.top)}px`, left: `${Math.round(r.left)}px`,
      // Hacia arriba y con un px de aire: redondeado hacia abajo, el título
      // («Notificaciones», 113.6 px) salía con puntos suspensivos.
      width: `${Math.min(Math.ceil(r.width) + 1, Math.floor(W - r.left))}px`, height: `${Math.ceil(r.height)}px`,
    });
    v.dataset.flota = '1';
    if (IPHONE_SAFARI) v.dataset.sinDesenfoque = '1';
  }
}

// En la computadora, la foto, «volver» y los botones de la derecha se alinean
// con la columna del contenido (560 px, componentes/ui.js), no con la orilla
// de una ventana de 1400. En todos los encabezados, no sólo los de la página
// que se desplaza. En el teléfono no cambia nada.
const alineados = new Map();
function alinearUno(ps, extra = Math.max(0, Math.round((window.innerWidth - 560) / 2))) {
  if (ps.length !== 3) return;
  // En la FILA, no en los lados: así el título conserva su ancho (con el
  // margen en los lados, «Notificaciones» salía cortado).
  const fila = ps[0].parentElement;
  if (!alineados.has(fila)) alineados.set(fila, { paddingLeft: fila.style.paddingLeft, paddingRight: fila.style.paddingRight });
  for (const k of ['paddingLeft', 'paddingRight']) {
    const v = extra ? `${extra}px` : alineados.get(fila)[k];
    if (fila.style[k] !== v) fila.style[k] = v;
  }
}
function alinearEncabezados() {
  const W = window.innerWidth;
  const extra = Math.max(0, Math.round((W - 560) / 2));
  const raiz = document.getElementById('root');
  for (const el of raiz.querySelectorAll('div')) {
    const r = el.getBoundingClientRect();
    if (r.width < W * 0.9 || r.height < 40 || r.height > 130) continue;
    if (Math.abs(r.top + window.scrollY) > 2 && !el.dataset.encabezado) continue;
    alinearUno(partes(el), extra);
  }
  for (const p of alineados.keys()) if (!p.isConnected) alineados.delete(p);
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
    // Buscar encabezados recorre todo el árbol: sólo cuando entran o salen
    // elementos, y como mucho cada 300 ms (las animaciones cambian estilos en
    // cada cuadro).
    let relojAlinear = null;
    const alinearPronto = () => { if (!relojAlinear) relojAlinear = setTimeout(() => { relojAlinear = null; alinearEncabezados(); pronto(); }, 300); };
    new MutationObserver((ms) => {
      pronto();
      if (ms.some((m) => m.type === 'childList')) alinearPronto();
    }).observe(raiz, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    // Al cambiar el ancho, las partes que flotan se vuelven a medir.
    let anchoVisto = window.innerWidth; let relojAncho = null;
    window.addEventListener('resize', () => {
      // En el iPhone, la barra de direcciones se encoge y crece AL DESPLAZAR, y
      // cada vez dispara `resize` con otro alto. Rearmar ahí devolvía la página
      // arriba y corría la foto y la campana contra los bordes (2026-11-14, «se
      // sube o baja solo» · «el ícono de persona y notificación se cortan»).
      // Sólo el ANCHO cambia lo que se acomoda.
      if (window.innerWidth === anchoVisto) return;
      anchoVisto = window.innerWidth;
      // Se rearma cuando la ventana DEJA de cambiar y la app ya se volvió a
      // dibujar con el ancho nuevo: medido antes, la foto quedaba en 0.
      const y = window.scrollY;
      clearTimeout(relojAncho);
      relojAncho = setTimeout(() => {
        // Primero se quita el margen viejo: con el de una ventana más ancha la
        // fila queda sin lugar y las partes no se encuentran.
        for (const [fila, o] of alineados) Object.assign(fila.style, o);
        alineados.clear();
        const lista = activo;
        deshacer(); alinearEncabezados();
        if (lista) posiciones.set(lista, y);
        pronto();
      }, 250);
    });
    alinearEncabezados();
    // Al bajar, el encabezado se vuelve vidrio (index.html), como la barra
    // del iPhone: arriba del todo es transparente sobre la aurora.
    const html = document.documentElement;
    window.addEventListener('scroll', () => {
      const bajo = window.scrollY > 4;
      if (bajo !== html.classList.contains('desplazada')) html.classList.toggle('desplazada', bajo);
      const oscuro = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
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
