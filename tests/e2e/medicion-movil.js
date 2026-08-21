// Instrumento COMPARTIDO de la auditoría móvil.
//
// Vive fuera de los spec porque lo usan dos suites —el barrido de vistas y la
// matriz de la fase 5— y dos medidores que se van separando es exactamente el
// modo de fallar que este proyecto ya conoce: el número deja de comparar con
// nada. Todo lo de acá se serializa a `page.evaluate`, así que NO puede cerrar
// sobre variables del módulo: cada función define sus ayudantes adentro.

export const MEDIR = () => {
    const vw = document.documentElement.clientWidth;
    // Se recorre la CADENA, no el elemento solo: la opacidad de un ancestro
    // apaga a toda su descendencia, pero `getComputedStyle` del hijo sigue
    // diciendo `opacity: 1`. Mirando sólo el elemento, los cuatro textos de un
    // tooltip apagado se contaban como visibles y desbordados — el tooltip
    // desaparecía del informe y sus párrafos se quedaban. Cuarta vez que este
    // proyecto mide la referencia en vez del cuerpo.
    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        for (let p = el; p; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        }
        return true;
    };
    // ¿Se puede LLEGAR a tocarlo? Distinto de `visible`, y por un caso concreto:
    // el sidebar del teléfono no se esconde con ninguna de las tres propiedades
    // que mira `visible` —se esconde con `transform: translateX(-100%)`—, así que
    // su botón de colapsar entraba como visible en LAS 37 RUTAS, una vez por
    // vista. Eran 37 de los 77 `sinAcuse`: la mitad del número que se leía como
    // deuda no existía. Quinta vez que este proyecto mide la referencia en vez
    // del cuerpo, y ya estaba anotado en v2.517.0 como «deuda del medidor tanto
    // como del botón».
    //
    // La regla es FUERA DE LADO, y no «fuera del viewport», a propósito: un
    // control por debajo del pliegue también está fuera y **sí** se alcanza
    // scrolleando — descartarlo haría subcontar toda la mitad inferior de cada
    // vista. Lo que no se alcanza es lo que está corrido horizontalmente, porque
    // `desbordePagina` mide 0 en las 37 rutas: no hay scroll lateral con que ir
    // a buscarlo.
    //
    // NO se aplica a `desbordan`, que mide justamente lo que se sale de cuadro.
    const alcanzable = (el) => {
        const r = el.getBoundingClientRect();
        if (!(r.right > 0 && r.left < vw)) return false;
        // Y lo que no recibe el toque tampoco es un blanco táctil, aunque se
        // vea. Con un diálogo abierto, el shell entero —`aside`, `main` y las
        // tabs— recibe `pointer-events-none select-none scale-[0.98]
        // blur-[2px]`: se aleja y se difumina detrás del velo, a propósito.
        //
        // Eso producía **70 de los 109 «chicos»** de la corrida completa, todos
        // en pantallas con modal y todos midiendo 43.12 — que es 44 × 0.98, o
        // sea controles que YA cumplen y sólo se ven encogidos por el efecto de
        // profundidad. Ninguno se puede tocar: el velo está encima y el shell
        // no recibe eventos. Sexta vez que este proyecto mide la referencia en
        // vez del cuerpo.
        //
        // Se mira la CADENA porque `pointer-events` se hereda: el atributo vive
        // en el shell, no en cada botón.
        for (let p = el; p; p = p.parentElement) {
            if (getComputedStyle(p).pointerEvents === 'none') return false;
        }
        return true;
    };
    const sel = (el) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = (el.className?.toString?.() || '').trim().split(/\s+/).slice(0, 3).join('.');
        return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}`;
    };
    // La CADENA de ancestros, porque un `span.font-mono.text-micro` repetido 49
    // veces no dice de qué componente salió, y sin eso el hallazgo no se puede
    // arreglar: hay que ir a buscarlo a mano por el árbol. Cuatro niveles
    // alcanzan para reconocer la fila o la tarjeta que lo contiene.
    const cadena = (el) => {
        const out = [];
        for (let p = el.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) out.push(sel(p));
        return out.join(' ‹ ');
    };

    // 1 · ¿La PÁGINA scrollea de lado? Es el síntoma que originó el plan.
    const desbordePagina = Math.max(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
        document.body.scrollWidth - document.body.clientWidth,
    );

    // 2 · Qué elementos se salen del viewport (los culpables del desborde)
    //
    // Salirse del viewport y HACER SCROLLEAR LA PÁGINA son cosas distintas, y
    // la primera versión de este bloque las mezclaba: reportaba 28 elementos en
    // ocho vistas donde el scroll horizontal de la página medía 0 en todas.
    // Un elemento se sale sin arrastrar a la página cuando algo lo RECORTA, y
    // ahí hay dos casos que no se parecen en nada:
    //
    //   · recortado a propósito — el buscador deslizante del encabezado espera
    //     fuera de cuadro hasta que se lo abre. Está bien.
    //   · recortado sin querer — contenido que existe, no se ve y no se alcanza.
    //
    // Sin nombrar al ancestro que recorta no se puede distinguir uno del otro,
    // así que se anota. Y el recorrido arranca en el propio elemento: un carril
    // con `overflow-x:auto` ES la solución, no el problema — contarlo era
    // acusar otra vez a quien hizo bien el trabajo.
    const desbordan = [];
    document.querySelectorAll('*').forEach(el => {
        if (!visible(el)) return;
        // Un ADORNO que sangra por el borde no es contenido perdido. Las
        // burbujas ambientales del login están puestas en `right-[-10%]` a
        // propósito y llevan `pointer-events: none`: no se tocan y no dicen
        // nada, así que recortarlas es justamente el efecto buscado. Se
        // excluyen por las DOS condiciones juntas —ni se alcanzan ni tienen
        // texto propio—, porque un texto recortado sí es una pérdida aunque no
        // se pueda tocar.
        const csEl = getComputedStyle(el);
        const textoPropio = [...el.childNodes]
            .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
        if (csEl.pointerEvents === 'none' && !textoPropio) return;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width <= vw * 3) {
            let enCarril = false, recorte = null;
            for (let p = el; p; p = p.parentElement) {
                const s = getComputedStyle(p);
                if (p !== el && !recorte && (s.overflowX === 'hidden' || s.overflowX === 'clip')) recorte = sel(p);
                if (s.overflowX === 'auto' || s.overflowX === 'scroll') { enCarril = true; break; }
            }
            if (!enCarril) desbordan.push({ sel: sel(el), sobra: Math.round(r.right - vw),
                                            recorte: recorte || '(nada lo recorta)',
                                            cadena: cadena(el),
                                            texto: (el.textContent || '').trim().slice(0, 40) });
        }
    });

    // 3 · Blancos táctiles < 44pt (fase 3.2)
    //
    // ⚠️ Se mide el ÁREA DE IMPACTO, no la caja. Un control puede verse de 20px
    // y tocarse como uno de 44 si extiende su área con un pseudo-elemento
    // (`.blanco-tactil`), que es el patrón del portal para los controles cuyo
    // tamaño ES el diseño — la flecha del carril, el aspa del select compacto.
    // La primera versión de esta auditoría leía sólo `getBoundingClientRect()`
    // y daba por chicos a controles que ya estaban resueltos: acusaba al que
    // hizo bien el trabajo. Mismo error que el detector de `pointermove` que
    // miraba la referencia en vez del cuerpo.
    const areaEfectiva = (el) => {
        const r = el.getBoundingClientRect();
        let w = r.width, h = r.height;
        for (const p of ['::before', '::after']) {
            const cs = getComputedStyle(el, p);
            if (cs.content === 'none' || cs.position === 'static') continue;
            const pw = parseFloat(cs.width), ph = parseFloat(cs.height);
            if (Number.isFinite(pw)) w = Math.max(w, pw);
            if (Number.isFinite(ph)) h = Math.max(h, ph);
        }
        return { w, h, caja: `${Math.round(r.width)}x${Math.round(r.height)}` };
    };
    // Un control que NO PUEDE medir 44 no es deuda: es aritmética. Siete
    // columnas de un gráfico repartiéndose 390px dan 42 cada una, y ampliarlas
    // las haría solaparse entre sí. Se separan de los hallazgos en vez de
    // sumarse.
    //
    // La condición se MIDE y antes se declaraba: la versión anterior excluía a
    // los que tuvieran un `aria-label` que empezara con «Día: », y ese rótulo no
    // lo escribe ningún archivo del proyecto — la excepción nunca excluyó nada y
    // las 14 columnas de los dos gráficos entraban como deuda en cada corrida.
    // Una excepción escrita contra un texto que hay que acordarse de poner es
    // una excepción que no existe.
    const noCabe = (el) => {
        const p = el.parentElement;
        if (!p) return false;
        const cs = getComputedStyle(p);
        if (!cs.display.includes('flex') || cs.flexDirection.startsWith('column')) return false;
        if (getComputedStyle(el).flexGrow === '0') return false;
        // Los hijos POSICIONADOS no reparten el ancho del flex: viven fuera del
        // flujo. Contarlos divide por un número más grande que el real y reporta
        // un blanco más chico de lo que es. Medido el 2026-08-20 en el gráfico
        // de Horarios: la rejilla de líneas punteadas es un `absolute inset-0`
        // adentro de la fila de barras, así que la cuenta daba 8 hermanos para
        // 7 días y 36px por barra donde había 42.
        const hermanos = [...p.children].filter(h => {
            if (h.getBoundingClientRect().width === 0) return false;
            const pos = getComputedStyle(h).position;
            return pos !== 'absolute' && pos !== 'fixed';
        });
        if (hermanos.length < 5) return false;
        // El HUECO entre columnas también se descuenta: sin eso, el gráfico del
        // tablero daba 322/7 = 46 y la regla lo dejaba pasar, cuando sus
        // columnas miden 40 justamente porque seis separaciones de 6px se
        // comen 36 del ancho. El reparto real es (ancho − huecos) / columnas.
        const hueco = parseFloat(getComputedStyle(p).columnGap) || 0;
        const util = p.getBoundingClientRect().width - hueco * (hermanos.length - 1);
        return util / hermanos.length < 44;
    };
    const chicos = [];
    const imposibles = [];
    document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select')
        .forEach(el => {
            if (!visible(el) || !alcanzable(el)) return;
            // Un elemento DECORATIVO no es un blanco táctil. El chevron de las
            // filas de asistencia es `aria-hidden` + `tabIndex={-1}` a
            // propósito: el control real es la fila entera, y el chevron sólo
            // dibuja el estado. Contarlo daba 49 «hallazgos» en una vista donde
            // no hay nada que tocar mal — el mismo error de medir la referencia
            // en vez del cuerpo, por tercera vez en este proyecto.
            if (el.getAttribute('aria-hidden') === 'true') return;
            if (el.tabIndex < 0 && !el.hasAttribute('href')) return;
            // Un `input` escondido dentro de su `<label>` no es el blanco: lo es
            // el label. Es el patrón canónico de casilla accesible —`sr-only
            // peer`, el input a 1×1 y el label pintando el estado— y el dedo
            // siempre cae sobre el label, nunca sobre el input.
            //
            // Se MIDE el label en vez de descartar el caso: si el label cumple no
            // hay nada que arreglar, y si no cumple el hallazgo es real pero hay
            // que reportarlo sobre el label, que es lo que se puede corregir. La
            // primera versión sólo descartaba cuando el label ya cumplía, así que
            // los que no cumplían seguían saliendo como «input de 1×1» — un
            // tamaño que no se puede arreglar porque no es el del control.
            let blanco = el;
            if (el.tagName === 'INPUT') {
                const lab = el.closest('label');
                if (lab) blanco = lab;
            }
            const a = areaEfectiva(blanco);
            if (a.w < 44 || a.h < 44) {
                if (noCabe(blanco)) { imposibles.push({ sel: sel(blanco), tam: `${Math.round(a.w)}x${Math.round(a.h)}` }); return; }
                // Se reporta el BLANCO, no el elemento que disparó la búsqueda:
                // un hallazgo que dice «input de 1×1» manda a arreglar un tamaño
                // que no se puede tocar, porque el control real es su label.
                chicos.push({ sel: sel(blanco),
                              tam: `${Math.round(a.w)}x${Math.round(a.h)} (caja ${a.caja})`,
                              cadena: cadena(blanco),
                              texto: (blanco.textContent || blanco.getAttribute('aria-label') || '').trim().slice(0, 24) });
            }
        });

    // 4 · Inputs con fuente < 16px → iOS hace ZOOM al enfocarlos (fase 3.3)
    const zoomIOS = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
        if (!visible(el)) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 16) zoomIOS.push({ sel: sel(el), fontSize: fs });
    });

    // 5 · Tablas que desbordan sin carril propio (fase 4.1)
    const tablas = [];
    document.querySelectorAll('table').forEach(el => {
        if (!visible(el)) return;
        const r = el.getBoundingClientRect();
        let enCarril = false;
        for (let p = el.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX === 'auto' || s.overflowX === 'scroll') { enCarril = true; break; }
        }
        if (r.width > vw + 1 && !enCarril) tablas.push({ sel: sel(el), ancho: Math.round(r.width) });
    });

    // 6 · overscroll-behavior en el scroll principal (fase 3.4)
    const main = document.querySelector('#main-scroll');
    const overscroll = main ? getComputedStyle(main).overscrollBehavior : '(sin #main-scroll)';

    // 7 · El acuse de recibo del toque (fase 3.4)
    //
    // En un teléfono, `hover:` no existe: si un control no declara un estado
    // `active:`, lo único que confirma el toque es el destello que pinta el
    // navegador — gris ajeno al material del portal, y que el plan pedía
    // apagar. Apagarlo SIN acuse propio deja el control mudo, así que lo que
    // hay que medir es cuántos dependen todavía de él.
    //
    // Se lee el atributo `class` literal y no una regla CSS: Tailwind escapa
    // los dos puntos al generar la clase, pero el atributo conserva el texto
    // (misma propiedad que usa la regla de `group-hover` de index.css).
    const sinAcuse = [];
    document.querySelectorAll('button, a[href], [role="button"]').forEach(el => {
        if (!visible(el) || !alcanzable(el)) return;
        if (el.getAttribute('aria-hidden') === 'true') return;
        // Un control DESHABILITADO no acusa nada porque no pasa nada: es la
        // misma familia que `aria-hidden` de la línea de arriba. El caso que lo
        // destapó es el rótulo «Esta semana» de `PeriodStepper`, que va
        // `disabled` justamente cuando ya estás en la semana actual — pedirle un
        // `active:` sería prometer un viaje que no ocurre, que es la regla que
        // `ListRow` ya aplica al no acusar las filas de sólo lectura.
        //
        // NO se excluye de `chicos`: el tamaño no cambia al habilitarse, así que
        // un control chico sigue siendo chico cuando le toque su turno.
        if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return;
        const clases = el.className?.toString?.() || '';
        if (/active:/.test(clases)) return;
        // ── `data-interactive` TAMBIÉN es acuse (2026-08-20) ─────────────────
        // El detector miraba sólo el atributo `class` buscando `active:`, y por
        // eso acusaba a las superficies que reciben el gel por CSS: `index.css`
        // §1.6 les da `[data-interactive]:active { transform: scale(.994) }`, o
        // sea exactamente lo que se está midiendo, sólo que declarado en una
        // hoja de estilo en vez de en una clase de Tailwind.
        //
        // Medido el 2026-08-20 en Cortes: de los **37** que marcaba, **36
        // llevaban `data-interactive`** — o sea que el 97% del número era el
        // detector acusando al código que hizo bien el trabajo. El mudo de
        // verdad era uno solo, y estaba en TODAS las rutas porque vive en el
        // marco (el disparador de Ajustes y su gemelo del tema).
        //
        // Es el modo de falla que este proyecto ya conoce —«acusar al que hizo
        // bien el trabajo es cómo un gate se termina desactivando»— y acá tenía
        // el agravante de que el número grande tapaba al hallazgo real.
        //
        // El atributo lo pone `clickable()` y no una lista escrita a mano, así
        // que preguntar por él es preguntar exactamente por «esta superficie se
        // apunta y acusa».
        if (el.hasAttribute('data-interactive')) return;
        sinAcuse.push({ sel: sel(el),
                        destello: getComputedStyle(el).webkitTapHighlightColor || '(no expuesto)',
                        cadena: cadena(el),
                        texto: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24) });
    });

    // 8 · Scroll-chaining dentro de hojas y modales (fase 3.4)
    // Un contenedor scrolleable dentro de un diálogo que llega a su tope
    // arrastra a la página de atrás. Es lo único que quedó vigente del punto
    // 3.4 sobre `overscroll-behavior`: en `#main-scroll` el token es `auto` a
    // propósito desde que el móvil scrollea el DOCUMENTO (v2.447.0).
    const encadenan = [];
    document.querySelectorAll('[role="dialog"] *, [data-hoja] *').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') return;
        if (el.scrollHeight <= el.clientHeight) return;
        if (cs.overscrollBehaviorY === 'auto') encadenan.push({ sel: sel(el) });
    });

    // El puntero, porque decide si un número es deuda o no: 44pt es el mínimo
    // del DEDO. En un escritorio con mouse `--tap-min` vale 0 a propósito y un
    // botón de 31px está bien — contarlo como hallazgo mezcla dos cosas y hace
    // que la matriz muestre 23 «problemas» en la columna que no los tiene.
    const tactil = window.matchMedia('(pointer: coarse)').matches;

    // La AGRUPACIÓN, que es lo que decide el trabajo. Un total de 125 hallazgos
    // no dice qué arreglar; «125 = tres botones de acción × 40 filas» dice que
    // es UN arreglo. Se agrupa por forma (el selector más su cadena de
    // ancestros) sobre las listas COMPLETAS, antes de recortarlas para el
    // informe — recortar primero y agrupar después contaría 12 de 125.
    const agrupar = (lista) => {
        const m = new Map();
        lista.forEach(h => {
            const clave = `${h.sel}  ‹ ${h.cadena || ''}`;
            const g = m.get(clave) || { clave, n: 0, muestra: h };
            g.n++; m.set(clave, g);
        });
        return [...m.values()].sort((a, b) => b.n - a.n);
    };

    return { vw, tactil, desbordePagina, desbordan: desbordan.slice(0, 12), chicos: chicos.slice(0, 12),
             grupos: { chicos: agrupar(chicos), desbordan: agrupar(desbordan), sinAcuse: agrupar(sinAcuse) },
             zoomIOS: zoomIOS.slice(0, 8), tablas, overscroll,
             sinAcuse: sinAcuse.slice(0, 8), encadenan,
             imposibles: imposibles.slice(0, 8),
             // ── El toque de la ficha que perdió su destino (F7) ─────────
             // `DataTable` estampa `data-destino` en cada ficha: `propio` si el
             // toque va al destino de la vista, `hoja` si sólo queda la hoja
             // genérica y aporta algo, `ninguno` si no hay nada que abrir, y
             // **`perdido`** cuando HAY un `onClick` de fila y la vista no lo
             // declaró — la hoja genérica le gana al destino real.
             //
             // Se cuenta acá y no en `gate:movil` porque el gate lee el fuente,
             // y una fila envuelta en su propio componente es una caja cerrada:
             // no se puede saber desde afuera si adentro hay un `onClick`. Lo
             // que el análisis estático no alcanza, lo cierra la medición.
             tocarPerdido: document.querySelectorAll('[data-destino="perdido"]').length,
             totales: { desbordan: desbordan.length, chicos: chicos.length, zoomIOS: zoomIOS.length,
                        imposibles: imposibles.length,
                        sinAcuse: sinAcuse.length, encadenan: encadenan.length,
                        tocarPerdido: document.querySelectorAll('[data-destino="perdido"]').length } };
};
