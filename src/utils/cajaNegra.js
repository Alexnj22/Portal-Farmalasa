// ── Caja negra — el registro que SOBREVIVE a la recarga ──────────────────────
//
// Existe por un bug que sólo pasa en el iPhone del usuario y que ningún emulador
// reproduce: al abrir el detalle de un producto «se recarga la página y se pone
// negro». Se persiguió tres veces por el lado del `backdrop-filter` y las tres
// falló, y el 2026-08-07 se comprobó por qué no podía ser eso: **su cuenta usa
// el tema `solid`, donde los cuatro `--backdrop-*` valen `none`**. O sea que en
// su teléfono nunca hubo desenfoque que romper.
//
// Cuando una hipótesis se cae tres veces, lo que falta no es otra hipótesis: es
// una medición del aparato donde pasa. El problema es que la página se RECARGA,
// así que la consola se limpia y no queda nada que mirar — y un teléfono no
// tiene consola a mano.
//
// `localStorage` sí sobrevive a la recarga. Esto es un anillo de 40 entradas que
// se escribe en los momentos que importan y se lee después en `/ios-test`, que
// el usuario puede abrir y fotografiar.
//
// **Por qué no se manda a la base:** el momento en que hay que anotar es
// justamente cuando la página se está por recargar; un `fetch` ahí no llega a
// salir. Primero se guarda local, que es síncrono y no puede fallar a medias.
//
// No guarda NADA de negocio: tipo de evento, mensaje de error, ruta y datos del
// aparato. La ruta puede traer el `?tab=`, que no es dato sensible.

const CLAVE = 'portal_caja_negra';
const TOPE  = 40;

// `localStorage` tira excepción en modo privado de Safari y cuando la cuota se
// llena. Una caja negra que rompe la app que viene a diagnosticar no sirve, así
// que todo acceso va envuelto y falla en silencio.
function leerCrudo() {
    try {
        const s = localStorage.getItem(CLAVE);
        const a = s ? JSON.parse(s) : [];
        return Array.isArray(a) ? a : [];
    } catch { return []; }
}

/**
 * Anota un evento. `detalle` es un objeto plano y chico — no meter payloads.
 * Devuelve la entrada escrita (o null) para poder encadenar sin leer de vuelta.
 */
export function anotar(tipo, detalle = {}) {
    try {
        const entrada = {
            t: new Date().toISOString(),
            tipo,
            ruta: `${location.pathname}${location.search}`,
            ...detalle,
        };
        const registro = leerCrudo();
        registro.push(entrada);
        // Se recorta por el principio: lo último es lo que explica la caída.
        localStorage.setItem(CLAVE, JSON.stringify(registro.slice(-TOPE)));
        return entrada;
    } catch { return null; }
}

export function leerCajaNegra() {
    return leerCrudo();
}

// ── El pulso — para el fallo que NO deja escribir nada ────────────────────────
//
// El 2026-08-08 la caja negra dio su primer resultado y fue un resultado por
// ausencia: tras el fallo no había `error-js`, ni `chunk-no-cargo`, ni
// `promesa-sin-capturar`. Nada. Un registro vacío no es un registro que falló:
// significa que NINGÚN código nuestro llegó a correr, o sea que el proceso de la
// página murió de golpe en vez de tirar un error.
//
// `anotar` no puede cubrir eso, porque anota en momentos que hay que prever y
// acá el momento es «justo antes de morir», que no se puede prever. El pulso es
// lo contrario: escribe SIEMPRE, una vez por segundo, sobre la MISMA ranura —
// no crece— dónde estaba la página el último segundo que estuvo viva. Al
// arrancar de nuevo, si quedó un pulso sin despedida, esa era la última foto.
//
// Lo que mide separa las tres explicaciones que quedan vivas, y las separa solas:
//
//   · `traba` (el retraso del reloj): si venía creciendo, el hilo principal se
//     estaba bloqueando — un bucle de render, no falta de memoria.
//   · `viva` (segundos desde el arranque): la app agregada a inicio la SUSPENDE
//     iOS en vez de recargarla, así que puede llevar días abierta acumulando.
//     Un número grande acá señala a eso y no a la vista.
//   · `y` y `ruta`: dónde estaba parado el dedo, y en qué pantalla.
const CLAVE_PULSO = 'portal_pulso';
const PASO_MS     = 250;   // resolución con la que se detecta un trabón
const ESCRIBE_1_DE = 4;    // ...pero al disco una vez por segundo

export function iniciarPulso() {
    if (typeof window === 'undefined' || !window.localStorage) return;

    const nacio = Date.now();
    let esperado = performance.now() + PASO_MS;
    let trabaMax = 0;
    let tics     = 0;

    // Con la pestaña de fondo el navegador ESTRANGULA los timers, y en la app
    // agregada a inicio iOS suspende el proceso entero. Las dos cosas producen
    // un retraso enorme que no es un trabón: al volver se reinicia la cuenta o
    // cada regreso se anotaría como si la página se hubiera colgado.
    const reiniciarCuenta = () => { esperado = performance.now() + PASO_MS; trabaMax = 0; };
    document.addEventListener('visibilitychange', reiniciarCuenta);
    window.addEventListener('pageshow', reiniciarCuenta);

    setInterval(() => {
        const ahora = performance.now();
        const traba = Math.round(ahora - esperado);
        if (traba > trabaMax) trabaMax = traba;
        esperado = ahora + PASO_MS;

        if (++tics % ESCRIBE_1_DE !== 0) return;
        if (document.hidden) return;          // oculta: el reloj no dice nada
        try {
            localStorage.setItem(CLAVE_PULSO, JSON.stringify({
                t:     new Date().toISOString(),
                ruta:  `${location.pathname}${location.search}`,
                viva:  Math.round((Date.now() - nacio) / 1000),
                y:     Math.round(window.scrollY),
                // El alto del documento va JUNTO al scroll porque la pregunta
                // no es «en qué píxel murió» sino «cuánto le faltaba para el
                // final». La segunda caída dio `scroll 2,292 px` y hubo que ir
                // a medir el alto en otra máquina para saber que eso era el
                // fondo de la lista — con el alto acá, la lectura se explica
                // sola y no depende de que el catálogo no haya cambiado.
                alto:  document.documentElement.scrollHeight,
                traba: trabaMax,
                nodos: document.getElementsByTagName('*').length,
            }));
        } catch { /* modo privado o cuota llena */ }
        trabaMax = 0;
    }, PASO_MS);

    // La despedida. Una salida limpia —recargar, navegar afuera, cerrar— borra
    // la ranura, así que un pulso que sobrevive SIEMPRE significa muerte súbita.
    // `persisted` es el caso de iOS que suspende sin cerrar: ahí NO se borra,
    // porque si el sistema la mata mientras duerme eso también hay que contarlo.
    window.addEventListener('pagehide', (e) => {
        if (e.persisted) return;
        try { localStorage.removeItem(CLAVE_PULSO); } catch { /* sin localStorage */ }
    });
}

/**
 * Levanta el pulso que dejó la sesión anterior, si murió sin despedirse, y lo
 * anota como un evento más. Se llama ANTES de `arranque` para que el registro
 * se lea en orden: primero cómo murió la anterior, después que arrancó ésta.
 */
export function recogerPulso() {
    let p = null;
    try {
        const s = localStorage.getItem(CLAVE_PULSO);
        localStorage.removeItem(CLAVE_PULSO);
        if (s) p = JSON.parse(s);
    } catch { return null; }
    if (!p || typeof p !== 'object') return null;

    const n = (v) => Number(v ?? 0).toLocaleString('es-SV');
    const dondeIba = p.alto ? `scroll ${n(p.y)} de ${n(p.alto)} px` : `scroll ${n(p.y)} px`;
    return anotar('murio', {
        ...p,
        msg: `a los ${n(p.viva)} s · ${dondeIba} · trabón máx ${n(p.traba)} ms · ${n(p.nodos)} elementos`,
    });
}

export function limpiarCajaNegra() {
    try { localStorage.removeItem(CLAVE); } catch { /* sin localStorage */ }
}

// ── La sonda de rotación — QUÉ tarda los segundos que se ven feos ────────────
//
// El 2026-08-08, tras fallar el tercer intento a ciegas, el usuario describió el
// defecto con precisión: «al girar, media pantalla se adapta bien, rápido; pero
// cuando pasa a ocupar toda la pantalla es que se traba y se ve raro, son
// segundos». O sea que el ancho correcto SÍ llega — lo que está mal es el tramo,
// y dura segundos.
//
// Los tres intentos anteriores (re-parsear el viewport, el interruptor de
// `display`, remontar el árbol de React) partían de «el ancho se queda pegado»,
// que era la lectura equivocada del mismo síntoma. Ninguno podía servir.
//
// Quedan tres explicaciones y esta sonda las separa **sola**, sin hipótesis:
//
//   A · el hilo principal BLOQUEADO → `peorSalto` de cientos de ms. Es trabajo
//       de JavaScript o recálculo de layout (el remontaje cae acá).
//   B · el hilo libre y el ANCHO tardando → algo anima la geometría (una
//       transición CSS sobre width/padding), o Safari reparte en cámara lenta.
//   C · el hilo libre y el ancho listo enseguida → entonces lo que tarda es el
//       PINTADO: las capas de vidrio se re-componen al tamaño nuevo. No es
//       layout y ninguna medición de layout lo iba a mostrar.
//
// El costo de medir está acotado a propósito: el bucle se corta apenas el ancho
// queda bien y pasa un segundo de calma, y los anchos se leen sólo hasta ese
// momento — leer `clientWidth` fuerza un recálculo, y una sonda que agrega
// trabajo al momento que viene a medir no mide nada.
const CLAVE_ROTACION = 'portal_rotacion';
const TOPE_ROTACION  = 3;      // las últimas tres vueltas alcanzan para comparar
const VENTANA_MS     = 6000;   // tope duro: si a los 6 s no se acomodó, se anota así
const CALMA_MS       = 1000;   // cuánto se sigue mirando después de que el ancho llegó

// Los instantes donde se guarda una foto de los anchos. Son pocos a propósito:
// la tarjeta de `/ios-test` se lee en un teléfono y se fotografía.
const HITOS = [0, 100, 250, 500, 1000, 2000, 3500, 6000];

export function iniciarSondaRotacion() {
    if (typeof window === 'undefined' || !window.matchMedia || !window.requestAnimationFrame) return;

    const mq = window.matchMedia('(orientation: portrait)');
    let corriendo = false;

    const arrancar = (desde) => {
        if (corriendo) return;
        corriendo = true;

        const t0    = performance.now();
        const vista = () => document.querySelector('[data-vista-montada]');
        const nodoInicial = vista();

        // El ancho al que hay que llegar es el del DOCUMENTO, no `innerWidth`:
        // `innerWidth` incluye la barra de Safari y en iOS se actualiza en otro
        // momento que el layout. `clientWidth` del root ES el viewport de layout.
        const muestras   = [];
        let   peorSalto  = 0;
        let   saltosLargos = 0;
        let   anchoOk    = null;   // ms hasta que la vista ocupa el ancho del documento
        let   remontadaEn = null;  // ms en que el nodo de la vista fue reemplazado
        let   previo     = t0;
        let   iHito      = 0;

        const paso = () => {
            const ahora = performance.now();
            const t     = Math.round(ahora - t0);
            const salto = Math.round(ahora - previo);
            previo = ahora;

            // El primer cuadro arrastra el tiempo que iOS pasó girando la
            // pantalla, que no es un trabón nuestro: se ignora.
            if (t > 40) {
                if (salto > peorSalto) peorSalto = salto;
                if (salto > 100) saltosLargos++;
            }

            const nodo = vista();
            if (remontadaEn == null && nodoInicial && nodo && nodo !== nodoInicial) remontadaEn = t;

            // Los anchos se leen hasta que quedan bien y ni un cuadro más.
            let doc = null, anchoVista = null;
            if (anchoOk == null) {
                doc = document.documentElement.clientWidth;
                anchoVista = Math.round(nodo?.getBoundingClientRect().width || 0);
                // 4px de tolerancia: la vista lleva relleno propio por las
                // áreas seguras, así que nunca calza al píxel con el documento.
                if (anchoVista > 0 && doc - anchoVista <= Math.max(4, doc * 0.06)) anchoOk = t;
            }

            while (iHito < HITOS.length && t >= HITOS[iHito]) {
                if (doc == null) {
                    doc = document.documentElement.clientWidth;
                    anchoVista = Math.round(nodo?.getBoundingClientRect().width || 0);
                }
                muestras.push({
                    t,
                    doc,
                    vista: anchoVista,
                    vp: `${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)}`,
                });
                iHito++;
            }

            const seAcabo = t >= VENTANA_MS || (anchoOk != null && t >= anchoOk + CALMA_MS);
            if (!seAcabo) { requestAnimationFrame(paso); return; }

            corriendo = false;
            const cuadros = muestras.length;
            try {
                const previas = JSON.parse(localStorage.getItem(CLAVE_ROTACION) || '[]');
                const lista = Array.isArray(previas) ? previas : [];
                lista.push({
                    t: new Date().toISOString(),
                    ruta: `${location.pathname}${location.search}`,
                    hacia: mq.matches ? 'vertical' : 'horizontal',
                    desde,
                    anchoOk,
                    peorSalto,
                    saltosLargos,
                    remontadaEn,
                    // El tema decide si existen capas de vidrio que recomponer:
                    // en `solid` los cuatro `--backdrop-*` valen `none`, así que
                    // la explicación C queda descartada sin discutirla.
                    tema: document.documentElement.getAttribute('data-theme') || '?',
                    nodos: document.getElementsByTagName('*').length,
                    cuadros,
                    muestras,
                });
                localStorage.setItem(CLAVE_ROTACION, JSON.stringify(lista.slice(-TOPE_ROTACION)));
            } catch { /* modo privado o cuota llena */ }
        };

        requestAnimationFrame(paso);
    };

    // `matchMedia` y no `resize`: `resize` dispara también al abrir el teclado y
    // al colapsarse la barra de Safari, y ahí no hay ninguna rotación que medir.
    mq.addEventListener('change', (e) => arrancar(e.matches ? 'horizontal' : 'vertical'));
}

export function leerRotaciones() {
    try {
        const a = JSON.parse(localStorage.getItem(CLAVE_ROTACION) || '[]');
        return Array.isArray(a) ? a : [];
    } catch { return []; }
}

export function limpiarRotaciones() {
    try { localStorage.removeItem(CLAVE_ROTACION); } catch { /* sin localStorage */ }
}

// ── El interruptor del remontaje — para poder apagar UNA variable ────────────
//
// v2.526.0 hizo que girar remonte la vista. No arregló nada y cuesta el estado
// local (filtros, scroll, un formulario a medio llenar), así que queda APAGADO
// por defecto. Pero sigue siendo una de las tres explicaciones vivas —remontar
// es justamente trabajo del hilo principal—, y para saberlo hay que girar con y
// sin él **en el mismo teléfono**: una medición de latencia sin un control no
// dice si el cambio fue el que movió el número.
const CLAVE_REMONTAR = 'portal_remontar_al_girar';

export function remontarAlGirar() {
    try { return localStorage.getItem(CLAVE_REMONTAR) === '1'; } catch { return false; }
}

export function fijarRemontarAlGirar(valor) {
    try {
        if (valor) localStorage.setItem(CLAVE_REMONTAR, '1');
        else localStorage.removeItem(CLAVE_REMONTAR);
    } catch { /* sin localStorage */ }
}

/**
 * Cómo está corriendo la app. Lo necesita el diagnóstico porque el modo
 * **standalone** es la diferencia grande contra cualquier emulador: iOS SUSPENDE
 * la app agregada a inicio en vez de recargarla, así que puede vivir días con el
 * bundle viejo (está escrito en `index.html`, donde por eso hay una recarga por
 * `visibilitychange`). Un chunk de ese bundle viejo ya no existe en el servidor.
 */
export function entorno() {
    const standalone = (window.matchMedia?.('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
    return {
        standalone,
        nativo: !!(window.Capacitor?.isNativePlatform?.()),
        ua: navigator.userAgent,
        pantalla: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio || 1}x`,
        memoria: navigator.deviceMemory ?? null,
        online: navigator.onLine,
    };
}
