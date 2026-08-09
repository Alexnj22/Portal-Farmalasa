// ── Caja negra — el registro que SOBREVIVE a la recarga ──────────────────────
//
// Existe por un bug que sólo pasa en el iPhone del usuario y que ningún emulador
// reproduce: al abrir el detalle de un producto «se recarga la página y se pone
// negro». Se persiguió tres veces por el lado del `backdrop-filter` y las tres
// falló, y el 2026-08-07 se creyó saber por qué no podía ser eso: la consulta a
// `user_dashboard_prefs` decía que esa cuenta usaba el tema `solid`, donde los
// cuatro `--backdrop-*` valen `none`.
//
// ⚠️ Un día después esa respuesta ya era falsa. El 2026-08-08 la sonda de
// rotación leyó el tema **del DOM, en el teléfono**, y salió `liquid`: con el
// vidrio encendido. El tema es un valor vivo — la consulta de ayer no describe
// la sesión de hoy, y se había usado para descartar una hipótesis. Se lee de
// `document.documentElement`, y ojo con el vacío: `liquid` es el único que NO
// estampa `data-theme`, así que un `null` significa «con vidrio», no «sin dato».
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
// ── Lo que midió la primera corrida, en el iPhone del usuario ────────────────
//
// Y el resultado corrigió la sonda misma. Se había supuesto que el DOCUMENTO
// entregaba el ancho nuevo enseguida y que lo que podía atrasarse era la VISTA.
// Es al revés:
//
//     4ms   doc 765  vista 641      ← ya está físicamente en vertical
//   510ms   doc 765  vista 641
//  1010ms   doc 765  vista 641
//  2010ms   doc 352  vista 336      ← recién acá Safari entrega el ancho nuevo
//
// La vista mide **exactamente lo que le toca** para el documento que Safari le
// reporta, en cada foto (641 de 765 son los 124px de la muesca en horizontal;
// 336 de 352 son los 8px de relleno en vertical). O sea que el portal nunca se
// repartió mal: se repartió bien para un viewport que Safari todavía no había
// cambiado, y tardó **1.1 a 3.2 segundos** en cambiarlo. Con el hilo principal
// LIBRE (peor trabón 89 ms en esa corrida).
//
// Eso cierra los tres intentos de una vez: ninguno podía servir, porque nuestro
// reparto nunca estuvo mal. Y el trabajo que tarda está **fuera del hilo
// principal** — o sea composición, no layout ni JavaScript.
//
// ── Qué mide esta versión ────────────────────────────────────────────────────
//
// Dos tiempos separados, que antes venían mezclados en uno solo:
//
//   · `viewportEn` — cuánto tardó **Safari** en entregar el ancho nuevo. Es el
//     número grande y no depende de nosotros.
//   · `vistaEstableEn` — cuánto tardó **el portal** en acomodarse DESPUÉS de
//     eso. Es el único que podemos bajar escribiendo código.
//
// El primero se detecta por cambio de `documentElement.clientWidth` contra su
// valor inicial, y no por una tolerancia contra el ancho de la vista: esa
// tolerancia tenía que ser distinta en cada orientación —en horizontal la
// muesca se come 124px y en vertical el relleno sólo 16— así que en la práctica
// nunca disparaba al girar HACIA horizontal, y esas corridas se perdían.
//
// El costo de medir está acotado a propósito: el bucle se corta poco después de
// que la vista deja de moverse, y los anchos se leen sólo hasta ahí — leer
// `clientWidth` fuerza un recálculo, y una sonda que agrega trabajo al momento
// que viene a medir no mide nada.
const CLAVE_ROTACION = 'portal_rotacion';
const TOPE_ROTACION  = 4;      // dos idas y dos vueltas: alcanza para comparar
const VENTANA_MS     = 9000;   // tope duro: se midieron 3.2 s, así que 6 quedaba corto
const CALMA_MS       = 600;    // cuánto se sigue mirando después de que la vista frenó
const QUIETOS        = 3;      // cuadros con el mismo ancho para darla por acomodada

// Los instantes donde se guarda una foto de los anchos. Son pocos a propósito:
// la tarjeta de `/ios-test` se lee en un teléfono y se fotografía.
const HITOS = [0, 100, 250, 500, 1000, 2000, 3500, 5000, 7000, 9000];

export function iniciarSondaRotacion() {
    if (typeof window === 'undefined' || !window.matchMedia || !window.requestAnimationFrame) return;

    const mq = window.matchMedia('(orientation: portrait)');
    // Girar de vuelta mientras la corrida anterior seguía midiendo la hacía
    // perderse —se descartaba la nueva— y encima etiquetaba a la vieja con la
    // orientación equivocada, porque el rumbo se leía al ESCRIBIR, hasta nueve
    // segundos después del giro. Ahora cada corrida lleva su número: la vieja se
    // abandona sola en el cuadro siguiente y el rumbo viaja desde el evento.
    let corridaActual = 0;

    const arrancar = (hacia) => {
        const mia = ++corridaActual;
        const t0  = performance.now();

        // Sin el marcador de la vista —`/raw-test`, `/login`, cualquier página
        // fuera del shell— se mide el `body`. Un control sin shell es
        // justamente lo que hace falta para saber si el retraso es del portal o
        // del teléfono, así que la sonda tiene que poder correr ahí.
        const buscarVista = () => document.querySelector('[data-vista-montada]') || document.body;
        const nodoInicial = document.querySelector('[data-vista-montada]');

        const docInicial = document.documentElement.clientWidth;
        const muestras   = [];
        let   peorSalto  = 0;
        let   saltosLargos = 0;
        let   viewportEn = null;   // ms hasta que Safari entrega el ancho nuevo
        let   vistaEstableEn = null; // ms hasta que la vista deja de moverse
        let   remontadaEn = null;
        let   anchoPrevio = null;
        let   quietos    = 0;
        let   previo     = t0;
        let   iHito      = 0;

        const paso = () => {
            if (mia !== corridaActual) return;   // giró otra vez: esta corrida se abandona

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

            const nodo = buscarVista();
            if (remontadaEn == null && nodoInicial && nodo !== nodoInicial) remontadaEn = t;

            const doc = document.documentElement.clientWidth;
            const anchoVista = Math.round(nodo?.getBoundingClientRect().width || 0);

            if (viewportEn == null && doc !== docInicial) viewportEn = t;

            // La vista se da por acomodada cuando su ancho no se mueve durante
            // tres cuadros seguidos, y sólo se empieza a contar después de que
            // llegó el viewport nuevo: antes de eso está quieta porque no tiene
            // a qué reaccionar todavía, y contarla ahí daría un cero engañoso.
            if (viewportEn != null && vistaEstableEn == null) {
                if (anchoVista === anchoPrevio) {
                    if (++quietos >= QUIETOS) vistaEstableEn = t;
                } else {
                    quietos = 0;
                }
            }
            anchoPrevio = anchoVista;

            while (iHito < HITOS.length && t >= HITOS[iHito]) {
                muestras.push({
                    t,
                    doc,
                    vista: anchoVista,
                    vp: `${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)}`,
                });
                iHito++;
            }

            const seAcabo = t >= VENTANA_MS || (vistaEstableEn != null && t >= vistaEstableEn + CALMA_MS);
            if (!seAcabo) { requestAnimationFrame(paso); return; }

            try {
                const previas = JSON.parse(localStorage.getItem(CLAVE_ROTACION) || '[]');
                const lista = Array.isArray(previas) ? previas : [];
                lista.push({
                    t: new Date().toISOString(),
                    ruta: `${location.pathname}${location.search}`,
                    hacia,
                    viewportEn,
                    vistaEstableEn,
                    peorSalto,
                    saltosLargos,
                    remontadaEn,
                    conShell: !!nodoInicial,
                    // `liquid` es el único tema que NO estampa `data-theme` (es
                    // el default). Leerlo como '?' hacía parecer que el dato
                    // faltaba cuando en realidad decía justo lo que importa:
                    // que las capas de vidrio están encendidas.
                    tema: document.documentElement.getAttribute('data-theme') || 'liquid',
                    // El zoom de página de Safari cambia `innerWidth` sin que
                    // cambie nada más, y explicaría medidas que no coinciden con
                    // ningún tamaño de iPhone conocido.
                    escala: Math.round((window.visualViewport?.scale ?? 1) * 100) / 100,
                    standalone: (window.matchMedia?.('(display-mode: standalone)').matches)
                        || window.navigator.standalone === true,
                    nodos: document.getElementsByTagName('*').length,
                    muestras,
                });
                localStorage.setItem(CLAVE_ROTACION, JSON.stringify(lista.slice(-TOPE_ROTACION)));
            } catch { /* modo privado o cuota llena */ }
        };

        requestAnimationFrame(paso);
    };

    // `matchMedia` y no `resize`: `resize` dispara también al abrir el teclado y
    // al colapsarse la barra de Safari, y ahí no hay ninguna rotación que medir.
    // El rumbo se toma del evento, no del final de la corrida.
    mq.addEventListener('change', (e) => arrancar(e.matches ? 'vertical' : 'horizontal'));
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
