import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SegmentedControl from '../../components/common/SegmentedControl';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Switch from '../../components/common/Switch';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import { SkeletonText } from '../../components/common/StateViews';
import { AnimatePresence, motion } from 'framer-motion';
import { normSearch } from '../../utils/searchUtils';
import {
    Loader2, Check, X, Ban, AlertTriangle, Package,
    Sparkles, FlaskConical, Box, Layers, Sigma, ArrowRight, Building2,
} from 'lucide-react';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { DataTable, DataRow, DataCell, useExpandStyle } from '../../components/common/DataTable';
import TablePagination                   from '../../components/common/TablePagination';
import FilterBar    from '../../components/common/FilterBar';
import LiquidSelect from '../../components/common/LiquidSelect';
import Notice       from '../../components/common/Notice';
import {
    fetchProductPresentacionesForDispatch, fetchLaboratorios, fetchAllDispatchRules,
    fetchActiveProductsCount, fetchNewProductsThisMonth, fetchProductsWithLabPage,
    deleteDispatchRule, updateDispatchRule, insertDispatchRule,
} from '../../data/dispatchRules';
import PortalInput from '../../components/common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';
import ExpedienteMovil from '../../components/common/ExpedienteMovil';
import { useExpedienteMovil, CORTE_TELEFONO } from '../../components/common/usarExpediente';
import useMediaQuery from '../../hooks/useMediaQuery';

const MULTIPLO_PILLS = [1, 2, 3, 5, 10, 25, 50];
const EASE           = [0.16, 1, 0.3, 1];

const EMPTY_VALS = { dispatch_id_presentacion: null, dispatch_multiplo: '1', notes: '', dispatch_label: '', caja_especial: false };

const COLS = [
    { key: 'laboratorio_nombre', label: 'Laboratorio',     align: 'left',   sortable: true },
    { key: 'nombre',             label: 'Producto',        align: 'left',   sortable: true },
    // `w-36` y no `w-28`: a 112px «Con regla» no entraba en un renglón y el badge
    // se partía en dos («Con» / «regla»), que es lo que se reportó. El ancho de
    // una columna de estado se mide con el rótulo MÁS LARGO más el relleno de
    // celda (`px-4 md:px-6`, o sea 48px), no con el más corto.
    { key: 'estado',             label: 'Estado',          align: 'center', className: 'w-36', sortable: true },
    { key: 'despacho',           label: 'Regla despacho',  align: 'center', className: 'w-44', sortable: true },
    { key: 'notas',              label: 'Notas',           align: 'left'   },
];

// La píldora de la columna "Regla despacho". Devuelve las props del canónico
// `Badge` —no clases sueltas—: estaba escrita a mano con `rounded-full` fijo y
// su propio par bg/texto, o sea un badge que no seguía al tema (en Solid la
// forma es tensa, no redonda) y que se salía del contraste que `Badge` resuelve
// por variante. Fuera del componente: no se recrea en cada render.
function ruleTypeLabel(rule) {
    if (!rule) return null;
    if (rule.dispatch_id_presentacion) {
        const label = rule.dispatch_label || null;
        const tipo  = label ?? rule.dispatch_tipo ?? '–';
        const mult  = rule.dispatch_multiplo ?? 1;
        const { variant } = presStyle(label ? 'CAJA' : tipo);
        // `solid` es el mismo relleno que lleva la tarjeta elegida en el panel:
        // la fila y el editor hablan del mismo tipo con el mismo color.
        return { text: mult > 1 ? `${tipo} ×${mult}` : tipo, variant, tone: 'solid' };
    }
    // Las tres reglas viejas (pre-presentaciones) van en `soft`: describen un
    // formato heredado, no una elección vigente del editor.
    if (rule.multiplo          != null) return { text: `×${rule.multiplo} cajas`,     variant: 'chart-1', tone: 'soft' };
    if (rule.blister           != null) return { text: `×${rule.blister} blíst.`,     variant: 'chart-3', tone: 'soft' };
    if (rule.multiplo_unidades != null) return { text: `×${rule.multiplo_unidades}u`, variant: 'chart-6', tone: 'soft' };
    return { text: 'Solo cajas', variant: 'neutral', tone: 'soft' };
}

// Icono + color según tipo de presentación.
// El color identifica el TIPO y solo se pinta cuando la opción está elegida —
// el mismo color que después lleva el badge de la fila. Sin elegir, el ícono va
// en `content-3` como cualquier otro: si el color también viviera en el estado
// inactivo dejaría de señalar cuál está activo, que es justo lo que se reportó.
//
// `variant` es la clave del canónico `Badge` y `bg`/`text` son las clases que
// pinta la tarjeta elegida del panel, que NO es un badge. Salen de la misma
// función a propósito: son dos formas de decir el mismo tipo, y separarlas es
// como se llega a que la fila diga azul y el editor verde.
const presStyle = (tipo) => {
    const t = (tipo || '').toUpperCase();
    if (t.startsWith('CAJA') || t.startsWith('BOLSA'))
        return { Icon: Box,     variant: 'chart-8', bg: 'bg-chart-8-solid', text: 'text-white' };
    if (t.startsWith('BLISTER') || t.startsWith('SOBRE'))
        return { Icon: Layers,  variant: 'chart-3', bg: 'bg-chart-3-solid', text: 'text-white' };
    if (t === 'UNIDAD' || t === 'UNIDADES' || t === 'PAR' || t === 'PARES')
        return { Icon: Sigma,   variant: 'chart-6', bg: 'bg-chart-6-solid', text: 'text-white' };
    return { Icon: Package, variant: 'chart-1', bg: 'bg-chart-1-solid', text: 'text-white' };
};

// ── Stat card ─────────────────────────────────────────────────────────────────

// Cuánto se despacha ante una necesidad de N unidades. Es la MISMA cuenta que
// hace el pedido; acá sólo se muestra.
const NECESIDAD_EJEMPLO = 7;
function calcularDespacho(multiplo, etiqueta) {
    const m = multiplo > 0 ? multiplo : 1;
    // Con etiqueta y múltiplo, el PDF cuenta CAJAS (una por lote), no packs.
    const porEtiqueta = !!etiqueta && m > 1;
    return {
        porEtiqueta,
        cantidad: porEtiqueta
            ? Math.ceil(NECESIDAD_EJEMPLO / m)
            : Math.ceil(NECESIDAD_EJEMPLO / m) * m,
    };
}

// ── El resultado de la regla ──────────────────────────────────────────────────
// Era una nota al pie en gris, y es lo único que verifica que la regla hace lo
// que se quiere: pasa a anclar la columna.
function ResultadoDespacho({ multiplo, tipo, etiqueta, compacto = false }) {
    const { porEtiqueta, cantidad } = calcularDespacho(multiplo, etiqueta);
    const unidad = porEtiqueta ? etiqueta : (tipo ? `pack(s) de ${tipo}` : 'pack(s)');

    // ── `compacto` NO lleva superficie propia (2026-08-07) ────────────────────
    // Es el modo del teléfono, donde esto vive DENTRO del panel del expediente,
    // que ya es una superficie con su material. `data-surface="card"` incluye
    // `backdrop-filter`, así que anidarlo deja un desenfoque dentro de otro — y
    // eso es lo que se venía persiguiendo con la pantalla negra del teléfono.
    // Aunque compusiera bien, una tarjeta dentro de una tarjeta no es el patrón.
    return (
        <div aria-live="polite"
            {...(compacto ? {} : { 'data-surface': 'card' })}
            className={`flex items-center gap-4 flex-wrap ${compacto ? 'px-1 py-0.5' : 'px-4 py-3'}`}>
            <div className="flex flex-col">
                <span className="text-micro font-bold uppercase tracking-widest text-content-3">Necesidad</span>
                <span className="text-body-lg font-bold tabular-nums leading-tight text-content">
                    {NECESIDAD_EJEMPLO}<span className="text-caption font-semibold text-content-2 ml-1">und.</span>
                </span>
            </div>
            <ArrowRight size={14} className="text-content-3 shrink-0" aria-hidden="true" />
            <div className="flex flex-col">
                <span className="text-micro font-bold uppercase tracking-widest text-content-3">Se despacha</span>
                <span className="text-body-lg font-bold tabular-nums leading-tight text-brand-text">
                    {cantidad}<span className="text-caption font-semibold text-content-2 ml-1">{unidad}</span>
                </span>
            </div>
            {/* En el pie del teléfono la nota sobra: costaba un renglón entero de
                un espacio que ya es escaso, y el número de al lado la dice. */}
            {!compacto && (
                <p className="text-micro text-content-3 leading-snug ml-auto text-right max-w-[24ch]">
                    {multiplo > 1
                        ? `Redondea hacia arriba al múltiplo de ${multiplo}.`
                        : 'Sin múltiplo: sale la cantidad exacta.'}
                </p>
            )}
        </div>
    );
}

// Encabezado de columna. Dos, en vez de los cinco rótulos idénticos que tenía el
// panel: lo que decide el despacho pesa distinto de lo que es excepción.
function TituloColumna({ children, nota }) {
    return (
        <div className="flex items-baseline gap-2 pb-2 mb-3.5 border-b border-divider">
            <h4 className="text-caption font-extrabold uppercase tracking-wider text-content">{children}</h4>
            {nota && <span className="text-micro text-content-3">{nota}</span>}
        </div>
    );
}

// ── Panel edición — basado en presentaciones reales del producto ──────────────
// `enExpediente`: el mismo panel montado en la hoja del teléfono. Ahí la hoja ya
// pone el nombre del producto arriba y se cierra arrastrando, así que el
// encabezado propio del panel sería el título repetido dos veces; y el resultado
// va anclado al fondo, fuera del scroll, en vez de inline.
function EditPanel({ product, rule, vals, setVals, saving, justSaved, saveError, onApply, onCancel, presCache, enExpediente = false }) {
    const [presentations, setPresentations] = useState(() => presCache.current[product.id] ?? []);
    const [loadingPres,   setLoadingPres]   = useState(!presCache.current[product.id]);

    useEffect(() => {
        // Si ya está en caché, no vuelve a hacer fetch
        if (presCache.current[product.id]) {
            setPresentations(presCache.current[product.id]); // eslint-disable-line react-hooks/set-state-in-effect -- usa el caché ya resuelto en vez de re-fetch
            setLoadingPres(false);
            return;
        }
        setLoadingPres(true);
        fetchProductPresentacionesForDispatch(product.id, rule?.dispatch_id_presentacion)
            .then(({ data }) => {
                // Deduplica por id_presentacion — queda la de mayor factor
                const seen = new Set();
                const uniq = (data || []).filter(row => {
                    if (seen.has(row.id_presentacion)) return false;
                    seen.add(row.id_presentacion);
                    return true;
                });
                presCache.current[product.id] = uniq;
                setPresentations(uniq);
                setLoadingPres(false);
            });
    }, [product.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Deduplica por factor numérico — si dos presentaciones tienen el mismo factor,
    // muestra solo una. Prefiere la que ya apunta la regla existente.
    const dedupedPres = useMemo(() => {
        const existingId = rule?.dispatch_id_presentacion ?? null;
        const groups = new Map(); // factor → pres row
        for (const pres of presentations) {
            const f = pres.factor;
            if (!groups.has(f)) groups.set(f, pres);
            if (pres.id_presentacion === existingId) groups.set(f, pres);
        }
        return [...groups.values()].sort((a, b) => b.factor - a.factor);
    }, [presentations, rule?.dispatch_id_presentacion]);

    const multiplo      = Number(vals.dispatch_multiplo) || 1;
    const selectedPres  = dedupedPres.find(p => p.id_presentacion === vals.dispatch_id_presentacion);
    const selectedTipo  = selectedPres?.presentaciones?.tipo ?? '';
    // Con una sola presentación no hay elección que ofrecer — ver más abajo.
    const unicaPres     = dedupedPres.length === 1 ? dedupedPres[0] : null;

    const selectPres = (idPres) => {
        if (saving) return;
        const next = { ...vals, dispatch_id_presentacion: idPres };
        setVals(next);
        onApply(next);
    };

    const selectMultiplo = (n) => {
        if (saving) return;
        const next = { ...vals, dispatch_multiplo: String(n) };
        setVals(next);
        onApply(next);
    };

    const selectLabel = (label) => {
        if (saving) return;
        const next = { ...vals, dispatch_label: vals.dispatch_label === label ? '' : label };
        setVals(next);
        onApply(next);
    };

    const clearRule = () => {
        if (saving) return;
        const next = { ...vals, dispatch_id_presentacion: null, dispatch_multiplo: '1', dispatch_label: '' };
        setVals(next);
        onApply(next);
    };

    const commitNotes = () => {
        if (!vals.dispatch_id_presentacion) return;
        if ((vals.notes || '') === (rule?.notes || '')) return;
        onApply(vals);
    };

    // El acuse de guardado baja al pie, junto a la acción destructiva: estaba a
    // 600px de distancia del control que lo dispara.
    const acuse = saving ? (
        <span className="flex items-center gap-1 text-label text-content-3">
            <Loader2 size={11} className="animate-spin" /> Guardando…
        </span>
    ) : justSaved ? (
        <span className="flex items-center gap-1 text-label text-success-text font-semibold">
            <Check size={11} /> Guardado
        </span>
    ) : saveError ? (
        <span className="text-label text-danger-text flex items-center gap-1 max-w-[260px]">
            <AlertTriangle size={10} className="shrink-0" /> {saveError}
        </span>
    ) : null;

    return (
        <div className="space-y-4">

            {/* El nombre del producto lo pone la barra del expediente; el laboratorio
                no viaja hasta ahí, así que se queda acá. */}
            {enExpediente && product.laboratorio_nombre && (
                <p className="text-label text-content-3 -mt-1">{product.laboratorio_nombre}</p>
            )}

            {/* Header — en el expediente lo pone la barra superior */}
            {!enExpediente && (
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <p className="font-semibold text-content text-body-lg leading-tight">{product.nombre}</p>
                        {product.laboratorio_nombre && (
                            <p className="text-label text-content-3 mt-0.5">{product.laboratorio_nombre}</p>
                        )}
                    </div>
                    <Button variant="ghost" icon={X} iconOnly onClick={onCancel} className="flex-shrink-0" />
                </div>
            )}

            {/* Dos columnas: lo que decide el despacho, y lo que casi nunca se toca.
                Antes eran cinco secciones apiladas en una columna angosta — el panel
                medía 680px y al abrir una fila se perdía el lugar en la lista. */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-x-8 gap-y-5">

            <div>
            <TituloColumna nota="se guarda sola al tocarla">La regla</TituloColumna>

            {/* Presentaciones del producto */}
            <div>
                <p className="text-micro text-content-3 uppercase tracking-widest mb-2 font-bold">
                    Presentación de despacho
                </p>
                {loadingPres ? (
                    <div className="flex items-center gap-2 text-label text-content-3 w-full"><SkeletonText lines={2} /></div>
                ) : dedupedPres.length === 0 ? (
                    /* `Notice` y no una caja a mano: era el aviso con ícono escrito
                       con `rounded-xl` y su propio par bg/texto, o sea el patrón
                       exacto que D3.5 canonizó (58 avisos, 3 radios distintos). */
                    <Notice variant="warning">
                        Sin presentaciones en catálogo — no se puede asignar regla de despacho.
                    </Notice>
                ) : unicaPres ? (
                    /* Con una sola presentación en catálogo no hay nada que elegir:
                       una tarjeta de 200px pedía una decisión que no existe. Se
                       muestra como dato, y la regla se aplica sola. */
                    /* En escritorio la superficie sale del canónico `data-surface="card"`
                       —escribirla con clases es la «tarjeta a mano» que el gate rechaza
                       (DESIGN.md §5)—. Dentro de la hoja del teléfono NO va ninguna: la
                       hoja YA es una superficie, y el `backdrop-filter` que trae el
                       canónico, anidado dentro del de la hoja, rompe la composición en
                       Safari de iPhone. Ver la nota de `ResultadoDespacho`. */
                    <button type="button" disabled={saving}
                        {...(enExpediente ? {} : { 'data-surface': 'card' })}
                        aria-pressed={vals.dispatch_id_presentacion === unicaPres.id_presentacion}
                        onClick={() => selectPres(
                            vals.dispatch_id_presentacion === unicaPres.id_presentacion ? null : unicaPres.id_presentacion,
                        )}
                        className={`inline-flex items-center gap-2.5 px-3 py-2 text-left ${
                            enExpediente ? 'rounded-card border border-divider' : ''
                        }`}
                    >
                        {(() => { const { Icon } = presStyle(unicaPres.presentaciones?.tipo); return <Icon size={16} className="text-content-3 shrink-0" />; })()}
                        <span className="text-body-sm font-bold text-content">
                            {unicaPres.presentaciones?.tipo ?? 'DESCONOCIDO'}
                        </span>
                        <span className="text-micro text-content-3">
                            única del catálogo · {unicaPres.factor > 1 ? `×${unicaPres.factor} unidades` : 'unidad base'}
                        </span>
                        {vals.dispatch_id_presentacion === unicaPres.id_presentacion && (
                            <Check size={14} className="text-success shrink-0" />
                        )}
                    </button>
                ) : (
                    <div role="radiogroup" aria-label="Presentación de despacho"
                        className={`flex flex-wrap gap-2 ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
                        {dedupedPres.map(pres => {
                            const tipo     = pres.presentaciones?.tipo ?? 'DESCONOCIDO';
                            const isActive = vals.dispatch_id_presentacion === pres.id_presentacion;
                            const style    = presStyle(tipo);
                            const { Icon } = style;
                            return (
                                <button key={pres.id_presentacion} type="button"
                                    role="radio"
                                    aria-checked={isActive}
                                    onClick={() => selectPres(pres.id_presentacion)}
                                    className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border-2 transition-all duration-[var(--dur-fast)] select-none text-left ${
                                        isActive
                                            ? `${style.bg} border-transparent ${style.text} shadow-lg`
                                            : 'bg-surface-card border-divider text-content-2 hover:border-brand/40 hover:bg-surface-card-hover'
                                    }`}
                                >
                                    <Icon size={15} className={isActive ? 'text-white' : 'text-content-3'} />
                                    <div>
                                        <p className="text-body-sm font-semibold leading-tight">{tipo}</p>
                                        <p className={`text-micro leading-tight ${isActive ? 'text-white/70' : 'text-content-3'}`}>
                                            {pres.factor > 1 ? `×${pres.factor} unidades` : 'unidad base'}
                                        </p>
                                    </div>
                                    {/* El relleno de color ya distingue la elegida, pero el check lo
                                        dice sin depender del color — y es lo que se lee de un vistazo
                                        cuando hay tres tarjetas de tonos distintos al lado. */}
                                    {isActive && <Check size={14} className="text-white shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Por lote — es "una de N elegida", no siete botones de acción.
                Estaban escritos como `Button tone="chart-1"`, o sea los siete
                rellenos de azul a la vez: el múltiplo activo no se distinguía
                de los demás (reportado 2026-08-07). `SegmentedControl` es el
                canónico de esa forma y pinta solo el elegido. */}
            <AnimatePresence>
                {vals.dispatch_id_presentacion && (
                    <motion.div
                        key="multiplo-block"
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.18, ease: EASE }}
                        className="space-y-2 mt-4"
                    >
                        <p className="text-micro text-content-3 uppercase tracking-widest font-bold">Por lote</p>
                        <div className={`flex flex-wrap items-center gap-1.5 ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
                            <SegmentedControl
                                size="sm"
                                tone="brand"
                                label="Múltiplo por lote"
                                value={String(multiplo)}
                                onChange={v => selectMultiplo(Number(v))}
                                options={MULTIPLO_PILLS.map(n => ({ value: String(n), label: `×${n}` }))}
                            />
                            <PortalInput
                                aria-label="Otro múltiplo de despacho"
                                type="number"
                                value={MULTIPLO_PILLS.includes(multiplo) ? '' : multiplo}
                                onChange={e => {
                                    const n = parseInt(e.target.value);
                                    if (n > 0) selectMultiplo(n);
                                }}
                                placeholder="Otro…"
                                min={1}
                                compact
                                className="w-24"
                            />
                        </div>

                        {/* En el teléfono va inline igual que acá, no anclado al fondo:
                            el envase es pantalla completa, así que el riel y el
                            resultado entran juntos sin tener que fijarlo. */}
                        <ResultadoDespacho
                            multiplo={multiplo} tipo={selectedTipo} etiqueta={vals.dispatch_label}
                            compacto={enExpediente}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
            </div>

            {/* ── Columna 2: lo que casi nunca hace falta ──────────────────── */}
            <div>
            <TituloColumna nota="casi nunca hacen falta">Ajustes</TituloColumna>

            {/* Etiqueta en PDF */}
            <div className={vals.dispatch_id_presentacion ? '' : 'opacity-45 pointer-events-none'}>
                <p className="text-micro text-content-3 uppercase tracking-widest mb-1 font-bold">
                    Mostrar en PDF como
                </p>
                {/* La ayuda pasa de dos renglones de párrafo a una línea con lo que
                    decide el caso: competía con los controles que explica. */}
                <p className="text-micro text-content-3 mb-2 leading-snug">
                    Solo para <strong className="text-content-2 font-semibold">cajas físicas grandes</strong> (Electrolit, sueros). En el archivo se listan aparte, una caja por fila con su lote.
                </p>
                <div className={`flex flex-wrap items-center gap-1.5 ${saving ? 'opacity-60 pointer-events-none' : ''}`}>
                    <SegmentedControl
                        size="sm"
                        tone="brand"
                        label="Unidad de despacho"
                        value={vals.dispatch_label}
                        onChange={selectLabel}
                        options={['CAJA', 'ESTUCHE', 'BOLSA'].map(l => ({ value: l, label: l, icon: Box }))}
                    />
                    {vals.dispatch_label && (
                        <Button variant="ghost" size="sm" icon={X} onClick={() => selectLabel(vals.dispatch_label)}>quitar</Button>
                    )}
                </div>
            </div>

            {/* Caja especial — encendido/apagado, así que `Switch` y no un botón
                relleno de rosa: como botón no se sabía si el rótulo describía el
                estado actual o lo que iba a pasar al apretarlo. */}
            <div className={`mt-4 ${vals.dispatch_id_presentacion ? '' : 'opacity-45 pointer-events-none'}`}>
                <p className="text-micro text-content-3 uppercase tracking-widest mb-2 font-bold">Caja especial</p>
                <div className="flex items-center gap-3">
                    <Switch
                        checked={!!vals.caja_especial}
                        disabled={saving || !vals.dispatch_id_presentacion}
                        label="Caja especial"
                        onChange={(on) => {
                            const next = { ...vals, caja_especial: on };
                            setVals(next); onApply(next);
                        }}
                    />
                    <span className="text-caption text-content-2 leading-snug">
                        {vals.caja_especial
                            ? 'Cada unidad lleva su etiqueta E1, E2… independiente.'
                            : 'Viaja en las cajas normales.'}
                    </span>
                </div>
            </div>

            {/* Notas */}
            <div className="mt-4">
                <p className="text-micro text-content-3 uppercase tracking-widest mb-1.5 font-bold">
                    Notas internas
                    <span className="normal-case tracking-normal font-medium text-content-3"> · se guardan al salir</span>
                </p>
                <PortalInput
                    aria-label="Notas de la regla"
                    type="text"
                    value={vals.notes}
                    onChange={e => setVals(p => ({ ...p, notes: e.target.value }))}
                    placeholder={!vals.dispatch_id_presentacion ? 'Selecciona una presentación primero' : 'Observación opcional…'}
                    onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                    onBlur={commitNotes}
                    readOnly={!vals.dispatch_id_presentacion}
                    compact
                />
            </div>
            </div>
            </div>

            {/* Pie: la acción destructiva y el acuse de guardado, juntos. El acuse
                estaba en el encabezado, a 600px del control que lo dispara. */}
            {(vals.dispatch_id_presentacion || acuse) && (
                <div className="flex items-center justify-between gap-4 flex-wrap pt-3 border-t border-divider">
                    {vals.dispatch_id_presentacion ? (
                        /* Quitar la regla es reversible (se vuelve a asignar en dos
                           clics), así que va en tinte y no en rojo sólido — el sólido
                           se reserva para lo definitivo (DESIGN.md §15.2). */
                        <Button tone="danger" soft size="sm" icon={Ban} disabled={saving} onClick={clearRule}>Quitar regla de despacho</Button>
                    ) : <span />}
                    {acuse}
                </div>
            )}
        </div>
    );
}

// ── La fila expandida ─────────────────────────────────────────────────────────
// Va en su propio componente porque `useExpandStyle` lee el contexto de
// `DataTable`, y desde el cuerpo de la vista —que se ejecuta FUERA del
// proveedor— devolvería el fallback. Es el hook que el canónico exporta justo
// para las filas expandidas de `<tr>` crudo.
//
// El tinte y el borde estaban copiados acá como dos constantes con el mismo
// texto que los tokens del canónico. Copiadas, sobreviven a que el canónico
// cambie: es la forma exacta en que una vista se despega del tema sin que nada
// falle (§22 y el blindspot de dark mode que la fase T3 cerró en `useTokens`).
function FilaEdicion({ colSpan, children }) {
    const tk = useExpandStyle();
    return (
        <motion.tr
            className={`${tk.expandBg} border-b ${tk.expandBorderColor}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
        >
            <td colSpan={colSpan} className="p-0">
                <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    style={{ overflow: 'hidden' }}
                >
                    <div className="px-5 py-4">{children}</div>
                </motion.div>
            </td>
        </motion.tr>
    );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TabReglas({ searchTerm = '' }) {

    // ── Por qué el teléfono pagina distinto (2026-08-08) ──────────────────
    // Esta vista es la que mata la página en el iPhone del usuario: al
    // scrollear, la pantalla se apaga y hay que cerrar la ventana. El pulso de
    // la caja negra descartó que fuera código nuestro —el hilo principal estaba
    // en 2 ms de retraso, o sea sano, con 1,600 elementos y 130 s de sesión— así
    // que lo que muere es el PROCESO, y lo mata el sistema.
    //
    // Se midió el inventario de capas del compositor con las medidas exactas de
    // su teléfono (352×715 @3x) y su tema (`solid-dark`). El resultado es que la
    // estructura es IDÉNTICA a la de Productos, que no falla: seis capas del
    // alto del documento en las dos. Lo único que cambia es el alto —Reglas
    // 5,241 px contra 3,277 px—, y se multiplica por seis. O sea que Reglas no
    // tiene un defecto propio: es la página más ALTA del teléfono, y por eso es
    // la que cruza el límite del aparato.
    //
    // El alto sale de cuántas fichas se pintan, así que ese es el único mando
    // que hay. 25 es el escalón que ya ofrece `TablePagination` —no una opción
    // nueva— y deja el documento por debajo de Productos. En escritorio no
    // aplica: ahí no hay a quién matar y 50 filas se leen de un vistazo.
    const enTelefono = useMediaQuery(CORTE_TELEFONO);

    const [rulesMap,        setRulesMap]        = useState({});
    const [loadingRules,    setLoadingRules]    = useState(true);
    const [products,        setProducts]        = useState([]);
    const [totalCount,      setTotalCount]      = useState(0);
    const [loadingProducts, setLoadingProducts] = useState(true);
    const [page,            setPage]            = useState(1);
    const [pageSize,        setPageSize]        = useState(() => (enTelefono ? 25 : 50));
    const [allCount,        setAllCount]        = useState(0);
    const [statsLoading,    setStatsLoading]    = useState(true);
    const [newProductIds,   setNewProductIds]   = useState(new Set());
    const [thisMonthCount,  setThisMonthCount]  = useState(0);
    const [sortKey,         setSortKey]         = useState('laboratorio_nombre');
    const [sortDir,         setSortDir]         = useState('asc');
    const [hiddenLabIds,    setHiddenLabIds]    = useState(null); // null = aún cargando
    const [labOptions,      setLabOptions]      = useState([]);
    // Tres filtros independientes: '' | 'con' | 'sin', el id del laboratorio, y
    // los nuevos del mes. «Nuevos SIN regla» es la pregunta de la pantalla, así
    // que no puede ser una elección excluyente con las otras dos.
    const [filterRule,      setFilterRule]      = useState('');
    const [filterLab,       setFilterLab]       = useState(null);
    const [soloNuevos,      setSoloNuevos]      = useState(false);
    const [editingId,       setEditingId]       = useState(null);
    const [editVals,        setEditVals]        = useState(EMPTY_VALS);
    const [saving,          setSaving]          = useState(false);
    const [saveError,       setSaveError]       = useState(null);
    const [justSaved,       setJustSaved]       = useState(false);

    // Ref siempre al día para que applyVals y loadProducts lean reglas frescas
    // sin que cada autoguardado dispare un re-fetch de la tabla de productos.
    const rulesMapRef    = useRef({});
    const justSavedTimer = useRef(null);
    const presCache      = useRef({});
    const tableTopRef    = useRef(null);
    useEffect(() => { rulesMapRef.current = rulesMap; }, [rulesMap]);
    useEffect(() => () => clearTimeout(justSavedTimer.current), []);
    // Scroll al tope de la tabla al cambiar página
    useEffect(() => {
        tableTopRef.current?.scrollIntoView({ behavior: 'instant', block: 'nearest' });
    }, [page]);

    // Labs: los ocultos en MIN·MAX se excluyen de la tabla, y el resto son las
    // opciones del filtro de laboratorio. Un solo fetch para las dos cosas.
    useEffect(() => {
        fetchLaboratorios()
            .then(({ data }) => {
                const filas = data || [];
                setHiddenLabIds(filas.filter(l => l.ocultar_en_minmax).map(l => l.id));
                setLabOptions(filas
                    .filter(l => !l.ocultar_en_minmax && l.nombre)
                    .map(l => ({ value: String(l.id), label: l.nombre })));
            });
    }, []);

    // Reglas + stats
    const loadRules = useCallback(async () => {
        setLoadingRules(true);
        setStatsLoading(true);
        try {
            const now          = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

            // Paginado con fetchAllRows — PostgREST cap silencioso a 1000 filas
            const allRules = await fetchAllDispatchRules() ?? [];

            const [totalRes, newRes] = await Promise.all([
                fetchActiveProductsCount(),
                fetchNewProductsThisMonth(startOfMonth),
            ]);

            const map = {};
            for (const r of allRules) {
                map[r.erp_product_id] = { ...r, dispatch_tipo: r.presentaciones?.tipo ?? null };
            }
            setRulesMap(map);
            setAllCount(totalRes.count ?? 0);
            setThisMonthCount(newRes.count ?? 0);
            setNewProductIds(new Set((newRes.data || []).map(p => p.id)));
        } catch (err) {
            console.error('[loadRules]', err?.message ?? err);
        } finally {
            setLoadingRules(false);
            setStatsLoading(false);
        }
    }, []);

    useEffect(() => { loadRules(); }, [loadRules]);
    useEffect(() => { setPage(1); }, [searchTerm, filterRule, filterLab, soloNuevos, sortKey, sortDir, pageSize]);

    // Productos paginados.
    // Recibe UN objeto y no once posicionales: con `sortKey`/`sortDir`/`labId`
    // pegados al final, agregar un filtro más era cambiar el orden de la llamada
    // en dos sitios y confiar en que coincidan.
    const loadProducts = useCallback(async (o) => {
        setLoadingProducts(true);
        try {
            const dbSk = (o.sortKey === 'estado' || o.sortKey === 'despacho') ? 'laboratorio_nombre' : o.sortKey;

            const { data, count, error } = await fetchProductsWithLabPage({
                offset: (o.page - 1) * o.pageSize,
                pageSize: o.pageSize,
                hiddenLabs: o.hiddenLabs,
                labId: o.labId,
                sortKey: dbSk,
                ascending: o.sortDir !== 'desc',
                term: o.term.length >= 2 ? (normSearch(o.term) || o.term) : '',
                ruleFilter: o.ruleFilter,
                ruleIds: o.ruleIds,
                soloNuevos: o.soloNuevos,
                newIds: o.newIds,
            });
            if (error) throw error;
            setProducts(data || []);
            setTotalCount(count ?? 0);
        } catch (err) {
            console.error('[loadProducts]', err?.message ?? err);
            setProducts([]);
            setTotalCount(0);
        } finally {
            setLoadingProducts(false);
        }
    }, []);

    // Lee las reglas desde el ref: un autoguardado no re-fetchea la lista
    // hiddenLabIds=null significa que el fetch de labs aún no terminó — esperar para no hacer doble fetch.
    useEffect(() => {
        if (loadingRules || hiddenLabIds === null) return;
        loadProducts({
            page, pageSize, term: searchTerm,
            ruleFilter: filterRule, ruleIds: Object.keys(rulesMapRef.current).map(Number),
            hiddenLabs: hiddenLabIds, labId: filterLab,
            soloNuevos, newIds: newProductIds,
            sortKey, sortDir,
        });
    }, [page, pageSize, searchTerm, filterRule, filterLab, soloNuevos, hiddenLabIds, newProductIds, loadProducts, loadingRules, sortKey, sortDir]);

    const handleSort = useCallback((key) => {
        setSortDir(prev => sortKey === key ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
        setSortKey(key);
        setPage(1);
    }, [sortKey]);

    const startEdit = useCallback((productId, rule) => {
        setEditingId(productId);
        setSaveError(null);
        setJustSaved(false);
        setEditVals({
            dispatch_id_presentacion: rule?.dispatch_id_presentacion ?? null,
            dispatch_multiplo:        String(rule?.dispatch_multiplo ?? 1),
            notes:                    rule?.notes ?? '',
            dispatch_label:           rule?.dispatch_label ?? '',
            caja_especial:            rule?.caja_especial ?? false,
        });
    }, []);

    const cancelEdit  = useCallback(() => { setEditingId(null); setSaveError(null); }, []);
    const toggleEdit  = useCallback((productId) => {
        if (editingId === productId) { cancelEdit(); return; }
        startEdit(productId, rulesMap[productId] ?? null);
    }, [editingId, rulesMap, startEdit, cancelEdit]);

    // Autoguardado: aplica los vals al instante. Sin botón Guardar.
    const applyVals = useCallback(async (productId, v) => {
        setSaving(true); setSaveError(null);
        const existing = rulesMapRef.current[productId];
        try {
            if (!v.dispatch_id_presentacion) {
                // Quitar regla → delete si existe
                if (existing) {
                    const { error } = await deleteDispatchRule(existing.id);
                    if (error) throw error;
                    useStaff.getState().appendAuditLog('ELIMINAR_REGLA_DESPACHO', String(existing.id), { erp_product_id: productId });
                    const next = { ...rulesMapRef.current };
                    delete next[productId];
                    rulesMapRef.current = next;
                    setRulesMap(next);
                }
            } else {
                const payload = {
                    erp_product_id:           productId,
                    dispatch_id_presentacion: v.dispatch_id_presentacion,
                    dispatch_multiplo:        Number(v.dispatch_multiplo) || 1,
                    dispatch_label:           v.dispatch_label || null,
                    caja_especial:            v.caja_especial ?? false,
                    solo_cajas:               false,   // NOT NULL en DB
                    multiplo:                 null,
                    blister:                  null,
                    multiplo_unidades:        null,
                    notes:                    v.notes || null,
                    updated_at:               new Date().toISOString(),
                };
                let saved;
                if (existing) {
                    const { data, error } = await updateDispatchRule(existing.id, payload);
                    if (error) throw error;
                    saved = data;
                    useStaff.getState().appendAuditLog('EDITAR_REGLA_DESPACHO', String(existing.id), payload);
                } else {
                    const { data, error } = await insertDispatchRule(payload);
                    if (error) throw error;
                    saved = data;
                    useStaff.getState().appendAuditLog('CREAR_REGLA_DESPACHO', String(productId), payload);
                }
                // dispatch_tipo desde presCache (ya cargado al abrir el panel)
                const cachedPres = presCache.current[productId] ?? [];
                const matchPres  = cachedPres.find(p => p.id_presentacion === v.dispatch_id_presentacion);
                const dispatch_tipo = matchPres?.presentaciones?.tipo ?? null;
                const next = { ...rulesMapRef.current, [productId]: { ...saved, dispatch_tipo } };
                rulesMapRef.current = next;
                setRulesMap(next);
            }
            setJustSaved(true);
            clearTimeout(justSavedTimer.current);
            justSavedTimer.current = setTimeout(() => setJustSaved(false), 2200);
        } catch (e) {
            setSaveError(mensajeAmigable(e));
        } finally {
            setSaving(false);
        }
    }, []);

    // Computed
    const rulesCount = Object.keys(rulesMap).length;
    const sinRegla   = Math.max(0, allCount - rulesCount);
    const mesActual  = useMemo(() => new Date().toLocaleDateString('es-SV', { month: 'long' }), []);

    // Sort client-side para columnas computed (estado/despacho) — opera sobre la página actual
    const sortedProducts = useMemo(() => {
        if (sortKey !== 'estado' && sortKey !== 'despacho') return products;
        const asc = sortDir !== 'desc';
        return [...products].sort((a, b) => {
            if (sortKey === 'estado') {
                const av = rulesMap[a.id] ? 1 : 0;
                const bv = rulesMap[b.id] ? 1 : 0;
                return asc ? av - bv : bv - av;
            }
            const at = ruleTypeLabel(rulesMap[a.id] ?? null)?.text ?? '';
            const bt = ruleTypeLabel(rulesMap[b.id] ?? null)?.text ?? '';
            return asc ? at.localeCompare(bt, 'es') : bt.localeCompare(at, 'es');
        });
    }, [products, sortKey, sortDir, rulesMap]);

    // El panel de edición vive en un `<tr colSpan>` hermano, que en el teléfono
    // no se pinta. Va al expediente, con la misma regla que el resto.
    // `enTelefono` ya se resolvió arriba con la MISMA consulta (el hook cachea
    // el `matchMedia`), así que acá sólo hace falta la fila abierta.
    const { abierto } = useExpedienteMovil(sortedProducts, editingId);

    return (
        <div className="px-4 lg:px-5 py-4 flex flex-col gap-4">

            {/* ── Stat cards + filtros ───────────────────────────────────────── */}
            {/* UNA fila, sin `flex-wrap` (§17.0). No es estética: `useMedidaFila`
                de `FilterBar` busca el carril por `[role="group"]` y le descuenta
                314px a la píldora por tenerlo al lado. Si el carril cae a otro
                renglón, la reserva se aplica igual y la píldora se reparte un
                ancho que no es el suyo — sin fallar, en silencio. El carril lleva
                `flex-1` para ceder el sobrante, que es la otra mitad de la regla. */}
            <div className="flex items-start gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de reglas">

                    <StatCard
                        icon={Package} iconBg="bg-chart-1/10" iconCls="text-brand-text"
                        label="Activos" value={allCount.toLocaleString()}
                        loading={statsLoading}
                    />

                    <StatCard label="Con regla" value={rulesCount}
                        icon={Check} iconBg={filterRule === 'con' ? 'bg-surface-card' : 'bg-success/10'} iconCls="text-success"
                        valueCls={rulesCount > 0 ? 'text-success' : 'text-content-3'}
                        tono="success" active={filterRule === 'con'}
                        loading={loadingRules}
                        onClick={() => setFilterRule(f => f === 'con' ? '' : 'con')}
                    />

                    <StatCard label="Sin regla" value={sinRegla}
                        icon={AlertTriangle} iconBg={filterRule === 'sin' ? 'bg-surface-card' : 'bg-danger/10'} iconCls="text-danger"
                        valueCls={sinRegla > 0 ? 'text-danger' : 'text-content-3'}
                        tono="danger" active={filterRule === 'sin'}
                        loading={loadingRules}
                        onClick={() => setFilterRule(f => f === 'sin' ? '' : 'sin')}
                    />

                    <StatCard label="Nuevos" sub={`agregados en ${mesActual}`} value={thisMonthCount}
                        icon={Sparkles} iconBg={soloNuevos ? 'bg-surface-card' : 'bg-success/10'} iconCls="text-success"
                        valueCls={thisMonthCount > 0 ? 'text-success' : 'text-content-3'}
                        tono="success" active={soloNuevos}
                        loading={statsLoading}
                        onClick={() => setSoloNuevos(v => !v)}
                    />
                </CarrilCards>

                {/* §17 — la barra canónica, a la derecha. Reemplaza al «Limpiar
                    filtro» suelto, que era la mitad de una barra de filtros: sabía
                    borrar el filtro pero no había dónde ponerlo. Y bajo 720px
                    `FilterBar` colapsa a hoja inferior, así que en el teléfono estos
                    filtros existen — el botón suelto no filtraba nada.

                    El orden de las ranuras es el de §17, de ámbito más amplio a más
                    angosto: entidad (laboratorio) y después estado (regla). */}
                <FilterBar
                    onClear={() => { setFilterLab(null); setFilterRule(''); setSoloNuevos(false); }}
                    activeCount={[filterLab !== null, filterRule !== '', soloNuevos].filter(Boolean).length}
                >
                    {labOptions.length > 0 && (
                        <FilterBar.Section active={filterLab !== null} onClear={() => setFilterLab(null)} label="laboratorio">
                            <div className="w-[175px]">
                                <LiquidSelect
                                    value={filterLab !== null ? String(filterLab) : ''}
                                    onChange={v => setFilterLab(v ? parseInt(v) : null)}
                                    options={labOptions}
                                    placeholder="Laboratorio"
                                    icon={Building2}
                                    clearable={false} compact bare
                                />
                            </div>
                        </FilterBar.Section>
                    )}

                    {/* Un `SegmentedControl` y no tres botones: es «una de tres
                        elegida», y el canónico pinta sólo la activa. Comparte estado
                        con las tarjetas de arriba, así que tocar cualquiera de las
                        dos mueve la otra. */}
                    <FilterBar.Section active={filterRule !== ''} onClear={() => setFilterRule('')} label="regla">
                        <SegmentedControl
                            size="sm"
                            tone="brand"
                            label="Regla de despacho"
                            value={filterRule}
                            onChange={setFilterRule}
                            options={[
                                { value: '',    label: 'Todos' },
                                { value: 'con', label: 'Con regla', icon: Check },
                                { value: 'sin', label: 'Sin regla', icon: AlertTriangle },
                            ]}
                        />
                    </FilterBar.Section>
                </FilterBar>
            </div>

            {/* Sentinel para scroll-to-top al cambiar página */}
            <div ref={tableTopRef} />

            {/* ── Tabla ─────────────────────────────────────────────────────── */}
            <DataTable columns={COLS} sortKey={sortKey} sortDir={sortDir} onSort={handleSort}
                movil={{ usarAccionDeFila: true }}
                loading={loadingProducts || loadingRules} skeletonRows={8}
                empty={{
                    icon: Package,
                    // Los filtros se combinan, así que el mensaje ya no puede
                    // atribuirle el vacío a uno solo: con laboratorio + «sin regla»
                    // + «nuevos» activos, «todos tienen regla» sería falso.
                    message: searchTerm.length >= 2 ? `Sin resultados para "${searchTerm}".`
                        : (filterLab !== null || filterRule || soloNuevos) ? 'Ningún producto cumple con los filtros aplicados.'
                        : 'Sin productos en catálogo.',
                }}
                minWidth="720px"
            >
                {sortedProducts.map((prod, i) => {
                    const isEditing = editingId === prod.id;
                    const rule      = rulesMap[prod.id] ?? null;
                    const hasRule   = !!rule;
                    const isNew     = newProductIds.has(prod.id);
                    const typeTag   = ruleTypeLabel(rule);

                    return (
                        <React.Fragment key={prod.id}>
                            <DataRow index={i} onClick={() => toggleEdit(prod.id)}
                                className={isEditing ? 'bg-chart-1/10' : ''}>

                                <DataCell className="text-content-3 text-body-sm">
                                    <span className="block">{prod.laboratorio_nombre ?? '—'}</span>
                                </DataCell>

                                <DataCell>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-content-2 text-body">{prod.nombre}</span>
                                        {isNew && (
                                            <Badge variant="success" size="sm" icon={Sparkles}>Nuevo</Badge>
                                        )}
                                        {prod.es_antibiotico && (
                                            <Badge variant="chart-6" size="sm" icon={FlaskConical}>Bajo receta</Badge>
                                        )}
                                    </div>
                                </DataCell>

                                {/* `whitespace-nowrap`: el ancho de columna evita el corte
                                    en el caso normal, pero un badge es texto y con el
                                    tipo escalado —o el tema Solid, que aprieta menos— se
                                    vuelve a partir. La regla que dice «esto es un
                                    renglón» va en el badge, no sólo en el ancho. */}
                                <DataCell align="center">
                                    {hasRule ? (
                                        <Badge variant="success" icon={Check} uppercase={false} className="whitespace-nowrap">Con regla</Badge>
                                    ) : (
                                        <Badge uppercase={false} className="whitespace-nowrap">Sin regla</Badge>
                                    )}
                                </DataCell>

                                <DataCell align="center">
                                    {typeTag
                                        ? <Badge variant={typeTag.variant} tone={typeTag.tone} className="whitespace-nowrap">{typeTag.text}</Badge>
                                        : <span className="text-content-3 text-body">—</span>
                                    }
                                </DataCell>

                                <DataCell className="text-content-3 italic text-body-sm max-w-[140px]">
                                    {hasRule
                                        ? <span className="block truncate">{rule.notes || <span className="not-italic text-content-3">—</span>}</span>
                                        : <span className="text-content-3">—</span>
                                    }
                                </DataCell>
                            </DataRow>

                            {/* Panel edición con animación entrada/salida */}
                            <AnimatePresence>
                                {isEditing && !enTelefono && (
                                    <FilaEdicion key={`ep-${prod.id}`} colSpan={COLS.length}>
                                        <EditPanel
                                            product={prod} rule={rule}
                                            vals={editVals} setVals={setEditVals}
                                            saving={saving} justSaved={justSaved} saveError={saveError}
                                            onApply={(v) => applyVals(prod.id, v)}
                                            onCancel={cancelEdit}
                                            presCache={presCache}
                                        />
                                    </FilaEdicion>
                                )}
                            </AnimatePresence>
                        </React.Fragment>
                    );
                })}
            </DataTable>

            {/* `variante="pantalla"` — el MISMO envase que usa Productos, y no la hoja
                `auto`. La hoja se ponía negra en el teléfono al abrir la regla
                (reportado 2026-08-07, tres veces): pinta su propia superficie con
                `backdrop-filter`, y el detalle vive dentro. `pantalla` no lleva velo
                ni material propio —lo dice `ModalShell`: sería «un desenfoque a
                pantalla completa que nadie llega a ver y que el compositor» tiene que
                sostener— así que saca del camino la capa que fallaba.
                Además encaja mejor con lo que es: la hoja ya medía 584px de 664, o
                sea que de «detalle corto» no tenía nada.

                Esto se escribió una vez en v2.508.2 y VOLVIÓ ATRÁS solo: v2.511.0
                —un cambio de las hojas impresas del conteo— commiteó de paso una
                copia vieja de este archivo y de `ExpedienteMovil`, y con ella
                regresó la hoja y la pantalla negra. Por eso el usuario lo reportó
                una tercera vez. Antes de tocar este bloque, `git log` del archivo. */}
            <ExpedienteMovil abierto={abierto} onClose={cancelEdit}
                titulo={abierto?.nombre || 'Regla de despacho'}
                variante="pantalla">
                {(prod) => (
                    <div className="px-4 py-4">
                        <EditPanel
                            product={prod} rule={rulesMap[prod.id] ?? null}
                            vals={editVals} setVals={setEditVals}
                            saving={saving} justSaved={justSaved} saveError={saveError}
                            onApply={(v) => applyVals(prod.id, v)}
                            onCancel={cancelEdit}
                            presCache={presCache}
                            enExpediente
                        />
                    </div>
                )}
            </ExpedienteMovil>

            <TablePagination
                page={page} pageSize={pageSize}
                totalPages={Math.ceil(totalCount / pageSize)}
                total={totalCount}
                onPageChange={setPage}
                onPageSizeChange={sz => { setPageSize(sz); setPage(1); }}
                unit="productos"
            />
        </div>
    );
}
