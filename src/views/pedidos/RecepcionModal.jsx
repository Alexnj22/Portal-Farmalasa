import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { tokenMatch } from '../../utils/searchUtils';
import { supabase } from '../../supabaseClient';
import useCapaFlotante from '../../utils/capaFlotante';
import {
    Loader2, X, PackageCheck, AlertTriangle, Search,
    Plus, Trash2, PackagePlus, Check, ChevronLeft, FileText, Truck, Star,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import PedidoModal from './PedidoModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import SearchInput from '../../components/common/SearchInput';
import { useSearchToggle } from '../../hooks/useSearchToggle';
import {
    fetchProductPreciosOpts, fetchProductPreciosOptsForProducts,
    searchAvailableProducts, fetchLastDispatchInfo, insertPedidoRecepcionExtras,
} from '../../data/recepcion';
import { updatePedidoSucursalStatus, recibirTrasladoPedido } from '../../data/pedidos';
import SegmentedControl from '../../components/common/SegmentedControl';
import ConfirmModal from '../../components/common/ConfirmModal';
import PortalInput from '../../components/common/PortalInput';
import { mensajeAmigable } from '../../utils/errorMessages';
import { alcanceDeRecepcion, construirCajasEspeciales } from '../../utils/cajasEspeciales';
import { estadoDeHojas, hojasContables, hojasContadas } from '../../utils/hojasRecepcion';
import useMontadoParaSalida from '../../hooks/useMontadoParaSalida';

// `EmpChip` vivía acá y se fue con la franja de «Responsables» del pie: era su
// único uso en todo el repo (el chip de las tarjetas de pedido es
// `tabpedidos/EmpChip.jsx`, otro archivo).

function toDispatch(qty, erpFactor, dispFactor) {
    if (!dispFactor || dispFactor === erpFactor) return qty;
    return Math.round(qty * erpFactor / dispFactor);
}

function fmtDispatchLabel(dispatch_tipo, dispatch_factor) {
    const f = Number(dispatch_factor) || 1;
    const LABELS = { CAJA: 'Caja', BLISTER: 'Blíster', MULTIPLO: 'Unid', UNIDAD: 'Unidad', caja: 'Caja', blister: 'Blíster', multiplo: 'Unid', multiplo_unidades: 'Unid', solo_cajas: 'Caja', unidad: 'Unidad' };
    const label = LABELS[dispatch_tipo] ?? dispatch_tipo ?? 'Unidad';
    return f > 1 ? `${label} ×${f}` : label;
}

/**
 * Las presentaciones que se le pueden poner a un renglón, con la del despacho
 * primero. Vive acá porque la usan los dos sitios donde se cuenta —la tabla de
 * la hoja y la búsqueda rápida— y dos copias de esta lista terminarían
 * ofreciendo opciones distintas para el mismo producto.
 */
function opcionesDePresentacion(r, presMap) {
    const erpFactor  = Number(r.factor) || 1;
    const dispFactor = Number(r.dispatch_factor) || erpFactor;
    const dispOpt    = { factor: dispFactor, label: fmtDispatchLabel(r.dispatch_tipo, dispFactor) };
    const vistos = new Set();
    const opts = [];
    if (r.dispatch_tipo && dispFactor !== erpFactor) { opts.push(dispOpt); vistos.add(dispFactor); }
    (presMap[r.erp_product_id] ?? []).forEach(o => {
        if (!vistos.has(o.factor)) { opts.push(o); vistos.add(o.factor); }
    });
    if (!opts.length) opts.push(dispOpt);
    return opts;
}

/**
 * «Vino mal» — tipo de problema, cuántos y la nota. Uno solo para los dos
 * sitios que cuentan.
 */
function PanelProblema({ id, fQty, campos, onListo }) {
    const { errorVals, setErrorVals, cantProblemaVals, setCantProblemaVals, notaVals, setNotaVals } = campos;
    const tipo = errorVals[id] || '';
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <SegmentedControl
                size="sm" tone="chart-4"
                options={ERROR_TIPOS.map(t => ({ value: t.value, label: t.label }))}
                value={tipo}
                onChange={v => setErrorVals(p => ({ ...p, [id]: ((p[id] || '') === v ? '' : v) }))}
                label="Tipo de error" />
            {(tipo === 'danado' || tipo === 'vencido') && (
                <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-caption text-content-3">¿Cuántos?</span>
                    <PortalInput
                        aria-label="Cantidad con problema"
                        type="number"
                        value={cantProblemaVals[id] ?? 1}
                        onChange={e => setCantProblemaVals(p => ({
                            ...p, [id]: Math.max(1, Math.min(fQty, parseInt(e.target.value) || 1))
                        }))}
                        min={1}
                        max={fQty}
                        tono="chart-4"
                        compact
                        inputClassName="text-center text-body-xl font-bold text-chart-4-text"
                        className="w-12"
                    />
                    <span className="text-caption text-content-3">de {fQty}</span>
                </div>
            )}
            <PortalInput
                aria-label="Nota del renglón"
                type="text"
                value={notaVals[id] ?? ''}
                onChange={e => setNotaVals(p => ({ ...p, [id]: e.target.value }))}
                placeholder="Nota…"
                onKeyDown={e => e.key === 'Enter' && onListo()}
                tono="chart-4"
                compact
                inputClassName="text-body-xl"
                className="flex-1 min-w-0"
            />
            <Button tone="chart-4" icon={Check} onClick={onListo}>Listo</Button>
        </div>
    );
}

/**
 * «Necesito ESE producto ya» — buscarlo en todo el despacho y recibirlo solo,
 * sin contar la hoja entera.
 *
 * Existía desde v2.569.0 pero como un ícono verde al final del renglón, o sea
 * que había que estar ADENTRO de la hoja correcta para verlo — y quien lo
 * necesita justamente no sabe en cuál cayó. Por eso vive en la primera pantalla
 * y dice en qué hoja está: la búsqueda contesta la pregunta que impedía usarlo.
 *
 * Y trae los MISMOS controles que la tabla de la hoja —presentación, cantidad y
 * «vino mal»—, sobre el mismo estado: recibir un producto suelto es contarlo,
 * no dar por bueno lo que decía el papel. Con sólo un botón «Recibir» no había
 * forma de decir que llegó uno menos o que venía dañado.
 */
function SueltoRapido({ rows, hojaDe, sueltosOk, saving, onRecibir, campos }) {
    const [q, setQ] = useState('');
    const { presMap, fQtyVals, setFQtyVals, fPresVals, setFPresVals, tieneProblema, setTieneProblema } = campos;
    const term = q.trim();
    const hits = term.length < 2 ? [] : rows
        .filter(r => !sueltosOk.has(r.id) && r.status !== 'recibido')
        .filter(r => tokenMatch(term, r.products?.nombre))
        .slice(0, 4);

    return (
        <div>
            <SearchInput
                value={q}
                onChange={setQ}
                placeholder="¿Necesitas un producto ya? Búscalo…"
                ariaLabel="Buscar un producto para recibirlo ahora"
            />
            {term.length >= 2 && hits.length === 0 && (
                <p className="text-label text-content-3 mt-2 px-1">Sin resultados entre lo que llegó.</p>
            )}
            {hits.map(r => {
                const hoja       = hojaDe(r.id);
                const erpFactor  = Number(r.factor) || 1;
                const dispFactor = Number(r.dispatch_factor) || erpFactor;
                const enviado    = enviadoDe(r);
                const presOpts   = opcionesDePresentacion(r, presMap);
                const fQty  = fQtyVals[r.id]  ?? toDispatch(enviado, erpFactor, dispFactor);
                const fPres = fPresVals[r.id] ?? dispFactor;
                const fRaw  = Math.round(fQty * fPres / erpFactor);
                const delta = fRaw - enviado;
                const panelOpen = tieneProblema[r.id] === true;
                const hasProb   = !!tieneProblema[r.id];
                const etiquetaEnviado = presOpts.find(o => o.factor === dispFactor)?.label ?? '';
                const enviadoDisp = toDispatch(enviado, erpFactor, dispFactor);

                return (
                    <div key={r.id} className={`mt-1.5 px-3 py-2.5 rounded-xl border ${delta !== 0 ? 'border-warning/40 bg-warning/10' : hasProb ? 'border-chart-4/40 bg-chart-4/10' : 'border-divider bg-surface-card'}`}>
                        <p className="text-body-sm font-semibold text-content-2 leading-tight">{r.products?.nombre}</p>
                        <p className="text-micro text-content-3 mt-0.5">
                            {hoja ? `Hoja ${hoja} · ` : ''}
                            Enviado: {enviadoDisp}{etiquetaEnviado ? ` × ${etiquetaEnviado}` : ''}
                        </p>

                        {/* Recibir uno suelto es parcial POR PRODUCTO, no por unidad:
                            el renglón se cierra con la cantidad que quede escrita acá
                            y no se vuelve a contar. Quien viene a buscar un producto
                            para venderlo ya, tiende a llevarse las que necesita y a
                            dejar el resto «para después» — y ese después no existe.
                            Se dice sólo cuando el renglón trae más de uno, que es el
                            único caso donde se puede equivocar. */}
                        {enviadoDisp > 1 && (
                            <p className="text-micro font-medium text-warning-text mt-1 leading-tight">
                                Cuenta las {enviadoDisp} de una vez: el producto se recibe
                                completo y después ya no se vuelve a contar.
                            </p>
                        )}

                        <div className="flex items-center gap-1.5 mt-2">
                            <div className="w-36 shrink-0">
                                <LiquidSelect
                                    value={String(fPres)}
                                    onChange={v => setFPresVals(p => ({ ...p, [r.id]: Number(v) }))}
                                    options={presOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                    compact
                                    clearable={false}
                                />
                            </div>
                            <div className="relative w-14 shrink-0">
                                <PortalInput
                                    aria-label="Cuántos llegaron" compact
                                    tono={delta !== 0 ? 'warning' : 'chart-9'}
                                    type="number" min={0} value={fQty}
                                    onChange={e => setFQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                    inputClassName="text-center font-bold tabular-nums"
                                />
                                {delta !== 0 && (
                                    <Badge variant={delta < 0 ? 'danger' : 'success'} tone="solid" size="sm" uppercase={false}
                                        className="absolute -top-1.5 -right-1.5">{delta > 0 ? '+' : ''}{delta}</Badge>
                                )}
                            </div>
                            <Button
                                icon={AlertTriangle} iconOnly size="sm" tone="chart-4" soft
                                onClick={() => setTieneProblema(p => {
                                    const cur = p[r.id];
                                    if (!cur) return { ...p, [r.id]: true };
                                    if (cur === true) return { ...p, [r.id]: false };
                                    return { ...p, [r.id]: true };
                                })}
                                title={panelOpen ? 'Cancelar problema' : hasProb ? 'Editar problema' : 'Vino mal'}
                            />
                            <div className="flex-1" />
                            <Button tone="success" size="sm" icon={PackageCheck} disabled={saving} onClick={() => onRecibir(r)}>Recibir</Button>
                        </div>

                        {panelOpen && (
                            <div className="mt-2">
                                <PanelProblema
                                    id={r.id} fQty={fQty} campos={campos}
                                    onListo={() => setTieneProblema(p => ({ ...p, [r.id]: 'done' }))}
                                />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

/**
 * Lo que salió de bodega para ese renglón — que es contra lo que se cuenta.
 *
 * `cantidad_enviada` sólo se escribe si al finalizar el despacho se ajustó la
 * cantidad; en casi todos los renglones es idéntica a la asignada, y justo en
 * los que no, la asignada es el número equivocado. La base compara contra esto
 * mismo (`COALESCE(cantidad_enviada, cantidad_asignada)` dentro de
 * `receive_pedido_sucursal`), así que la pantalla y la base miran lo mismo.
 */
const enviadoDe = (r) => r?.cantidad_enviada ?? r?.cantidad_asignada ?? 0;

const ERROR_TIPOS = [
    { value: 'danado',  label: 'Dañado'  },
    { value: 'vencido', label: 'Vencido' },
    { value: 'otro',    label: 'Otro'    },
];

// Items screen: producto | enviado | presentación | cantidad | acción
//
// Eran siete columnas: las dos de «Físico» que se ven acá y otras dos de
// «Sistema» al lado. «Sistema» pedía escribir a mano lo que el portal ya sabe
// —lo que despachó— y arrancaba con el mismo número, así que sólo cambiaba si
// alguien la tocaba. Desde que el traslado sale solo del portal, contar es
// decir qué llegó y compararlo con lo enviado.
const GRID = 'grid-cols-[minmax(0,1fr)_3.5rem_9rem_3rem_4.25rem]';
// Extras screen: sin columna "enviado" → no hay envío contra el cual comparar
const EXTRAS_GRID = 'grid-cols-[minmax(0,1fr)_9rem_3rem_1.75rem]';

async function fetchPresOpts(productId) {
    const { data, error } = await fetchProductPreciosOpts(productId);
    if (error) console.error('fetchPresOpts failed:', error.message);
    const opts = [];
    (data || []).forEach(p => {
        const f = Number(p.factor) || 1;
        if (!opts.find(x => x.factor === f)) {
            const tipo = p.presentaciones?.tipo || '';
            const det  = p.descripcion || '';
            const label = tipo ? `${tipo}${det ? ' ' + det : ''}` : det || (f === 1 ? 'Unidad' : `×${f}`);
            opts.push({ factor: f, label });
        }
    });
    return opts;
}

// ── Los campos de cantidad NO pasan por `PortalInput` (2026-07-28, D3.4) ──
// Son celdas de una grilla densa, no campos de formulario:
//   · no tienen etiqueta visible (usan `aria-label`) y `PortalInput` siempre
//     dibuja un `<label>` arriba — acá no hay lugar ni sentido
//   · llevan `data-qty-row`/`data-qty-col` y un `onKeyDown` propio para
//     moverse con las flechas entre celdas, como una hoja de cálculo
//   · su borde cambia de color segun la diferencia contra lo facturado
// Es el mismo criterio que el banco de horas de nómina (v2.116.0).

export default function RecepcionModal({
    open, onClose, pedido, sucursalId, sucursalNombre, rows, onConfirmed,
    cajaDanada   = [],   // cajas que llegaron dañadas (sus productos sí están)
    cajaMap      = {},   // {"1":[1,2],"2":[3,4]} → caja → hojas que trae adentro
    paginaItems  = {},   // {"1":[itemId,...],...} → hoja → pedido_item IDs
    paginas      = [],   // [{ ids, firstLab, firstItem, itemCount }] → el rótulo de cada hoja
    hojasRecibidas: initHojasRecibidas = [], // hojas ya contadas (de la base)
    faltaCajas   = [],   // cajas que no llegaron (sus productos quedan excluidos)
    hasFaltaItems = false, // hay items falta_caja:true en otros grupos (electrolit/especial/caja pendiente)
    especialesLlegadas = {}, // { 'E1': 'ok'|'danada'|'faltante', ... }
    itemsEnReenvio  = [],  // ids de renglones que quedaron en una caja que no llegó
    itemsYaContados = [],  // ids de renglones que ya se contaron (en cualquier sesión)
}) {
    const montadoParaSalida = useMontadoParaSalida(open);
    const { user } = useAuth();

    // ¿Tenemos con qué contar por hoja? `pagina_items` es el mapa hoja→productos
    // y lo escribe bodega al finalizar; los despachos viejos no lo tienen y se
    // cuentan enteros, como siempre.
    //
    // Y no alcanza con que exista: tiene que cubrir TODO. Si un renglón no cae
    // en ninguna hoja —pasa en los despachos con el mapa a medias— contar por
    // hoja lo dejaría fuera de toda pantalla, sin que nadie lo note. Antes que
    // perder un producto de vista, se cuenta el pedido entero como siempre.
    const hayHojas = useMemo(() => {
        if (Object.keys(paginaItems).length === 0) return false;
        const enHojas = new Set(Object.values(paginaItems).flat());
        return rows.every(r => enHojas.has(r.id) || r.caja_especial === true);
    }, [paginaItems, rows]);

    // ── Screen ─────────────────────────────────────────────────────────────────
    const [screen,              setScreen]              = useState('cajas');
    const [selectedHoja,        setSelectedHoja]        = useState(null);
    // Los que se recibieron de a uno, para pintarlos sin recargar todo.
    const [sueltosOk,           setSueltosOk]           = useState(() => new Set());
    const [selectedEspecial,    setSelectedEspecial]    = useState(null); // { label, item }
    const [confirmedEspecialIds,setConfirmedEspecialIds] = useState(new Set());
    const [localRec,     setLocalRec]     = useState([]);   // confirmed this session
    const [anyHasDiff,   setAnyHasDiff]   = useState(false);
    const [confirmarTodoOpen, setConfirmarTodoOpen] = useState(false);
    // Qué confirmación de la hoja/caja ABIERTA está esperando respuesta:
    // 'contado' (las cantidades de pantalla) | 'todook' (tal como se envió).
    // Confirmar una hoja mete su contenido al inventario de la sala y no se
    // deshace desde acá, así que pregunta igual que «Confirmar todo».
    const [confirmarHoja, setConfirmarHoja] = useState(null);

    // ── Per-item input state ────────────────────────────────────────────────────
    const [fQtyVals,  setFQtyVals]  = useState({});
    const [fPresVals, setFPresVals] = useState({});
    const [notaVals,  setNotaVals]  = useState({});
    const [errorVals, setErrorVals] = useState({});
    const [tieneProblema,    setTieneProblema]    = useState({});
    const [cantProblemaVals, setCantProblemaVals] = useState({});
    const [presMap,   setPresMap]   = useState({});
    const [saving,    setSaving]    = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [prodSearch, setProdSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);

    // ── Extras ─────────────────────────────────────────────────────────────────
    const [extras,       setExtras]       = useState([]);
    const [extraSearch,  setExtraSearch]  = useState('');
    const [extraResults, setExtraResults] = useState([]);
    const [extraBusy,    setExtraBusy]    = useState(false);
    const [prevScreen,   setPrevScreen]   = useState(null);

    const searchRef       = useRef(null);
    const extraRef        = useRef(null);
    const extrasEndRef    = useRef(null);
    const extraBuscarRef  = useRef(null);
    const [extraDropCoords, setExtraDropCoords] = useState({ top: 0, left: 0, width: 0 });

    // Con la lista de resultados abierta, lo de atrás se queda quieto — ver
    // `src/utils/capaFlotante.js`. Acá hay tarjetas debajo del campo de
    // búsqueda, así que es el mismo salto que en el tablero.
    useCapaFlotante(extraResults.length > 0);

    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío. Declarado acá
    // (no cerca de donde se usa, más abajo) porque este componente tiene
    // returns tempranos por pantalla (cajas/extras) — un hook después de esos
    // returns se saltearía en algunos renders, violando las reglas de hooks.
    const { containerProps: prodSearchContainerRef } = useSearchToggle({
        active: showSearch,
        value: prodSearch,
        onClear: () => setProdSearch(''),
        onClose: () => setShowSearch(false),
    });

    // ── Sorted all rows ─────────────────────────────────────────────────────────
    const sortedRows = useMemo(() => [...rows].sort((a, b) => {
        const la = a.products?.laboratorios?.nombre ?? '';
        const lb = b.products?.laboratorios?.nombre ?? '';
        return la.localeCompare(lb, 'es') || (a.products?.nombre ?? '').localeCompare(b.products?.nombre ?? '', 'es');
    }), [rows]);

    // Cajas especiales: E1, E2… una por CAJA, con la numeración compartida (así
    // marcar «E2 dañada» en el aviso de llegada señala la misma caja acá).
    //
    // Pero la BALDOSA es por renglón, no por caja: la recepción confirma la
    // cantidad de un renglón de una sola vez —`receive_pedido_sucursal` recibe un
    // número por `pedido_item`— así que dos baldosas del mismo producto serían
    // dos veces la misma confirmación, y tocar una desactivaría la otra. La
    // baldosa dice entonces qué cajas cubre: «E1–E2».
    const especialItems = useMemo(() => {
        const porRenglon = new Map();
        for (const caja of construirCajasEspeciales(rows)) {
            const previo = porRenglon.get(caja.pedido_item_id);
            if (previo) { previo.labels.push(caja.label); continue; }
            const item = rows.find(r => r.id === caja.pedido_item_id);
            if (item) porRenglon.set(caja.pedido_item_id, { labels: [caja.label], item });
        }
        return [...porRenglon.values()].map(({ labels, item }) => ({
            label: labels.length > 1 ? `${labels[0]}–${labels[labels.length - 1]}` : labels[0],
            labels,
            item,
        }));
    }, [rows]);

    // ── Hojas: la unidad de conteo ──────────────────────────────────────────────
    // `paginaItems` dice qué productos van en cada hoja, y es el mismo reparto
    // que se imprimió en papel. Los renglones que no llegaron (`falta_caja`) ya
    // vienen filtrados de `rows`, así que una hoja partida por una caja que no
    // llegó aparece acá con los que sí se pueden contar.
    const idsPresentes = useMemo(() => new Set(rows.map(r => r.id)), [rows]);

    const itemIdsByHoja = useMemo(() => {
        if (!hayHojas) return {};
        const result = {};
        Object.entries(paginaItems).forEach(([hojaStr, ids]) => {
            result[hojaStr] = new Set((ids ?? []).filter(id => idsPresentes.has(id)));
        });
        return result;
    }, [paginaItems, hayHojas, idsPresentes]);

    const allHojaNums = useMemo(() =>
        Object.keys(paginaItems).map(Number).sort((a, b) => a - b),
    [paginaItems]);

    // El rótulo de cada hoja: su primer laboratorio, que es como quien recibe la
    // reconoce en el papel. Sale de `paginas`, en el mismo orden en que se
    // numeraron (índice + 1 = número de hoja).
    const hojaLabel = useMemo(() => {
        const m = {};
        (paginas ?? []).forEach((p, i) => { m[i + 1] = p?.firstLab || p?.firstItem || ''; });
        return m;
    }, [paginas]);

    // Los campos que se editan al contar, en un solo bulto. Los comparten la
    // tabla de la hoja y la búsqueda rápida A PROPÓSITO: lo que se escribe en
    // cualquiera de las dos es lo que se guarda, porque `buildPItems` lee este
    // mismo estado. Dos juegos de campos serían dos números para el mismo
    // renglón.
    const campos = {
        presMap,
        fQtyVals, setFQtyVals, fPresVals, setFPresVals,
        tieneProblema, setTieneProblema,
        errorVals, setErrorVals,
        cantProblemaVals, setCantProblemaVals,
        notaVals, setNotaVals,
    };

    // En qué hoja cayó un renglón — para que el buscador de «lo necesito ya»
    // pueda decirlo, que es lo que uno no sabe cuando lo busca.
    const hojaDeItem = useCallback((itemId) => {
        for (const [hojaStr, ids] of Object.entries(itemIdsByHoja)) {
            if (ids.has(itemId)) return Number(hojaStr);
        }
        return null;
    }, [itemIdsByHoja]);

    // Qué cajas trae cada hoja — el inverso de `cajaMap`. Sirve para dos cosas:
    // decir en qué cajas buscarla, y saber si alguna de ésas llegó dañada o no
    // llegó, que es lo que pone la hoja en alerta.
    const cajasDeHoja = useMemo(() => {
        const m = {};
        Object.entries(cajaMap).forEach(([cajaStr, hojas]) => {
            (hojas ?? []).forEach(h => { (m[h] ??= []).push(Number(cajaStr)); });
        });
        Object.values(m).forEach(v => v.sort((a, b) => a - b));
        return m;
    }, [cajaMap]);

    // Regla del usuario: una caja dañada o faltante ALERTA a las hojas que traía
    // y les prohíbe el «Todo OK». Esos renglones hay que mirarlos de a uno.
    const hojasAlertadas = useMemo(() => {
        const malas = new Set([...cajaDanada, ...faltaCajas]);
        return new Set(allHojaNums.filter(h => (cajasDeHoja[h] ?? []).some(c => malas.has(c))));
    }, [allHojaNums, cajasDeHoja, cajaDanada, faltaCajas]);

    // Contadas: las de la base + las de esta sesión.
    const allRecibidas = useMemo(() => {
        const s = new Set([...initHojasRecibidas, ...localRec]);
        return [...s].sort((a, b) => a - b);
    }, [initHojasRecibidas, localRec]);

    // Una hoja sin ningún renglón presente no se puede contar AHORA: sus
    // productos ya se contaron antes, o viajaban en una caja que no llegó.
    const accessibleHojaNums = useMemo(() =>
        allHojaNums.filter(n => (itemIdsByHoja[String(n)]?.size ?? 0) > 0),
    [allHojaNums, itemIdsByHoja]);

    // ── En qué está cada hoja ───────────────────────────────────────────────────
    // La regla vive en `estadoDeHojas`, probada: `rows` trae SÓLO lo pendiente,
    // así que una hoja contada en una sesión anterior llega acá sin un renglón
    // —igual que una que viaja en una caja que no llegó— y el encabezado terminó
    // diciendo «0/2 contadas» sobre una lista de cuatro con dos ya contadas.
    const hojaEstado = useMemo(() => estadoDeHojas({
        hojaNums:          allHojaNums,
        paginaItems,
        pendientesPorHoja: Object.fromEntries(allHojaNums.map(n => [n, itemIdsByHoja[String(n)]?.size ?? 0])),
        hojasRecibidas:    allRecibidas,
        itemsEnReenvio,
        itemsYaContados,
    }), [allHojaNums, paginaItems, itemIdsByHoja, allRecibidas, itemsEnReenvio, itemsYaContados]);

    const contables = hojasContables(allHojaNums, hojaEstado);
    const contadas  = hojasContadas(allHojaNums, hojaEstado);

    const accessibleEspeciales = especialItems.filter(e => !e.item.falta_caja);
    const allEspecialesDone = accessibleEspeciales.every(e => confirmedEspecialIds.has(e.item.id) || e.item.status === 'recibido');
    const hasAnythingToReceive = accessibleHojaNums.length > 0 || accessibleEspeciales.length > 0;
    const allAccessibleDone = hasAnythingToReceive
        && (accessibleHojaNums.length === 0 || accessibleHojaNums.every(n => allRecibidas.includes(n)))
        && allEspecialesDone;

    // Qué hay abierto: una caja especial, una hoja, o el pedido entero.
    // Una sola vez y en una función probada — ver `alcanceDeRecepcion`.
    const alcance = alcanceDeRecepcion({ especial: selectedEspecial, hoja: selectedHoja, hayHojas });

    // Los renglones de lo que esté abierto: la caja especial, la hoja, o todo.
    const filasAbiertas = useMemo(() => {
        if (selectedEspecial !== null) return [selectedEspecial.item];
        if (selectedHoja === null || !hayHojas) return sortedRows;
        const ids = itemIdsByHoja[String(selectedHoja)];
        if (!ids) return sortedRows;
        return sortedRows.filter(r => ids.has(r.id));
    }, [selectedHoja, selectedEspecial, itemIdsByHoja, sortedRows, hayHojas]);

    // Un renglón que ya se recibió de a uno —en esta sesión o en otra— NO se
    // vuelve a contar. Sigue a la vista en su hoja, marcado, porque quien cuenta
    // tiene que ver que ese producto ya está resuelto; lo que no hace es entrar
    // otra vez en el envío al confirmar. La base sola no alcanza: sólo toca los
    // renglones que siguen `pendiente`, así que mandarlo de nuevo no suma
    // existencias, pero sí miente en el número que queda registrado y —lo caro—
    // deja que la lista de ids del ingreso al inventario se arme mal.
    const yaRecibido = useCallback(
        (r) => sueltosOk.has(r.id) || r.status === 'recibido',
        [sueltosOk]);

    const filasPorContar = useMemo(
        () => filasAbiertas.filter(r => !yaRecibido(r)),
        [filasAbiertas, yaRecibido]);

    // ── Init on open ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!open) return;
        setScreen(hayHojas ? 'cajas' : 'items');
        setSelectedHoja(null);
        setSelectedEspecial(null);
        setConfirmedEspecialIds(new Set());
        setLocalRec([]);
        setAnyHasDiff(false);
        setSueltosOk(new Set());
        setConfirmarHoja(null);
        setConfirmarTodoOpen(false);
        setSaveError(null);
        setPresMap({});
        setExtras([]); setExtraSearch(''); setExtraResults([]);
        setProdSearch(''); setShowSearch(false); setPrevScreen(null);

        const fQ = {}, fP = {}, notas = {}, errs = {};
        for (const r of rows) {
            const erpF  = Number(r.factor) || 1;
            const dispF = Number(r.dispatch_factor) || erpF;
            fQ[r.id] = toDispatch(enviadoDe(r), erpF, dispF); fP[r.id] = dispF;
            notas[r.id] = ''; errs[r.id] = '';
        }
        setFQtyVals(fQ); setFPresVals(fP);
        setNotaVals(notas); setErrorVals(errs); setTieneProblema({}); setCantProblemaVals({});

        const productIds = [...new Set(rows.map(r => r.erp_product_id))];
        if (productIds.length > 0) {
            (async () => {
                const allData = await fetchProductPreciosOptsForProducts(productIds) ?? [];
                const map = {};
                allData.forEach(p => {
                    const pid = p.product_id;
                    if (!map[pid]) map[pid] = [];
                    const f = Number(p.factor) || 1;
                    if (!map[pid].find(x => x.factor === f)) {
                        const tipo = p.presentaciones?.tipo || '';
                        const det  = p.descripcion || '';
                        const label = tipo ? `${tipo}${det ? ' ' + det : ''}` : det || (f === 1 ? 'Unidad' : `×${f}`);
                        map[pid].push({ factor: f, label });
                    }
                });
                setPresMap(map);
            })();
        }
    }, [open, rows, pedido?.id, sucursalId]); // eslint-disable-line

    // ── Extras search ────────────────────────────────────────────────────────────
    useEffect(() => {
        if (screen !== 'extras' || extraSearch.trim().length < 2) { setExtraResults([]); return; }
        const existingIds = [...rows.map(r => r.erp_product_id), ...extras.map(e => e.erp_product_id)];
        const t = setTimeout(async () => {
            setExtraBusy(true);
            const { data, error } = await searchAvailableProducts(extraSearch.trim(), existingIds);
            if (error) console.error('extras search failed:', error.message);
            setExtraResults((data || []).slice(0, 8));
            setExtraBusy(false);
        }, 300);
        return () => clearTimeout(t);
    }, [extraSearch, screen, rows, extras]);

    const addExtra = useCallback(async (prod) => {
        if (extras.some(e => e.erp_product_id === prod.id)) return;
        setExtraSearch(''); setExtraResults([]);

        let opts = presMap[prod.id] ? [...presMap[prod.id]] : [];
        if (opts.length === 0) opts = await fetchPresOpts(prod.id);

        const { data: lastDispatch, error: lastDispatchErr } = await fetchLastDispatchInfo(prod.id);
        if (lastDispatchErr) console.error('fetch last dispatch failed:', lastDispatchErr.message);
        if (lastDispatch?.[0]) {
            const df = Number(lastDispatch[0].dispatch_factor) || 1;
            if (!opts.find(o => o.factor === df)) {
                opts.unshift({ factor: df, label: fmtDispatchLabel(lastDispatch[0].dispatch_tipo, df) });
            }
        }

        if (opts.length > 0) setPresMap(prev => ({ ...prev, [prod.id]: opts }));
        const defF = opts[0]?.factor ?? 1;
        setExtras(prev => [...prev, {
            erp_product_id: prod.id, nombre: prod.nombre,
            fPres: defF, fQty: 1, nota: '',
        }]);
        setTimeout(() => extrasEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 80);
    }, [extras, presMap]);

    // ── Build p_items payload for a set of rows ─────────────────────────────────
    const buildPItems = useCallback((rowsToProcess) => {
        return rowsToProcess.map(r => {
            const erpFactor  = Number(r.factor) || 1;
            const dispFactor = Number(r.dispatch_factor) || erpFactor;
            const enviado    = enviadoDe(r);
            const fQty  = fQtyVals[r.id]  ?? toDispatch(enviado, erpFactor, dispFactor);
            const fPres = fPresVals[r.id] ?? dispFactor;
            const tp = tieneProblema[r.id];
            const hasProb = !!tp;
            const fRaw = Math.round(fQty * fPres / erpFactor);
            // Contra lo ENVIADO, no contra una segunda casilla que había que
            // llenar a mano. Cambiar la presentación sin cambiar el total ya no
            // es una diferencia: son las mismas unidades en otro empaque, y eso
            // es justo lo que la sala hace cuando le llega en caja lo que se
            // pidió por unidad. (El tipo `presentacion` deja de generarse; se
            // conserva su etiqueta en «Diferencias» por los renglones viejos.)
            const isDiff = fRaw !== enviado || hasProb;

            const nota = notaVals[r.id] || null;
            let error_tipo = null;
            if (isDiff) {
                if (hasProb && errorVals[r.id]) error_tipo = errorVals[r.id];
                else if (fRaw < enviado)        error_tipo = 'faltante';
                else if (fRaw > enviado)        error_tipo = 'sobrante';
                else                            error_tipo = 'otro';
            }
            const cantProb = (error_tipo === 'danado' || error_tipo === 'vencido')
                ? (cantProblemaVals[r.id] ?? 1) : null;
            return { pedido_item_id: r.id, cantidad_recibida: fRaw, nota_diferencia: nota, error_tipo, cantidad_problema: cantProb };
        });
    }, [fQtyVals, fPresVals, notaVals, errorVals, tieneProblema, cantProblemaVals]);

    const saveExtras = useCallback(async () => {
        if (!extras.length) return;
        const erpFactorMap = {};
        rows.forEach(r => { erpFactorMap[r.erp_product_id] = Number(r.factor) || 1; });
        // Un producto de más que no queda escrito es un producto que nadie va a
        // buscar: el `error` se miraba en ningún lado y el modal se cerraba
        // igual. Lanza, y quien recibe se entera en la misma pantalla.
        const { error } = await insertPedidoRecepcionExtras(
            extras.map(e => {
                const ef = erpFactorMap[e.erp_product_id] ?? 1;
                return {
                    pedido_id: pedido.id, erp_sucursal_id: sucursalId,
                    erp_product_id: e.erp_product_id,
                    cantidad: Math.round(e.fQty * e.fPres / ef),
                    // Un producto de más no tiene contra qué compararse: nadie
                    // lo despachó. La nota es la que escriba quien recibe.
                    nota: e.nota || null,
                    reported_by: user?.id ?? null,
                };
            })
        );
        if (error) throw error;
    }, [extras, rows, pedido?.id, sucursalId, user]);

    // ── Meter al inventario lo que se acaba de confirmar ────────────────────────
    // Cada producto viaja en su propio traslado, así que dar por recibidos los
    // renglones contados es recibir esos traslados ENTEROS. Por eso la recepción
    // parcial —que no existe del otro lado— no hace falta.
    //
    // Nunca bloquea ni lanza: lo contado ya quedó guardado, y un tropiezo acá no
    // puede deshacerlo ni hacer creer que no se contó. `NADA_QUE_RECIBIR` no es
    // un error: es lo normal en los pedidos que se despacharon a mano.
    //
    // Existía sólo adentro de «Confirmar hoja». «Todo OK» y «Confirmar todo»
    // marcaban recibido en el portal y NO ingresaban nada —el aviso de
    // «Confirmar todo» ya prometía que sí—, o sea que dar por bueno un pedido
    // entero de una vez dejaba la sala sin existencias. Una sola copia, y la
    // llaman los tres.
    //
    // El aviso va por toast y no en la franja del pie: los tres caminos pueden
    // terminar cerrando el modal, y ahí la franja se va con él sin que nadie la
    // lea.
    const ingresarAlInventario = useCallback(async (itemIds) => {
        // SIN ids no se llama. La función sin `pedido_item_ids` ni `hoja` recibe
        // TODO lo pendiente de la sucursal: una hoja cuyos renglones ya se
        // recibieron de a uno deja la lista vacía, y esa llamada ingresaría el
        // pedido completo sin que nadie lo pidiera.
        if (!itemIds.length) return { ok: true };
        try {
            const erp = await recibirTrasladoPedido(pedido.id, sucursalId, { itemIds });
            if (!erp.ok && erp.codigo !== 'NADA_QUE_RECIBIR') return { ok: false, error: erp.error ?? 'sin detalle' };
            return { ok: true };
        } catch (e) {
            console.error('ingreso al inventario:', e);
            return { ok: false, error: mensajeAmigable(e) };
        }
    }, [pedido?.id, sucursalId]);

    const avisarIngresoFallido = useCallback((detalle) => {
        useToastStore.getState().showToast(
            'Recepción guardada, inventario pendiente',
            `El conteo quedó guardado, pero los productos no entraron al inventario: ${detalle}. Se puede reintentar.`,
            'error', 8000,
        );
    }, []);

    // ── Recibir UN producto, sin contar el resto de la caja ─────────────────────
    // El caso real: llegó la caja, todavía no se cuenta, y hace falta ese
    // producto para venderlo AHORA. Sin esto habría que confirmar la caja
    // entera —o sea contarla— antes de poder facturarlo.
    //
    // Se puede porque cada producto viaja en su propio traslado: recibirlo es
    // recibir ese traslado ENTERO, sin tocar los demás.
    const handleRecibirSolo = useCallback(async (row) => {
        setSaving(true); setSaveError(null);
        try {
            const p_items = buildPItems([row]);
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null,
            });
            if (error) throw error;

            const erp = await recibirTrasladoPedido(pedido.id, sucursalId, { itemIds: [row.id] });
            setSueltosOk(prev => new Set([...prev, row.id]));

            useStaff.getState().appendAuditLog('RECIBIR_PRODUCTO_SUELTO', pedido.id, {
                sucursal_id: sucursalId, pedido_item_id: row.id,
                producto: row.products?.nombre ?? null,
                entro_al_sistema: erp.ok === true,
            });

            if (!erp.ok && erp.codigo !== 'NADA_QUE_RECIBIR') {
                setSaveError(
                    `Quedó contado, pero no entró al inventario: ${erp.error ?? 'sin detalle'}. `
                    + 'Todavía no se puede facturar.',
                );
            }
        } catch (e) {
            setSaveError(mensajeAmigable(e));
        } finally {
            setSaving(false);
        }
    }, [buildPItems, pedido, sucursalId, user]);

    // ── Cerrar lo que se acaba de confirmar ─────────────────────────────────────
    // Estos dos bloques vivían duplicados dentro de «Confirmar» y de «Todo OK», y
    // ya habían divergido: la copia de «Todo OK» no conocía las cajas especiales
    // —desde adentro de una confirmaba el pedido ENTERO— y tampoco las esperaba
    // antes de darlo por terminado. Una sola copia de cada uno.
    const cerrarEspecial = useCallback(async ({ itemsCount, hasDiff, todoOk = false }) => {
        const newConfirmedIds = new Set([...confirmedEspecialIds, selectedEspecial.item.id]);
        setConfirmedEspecialIds(newConfirmedIds);
        const espDone = especialItems.filter(e => !e.item.falta_caja)
            .every(e => newConfirmedIds.has(e.item.id) || e.item.status === 'recibido');
        const regDone = accessibleHojaNums.length === 0 || accessibleHojaNums.every(n => allRecibidas.includes(n));
        useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_ESPECIAL', pedido.id, {
            sucursal_id: sucursalId, especial: selectedEspecial.label, items_count: itemsCount,
            ...(todoOk ? { todo_ok: true } : {}),
        });
        if (regDone && espDone) {
            await saveExtras();
            onConfirmed?.({ hasDiff, allDone: faltaCajas.length === 0 && !hasFaltaItems });
            onClose();
        } else {
            setScreen('cajas'); setSelectedEspecial(null); setProdSearch(''); setShowSearch(false);
        }
    }, [confirmedEspecialIds, selectedEspecial, especialItems, accessibleHojaNums, allRecibidas,
        pedido, sucursalId, saveExtras, onConfirmed, onClose, faltaCajas, hasFaltaItems]);

    const cerrarHoja = useCallback(async ({ itemsCount, hasDiff, todoOk = false }) => {
        const newRec = [...new Set([...allRecibidas, selectedHoja])].sort((a, b) => a - b);
        // Sin este chequeo la hoja se pintaba contada en pantalla y reaparecía
        // pendiente al recargar: el UPDATE lo frenaba RLS y no devolvía error.
        // Es lo que pasó el 2026-08-14 en La Popular.
        const { error } = await updatePedidoSucursalStatus(pedido.id, sucursalId, { hojas_recibidas: newRec });
        if (error) throw error;
        setLocalRec(prev => [...new Set([...prev, selectedHoja])].sort((a, b) => a - b));

        const regDone = accessibleHojaNums.every(n => newRec.includes(n));
        const espDone = especialItems.filter(e => !e.item.falta_caja)
            .every(e => confirmedEspecialIds.has(e.item.id) || e.item.status === 'recibido');
        useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_HOJA', pedido.id, {
            sucursal_id: sucursalId, hoja: selectedHoja, items_count: itemsCount,
            ...(todoOk ? { todo_ok: true } : {}),
        });
        if (regDone && espDone) {
            await saveExtras();
            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                sucursal_id: sucursalId, extras_count: extras.length,
            });
            onConfirmed?.({ hasDiff, allDone: true });
            onClose();
        } else {
            // Quedan hojas o especiales — de vuelta a la lista
            setScreen('cajas'); setSelectedHoja(null); setProdSearch(''); setShowSearch(false);
        }
    }, [allRecibidas, selectedHoja, pedido, sucursalId, accessibleHojaNums, especialItems,
        confirmedEspecialIds, saveExtras, extras, onConfirmed, onClose]);

    // ── Confirm a single box (or all if no caja map) ────────────────────────────
    const handleConfirmarCaja = useCallback(async () => {
        // `filasAbiertas` YA resuelve los tres alcances (especial, caja,
        // pedido entero), así que repetir la condición acá sólo daba lugar a que
        // se escribiera distinta en cada sitio. Y así se escribió. Lo ya
        // recibido de a uno queda fuera: se cuenta una vez.
        const rowsToSave = filasPorContar;

        const invalidExtra = extras.find(e => e.fQty === 0);
        if (invalidExtra) {
            setSaveError(`"${invalidExtra.nombre}": escribe cuántos llegaron.`);
            return;
        }

        setSaving(true); setSaveError(null);
        const p_items = buildPItems(rowsToSave);

        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null,
            });
            if (error) throw error;

            // ── Y lo mismo en el inventario ─────────────────────────────────
            const ing = await ingresarAlInventario(p_items.map(it => it.pedido_item_id));
            if (!ing.ok) avisarIngresoFallido(ing.error);

            const boxHasDiff = p_items.some(it => it.error_tipo !== null);
            const newAnyDiff = anyHasDiff || boxHasDiff;
            setAnyHasDiff(newAnyDiff);

            if (alcance === 'especial') {
                await cerrarEspecial({ itemsCount: p_items.length, hasDiff: newAnyDiff });
            } else if (alcance === 'hoja') {
                await cerrarHoja({ itemsCount: p_items.length, hasDiff: newAnyDiff });
            } else {
                // No caja map — single confirm, original behavior
                await saveExtras();
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                    sucursal_id: sucursalId, items_count: p_items.length, extras_count: extras.length,
                });
                onConfirmed?.({ hasDiff: boxHasDiff, allDone: true });
                onClose();
            }
        } catch (e) {
            setSaveError(mensajeAmigable(e));
        } finally {
            setSaving(false);
        }
    }, [
        alcance, filasPorContar, extras, buildPItems, cerrarEspecial, cerrarHoja,
        pedido, sucursalId, user, anyHasDiff, saveExtras, onConfirmed, onClose,
        ingresarAlInventario, avisarIngresoFallido,
    ]);

    // ── Confirmar todo sin errores (acción rápida) ──────────────────────────────
    // 7A.3: botón "Todo OK" en el footer de la pantalla de items — confirma
    // recibido = enviado sin revisar línea por línea (mismo criterio que
    // handleConfirmarTodo, pero acotado a la caja/pedido actualmente abierto).
    const handleTodoOk = useCallback(async () => {
        // Acotado a lo que hay ABIERTO. Preguntaba sólo por el número de caja,
        // que dentro de una caja especial es `null`: desde una especial este
        // botón daba por recibido el pedido entero.
        const rowsToSave = filasPorContar;
        setSaving(true); setSaveError(null);

        // Payload con cantidades exactas asignadas, sin diferencias
        const p_items = rowsToSave.map(r => {
            const erpFactor  = Number(r.factor) || 1;
            const dispFactor = Number(r.dispatch_factor) || erpFactor;
            const dispQty    = toDispatch(enviadoDe(r), erpFactor, dispFactor);
            const rawQty     = Math.round(dispQty * dispFactor / erpFactor);
            return { pedido_item_id: r.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null };
        });

        try {
            const { error } = await supabase.rpc('receive_pedido_sucursal', {
                p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                p_items, p_received_by: user?.id ?? null,
            });
            if (error) throw error;

            // Dar por bueno también ingresa: «Todo OK» y «Confirmar» dejan el
            // mismo renglón recibido, y sólo uno de los dos metía el producto al
            // inventario. Quien lo apretaba se quedaba sin existencias.
            const ing = await ingresarAlInventario(p_items.map(it => it.pedido_item_id));
            if (!ing.ok) avisarIngresoFallido(ing.error);

            if (alcance === 'especial') {
                await cerrarEspecial({ itemsCount: p_items.length, hasDiff: anyHasDiff, todoOk: true });
            } else if (alcance === 'hoja') {
                await cerrarHoja({ itemsCount: p_items.length, hasDiff: anyHasDiff, todoOk: true });
            } else {
                await saveExtras();
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, { sucursal_id: sucursalId, items_count: p_items.length, todo_ok: true });
                onConfirmed?.({ hasDiff: false, allDone: true });
                onClose();
            }
        } catch (e) {
            setSaveError(mensajeAmigable(e));
        } finally {
            setSaving(false);
        }
    }, [alcance, filasPorContar, pedido, sucursalId, user, anyHasDiff,
        cerrarEspecial, cerrarHoja, saveExtras, onConfirmed, onClose,
        ingresarAlInventario, avisarIngresoFallido]);

    // ── Confirmar de una vez todo lo que se puede (Todo OK) ────────────────────
    const handleConfirmarTodo = useCallback(async () => {
        setSaving(true); setSaveError(null);
        // El ingreso al inventario va POR HOJA y no en una sola llamada al
        // final: un pedido grande pasa de las 500 líneas que la recepción trae
        // por vuelta, y ahí el resto se quedaría afuera en silencio. Los fallos
        // se juntan y se avisan una vez —dentro del bucle, cada aviso pisaría al
        // anterior—.
        const fallosIngreso = [];
        try {
            let newRec = [...allRecibidas];
            for (const hojaNum of accessibleHojaNums) {
                if (newRec.includes(hojaNum)) continue;
                // Regla del usuario: una hoja que venía en una caja dañada o que
                // no llegó NO se confirma en bloque. Hay que abrirla y mirar sus
                // renglones de a uno, que es justo lo que la caja con problema
                // pone en duda.
                if (hojasAlertadas.has(hojaNum)) continue;
                const ids = itemIdsByHoja[String(hojaNum)];
                if (!ids) continue;
                const hojaRows = sortedRows.filter(r => ids.has(r.id) && !yaRecibido(r));
                if (!hojaRows.length) {
                    // Sin renglones por contar la hoja igual queda contada: sus
                    // productos se recibieron de a uno y ya están adentro.
                    newRec = [...new Set([...newRec, hojaNum])].sort((a, b) => a - b);
                    continue;
                }
                const p_items = hojaRows.map(r => {
                    const erpFactor  = Number(r.factor) || 1;
                    const dispFactor = Number(r.dispatch_factor) || erpFactor;
                    const rawQty     = Math.round(toDispatch(enviadoDe(r), erpFactor, dispFactor) * dispFactor / erpFactor);
                    return { pedido_item_id: r.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null };
                });
                const { error } = await supabase.rpc('receive_pedido_sucursal', {
                    p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                    p_items, p_received_by: user?.id ?? null,
                });
                if (error) throw error;
                const ing = await ingresarAlInventario(p_items.map(it => it.pedido_item_id));
                if (!ing.ok) fallosIngreso.push(`H${hojaNum}: ${ing.error}`);
                newRec = [...new Set([...newRec, hojaNum])].sort((a, b) => a - b);
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_HOJA', pedido.id, {
                    sucursal_id: sucursalId, hoja: hojaNum, items_count: p_items.length, todo_ok: true,
                    entro_al_inventario: ing.ok,
                });
            }
            const { error: recErr } = await updatePedidoSucursalStatus(pedido.id, sucursalId, { hojas_recibidas: newRec });
            if (recErr) throw recErr;
            setLocalRec(newRec.filter(n => !initHojasRecibidas.includes(n)));

            // También confirmar cajas especiales accesibles (no faltantes)
            const newConfirmedEspIds = new Set([...confirmedEspecialIds]);
            for (const { label, item } of especialItems) {
                if (item.falta_caja) continue; // en reenvío, no tocar
                if (confirmedEspecialIds.has(item.id) || item.status === 'recibido') continue;
                const erpF  = Number(item.factor) || 1;
                const dispF = Number(item.dispatch_factor) || erpF;
                const rawQty = Math.round(toDispatch(enviadoDe(item), erpF, dispF) * dispF / erpF);
                const { error } = await supabase.rpc('receive_pedido_sucursal', {
                    p_pedido_id: pedido.id, p_sucursal_id: sucursalId,
                    p_items: [{ pedido_item_id: item.id, cantidad_recibida: rawQty, nota_diferencia: null, error_tipo: null, cantidad_problema: null }],
                    p_received_by: user?.id ?? null,
                });
                if (error) throw error;
                const ingEsp = await ingresarAlInventario([item.id]);
                if (!ingEsp.ok) fallosIngreso.push(`${label}: ${ingEsp.error}`);
                newConfirmedEspIds.add(item.id);
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_ESPECIAL', pedido.id, {
                    sucursal_id: sucursalId, especial: label, todo_ok: true,
                    entro_al_inventario: ingEsp.ok,
                });
            }
            setConfirmedEspecialIds(newConfirmedEspIds);

            await saveExtras();
            useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                sucursal_id: sucursalId, extras_count: extras.length, todo_ok: true, batch: true,
                ingresos_fallidos: fallosIngreso.length || undefined,
            });
            if (fallosIngreso.length) avisarIngresoFallido(fallosIngreso.join(' · '));
            // Sólo se da por terminado si no quedó nada por revisar ni en reenvío
            const quedaPorRevisar = accessibleHojaNums.some(n => hojasAlertadas.has(n) && !newRec.includes(n));
            onConfirmed?.({ hasDiff: anyHasDiff, allDone: faltaCajas.length === 0 && !hasFaltaItems && !quedaPorRevisar });
            if (!quedaPorRevisar) onClose();
        } catch (e) {
            setSaveError(mensajeAmigable(e));
        } finally {
            setSaving(false);
        }
    }, [accessibleHojaNums, allRecibidas, itemIdsByHoja, sortedRows, pedido, sucursalId, user,
        anyHasDiff, initHojasRecibidas, saveExtras, extras, onConfirmed, onClose, hojasAlertadas,
        especialItems, confirmedEspecialIds, faltaCajas.length, hasFaltaItems,
        yaRecibido, ingresarAlInventario, avisarIngresoFallido]);

    // ── Finalizar desde la pantalla de cajas (cuando todas ya están recibidas) ──
    const handleFinalizar = useCallback(async () => {
        setSaving(true); setSaveError(null);
        try {
            await saveExtras();
            if (extras.length > 0) {
                useStaff.getState().appendAuditLog('CONFIRMAR_RECEPCION_PEDIDO', pedido.id, {
                    sucursal_id: sucursalId, extras_count: extras.length,
                });
            }
            onConfirmed?.({ hasDiff: anyHasDiff, allDone: faltaCajas.length === 0 && !hasFaltaItems });
            onClose();
        } catch (e) {
            setSaveError(mensajeAmigable(e));
        } finally {
            setSaving(false);
        }
    }, [saveExtras, extras, pedido?.id, sucursalId, anyHasDiff, faltaCajas, hasFaltaItems, onConfirmed, onClose]);

    // El gate mira el montaje-para-SALIDA y no `open` a secas: cortar en el
    // mismo tick del cierre desmontaba el componente antes de que
    // `ModalShell` pudiera animar nada. Ver `useMontadoParaSalida`.
    if (!montadoParaSalida) return null;

    // Visible rows for the items grid
    //
    // Era `selectedHoja !== null ? filasAbiertas : sortedRows`, y adentro de
    // una caja especial `selectedHoja` es null: la pantalla listaba los
    // productos de las cajas NORMALES bajo el título de la especial. Visto en La
    // Popular el 2026-08-14 («E3 — Caja especial» con tres leches adentro).
    // `filasAbiertas` ya resuelve los tres alcances; no hay nada que decidir.
    const gridRows = filasAbiertas;
    const visibleRows = prodSearch.trim()
        ? gridRows.filter(r => tokenMatch(prodSearch, r.products?.nombre))
        : gridRows;

    // ════════════════════════════════════════════════════════════════
    // SCREEN: CAJAS — box picker
    // ════════════════════════════════════════════════════════════════
    if (screen === 'cajas' && hayHojas) {
        const todasContadas = contables.length > 0 && contadas.length === contables.length;

        return (
            <PedidoModal open={open} onClose={saving ? undefined : onClose} maxWidth="max-w-md">
                <PedidoModal.Header className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                            <h3 className="text-subtitle font-bold text-content leading-snug">Confirmar recepción</h3>
                            <p className="text-label text-content-3 mt-0.5">
                                {/* «58 prod.» sonaba a que el despacho traía 58, cuando son
                                    los que QUEDAN: `rows` ya viene sin lo contado antes. */}
                                {sucursalNombre} · {rows.length} {contadas.length > 0 ? 'por contar' : 'prod.'} · {allHojaNums.length} hoja{allHojaNums.length !== 1 ? 's' : ''}
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Badge variant={todasContadas ? 'success' : 'warning'} uppercase={false}>
                                {contadas.length}/{contables.length} contadas
                            </Badge>
                            <Button variant="ghost" icon={X} disabled={saving} iconOnly onClick={onClose} />
                        </div>
                    </div>
                </PedidoModal.Header>

                <PedidoModal.Body className="px-4 py-4 scrollbar-hide">
                    {/* Un producto YA, sin contar la hoja entera. Va acá arriba y no
                        escondido adentro de una hoja, porque quien lo necesita no
                        sabe en cuál cayó — que es justo lo que esta búsqueda le
                        contesta. */}
                    <SueltoRapido
                        rows={sortedRows}
                        hojaDe={hojaDeItem}
                        sueltosOk={sueltosOk}
                        saving={saving}
                        onRecibir={handleRecibirSolo}
                        campos={campos}
                    />

                    <p className="text-caption font-bold text-content-2 uppercase tracking-wide mb-2 mt-4">Hojas del despacho</p>
                    <div className="flex flex-col gap-1.5">
                        {allHojaNums.map(hojaNum => {
                            const isContada  = hojaEstado[hojaNum] === 'contada';
                            const itemCount  = itemIdsByHoja[String(hojaNum)]?.size ?? 0;
                            const sinNada    = hojaEstado[hojaNum] === 'reenvio';  // todo su contenido está en reenvío
                            const isAlertada = hojasAlertadas.has(hojaNum);
                            const cajas      = cajasDeHoja[hojaNum] ?? [];
                            const cajaHint   = cajas.length === 0 ? null
                                : cajas.length === 1 ? `caja ${cajas[0]}`
                                : `cajas ${cajas[0]}–${cajas[cajas.length - 1]}`;

                            // SIN `aria-pressed` a propósito: no es un interruptor. Abre la
                            // pantalla de ítems de esa hoja (`setScreen`), o sea que es una
                            // ACCIÓN de navegación. El estado ya lo dicen `disabled` y el
                            // texto de la fila.
                            return (
                                <button key={hojaNum}
                                    disabled={isContada || sinNada}
                                    onClick={() => { setSelectedHoja(hojaNum); setScreen('items'); }}
                                    className={`flex items-center gap-2.5 p-2.5 rounded-2xl border-2 text-left transition-all ${
                                        isContada  ? 'bg-success/10 border-success/30 cursor-default' :
                                        sinNada    ? 'bg-surface-card-hover border-divider cursor-default opacity-50' :
                                        isAlertada ? 'bg-warning/10 border-warning/40 hover:border-warning active:scale-[0.99] cursor-pointer' :
                                                     'bg-surface-card border-divider hover:border-chart-3/40 hover:bg-chart-3/10 active:scale-[0.99] cursor-pointer'
                                    }`}>
                                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm shrink-0 ${
                                        isContada  ? 'bg-success' :
                                        sinNada    ? 'bg-content-3' :
                                        isAlertada ? 'bg-warning' :
                                                     'bg-chart-3 shadow-[var(--shadow-glow-chart-3)]'
                                    }`}>
                                        {isContada  ? <Check size={16} className="text-white" /> :
                                         sinNada    ? <Truck size={14} className="text-white" /> :
                                         isAlertada ? <AlertTriangle size={14} className="text-white" /> :
                                                      <FileText size={14} className="text-white" />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className={`text-body-sm font-black leading-tight truncate ${
                                            isContada ? 'text-success-text' : sinNada ? 'text-content-3' : 'text-content-2'
                                        }`}>
                                            <span className="text-chart-3-text">H{hojaNum}</span>
                                            {hojaLabel[hojaNum] ? ` · ${hojaLabel[hojaNum]}` : ''}
                                        </p>
                                        <p className={`text-micro font-medium mt-0.5 leading-none ${
                                            isContada ? 'text-success' : sinNada ? 'text-content-3' : isAlertada ? 'text-warning' : 'text-content-3'
                                        }`}>
                                            {isContada ? 'Contada'
                                                : sinNada ? 'En reenvío'
                                                : isAlertada ? `${itemCount} prod. · revisar una por una`
                                                : `${itemCount} prod.${cajaHint ? ` · ${cajaHint}` : ''}`}
                                        </p>
                                    </div>
                                    {!isContada && !sinNada && (
                                        <Badge variant={isAlertada ? 'warning' : 'chart-3'} size="sm" uppercase={false}>Contar</Badge>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {allAccessibleDone && (
                        <div className={`mt-4 flex items-start gap-2.5 px-3 py-3 rounded-2xl border ${faltaCajas.length > 0 || hasFaltaItems ? 'bg-warning/10 border-warning/30' : 'bg-success/10 border-success/30'}`}>
                            <PackageCheck size={15} className={`shrink-0 mt-0.5 ${faltaCajas.length > 0 || hasFaltaItems ? 'text-warning' : 'text-success'}`} />
                            <p className={`text-body-sm font-medium leading-snug ${faltaCajas.length > 0 || hasFaltaItems ? 'text-warning-text' : 'text-success-text'}`}>
                                {faltaCajas.length > 0
                                    ? `Contado lo que llegó. Caja${faltaCajas.length > 1 ? 's' : ''} ${faltaCajas.map(n => `#${n}`).join(', ')} pendiente${faltaCajas.length > 1 ? 's' : ''} de reenvío.`
                                    : hasFaltaItems
                                        ? 'Contado lo que llegó. Aún hay electrolit o cajas especiales pendientes de reenvío. Finaliza cuando lleguen.'
                                        : 'Todo contado'
                                }
                            </p>
                        </div>
                    )}

                    {faltaCajas.length > 0 && !allAccessibleDone && (
                        <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-card-hover border border-divider">
                            <Truck size={12} className="text-content-3 shrink-0" />
                            <p className="text-label text-content-3">
                                Caja{faltaCajas.length > 1 ? 's' : ''} {faltaCajas.map(n => `#${n}`).join(', ')} en reenvío — se recibirá por separado.
                            </p>
                        </div>
                    )}

                    {hojasAlertadas.size > 0 && !allAccessibleDone && (
                        <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-warning/10 border border-warning/30">
                            <AlertTriangle size={12} className="text-warning shrink-0 mt-0.5" />
                            <p className="text-label text-warning-text">
                                Hoja{hojasAlertadas.size > 1 ? 's' : ''} {[...hojasAlertadas].sort((a, b) => a - b).map(n => `H${n}`).join(', ')} venían en una caja
                                con problema — hay que revisarlas producto por producto, sin confirmarlas de una.
                            </p>
                        </div>
                    )}

                    {/* Cajas especiales */}
                    {especialItems.length > 0 && (
                        <div className="mt-4">
                            <p className="text-caption font-bold text-content-2 uppercase tracking-wide mb-2">Cajas especiales</p>
                            {/* Dos columnas hasta seis baldosas: el nombre del producto es
                                lo que se busca en el estante, y en tres columnas no le
                                queda ancho para leerse entero. */}
                            <div className={`grid gap-2 ${especialItems.length <= 6 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                                {especialItems.map(({ label, labels, item }) => {
                                    // La baldosa cubre varias cajas: alcanza con que UNA venga
                                    // dañada para que haya que mirarla.
                                    const isDamaged   = labels.some(l => especialesLlegadas[l] === 'danada');
                                    const isFaltante  = !!item.falta_caja;
                                    const isConfirmed = confirmedEspecialIds.has(item.id) || item.status === 'recibido';
                                    // Igual que las cajas: navega, no alterna.
                                    return (
                                        <button key={item.id}
                                            disabled={isConfirmed || isFaltante}
                                            onClick={() => { setSelectedEspecial({ label, item }); setScreen('items'); }}
                                            className={`flex flex-col items-center gap-2 p-3 rounded-2xl border-2 text-center transition-all ${
                                                isConfirmed ? 'bg-success/10 border-success/30 cursor-default' :
                                                isFaltante  ? 'bg-surface-card-hover border-divider cursor-default opacity-50' :
                                                isDamaged   ? 'bg-warning/10 border-warning/40 hover:border-warning active:scale-[0.97] cursor-pointer' :
                                                              'bg-chart-3/10 border-chart-3/30 hover:border-chart-3 active:scale-[0.97] cursor-pointer'
                                            }`}>
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
                                                isConfirmed ? 'bg-success' :
                                                isFaltante  ? 'bg-content-3' :
                                                isDamaged   ? 'bg-warning' :
                                                              'bg-chart-3'
                                            }`}>
                                                {isConfirmed ? <Check size={16} className="text-white" /> :
                                                 isFaltante  ? <Truck size={14} className="text-white" /> :
                                                 isDamaged   ? <AlertTriangle size={14} className="text-white" /> :
                                                               <Star size={14} className="text-white" />}
                                            </div>
                                            <div className="w-full min-w-0">
                                                <p className={`text-body-sm font-black leading-none ${
                                                    isConfirmed ? 'text-success-text' : isFaltante ? 'text-content-3' : 'text-content-2'
                                                }`}>{label}</p>
                                                {/* El nombre ENTERO, aunque ocupe dos o tres
                                                    renglones: cortado a 90px decía «ELECTROLIT
                                                    MANZ…» en las diez baldosas, o sea que no
                                                    distinguía la caja que hay que ir a buscar de
                                                    la de al lado. Las baldosas de una misma fila
                                                    igualan alto solas. */}
                                                <p className="text-micro text-content-3 mt-0.5 leading-tight break-words">
                                                    {item.products?.nombre ?? ''}
                                                </p>
                                                <p className={`inline-flex items-center gap-0.5 text-micro font-medium mt-0.5 ${
                                                    isConfirmed ? 'text-success' : isFaltante ? 'text-content-3' : isDamaged ? 'text-warning' : 'text-chart-3-text'
                                                }`}>
                                                    {isConfirmed ? <><Check size={9} aria-hidden="true" />Confirmado</>
                                                        : isFaltante ? 'En reenvío'
                                                        : isDamaged ? <><AlertTriangle size={9} aria-hidden="true" />Dañada</>
                                                        /* Cuántas cajas hay que buscar, además de cuántas unidades
                                                           trae: con un Electrolit ×12, «24 unid.» solo no dice si
                                                           son una caja o dos. */
                                                        : labels.length > 1
                                                            ? `${labels.length} cajas · ${enviadoDe(item)} unid.`
                                                            : `${enviadoDe(item)} unid.`}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* «Todo OK» va DESPUÉS de las especiales, no en medio: confirma
                        las dos cosas —hojas y cajas especiales— y estando arriba
                        parecía cubrir sólo lo que tenía encima. Se salta las hojas
                        que vinieron en una caja con problema: ésas se revisan
                        producto por producto. */}
                    {!allAccessibleDone && (accessibleHojaNums.length > 0 || accessibleEspeciales.length > 0) && (
                        <div className="mt-4">
                            {/* Pregunta antes: esto da por bueno TODO sin contar nada, y
                                además ingresa el pedido entero al sistema. Es la acción
                                más cara de la pantalla y estaba a un solo clic. */}
                            <Button tone="success" disabled={saving} onClick={() => setConfirmarTodoOpen(true)}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                Confirmar todo
                                {(faltaCajas.length > 0 || hojasAlertadas.size > 0) && (
                                    <span className="text-caption font-medium text-success">
                                        {hojasAlertadas.size > 0 ? '(omite las hojas por revisar)' : '(omite lo que está en reenvío)'}
                                    </span>
                                )}</Button>
                        </div>
                    )}
                </PedidoModal.Body>

                {/* Extras section on cajas screen */}
                <div className="flex-none border-t border-divider px-4 py-3">
                    <Button variant="ghost" icon={PackagePlus} onClick={() => { setPrevScreen('cajas'); setScreen('extras'); setTimeout(() => extraRef.current?.focus(), 80); }}>¿Llegó un producto extra?
                        {extras.length > 0 && <Badge variant="info" uppercase={false}>{extras.length}</Badge>}</Button>
                </div>

                {allAccessibleDone && (
                    <PedidoModal.Footer className="space-y-2">
                        {saveError && (
                            <div className="flex items-center gap-2 text-danger text-body-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                                <AlertTriangle size={13} /> {saveError}
                            </div>
                        )}
                        <div className="flex justify-end">
                            <Button tone="success" disabled={saving} onClick={handleFinalizar}>{saving ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                                Finalizar recepción</Button>
                        </div>
                    </PedidoModal.Footer>
                )}

                <ConfirmModal
                    isOpen={confirmarTodoOpen}
                    onClose={() => setConfirmarTodoOpen(false)}
                    onConfirm={() => { setConfirmarTodoOpen(false); handleConfirmarTodo(); }}
                    title="¿Dar por bueno todo el pedido?"
                    message={
                        'Se van a confirmar todas las hojas y cajas especiales tal como se enviaron, sin contarlas, '
                        + 'y el pedido completo entra al inventario de la sala automáticamente.'
                        + (hojasAlertadas.size > 0
                            ? ` Quedan fuera las hojas ${[...hojasAlertadas].sort((a, b) => a - b).map(n => `H${n}`).join(', ')}, que venían en una caja con problema y hay que revisar.`
                            : '')
                    }
                    confirmText="Sí, confirmar todo"
                    isDestructive={false}
                    isProcessing={saving}
                />
            </PedidoModal>
        );
    }

    // ════════════════════════════════════════════════════════════════
    // SCREEN: EXTRAS — dedicated screen for extra products
    // ════════════════════════════════════════════════════════════════
    const goBackFromExtras = () => setScreen(prevScreen ?? (hayHojas ? 'cajas' : 'items'));

    if (screen === 'extras') {
        return (
            <PedidoModal open={open} onClose={saving ? undefined : goBackFromExtras} maxWidth="max-w-2xl">
                <PedidoModal.Header className="px-5 py-4">
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="xs" icon={ChevronLeft} disabled={saving} iconOnly onClick={goBackFromExtras} />
                        <div className="flex-1 min-w-0">
                            <h3 className="text-subtitle font-bold text-content leading-snug">Productos extra</h3>
                            <p className="text-label text-content-3 mt-0.5">
                                {extras.length === 0
                                    ? 'Productos recibidos que no estaban en el pedido'
                                    : `${extras.length} producto${extras.length !== 1 ? 's' : ''} agregado${extras.length !== 1 ? 's' : ''}`}
                            </p>
                        </div>
                        <Button variant="ghost" icon={X} disabled={saving} iconOnly onClick={goBackFromExtras} />
                    </div>
                </PedidoModal.Header>

                {/* Item grid — mismo formato que pantalla de items */}
                <PedidoModal.Body className="px-0 py-0" style={{ overflow: 'hidden', flex: 'none' }}>
                    <div className="max-h-[48vh] overflow-y-auto scrollbar-hide">
                        {/* §15.1 · pegajoso = tiene que OCLUIR. El fondo sale de
                            `--thead-bg` vía `data-pegajoso`; era `bg-surface-card
                            backdrop-blur-sm`, con el que las filas se leían a
                            través del encabezado al desplazar. */}
                        <div data-pegajoso className="sticky top-0 z-base border-b-2 border-divider shadow-sm">
                            <div className={`grid ${EXTRAS_GRID} gap-x-2 px-5 pt-2.5 pb-1`}>
                                <span />
                                <span className="col-span-2 text-center text-caption font-bold text-chart-9-text uppercase tracking-widest border-b-2 border-chart-9 pb-1">Lo que llegó</span>
                                <span />
                            </div>
                            <div className={`grid ${EXTRAS_GRID} gap-x-2 items-center px-5 py-2`}>
                                <span className="text-caption font-bold text-content-2 uppercase tracking-wide">Producto</span>
                                <span className="text-caption font-bold text-chart-9-text uppercase text-center">Pres.</span>
                                <span className="text-caption font-bold text-chart-9-text uppercase text-center">Cant.</span>
                                <span />
                            </div>
                        </div>

                        {extras.length === 0 && (
                            <div className="py-12 text-center">
                                <PackagePlus size={28} className="text-brand-text/40 mx-auto mb-2" />
                                <p className="text-body font-semibold text-content-3">Sin productos extra</p>
                                <p className="text-label text-content-3 mt-1">Busca un producto abajo para agregarlo</p>
                            </div>
                        )}

                        <div className="divide-y divide-divider">
                            {extras.map((e, ei) => {
                                const eOpts     = presMap[e.erp_product_id] ?? [{ factor: 1, label: 'Unidad' }];
                                // Un extra no tiene envío contra el cual diferir:
                                // nadie lo despachó. Lo único inválido es que no
                                // diga cuántos llegaron.
                                const eSinCant  = e.fQty === 0;
                                return (
                                    <div key={e.erp_product_id} className={`transition-colors ${eSinCant ? 'bg-danger/10' : 'bg-surface-card hover:bg-surface-card-hover/50'}`}>
                                        <div className={`grid ${EXTRAS_GRID} gap-x-2 items-center px-5 py-2`}>
                                            <div className="min-w-0">
                                                <Badge variant="info" size="sm" icon={Plus}>Extra</Badge>
                                                <p className={`text-body-sm font-semibold leading-snug ${eSinCant ? 'text-danger' : 'text-content-2'}`}>{e.nombre}</p>
                                                {eSinCant && <p className="text-caption text-danger-text font-medium">¿Cuántos llegaron?</p>}
                                            </div>

                                            <div>
                                                <LiquidSelect
                                                    value={String(e.fPres)}
                                                    onChange={v => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, fPres: Number(v) } : x))}
                                                    options={eOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                                    compact
                                                    clearable={false}
                                                />
                                            </div>

                                            <PortalInput
                                                aria-label="Cantidad recibida" compact
                                                tono={eSinCant ? 'danger' : 'chart-9'}
                                                type="number" min={0} value={e.fQty}
                                                onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, fQty: Math.max(0, parseInt(ev.target.value) || 0) } : x))}
                                                inputClassName="text-center font-bold tabular-nums"
                                            />

                                            <Button variant="ghost" icon={Trash2} iconOnly onClick={() => setExtras(prev => prev.filter((_, j) => j !== ei))} />
                                        </div>
                                        {(eSinCant || e.nota) && (
                                            <div className="px-5 pb-2">
                                                <PortalInput
                                                    aria-label="Nota del renglón"
                                                    type="text"
                                                    value={e.nota}
                                                    onChange={ev => setExtras(prev => prev.map((x, j) => j === ei ? { ...x, nota: ev.target.value } : x))}
                                                    placeholder="Nota (opcional)…"
                                                    tono="brand"
                                                    compact
                                                    inputClassName="text-body-xl"
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div ref={extrasEndRef} />
                        </div>
                    </div>
                </PedidoModal.Body>

                {/* Buscador para agregar productos */}
                <div className="flex-none border-t border-divider px-5 py-3">
                    <div ref={extraBuscarRef}>
                        <SearchInput
                            ref={extraRef}
                            value={extraSearch}
                            loading={extraBusy}
                            onChange={val => {
                                setExtraSearch(val);
                                if (extraBuscarRef.current) {
                                    const r = extraBuscarRef.current.getBoundingClientRect();
                                    setExtraDropCoords({ top: r.top, left: r.left, width: r.width });
                                }
                            }}
                            placeholder="Buscar producto extra recibido…"
                        />
                    </div>
                    {extraResults.length > 0 && createPortal(
                        <div style={{
                            position: 'fixed',
                            bottom: window.innerHeight - extraDropCoords.top + 8,
                            left: extraDropCoords.left,
                            width: extraDropCoords.width,
                            zIndex: 99999,
                        }} className="rounded-xl border border-brand/30 bg-surface-card shadow-2xl overflow-hidden">
                            {extraResults.map(prod => (
                                <Button
                                    variant="primary"
                                    className="w-full"
                                    icon={Plus}
                                    key={prod.id}
                                    onMouseDown={() => addExtra(prod)}
                                >{prod.nombre}</Button>
                            ))}
                        </div>,
                        document.body
                    )}
                </div>

                <PedidoModal.Footer className="space-y-2">
                    {saveError && (
                        <div className="flex items-center gap-2 text-danger text-body-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                            <AlertTriangle size={13} /> {saveError}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                        <Button variant="secondary" disabled={saving} onClick={goBackFromExtras}>Volver</Button>
                        <Button icon={Check} onClick={goBackFromExtras}>{extras.length > 0 ? `Listo · ${extras.length} extra${extras.length !== 1 ? 's' : ''}` : 'Listo'}</Button>
                    </div>
                </PedidoModal.Footer>
            </PedidoModal>
        );
    }

    // ════════════════════════════════════════════════════════════════
    // SCREEN: ITEMS — product grid for selected box (or all items)
    // ════════════════════════════════════════════════════════════════
    const goBack = () => { setScreen('cajas'); setSelectedHoja(null); setSelectedEspecial(null); setProdSearch(''); setShowSearch(false); };
    // La hoja abierta viene de una caja con problema: se cuenta, pero de a uno.
    const hojaEnAlerta = alcance === 'hoja' && hojasAlertadas.has(selectedHoja);
    const isDanadaEspecial = selectedEspecial ? especialesLlegadas[selectedEspecial.label] === 'danada' : false;

    // ── Lo que dice el aviso antes de confirmar ─────────────────────────────────
    // Confirmar una hoja mete su contenido al inventario de la sala y deja la
    // hoja fuera de la lista: es tan definitivo como «Confirmar todo», que ya
    // preguntaba. Los dos botones del pie pasan por acá.
    const rotuloAbierto = alcance === 'especial' ? `la caja ${selectedEspecial.label}`
        : alcance === 'hoja'                     ? `la hoja ${selectedHoja}`
        :                                          'este pedido';
    const nPorContar     = filasPorContar.length;
    const nYaRecibidos   = filasAbiertas.length - nPorContar;
    const colaYaRecibido = nYaRecibidos > 0
        ? ` ${nYaRecibidos === 1 ? 'Un producto ya se recibió' : `${nYaRecibidos} productos ya se recibieron`} de a uno y no se vuelve${nYaRecibidos === 1 ? '' : 'n'} a contar.`
        : '';
    const avisoConfirmar = nPorContar === 0
        ? `No queda nada por contar en ${rotuloAbierto}: sus productos ya se recibieron de a uno y están en el inventario. Confirmar sólo la marca como contada.`
        : confirmarHoja === 'todook'
            ? `Se van a dar por buenos ${nPorContar} producto${nPorContar !== 1 ? 's' : ''} de ${rotuloAbierto} tal como se enviaron, sin contarlos, y entran al inventario de la sala automáticamente.${colaYaRecibido} Después ${rotuloAbierto} ya no se vuelve a contar.`
            : `Se van a dar por recibidos ${nPorContar} producto${nPorContar !== 1 ? 's' : ''} de ${rotuloAbierto} con las cantidades que están en pantalla, y entran al inventario de la sala automáticamente.${colaYaRecibido} Después ${rotuloAbierto} ya no se vuelve a contar.`;

    return (
        <PedidoModal open={open} onClose={saving ? undefined : ((hayHojas || selectedEspecial !== null) ? goBack : onClose)} maxWidth="max-w-2xl">

            {/* Header — COMPACTO (2026-08-17)
                Lo que se mira en esta pantalla es la lista de productos: el
                encabezado sólo tiene que decir qué hoja está abierta y cuánto
                queda. Con `py-4` y el título a 15px se comía casi 80px de alto
                para tres datos que entran en dos renglones cortos. */}
            <PedidoModal.Header className="px-4 py-2.5">
                <div {...prodSearchContainerRef} className="flex items-center gap-2">
                    {hayHojas && (
                        <Button variant="secondary" size="xs" icon={ChevronLeft} disabled={saving} iconOnly onClick={goBack} />
                    )}
                    <AnimatePresence mode="popLayout" initial={false}>
                        {!showSearch ? (
                            <motion.div key="title" className="flex-1 min-w-0"
                                initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.15 }}>
                                {selectedEspecial !== null ? (
                                    <>
                                        <h3 className="text-body-lg font-bold text-content leading-tight truncate">
                                            {selectedEspecial.label} — Caja especial
                                            {isDanadaEspecial && <span className="ml-2 inline-flex items-center gap-1 text-label font-semibold text-warning"><AlertTriangle size={12} aria-hidden="true" />Dañada</span>}
                                        </h3>
                                        <p className="text-micro text-content-3 leading-tight truncate">
                                            {selectedEspecial.item.products?.nombre ?? ''} · {sucursalNombre}
                                        </p>
                                    </>
                                ) : hayHojas ? (
                                    <>
                                        <h3 className="text-body-lg font-bold text-content leading-tight truncate">
                                            Hoja {selectedHoja}{hojaLabel[selectedHoja] ? ` — ${hojaLabel[selectedHoja]}` : ''}
                                            {hojaEnAlerta && <span className="ml-2 inline-flex items-center gap-1 text-label font-semibold text-warning"><AlertTriangle size={12} aria-hidden="true" />Revisar</span>}
                                        </h3>
                                        <p className="text-micro text-content-3 leading-tight">
                                            {/* Cuántos quedan por contar, no cuántos trae la
                                                hoja: los recibidos de a uno siguen en la
                                                lista y decir «5 productos» sobre 3 por contar
                                                manda a buscar dos que ya están adentro. */}
                                            {nPorContar} por contar
                                            {nYaRecibidos > 0 && ` · ${nYaRecibidos} ya recibido${nYaRecibidos !== 1 ? 's' : ''}`}
                                            {' · '}{sucursalNombre}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <h3 className="text-body-lg font-bold text-content leading-tight truncate">Confirmar recepción</h3>
                                        <p className="text-micro text-content-3 leading-tight truncate">
                                            {sucursalNombre}{pedido.codigo && ` · ${pedido.codigo}`} · {rows.length} productos
                                        </p>
                                    </>
                                )}
                                {(hojaEnAlerta || isDanadaEspecial) && (
                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-warning/10 border border-warning/30">
                                        <AlertTriangle size={11} className="text-warning shrink-0" />
                                        <span className="text-caption text-warning-text font-medium">
                                            {isDanadaEspecial
                                                ? 'Esta caja especial llegó dañada — revisa el estado físico al contar'
                                                : `Esta hoja venía en la caja ${(cajasDeHoja[selectedHoja] ?? []).map(n => `#${n}`).join(', ')} — revisa producto por producto`}
                                        </span>
                                    </div>
                                )}
                                {!hayHojas && cajaDanada.length > 0 && (
                                    <div className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-warning/10 border border-warning/30">
                                        <AlertTriangle size={11} className="text-warning shrink-0" />
                                        <span className="text-caption text-warning-text font-medium">
                                            Caja{cajaDanada.length > 1 ? 's' : ''} {cajaDanada.map(n => `#${n}`).join(', ')} llegó dañada — revisa el estado físico
                                        </span>
                                    </div>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div key="search" className="flex-1 min-w-0"
                                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
                                <SearchInput ref={searchRef} size="sm" value={prodSearch} onChange={setProdSearch} placeholder="Buscar producto…" />
                            </motion.div>
                        )}
                    </AnimatePresence>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <motion.button
                            onClick={() => setShowSearch(s => { if (!s) setTimeout(() => searchRef.current?.focus(), 80); else setProdSearch(''); return !s; })}
                            animate={showSearch ? { scale: 1.15 } : { scale: 1 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            className={`p-1.5 rounded-lg transition-colors ${showSearch ? 'bg-brand/10 text-brand-text' : 'text-content-3 hover:text-content-2'}`}
                            title="Buscar producto"
                        >
                            <Search size={15} />
                        </motion.button>
                        <Button variant="ghost" icon={X} disabled={!showSearch && saving} iconOnly onClick={showSearch ? () => { setShowSearch(false); setProdSearch(''); } : (hayHojas ? goBack : onClose)} />
                    </div>
                </div>
            </PedidoModal.Header>

            {/* Item grid */}
            <PedidoModal.Body className="px-0 py-0" style={{ overflow: 'hidden', flex: 'none' }}>
              {/* 54dvh y no 48vh: el encabezado compacto y la franja de
                  responsables que se fue dejaron ~140px libres, y van a la
                  lista, que es lo que se lee. `dvh` porque en el teléfono
                  descuenta el cromo del navegador — con el tope de 88dvh de la
                  tarjeta, el pie con «Confirmar» sigue entrando. */}
              <div className="max-h-[54dvh] overflow-y-auto">
                {/* §15.1 · pegajoso = tiene que OCLUIR — ver el encabezado gemelo
                    de la pestaña de extras, unas líneas más arriba. */}
                <div data-pegajoso className="sticky top-0 z-base border-b-2 border-divider shadow-sm">
                    <div className={`grid ${GRID} gap-x-2 px-5 pt-2.5 pb-1`}>
                        <span /><span />
                        <span className="col-span-2 text-center text-caption font-bold text-chart-9-text uppercase tracking-widest border-b-2 border-chart-9 pb-1">Lo que llegó</span>
                        <span />
                    </div>
                    <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                        <span className="text-caption font-bold text-content-2 uppercase tracking-wide">Producto</span>
                        <span className="text-caption font-bold text-content-2 uppercase text-center">Enviado</span>
                        <span className="text-caption font-bold text-chart-9-text uppercase text-center">Pres.</span>
                        <span className="text-caption font-bold text-chart-9-text uppercase text-center">Cant.</span>
                        <span />
                    </div>
                </div>

                {visibleRows.length === 0 && !extras.length && (
                    <p className="text-center text-body-sm text-content-3 py-6">No se encontraron productos.</p>
                )}

                <div className="divide-y divide-divider">
                    {visibleRows.map((r, rowIdx) => {
                        const erpFactor  = Number(r.factor) || 1;
                        const dispFactor = Number(r.dispatch_factor) || erpFactor;
                        const enviado    = enviadoDe(r);
                        const defDispQty = toDispatch(enviado, erpFactor, dispFactor);
                        const fQty  = fQtyVals[r.id]  ?? defDispQty;
                        const fPres = fPresVals[r.id] ?? dispFactor;
                        const tp = tieneProblema[r.id];
                        const hasProb   = !!tp;
                        const panelOpen = tp === true;
                        const fRaw = Math.round(fQty * fPres / erpFactor);
                        // Un renglón ya recibido no tiene diferencia que mostrar:
                        // su cantidad quedó guardada cuando se recibió, y lo que
                        // haya en estas casillas ya no se manda a ningún lado.
                        const recibidoSolo = yaRecibido(r);
                        const hasDiff = !recibidoSolo && fRaw !== enviado;
                        const delta   = fRaw - enviado;

                        const presOpts = opcionesDePresentacion(r, presMap);

                        const toggleProblema = () => {
                            setTieneProblema(p => {
                                const cur = p[r.id];
                                if (!cur) return { ...p, [r.id]: true };
                                if (cur === true) { setErrorVals(ev => ({ ...ev, [r.id]: '' })); return { ...p, [r.id]: false }; }
                                return { ...p, [r.id]: true };
                            });
                        };
                        const confirmProblema = () => setTieneProblema(p => ({ ...p, [r.id]: 'done' }));

                        return (
                            <div key={r.id} className={`transition-colors ${recibidoSolo ? 'bg-success/10' : hasDiff ? 'bg-warning/10' : hasProb ? 'bg-chart-4/10' : 'bg-surface-card hover:bg-surface-card-hover/50'}`}>
                                <div className={`grid ${GRID} gap-x-2 items-center px-5 py-2`}>
                                    <span className={`text-body-sm font-semibold leading-snug ${recibidoSolo ? 'text-content-3' : 'text-content-2'}`}>
                                        {r.products?.nombre}
                                        {!hayHojas && r.caja_especial && (
                                            <Badge variant="chart-3" size="sm" icon={Star} uppercase={false}>Especial</Badge>
                                        )}
                                        {/* El renglón ya está resuelto: se recibió de a
                                            uno y su producto entró al inventario. Se
                                            queda a la vista —sacarlo dejaría a quien
                                            cuenta buscando un producto que el papel sí
                                            tiene— pero no se cuenta ni se toca. */}
                                        {recibidoSolo && (
                                            <Badge variant="success" size="sm" icon={Check} uppercase={false}>Recibido</Badge>
                                        )}
                                    </span>
                                    <span className="text-body-sm font-bold text-content-3 tabular-nums text-center">{defDispQty}</span>

                                    <LiquidSelect
                                        value={String(fPres)}
                                        onChange={v => setFPresVals(p => ({ ...p, [r.id]: Number(v) }))}
                                        options={presOpts.map(o => ({ value: String(o.factor), label: o.label }))}
                                        compact
                                        clearable={false}
                                        disabled={recibidoSolo}
                                    />

                                    <div className="relative">
                                        <PortalInput
                                            aria-label="Cantidad facturada" compact
                                            readOnly={recibidoSolo}
                                            tono={recibidoSolo ? undefined : hasDiff ? 'warning' : 'chart-9'}
                                            type="number" min={0} value={fQty}
                                            onChange={e => setFQtyVals(p => ({ ...p, [r.id]: Math.max(0, parseInt(e.target.value) || 0) }))}
                                            data-qty-row={rowIdx} data-qty-col="fqty"
                                            onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = document.querySelector(`[data-qty-row="${rowIdx + (e.key === 'ArrowDown' ? 1 : -1)}"][data-qty-col="fqty"]`); n?.focus(); n?.select(); } }}
                                            inputClassName="text-center font-bold tabular-nums"
                                        />
                                        {hasDiff && (
                                            <Badge variant={delta < 0 ? 'danger' : 'success'} tone="solid" size="sm" uppercase={false}
                                                        className="absolute -top-1.5 -right-1.5">{delta > 0 ? '+' : ''}{delta}</Badge>
                                        )}
                                    </div>

                                    {/* Las dos acciones del renglón viven en UNA celda.
                                        Eran dos hijos sueltos de una rejilla que sólo
                                        tenía una columna para ellos, así que el de
                                        recibir suelto se iba a la línea de abajo y
                                        aparecía como un ícono verde huérfano debajo del
                                        nombre del producto. */}
                                    <div className="flex items-center justify-end gap-1">
                                        {/* Ya recibido = sin acciones. Reportarle un
                                            problema o volver a recibirlo no escribe
                                            nada —la base sólo toca lo `pendiente`—,
                                            así que un botón vivo ahí sería un control
                                            que promete lo que no hace. */}
                                        {recibidoSolo ? (
                                            <Check size={15} className="text-success" aria-hidden="true" />
                                        ) : (<>
                                            <Button
                                                icon={AlertTriangle}
                                                iconOnly
                                                size="sm"
                                                tone="chart-4"
                                                soft
                                                onClick={toggleProblema}
                                                title={panelOpen ? 'Cancelar problema' : hasProb ? 'Editar problema' : hasDiff ? 'Diferencia detectada' : 'Reportar problema'}
                                            />

                                            {/* Recibir SOLO este, para poder venderlo antes de
                                                contar el resto de la hoja. */}
                                            <Button
                                                icon={PackageCheck}
                                                iconOnly
                                                size="sm"
                                                tone="success"
                                                soft
                                                disabled={saving}
                                                onClick={() => handleRecibirSolo(r)}
                                                title={defDispQty > 1
                                                    ? `Recibir solo este producto e ingresarlo al inventario ahora — entra completo con la cantidad que esté escrita (${defDispQty} enviadas), y después no se vuelve a contar`
                                                    : 'Recibir solo este producto e ingresarlo al inventario ahora'}
                                            />
                                        </>)}
                                    </div>
                                </div>

                                {panelOpen && !recibidoSolo && (
                                    <div className="px-5 pb-2.5">
                                        <PanelProblema id={r.id} fQty={fQty} campos={campos} onListo={confirmProblema} />
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    <div ref={extrasEndRef} />
                </div>
              </div>
            </PedidoModal.Body>

            {/* Extras — navigate to dedicated screen */}
            <div className="flex-none border-t border-divider px-5 py-3">
                <Button variant="ghost" icon={PackagePlus} onClick={() => { setPrevScreen(screen); setScreen('extras'); setTimeout(() => extraRef.current?.focus(), 80); }}>¿Llegó un producto extra?
                    {extras.length > 0 && <Badge variant="info" uppercase={false}>{extras.length}</Badge>}</Button>
            </div>

            {/* Sin franja de «Responsables» (2026-08-17). Quien cuenta ya sabe
                quién está contando, y la tarjeta del pedido sigue mostrando el
                apoyo de recepción: acá sólo comía dos renglones de alto en la
                única pantalla donde el alto es la lista de productos. */}

            <PedidoModal.Footer className="space-y-2">
                {saveError && (
                    <div className="flex items-center gap-2 text-danger text-body-sm bg-danger/10 border border-danger/30 rounded-lg px-3 py-2">
                        <AlertTriangle size={13} /> {saveError}
                    </div>
                )}
                <div className="flex justify-between gap-2">
                    <Button variant="secondary" disabled={saving} onClick={hayHojas ? goBack : onClose}>{hayHojas ? 'Volver' : 'Cancelar'}</Button>
                    <div className="flex items-center gap-2">
                        {/* Sin «Todo OK» en una hoja que venía en una caja dañada o
                            que no llegó: es justo la que hay que mirar de a uno. */}
                        {!hojaEnAlerta && (
                            <Button tone="success" icon={Check} disabled={saving} title="Confirma recibido exactamente como se envió, sin revisar línea por línea" onClick={() => setConfirmarHoja('todook')}>Todo OK</Button>
                        )}
                        <Button tone="success" disabled={saving} onClick={() => setConfirmarHoja('contado')}>{saving ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
                            {alcance === 'especial' ? `Confirmar ${selectedEspecial.label}`
                                : alcance === 'hoja'  ? `Confirmar Hoja ${selectedHoja}`
                                :                       'Confirmar recepción'}</Button>
                    </div>
                </div>
            </PedidoModal.Footer>

            <ConfirmModal
                isOpen={confirmarHoja !== null}
                onClose={() => setConfirmarHoja(null)}
                onConfirm={() => {
                    const modo = confirmarHoja;
                    setConfirmarHoja(null);
                    if (modo === 'todook') handleTodoOk(); else handleConfirmarCaja();
                }}
                title={confirmarHoja === 'todook'
                    ? `¿Dar por bueno todo lo de ${rotuloAbierto}?`
                    : `¿Confirmar ${rotuloAbierto}?`}
                message={avisoConfirmar}
                confirmText={confirmarHoja === 'todook' ? 'Sí, dar por bueno' : 'Sí, confirmar'}
                isDestructive={false}
                isProcessing={saving}
            />
        </PedidoModal>
    );
}
