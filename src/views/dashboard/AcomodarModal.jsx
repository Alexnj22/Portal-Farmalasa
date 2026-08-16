import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, RotateCcw, X } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import { reacomodar } from '../../utils/acomodoWidgets';

// El tablero entero, en chico, para acomodarlo de una sentada.
//
// ── Por qué existe (2026-08-16) ───────────────────────────────────────────
// Reportado por el usuario: «el movimiento de widget se siente torpe, al pasar
// de un lado a otro, desordena todo lo que había ordenado». Eran tres
// problemas distintos con un solo síntoma, y este modal resuelve dos:
//
//   1. El acomodo se rebarajaba solo. Eso NO se arregla acá — se arregló en la
//      regla (`utils/acomodoWidgets`), que hoy intercambia en vez de dispersar
//      y que usan por igual el tablero y este modal.
//
//   2. **Arrastrar a ciegas.** En el tablero se arrastra una tarjeta de 400px
//      por una página que scrollea: el origen y el destino no caben juntos en
//      pantalla, así que hay que soltar, bajar y volver a empezar. Acá el
//      tablero entero entra sin scroll —cada widget es su título y su medida—
//      y mover algo es un gesto corto con las dos puntas a la vista.
//
//   3. **No había cómo arrepentirse.** Cada soltada se guardaba al instante
//      (estado + localStorage + base a los 1.5s). Acá se edita un BORRADOR:
//      «Listo» guarda y «Cancelar» descarta, así que probar no cuesta nada.
//
// La idea es del usuario, con una corrección: el tamaño no se cambia con un
// asa en la esquina de una ficha de 60×44 —imposible de agarrar con el dedo—
// sino eligiendo la ficha y usando el control de abajo, que es el canónico y
// ya trae los 44px de toque.
//
// El alto de la fila NO es fijo, y ése fue el primer intento fallido: con 46px
// por renglón, el tablero real de General —14 renglones— medía 728px y el
// editor terminaba scrolleando, que es exactamente lo que venía a evitar
// (verificado con captura). Hoy los renglones se reparten el alto disponible
// (`1fr`) entre un piso y un techo, así que el tablero entra completo salvo que
// sea enorme, y si es corto no se estira hasta quedar ridículo.
//
// El piso son 24px: lo que necesita una línea de `text-label` con `py-1`. Por
// eso la ficha dice el rótulo y la medida en UNA línea y no en dos — la segunda
// obligaba a un piso de 40 y hacía scrollear a los tableros medianos. Medido
// sobre el tablero real de General, que es el más largo que existe hoy: 18
// renglones de contenido más la franja libre = 19 × 24 + 18 × 6 = 564px, contra
// los ~565 que deja el modal en una pantalla de 900. Entra entero, que era el
// punto. Uno más largo scrollea, y para eso el cuerpo sigue teniendo su scroll.
const FILA_MIN = 24;
const FILA_MAX = 52;
const HUECO = 6;

// Dónde empieza cada pista de la retícula, leído del estilo COMPUTADO.
//
// No se calcula dividiendo el alto de la caja entre el número de renglones, y
// ése fue el segundo intento fallido: con `minmax(26px, 1fr)` los renglones
// dejan de repartirse por igual en cuanto el tablero no entra —se van todos al
// piso— así que la división da un paso que no existe. Medido en el tablero real
// de General: 27.75px calculados contra 32 reales, y soltar sobre la fila 9
// caía en la 10, con lo que el intercambio no se disparaba y el tablero se
// empujaba. Leer las pistas es exacto aunque midan distinto entre sí.
const pistasDe = (rejilla) => {
    const cs = getComputedStyle(rejilla);
    const arma = (valor) => {
        const inicios = [];
        let acumulado = 0;
        for (const t of valor.split(' ').map(parseFloat)) {
            if (Number.isNaN(t)) continue;
            inicios.push(acumulado);
            acumulado += t + HUECO;
        }
        return inicios;
    };
    return { cols: arma(cs.gridTemplateColumns), filas: arma(cs.gridTemplateRows) };
};

/** En qué pista (0-indexada) cae una posición relativa a la retícula. */
const pistaEn = (inicios, pos) => {
    let i = 0;
    while (i + 1 < inicios.length && inicios[i + 1] <= pos) i++;
    return i;
};

export default function AcomodarModal({
    abierto,
    onCerrar,
    titulo,
    columnas,
    // { id, label, icon, encendido, permitido }
    widgets,
    acomodo,          // { [id]: { col, row } }  — sólo los encendidos
    medidas,          // { [id]: { cols, rows } } — efectivas, ya recortadas
    minimos,          // (id) => { minCols, minRows }
    onAplicar,        // ({ acomodo, medidas, apagados })
    onRestablecer,
}) {
    // ── El borrador ───────────────────────────────────────────────────────
    // Se rearma en cada apertura y no en cada render: si leyera las props
    // vivas, guardar de fondo mientras el modal está abierto le pisaría a la
    // persona lo que está moviendo.
    const [bAcomodo, setBAcomodo] = useState(acomodo);
    const [bMedidas, setBMedidas] = useState(medidas);
    const [bEncendidos, setBEncendidos] = useState(() => new Set(
        widgets.filter(w => w.encendido && w.permitido).map(w => w.id)));
    const [elegido, setElegido] = useState(null);

    useEffect(() => {
        if (!abierto) return;
        setBAcomodo(acomodo);
        setBMedidas(medidas);
        setBEncendidos(new Set(widgets.filter(w => w.encendido && w.permitido).map(w => w.id)));
        setElegido(null);
        // Sólo al abrir: las props siguen cambiando abajo mientras el tablero
        // se refresca solo, y volver a copiarlas descartaría el trabajo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [abierto]);

    const rotulos = useMemo(
        () => Object.fromEntries(widgets.map(w => [w.id, w])), [widgets]);

    const medidaDe = useCallback((id) => ({
        cols: Math.min(bMedidas[id]?.cols ?? minimos(id).minCols, columnas),
        rows: bMedidas[id]?.rows ?? minimos(id).minRows,
    }), [bMedidas, minimos, columnas]);

    const puestos = useMemo(
        () => Object.keys(bAcomodo).filter(id => bEncendidos.has(id) && rotulos[id]),
        [bAcomodo, bEncendidos, rotulos]);

    const apagados = useMemo(
        () => widgets.filter(w => w.permitido && !bEncendidos.has(w.id)),
        [widgets, bEncendidos]);

    // La retícula necesita existir hasta la última fila ocupada, más UNA franja
    // libre abajo: sin ella no hay dónde apuntar para alargar el tablero. Una
    // sola y no dos —que es lo que había— porque cada renglón de más son 30px
    // que le faltan al de arriba para entrar. Alcanza: soltar en esa franja
    // coloca el widget aunque mida tres de alto, y `filas` se estira sola en la
    // pintada siguiente.
    const filas = useMemo(() => Math.max(
        4, ...puestos.map(id => (bAcomodo[id]?.row ?? 1) + medidaDe(id).rows - 1)) + 1,
        [puestos, bAcomodo, medidaDe]);

    // ── Arrastre sobre la retícula chica ──────────────────────────────────
    const rejillaRef = useRef(null);
    const arrastreRef = useRef({ id: null, arranco: false, x0: 0, y0: 0, desCol: 0, desFila: 0, pistas: null });
    const [arrastrando, setArrastrando] = useState(null);
    const [destino, setDestino] = useState(null);   // { col, row }

    const calcularDestino = useCallback((x, y, id) => {
        const caja = rejillaRef.current?.getBoundingClientRect();
        const { desCol, desFila, pistas } = arrastreRef.current;
        if (!caja || !pistas) return null;
        const m = medidaDe(id);
        // Se descuenta POR DÓNDE se agarró la ficha, y no es un detalle fino:
        // sin esto la esquina superior izquierda va a parar debajo del puntero,
        // así que agarrar un 2×2 por el medio y soltarlo sobre otro 2×2 lo deja
        // corrido una celda — pisando a DOS vecinos en vez de a uno, con lo que
        // el intercambio no se dispara y el tablero se empuja.
        const col = Math.max(1, Math.min(columnas - m.cols + 1,
            pistaEn(pistas.cols, x - caja.left) + 1 - desCol));
        const row = Math.max(1, pistaEn(pistas.filas, y - caja.top) + 1 - desFila);
        return { col, row };
    }, [columnas, medidaDe]);

    const empezar = useCallback((e, id) => {
        e.preventDefault();
        setElegido(id);
        // Cuántas pistas hay entre el puntero y la esquina de la ficha, para que
        // el widget viaje agarrado de donde uno lo tomó. El `+1` es contra el
        // redondeo: la esquina de la ficha cae justo sobre el inicio de su
        // pista, y medio píxel de menos la clasifica en la anterior.
        const rejilla = rejillaRef.current;
        const caja    = rejilla?.getBoundingClientRect();
        const ficha   = e.currentTarget.getBoundingClientRect();
        const pistas  = rejilla ? pistasDe(rejilla) : null;
        let desCol = 0, desFila = 0;
        if (pistas && caja) {
            desCol  = pistaEn(pistas.cols,  e.clientX - caja.left)
                    - pistaEn(pistas.cols,  ficha.left - caja.left + 1);
            desFila = pistaEn(pistas.filas, e.clientY - caja.top)
                    - pistaEn(pistas.filas, ficha.top  - caja.top  + 1);
        }
        Object.assign(arrastreRef.current, {
            id, arranco: false, x0: e.clientX, y0: e.clientY, desCol, desFila, pistas });

        const alMover = (ev) => {
            const ref = arrastreRef.current;
            if (!ref.arranco) {
                // 6px y no 8: en la retícula chica una celda mide ~60px, así que
                // el umbral del tablero grande se comía un décimo del recorrido.
                if (Math.hypot(ev.clientX - ref.x0, ev.clientY - ref.y0) < 6) return;
                ref.arranco = true;
                setArrastrando(id);
            }
            setDestino(calcularDestino(ev.clientX, ev.clientY, id));
        };
        const alSoltar = (ev) => {
            const ref = arrastreRef.current;
            if (ref.arranco) {
                const d = calcularDestino(ev.clientX, ev.clientY, id);
                if (d) setBAcomodo(prev => reacomodar(id, d.col, d.row, prev, medidaDe, columnas));
            }
            Object.assign(arrastreRef.current, { id: null, arranco: false });
            setArrastrando(null); setDestino(null);
            window.removeEventListener('pointermove', alMover);
            window.removeEventListener('pointerup', alSoltar);
            window.removeEventListener('pointercancel', alSoltar);
        };
        window.addEventListener('pointermove', alMover, { passive: true });
        window.addEventListener('pointerup', alSoltar);
        window.addEventListener('pointercancel', alSoltar);
    }, [calcularDestino, medidaDe, columnas]);

    // ── Tamaño, encender y apagar ─────────────────────────────────────────
    const cambiarMedida = useCallback((id, dim, valor) => {
        setBMedidas(prev => {
            const nuevas = { ...prev, [id]: { ...medidaDe(id), [dim]: valor } };
            // Crecer puede desbordar la retícula por la derecha: se corre a la
            // izquierda ANTES de resolver, o el widget quedaría fuera de campo.
            setBAcomodo(acom => {
                const p = acom[id];
                if (!p) return acom;
                const col = dim === 'cols' ? Math.max(1, Math.min(p.col, columnas - valor + 1)) : p.col;
                const base = col !== p.col ? { ...acom, [id]: { ...p, col } } : acom;
                const medir = (wid) => ({
                    cols: Math.min(nuevas[wid]?.cols ?? minimos(wid).minCols, columnas),
                    rows: nuevas[wid]?.rows ?? minimos(wid).minRows,
                });
                return reacomodar(id, col, p.row, base, medir, columnas);
            });
            return nuevas;
        });
    }, [medidaDe, minimos, columnas]);

    const apagar = useCallback((id) => {
        setBEncendidos(prev => { const n = new Set(prev); n.delete(id); return n; });
        setElegido(null);
    }, []);

    const encender = useCallback((id) => {
        setBEncendidos(prev => { const n = new Set(prev); n.add(id); return n; });
        // Al fondo y a la izquierda: es el único sitio que con seguridad está
        // libre, y deja que la persona lo arrastre a donde lo quiere. Meterlo
        // en el primer hueco lo pondría en medio de lo que acaba de acomodar.
        setBAcomodo(prev => {
            if (prev[id]) return prev;
            const abajo = Object.keys(prev).reduce(
                (max, wid) => Math.max(max, (prev[wid]?.row ?? 1) + medidaDe(wid).rows - 1), 0);
            return { ...prev, [id]: { col: 1, row: abajo + 1 } };
        });
        setElegido(id);
    }, [medidaDe]);

    const aplicar = () => {
        onAplicar({
            acomodo: Object.fromEntries(Object.entries(bAcomodo).filter(([id]) => bEncendidos.has(id))),
            medidas: bMedidas,
            apagados: widgets.filter(w => w.permitido && !bEncendidos.has(w.id)).map(w => w.id),
        });
        onCerrar();
    };

    if (!abierto) return null;

    const elegidoM = elegido ? medidaDe(elegido) : null;
    const elegidoMin = elegido ? minimos(elegido) : null;

    return (
        <LiquidModal open={abierto} onClose={onCerrar} maxWidth="max-w-4xl"
            ariaLabel={`Acomodar ${titulo}`}>
            <LiquidModal.Header>
                <div className="flex items-center justify-between gap-3 w-full">
                    <div className="min-w-0">
                        <p className="text-body font-black text-content truncate">Acomodar {titulo}</p>
                        <p className="text-label font-semibold text-content-3">
                            Arrastra para mover · toca uno para cambiarle el tamaño
                        </p>
                    </div>
                    <Button variant="ghost" iconOnly icon={X} onClick={onCerrar} aria-label="Cerrar" />
                </div>
            </LiquidModal.Header>

            {/* `flex flex-col min-h-0`: el cuerpo reparte su alto entre el
                aviso, la retícula y los apagados, y la retícula se queda con lo
                que sobra. Sin `min-h-0` un hijo flex no puede achicarse por
                debajo de su contenido y la retícula empuja al pie fuera del
                modal en vez de comprimirse. */}
            <LiquidModal.Body className="flex flex-col gap-3 min-h-0">
                <Notice variant="neutral" compact>
                    Éste es tu tablero en chico. Nada se guarda hasta que toques <b>Listo</b>.
                </Notice>

                {/* El LIENZO del editor, y `--thead-bg` no es decorativo.
                    Reportado con captura el 2026-08-16: «no se distingue bien,
                    no se logra leer». Medido en Liquid claro, que es donde
                    pasa: el panel del modal deja pasar el 49% y las fichas
                    estaban a **16%** de opacidad y sin desenfoque propio, así
                    que el tablero de atrás llegaba al texto al **41%** de su
                    color — con las barras naranjas y azules de las gráficas
                    justo debajo. En Solid no se ve (todo es opaco) y en oscuro
                    casi tampoco (la ficha es 58%), que es por qué las capturas
                    de la sesión anterior no lo mostraron: estaban tomadas con
                    la cuenta de QA, que usa Solid.

                    El canon ya tenía la respuesta y no era subirle la opacidad
                    al panel —eso está decidido al revés (§LiquidModal: dos
                    superficies apiladas dan un modal «casi opaco» y se
                    consideró un defecto)— sino §5.bis: **una superficie que
                    tiene que ocluir usa `--thead-bg`, nunca una opacidad de
                    acento; lo que pasa por debajo se lee a través**. Es
                    literalmente el caso del encabezado pegajoso de una tabla, y
                    `--thead-bg` está entre 97% y 98% en los cuatro temas.

                    Va acá y no en la regla global de superficie anidada de
                    `index.css`: esa regla sólo cubre tarjeta-dentro-de-tarjeta y
                    extenderla a los paneles cambiaría el aspecto de las
                    tarjetas de 117 archivos, la mayoría dentro de modales, sin
                    haberlas mirado. */}
                <div className="flex-1 min-h-0 flex flex-col rounded-card border border-divider p-2"
                     style={{ background: 'var(--thead-bg)' }}>
                <div
                    ref={rejillaRef}
                    className="grid select-none flex-1 min-h-0"
                    style={{
                        gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`,
                        // Los renglones se reparten lo disponible, con piso y
                        // techo. El techo es lo que evita que un tablero de tres
                        // renglones dibuje fichas de 200px de alto.
                        gridTemplateRows: `repeat(${filas}, minmax(${FILA_MIN}px, 1fr))`,
                        maxHeight: `${filas * FILA_MAX + (filas - 1) * HUECO}px`,
                        gap: `${HUECO}px`,
                    }}
                >
                    {/* La sombra del destino. Va primero para quedar por debajo
                        de las fichas: pintarla encima taparía el título justo
                        de la que se está moviendo. */}
                    {arrastrando && destino && (
                        <div
                            aria-hidden
                            style={{
                                gridColumnStart: destino.col, gridRowStart: destino.row,
                                gridColumnEnd: `span ${medidaDe(arrastrando).cols}`,
                                gridRowEnd: `span ${medidaDe(arrastrando).rows}`,
                            }}
                            className="rounded-xl border-2 border-dashed border-brand/60 bg-brand/10"
                        />
                    )}

                    {puestos.map(id => {
                        const w = rotulos[id];
                        const m = medidaDe(id);
                        const p = bAcomodo[id];
                        const Icono = w.icon;
                        const activo = elegido === id;
                        const movido = arrastrando === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                onPointerDown={e => empezar(e, id)}
                                onClick={() => setElegido(id)}
                                aria-pressed={activo}
                                style={{
                                    gridColumnStart: p.col, gridRowStart: p.row,
                                    gridColumnEnd: `span ${m.cols}`, gridRowEnd: `span ${m.rows}`,
                                    opacity: movido ? 0.35 : 1,
                                    // El escalón sobre el lienzo, que es el que
                                    // el canon define para una superficie dentro
                                    // de otra (§5.bis, `--anidada`). Antes acá
                                    // iba `bg-surface-card`, que a 16% en Liquid
                                    // claro no es un escalón: es un vidrio sobre
                                    // otro vidrio, y a través se leía el
                                    // tablero. `--anidada` ACLARA sobre material
                                    // translúcido y OSCURECE sobre blanco opaco
                                    // — el token ya resuelve la dirección por
                                    // tema, que es lo que un color a mano no
                                    // puede hacer.
                                    ...(activo ? {} : { background: 'var(--anidada)' }),
                                }}
                                className={`min-w-0 rounded-[var(--card-radius-anidada)] border px-2 py-1 text-left
                                    touch-none cursor-grab active:cursor-grabbing
                                    transition-[background-color,border-color] duration-[var(--dur-fast)]
                                    ${activo
                                        ? 'bg-brand/25 border-brand/60'
                                        : 'border-divider hover:bg-surface-card-hover'}`}
                            >
                                {/* Rótulo y medida en UNA línea: la segunda
                                    obligaba a un renglón de 40px de piso y hacía
                                    scrollear el editor, que es lo que vino a
                                    evitar. La medida es `shrink-0` — lo que se
                                    recorta cuando no hay ancho es el nombre, que
                                    se adivina; «2×3» no. */}
                                <span className="flex items-center gap-1.5 min-w-0">
                                    <GripVertical size={11} className="shrink-0 text-content-3" />
                                    {Icono && <Icono size={11} className={`shrink-0 ${activo ? 'text-brand-text' : 'text-content-3'}`} />}
                                    <span className={`min-w-0 truncate text-label font-black ${activo ? 'text-brand-text' : 'text-content'}`}>
                                        {w.label}
                                    </span>
                                    <span className="shrink-0 text-micro font-semibold text-content-3 tabular-nums">
                                        {m.cols}×{m.rows}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
                </div>

                {apagados.length > 0 && (
                    <div className="flex-none">
                        <p className="text-micro font-black uppercase tracking-widest text-content-3 mb-1.5">
                            Apagados · toca uno para agregarlo abajo
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                            {apagados.map(w => {
                                const Icono = w.icon;
                                // Ocluye igual que el lienzo: estas píldoras sí
                                // quedan apoyadas sobre el vidrio del panel, y
                                // con `bg-surface-card` se leía el tablero a
                                // través del rótulo.
                                return (
                                    <button key={w.id} type="button" onClick={() => encender(w.id)}
                                        style={{ background: 'var(--thead-bg)' }}
                                        className="inline-flex items-center gap-1.5 rounded-full border border-divider
                                            px-2.5 py-1.5 hover:bg-surface-card-hover
                                            transition-colors duration-[var(--dur-fast)]">
                                        <Plus size={11} className="text-content-3" />
                                        {Icono && <Icono size={11} className="text-content-3" />}
                                        <span className="text-label font-semibold text-content-2">{w.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <div className="flex flex-wrap items-center gap-2 w-full">
                    {/* El control del elegido. Ocupa el sitio de «Restablecer»
                        en vez de sumarse: son las dos cosas que se hacen desde
                        acá abajo y nunca a la vez. */}
                    {elegido && rotulos[elegido] ? (
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span className="text-label font-black text-content truncate max-w-[150px]">
                                {rotulos[elegido].label}
                            </span>
                            <SegmentedControl size="sm" label="Ancho"
                                value={elegidoM.cols}
                                onChange={n => cambiarMedida(elegido, 'cols', n)}
                                options={Array.from({ length: columnas }, (_, i) => ({
                                    value: i + 1, label: String(i + 1),
                                    // Por debajo del mínimo el widget no dibuja
                                    // su contenido: se ofrece apagado en vez de
                                    // dejar elegir un tamaño que no sirve.
                                    disabled: i + 1 < elegidoMin.minCols,
                                }))} />
                            <span className="text-micro font-black text-content-3">×</span>
                            <SegmentedControl size="sm" label="Alto"
                                value={elegidoM.rows}
                                onChange={n => cambiarMedida(elegido, 'rows', n)}
                                options={[1, 2, 3, 4].map(n => ({
                                    value: n, label: String(n), disabled: n < elegidoMin.minRows,
                                }))} />
                            <Button variant="secondary" icon={X} onClick={() => apagar(elegido)}>
                                Quitar
                            </Button>
                        </div>
                    ) : (
                        <Button variant="secondary" icon={RotateCcw} onClick={onRestablecer}>
                            Restablecer
                        </Button>
                    )}
                    <div className="flex items-center gap-2 ml-auto">
                        <Button variant="secondary" onClick={onCerrar}>Cancelar</Button>
                        <Button onClick={aplicar}>Listo</Button>
                    </div>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
