// Puntos Salud a pantalla completa en Safari del iPhone (2026-11-14).
//
// La app es de pantalla fija: lo que se desplaza son las listas de adentro, no
// la página. Medido en el simulador (iPhone Air, iOS 27): con la página quieta
// arriba del todo, Safari pinta la zona de la hora y la de su barra de abajo
// con un color liso —las «franjas negras»—, y no hay CSS que lo cambie. En
// cuanto la página está desplazada, en cambio, dibuja la PÁGINA debajo de las
// dos barras, como en cualquier sitio que se desplaza.
//
// Así que la página se deja desplazada, quieta, `DESPLAZADO` px hacia abajo, y
// la app vive en un `#root` fijo de alto `100lvh` (el alto con las barras
// recogidas: llega por debajo de la barra de Safari). Lo que queda debajo de
// esa barra se reserva con `--bajo-safari` (padding en index.html) para que las
// pestañas queden encima y no tapadas; ahí se ve el fondo de la aurora.
//
// Para que la página no vuelva a cero:
//   - un arrastre que no cae sobre algo que se desplaza no mueve la página;
//   - si algo la movió (el teclado, una rotación), se vuelve a anclar.
// Sólo en Safari/WebKit del iPhone y fuera de la app instalada en inicio (ahí
// no hay barras). En la computadora no cambia nada.
const DESPLAZADO = 60;

function esIphoneEnNavegador() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ios = /iPhone|iPod|iPad/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
  const instalada = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !instalada;
}

function desplazable(el) {
  for (let n = el; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
    if (/(auto|scroll)/.test(s.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
  }
  return false;
}

export function anclarDocumento() {
  if (!esIphoneEnNavegador()) return;
  const html = document.documentElement;
  html.classList.add('anclado');

  // Con el teclado abierto Safari mueve la página para mostrar el campo: no se
  // pelea con eso.
  const conTeclado = () => (window.visualViewport ? window.visualViewport.height < window.innerHeight - 120 : false);
  const medir = () => {
    const raiz = document.getElementById('root');
    if (!raiz) return;
    const bajo = Math.max(0, Math.round(window.innerHeight ? (parseFloat(getComputedStyle(raiz).height) - window.innerHeight) : 0));
    html.style.setProperty('--bajo-safari', `${bajo}px`);
  };
  const anclar = () => {
    if (conTeclado()) return;
    if (Math.abs(window.scrollY - DESPLAZADO) > 1) window.scrollTo(0, DESPLAZADO);
  };

  let reloj = null;
  window.addEventListener('scroll', () => { clearTimeout(reloj); reloj = setTimeout(anclar, 200); }, { passive: true });
  window.addEventListener('resize', () => { medir(); anclar(); });
  window.visualViewport?.addEventListener('resize', () => { medir(); clearTimeout(reloj); reloj = setTimeout(anclar, 300); });
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1 || !e.cancelable) return; // pellizcar para acercar
    if (!desplazable(e.target)) e.preventDefault();
  }, { passive: false });

  const listo = () => { medir(); anclar(); };
  requestAnimationFrame(listo);
  window.addEventListener('load', () => setTimeout(listo, 50));
  setTimeout(listo, 1500);
}
