// Instrumento de la auditoría de ESCRITORIO — el hermano de `medicion-movil.js`.
//
// ── Por qué existe ───────────────────────────────────────────────────────────
// El barrido móvil recorre las 37 rutas × 4 temas, con pestañas y diálogos, y
// está en cero. Pero corre `devices['iPhone 13']` y nada más: mide el teléfono.
//
// El 2026-08-09, revisando Ventas a ojo, apareció esto: a **1440×900 con el menú
// abierto** —el ancho de portátil más común— las ocho columnas de la lista no
// entraban en los ~1080px de marco útil, y la que quedaba cortada era **Total**:
// `$3.`, `$28.`, `$8.`, a media cifra. O sea que el número por el que existe la
// pantalla era legible en el teléfono e ilegible en la computadora, y 37 rutas
// barridas exhaustivamente no lo vieron nunca porque nadie miraba ese ancho.
//
// Las reglas de acá salen de defectos observados, no de un catálogo. Cada una
// nombra el caso que la originó.
//
// Igual que el medidor móvil: todo esto se serializa a `page.evaluate`, así que
// NO puede cerrar sobre variables del módulo — cada función define sus ayudantes
// adentro.

export const MEDIR_ESCRITORIO = () => {
    const vw = document.documentElement.clientWidth;

    const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        for (let p = el; p; p = p.parentElement) {
            const cs = getComputedStyle(p);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        }
        return true;
    };
    const sel = (el) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = (el.className?.toString?.() || '').trim().split(/\s+/).slice(0, 3).join('.');
        return `${el.tagName.toLowerCase()}${id}${cls ? '.' + cls : ''}`;
    };
    const cadena = (el) => {
        const out = [];
        for (let p = el.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) out.push(sel(p));
        return out.join(' ‹ ');
    };
    // El ancestro que RECORTA: el primero con overflow-x que no sea `visible`.
    // Se arranca en el padre y no en el elemento: un carril que scrollea es la
    // solución, no el problema — mirarlo a él sería acusar a quien hizo bien el
    // trabajo, que es el modo de falla que el medidor móvil ya documenta.
    const recortador = (el) => {
        for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return p;
        }
        return null;
    };

    // ── 1 · La última columna, fuera del marco ───────────────────────────────
    //
    // El caso de Ventas. No alcanza con «la tabla scrollea de lado»: una tabla
    // ancha con carril propio puede estar bien —es lo que `DataTable` hace a
    // propósito en el teléfono—. Lo que NO puede pasar es que la última columna,
    // que es donde vive el ancla de la fila (total, monto, estado), termine más
    // allá del borde de su marco: se entra a la lista por ese número.
    //
    // Se miden las tres primeras filas y no el `thead`, porque el encabezado
    // puede tener otro ancho que la celda —y porque buscar el `<th>` por su
    // texto ya falló una vez: enganchó otro encabezado y dijo «entra» mientras
    // la captura mostraba lo contrario.
    // Excepción declarada, con su motivo — la misma convención que
    // `EXCEPCIONES` en `scripts/mobile-gate.mjs`.
    //
    // El calendario semanal de Horarios (`#schedule-table-scroll`) se pasa por
    // **12px** a 1440 y no hay nada que arreglar: su fila no es un registro
    // sino un empleado cruzado con siete días, y su carril horizontal es la
    // decisión correcta —ya está declarado así en el gate móvil por el mismo
    // motivo—. Acusarlo sería pedirle que esconda un día de la semana.
    const exceptuado = (marco) => !!marco.closest('#schedule-table-scroll');

    const columnasFuera = [];
    document.querySelectorAll('table').forEach((t) => {
        if (!visible(t)) return;
        const marco = recortador(t);
        if (!marco) return;
        if (exceptuado(marco)) return;
        const rm = marco.getBoundingClientRect();
        if (marco.scrollWidth <= marco.clientWidth + 1) return;   // no hay recorte
        const filas = [...t.querySelectorAll('tbody tr')].slice(0, 3);
        for (const tr of filas) {
            const celdas = [...tr.children].filter(td => getComputedStyle(td).display !== 'none');
            const ultima = celdas[celdas.length - 1];
            if (!ultima) continue;
            const r = ultima.getBoundingClientRect();
            if (r.right > rm.right + 1) {
                // ¿Qué se está perdiendo? No siempre es el ancla.
                //
                // En Ventas la columna cortada era **Total** y eso es grave: el
                // número por el que se entra a la lista. En Mín·Máx la cortada
                // es la de **acciones** —«Poner 0 · Restaurar · Más»— y eso es
                // otro defecto: los botones existen y no se alcanzan. Los dos
                // hay que arreglarlos, pero no son la misma urgencia y mezclarlos
                // en un solo número hace que el orden de trabajo salga mal.
                const esAcciones = !!ultima.querySelector('button, a[href], [role="button"]');
                columnasFuera.push({
                    sel: sel(t), cadena: cadena(t),
                    esAcciones,
                    columnas: celdas.length,
                    sobra: Math.round(r.right - rm.right),
                    marco: `${Math.round(rm.width)}px`,
                    contenido: `${marco.scrollWidth}px`,
                    texto: (ultima.textContent || '').trim().slice(0, 24),
                });
                break;   // una vez por tabla: son la misma columna
            }
        }
    });

    // ── 2 · Un carril que recorta donde no hacía falta ───────────────────────
    //
    // El carril de indicadores de Ventas: tres tarjetas, una flecha, y la
    // tercera cortada a media ficha a 1440px. Un carril está bien cuando el
    // contenido de verdad no entra; está mal cuando recorta en un ancho donde
    // habría entrado de no estar encerrado.
    //
    // Por eso no se reporta «hay carril con scroll» —eso es normal— sino carril
    // con un hijo cortado Y cuyo contenido cabría en el ancho de la ventana. La
    // diferencia entre `clientWidth` y `vw` es lo que el carril se está negando
    // a usar.
    const carrilesRecortados = [];
    document.querySelectorAll('*').forEach((el) => {
        const ox = getComputedStyle(el).overflowX;
        if (ox !== 'auto' && ox !== 'scroll') return;
        if (!visible(el)) return;
        if (el.scrollWidth <= el.clientWidth + 1) return;
        if (el.querySelector('table')) return;              // eso es la regla 1
        const r = el.getBoundingClientRect();
        const cortados = [...el.children].filter((c) => {
            const rc = c.getBoundingClientRect();
            return rc.width > 0 && rc.right > r.right + 1;
        });
        if (!cortados.length) return;
        // ¿Habría entrado? Sólo se acusa si el contenido cabe en la ventana: si
        // no cabe ni ahí, el carril es la respuesta correcta y no un defecto.
        if (el.scrollWidth > vw - 32) return;
        carrilesRecortados.push({
            sel: sel(el), cadena: cadena(el),
            hijos: el.children.length, cortados: cortados.length,
            marco: `${Math.round(r.width)}px`, contenido: `${el.scrollWidth}px`,
            sobraDelMarco: Math.round(vw - r.width),
        });
    });

    // ── 3 · Texto cortado donde nombra la cosa ───────────────────────────────
    //
    // Truncar el nombre de un cliente en una celda es correcto: la fila tiene un
    // ancho y el dato no. Truncar el ENCABEZADO que dice qué es esa columna, la
    // pestaña, el rótulo o el botón, no: ahí el texto **es** la función.
    //
    // Se exige que el corte esté ocurriendo de verdad (`scrollWidth` mayor que
    // `clientWidth`), no que la clase esté puesta. Una clase `truncate` sobre un
    // texto que entra no recorta nada.
    const textosCortados = [];
    document.querySelectorAll('th, h1, h2, h3, h4, button, label, [role="tab"]').forEach((el) => {
        if (!visible(el)) return;
        const cs = getComputedStyle(el);
        if (cs.textOverflow !== 'ellipsis') return;
        if (el.scrollWidth <= el.clientWidth + 1) return;
        const txt = (el.textContent || '').trim();
        if (!txt) return;
        textosCortados.push({
            sel: sel(el), cadena: cadena(el),
            texto: txt.slice(0, 40),
            visible: `${Math.round(el.clientWidth)}px`, necesita: `${el.scrollWidth}px`,
        });
    });

    return {
        marco: `${vw}×${document.documentElement.clientHeight}`,
        columnasFuera, carrilesRecortados, textosCortados,
    };
};

// ── 4 · Cuántas pantallas hay que scrollear ──────────────────────────────────
//
// La medida que destapó Inicio: 5,874px en un viewport de 844 son **siete
// pantallas**, y la segunda era entera un gráfico vacío. No es un defecto por sí
// misma —una lista larga scrollea, y está bien— pero ordena: la vista que pide
// siete pantallas para su primera lectura es la que hay que ir a mirar.
//
// Corre en el teléfono, que es donde el scroll cuesta.
export const MEDIR_SCROLL = () => {
    const alto = document.documentElement.scrollHeight;
    const vp = window.innerHeight || document.documentElement.clientHeight;
    const nodos = document.getElementsByTagName('*').length;
    // ⚠️ Una vista que no cargó mide `pantallas: 1` — el alto del documento es
    // exactamente el del viewport porque no hay nada que desborde. Y `1` se lee
    // como «esta vista entra en una pantalla», que es la mejor nota posible.
    //
    // Pasó en la primera corrida: 15 de 19 rutas dieron 1 con **112 elementos**,
    // o sea el cascarón de la app sin contenido, mientras Ventas daba 7.3 con
    // 1,714. Si eso hubiera entrado al informe como dato, el orden de trabajo se
    // habría armado sobre quince ceros que en realidad eran mediciones fallidas.
    //
    // Cero hallazgos y cero datos se ven igual, así que se distinguen: el
    // umbral es el cascarón medido (112) con margen.
    const valida = nodos >= 300;
    return {
        alto, viewport: vp, nodos, valida,
        pantallas: valida ? Math.round((alto / vp) * 10) / 10 : null,
    };
};
