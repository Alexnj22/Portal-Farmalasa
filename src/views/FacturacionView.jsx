import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
import { useSearchParams } from 'react-router-dom';
import {
    FileText, AlertTriangle, Clock, CreditCard, Building2,
    Loader2, Search, X, Check, History,
    ChevronDown, ChevronUp, CheckCircle2, Paperclip, ExternalLink, Copy, Info,
    Pause, Play, ShieldCheck
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import { EmptyState, SkeletonText } from '../components/common/StateViews';
import { tokenMatch, smartFilter } from '../utils/searchUtils';
import LiquidSelect from '../components/common/LiquidSelect';
import FilterBar from '../components/common/FilterBar';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import ListRow from '../components/common/ListRow';
import { DataTable, DataRow, DataCell, useExpandStyle } from '../components/common/DataTable';
import TablePagination from '../components/common/TablePagination';
import { openStoredFile } from '../utils/storageFiles';
import { signPhotosDeep } from '../utils/storageFiles';
import FileField from '../components/common/FileField';
import PortalTextarea from '../components/common/PortalTextarea';
import { formatMoney } from '../utils/formatNumber';
import {
    regularizarDte,
    fetchNulaInvoices, fetchPendingMhInvoices, fetchConfirmedMhInvoices,
    fetchInvoicesByIds, fetchInvoiceResolutionIds, fetchInvoiceResolutionsHistorial, insertInvoiceResolution,
    fetchInvoiceNullIds, fetchSalesInvoiceNulls, insertNullResolution, fetchNullResolutionIds,
    fetchSalesInvoiceGaps, fetchGapResolutions, insertGapResolution,
    fetchNonCashInvoices, fetchPaymentConfirmationIds, fetchPaymentConfirmationsHistorial, insertPaymentConfirmation,
    fetchInvoiceObservations, fetchObservationResolutions, insertObservationResolution,
} from '../data/facturacion';
import { useToastStore } from '../store/toastStore';

// Los cuatro "Solventar" fallaban en silencio: las tablas de resoluciones tenían
// RLS sin policy de INSERT, así que Postgres rechazaba la escritura y la vista no
// avisaba (dos de los cuatro handlers ni desestructuraban `error`, y auditaban
// igual — `audit_logs` quedó con acciones que nunca ocurrieron). La policy ya
// existe; esto es la otra mitad: que un fallo se VEA.
import { mensajeAmigable } from '../utils/errorMessages';
function avisarFalloAlSolventar(error, contexto) {
    console.error(`${contexto}: insert resolution failed:`, error.message);
    useToastStore.getState().showToast(
        'No se pudo solventar',
        'No quedó registrado. Si el problema sigue, es que tu rol no tiene permiso de edición en Facturación.',
        'error',
    );
}

const SALES_BRANCH_IDS = [4, 25, 27, 28, 29, 2];
const fmt = (n) => formatMoney(n || 0);

// `facturacion_ver_montos` (canon 2026-08-03). El módulo sirve para perseguir
// anulaciones, saltos de correlativo y documentos pendientes de Hacienda, y todo
// eso se trabaja sin ver el importe. Un componente y no un `fmt` local porque
// los montos viven en cinco componentes distintos de este archivo: así el gate
// se declara UNA vez y no hay forma de que a uno se le olvide.
const Monto = ({ v }) => {
    const { hasPermission } = useAuth();
    return hasPermission('facturacion_ver_montos') ? fmt(v) : '—';
};
const NON_CASH_TYPES = ['tarjeta', 'credito', 'transferencia', 'bitcoin', 'cheque'];
const IMMEDIATE_TIPOS = ['tarjeta', 'transferencia', 'cheque', 'bitcoin'];
const CREDIT_TIPOS    = ['credito'];

// Categórico puro (T7, paleta cerrada cat-1..9) — 5 métodos de pago sin
// severidad, solo necesitan distinguirse entre sí en la tabla.
// ── ChipDoc (2026-07-28, D3.3) ───────────────────────────────────────────
// Este control estaba escrito TRES VECES en este archivo: las facturas
// pendientes, los saltos de correlativo y las anuladas con campos nulos. Las
// tres copias tenían la misma anatomía —copiar el id │ etiqueta del medio │
// resolver— y la misma cascada de ternarios de color, cada una con un estado
// de más o de menos. Siete de los nueve `<button>` a mano del archivo eran
// esto.
//
// No pasa por `Button` a propósito: son tres segmentos PEGADOS dentro de un
// borde común (`items-stretch` + `border-r`), y el canónico les daría a cada
// uno su propio radio y su propia sombra, rompiendo la unión. Lo que sí se
// arregla es que exista una sola definición.
//
// El color deja de ser una cascada de ternarios y pasa a ser una tabla. Es el
// mismo cambio que se le hizo a `SUC_COLORS` en TabSinVenta: si el estado tiene
// nombre, el color se busca; si no, se vuelve a escribir en cada copia.
const CHIP_TONO = {
    visitado: { copia: 'bg-warning/10 text-warning-text border-warning/30',
                medio: 'bg-warning/10', medioTxt: 'text-warning-text',
                borde: 'border-warning/40' },
    nulos:    { copia: 'bg-chart-3/10 text-chart-3-text border-chart-3/30 hover:bg-chart-3/20',
                medio: 'bg-chart-3/10', medioTxt: 'text-chart-3-text',
                borde: 'border-chart-3/40 hover:border-chart-3/60' },
    salto:    { copia: 'bg-chart-4/10 text-chart-4-text border-chart-4/30',
                medio: 'bg-surface-card', medioTxt: 'text-content-3',
                borde: 'border-chart-4/30 hover:border-chart-4/40' },
    ccf:      { copia: 'bg-danger/10 text-danger-text border-danger/30 hover:bg-danger/10',
                medio: 'bg-danger/10', medioTxt: 'text-danger-text',
                borde: 'border-danger/30 hover:border-danger/40' },
    normal:   { copia: 'bg-surface-card-hover text-content-2 border-divider hover:bg-surface-card-hover',
                medio: 'bg-surface-card', medioTxt: 'text-content-3',
                borde: 'border-divider hover:border-divider' },
};

const ChipDoc = memo(({
    estado = 'normal',      // visitado · nulos · ccf · normal
    copiado = false,
    resuelto = false,
    onCopiar,
    onResolver,
    etiquetaCopia,
    nombreResolver,         // qué dice el lector de pantalla en el botón de resolver
    children,               // el segmento del medio
}) => {
    const t = CHIP_TONO[estado] || CHIP_TONO.normal;
    return (
        // `min-h-[var(--tap-min)]`: los dos botones de este chip medían 29px de
        // alto, y en un teléfono el piso es 44 (medido en iPhone 13 el
        // 2026-07-29: 22 targets en esta vista, los únicos de la pasada que
        // eran deuda real y no un duplicado decorativo). `items-stretch` hace
        // que los segmentos hereden la altura del riel, así que se corrige acá
        // una vez en vez de en los tres. En escritorio `--tap-min` es 0: no
        // cambia nada.
        <div className={`inline-flex items-stretch min-h-[var(--tap-min)] rounded-xl border overflow-hidden transition-all duration-[var(--dur-fast)] shadow-sm ${
            resuelto ? 'border-success shadow-emerald-100' : t.borde}`}>
            {/* Sin `onCopiar` el primer segmento NO es un botón. El de los
                saltos de correlativo muestra un rango que no se copia, y
                tenerlo como `<button>` le habría dado foco y voz de control
                a un dato de solo lectura. */}
            {onCopiar ? (
                <button
                    aria-label={copiado ? 'Copiado' : `Copiar ${etiquetaCopia}`}
                    onClick={onCopiar}
                    className={`flex items-center gap-1 px-2 py-1.5 min-h-[var(--tap-min)] font-mono text-caption font-black border-r transition-all active:scale-[0.97] ${
                        copiado ? 'bg-success/10 text-success-text border-success/30' : t.copia}`}>
                    {copiado || estado === 'visitado' ? <Check size={8} /> : <Copy size={8} />}
                    {etiquetaCopia}
                </button>
            ) : (
                <div className={`flex items-center px-2 py-1.5 border-r font-mono text-caption font-black ${t.copia}`}>
                    {etiquetaCopia}
                </div>
            )}
            <div className={`flex items-center gap-1 px-2 py-1.5 border-r border-divider ${t.medio} ${t.medioTxt}`}>
                {children}
            </div>
            {/* Sin `onResolver` no se dibuja el segmento: quien no tiene
                `can_edit` en Facturación no puede solventar (lo frena el RLS de
                las tablas de resoluciones), así que tampoco se le ofrece el
                botón. Mismo criterio que el primer segmento con `onCopiar`. */}
            {onResolver && (
                <button
                    aria-pressed={resuelto}
                    aria-label={resuelto ? `Cancelar la resolución de ${nombreResolver}` : `Marcar ${nombreResolver} como resuelta`}
                    onClick={onResolver}
                    className={`flex items-center justify-center px-2 py-1.5 min-h-[var(--tap-min)] min-w-[var(--tap-min)] transition-all ${
                        resuelto ? 'bg-danger/10 text-danger hover:bg-danger/10'
                                 : 'bg-success/10 text-success hover:bg-success-solid hover:text-white'}`}>
                    {resuelto ? <X size={10} /> : <Check size={10} />}
                </button>
            )}
        </div>
    );
});

// Era la paleta SOFT de `Badge` escrita a mano, una fila por forma de pago.
// Ahora guarda el NOMBRE de la variante y el color lo pone el canónico.
// El color por tipo de documento. Mismo criterio que en VentasView, pero cada
// vista tiene el suyo: son dos archivos sin nada compartido entre ellos.
const VARIANTE_DOC = { CCF: 'danger', FCF: 'chart-1' };

const TIPO_PAGO_VARIANTE = {
    tarjeta: 'chart-1', credito: 'chart-3', transferencia: 'chart-9',
    bitcoin: 'chart-4', cheque:  'chart-9',
};


const TIPO_PAGO_LABELS = {
    tarjeta:       'Tarjeta',
    credito:       'Crédito',
    transferencia: 'Transferencia',
    cheque:        'Cheque',
    bitcoin:       'Bitcoin',
};

const TIPO_PAGO_THEME = {
 tarjeta:       { ico: 'bg-chart-1/10 text-chart-1-text', texto: 'text-chart-1-text' },
 credito:       { ico: 'bg-chart-3/10 text-chart-3-text', texto: 'text-chart-3-text' },
 transferencia: { ico: 'bg-chart-9/10 text-chart-9-text', texto: 'text-chart-9-text' },
 cheque:        { ico: 'bg-chart-9/10 text-chart-9-text', texto: 'text-chart-9-text' },
 bitcoin:       { ico: 'bg-chart-4/10 text-chart-4-text', texto: 'text-chart-4-text' },
};

// SV time
function svNow() { return new Date(Date.now() - 6 * 3600_000); }

// Días cumplidos desde una fecha `YYYY-MM-DD`, contra medianoche de hoy en SV.
// Va a nivel de módulo porque lo usan dos pestañas y además entra en un
// `useMemo`: como función local se recrearía en cada render.
function diasDesde(fechaStr) {
    const today = svNow();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((todayMidnight - new Date(`${fechaStr}T00:00:00`)) / 86400000);
}

function monthOptions() {
    const opts = [];
    const now = svNow();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear(); const m = d.getMonth() + 1;
        const pad = n => String(n).padStart(2, '0');
        const last = new Date(y, m, 0).getDate();
        const label = d.toLocaleDateString('es-SV', { month: 'long', year: 'numeric' });
        opts.push({ value: `${y}-${pad(m)}-01|${y}-${pad(m)}-${pad(last)}`, label: label.charAt(0).toUpperCase() + label.slice(1) });
    }
    return opts;
}

// ─── La marca "ya me llevé este id al ERP" ────────────────────────────────────
//
// Se apaga la fila y se tacha el chip: es lo que permite recorrer una lista de
// 157 documentos sin perder el hilo de cuáles ya se fueron a buscar al sistema.
//
// La clave de localStorage es UNA para todas las pestañas, a propósito: la marca
// es del DOCUMENTO, no de la lista donde se lo encontró. Era el mismo bloque
// copiado en Anuladas y en Pendiente MH; Observaciones habría sido la tercera
// copia (pedido del usuario, 2026-07-31).
const VISITED_KEY = 'facturacion_visited';

function useVisitados() {
    const [visitedIds, setVisitedIds] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem(VISITED_KEY) || '[]')); }
        catch { return new Set(); }
    });

    const toggleVisited = useCallback((erpId) => {
        if (!erpId) return;
        setVisitedIds(prev => {
            const next = new Set(prev);
            const key = String(erpId);
            if (next.has(key)) next.delete(key); else next.add(key);
            try { localStorage.setItem(VISITED_KEY, JSON.stringify([...next])); } catch { /* localStorage no disponible (privado/cuota) */ }
            return next;
        });
    }, []);

    const clearVisited = useCallback(() => {
        setVisitedIds(new Set());
        try { localStorage.removeItem(VISITED_KEY); } catch { /* localStorage no disponible (privado/cuota) */ }
    }, []);

    return { visitedIds, toggleVisited, clearVisited };
}

// ─── Sort hook ────────────────────────────────────────────────────────────────
function useSortable(defaultKey, defaultDir = 'asc') {
    const [sortKey, setSortKey] = useState(defaultKey);
    const [sortDir, setSortDir] = useState(defaultDir);
    const toggle = useCallback((key) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('asc'); }
    }, [sortKey]);
    const sortFn = useCallback((arr, accessors) => {
        const fn = accessors[sortKey];
        if (!fn) return arr;
        return [...arr].sort((a, b) => {
            const av = fn(a), bv = fn(b);
            if (av == null && bv == null) return 0;
            if (av == null) return 1; if (bv == null) return -1;
            const cmp = typeof av === 'string' ? av.localeCompare(bv, 'es') : av - bv;
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [sortKey, sortDir]);
    return { sortKey, sortDir, toggle, sortFn };
}



// Acá vivía un `Pagination` escrito a mano. No era solo divergencia estética:
// pintaba TODOS los números con `variant="primary"` sin compararlos nunca contra
// `page`, así que la página actual no se distinguía —verificado en vivo: los
// cinco botones con la misma clase y ninguno con `aria-current`—. El canónico
// `TablePagination` además dice el rango ("1–25 de 816") en vez de números
// sueltos, ofrece tamaño de página, es un `<nav>` con `aria-live`, baja de 7
// paradas de tabulación a 3 y deja la paginación a la vista al cambiar de página.

// ─── Fila expandida: confirmar un pago ────────────────────────────────────────
// Va en su propio componente porque `useExpandStyle` lee el contexto de
// `DataTable`: es el hook que el canónico exporta justo para las filas
// expandidas de `<tr>` crudo, y hasta ahora no lo usaba nadie. Antes el tinte
// salía de `TIPO_PAGO_THEME.expand`, o sea fuera del sistema de tokens.
function FilaConfirmar({ colSpan, notas, setNotas, archivo, setArchivo, guardando, onConfirmar, onCancelar, textoNotas, textoArchivo }) {
    const tk = useExpandStyle();
    return (
        <tr>
            <td colSpan={colSpan} className={`px-5 py-4 border-t ${tk.expandBg} ${tk.expandBorderColor}`}>
                <div className="flex items-start gap-3 max-w-3xl">
                    <div className="flex-1 space-y-2">
                        <PortalTextarea rows={2} autoFocus placeholder={textoNotas}
                            value={notas} onChange={e => setNotas(e.target.value)} />
                        <FileField accept="image/*,application/pdf" density="sm"
                            file={archivo} onChange={setArchivo} hint={textoArchivo} />
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                        <Button tone="success" disabled={guardando} onClick={onConfirmar}>
                            {guardando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmar
                        </Button>
                        <Button variant="secondary" icon={X} onClick={onCancelar}>Cancelar</Button>
                    </div>
                </div>
            </td>
        </tr>
    );
}

// ─── Bloque de una forma de pago ──────────────────────────────────────────────
// Estaba escrito DOS veces —pagos inmediatos y ventas a crédito— con la única
// diferencia de los textos del formulario. Un solo componente: cualquier arreglo
// se hace una vez, que es la razón por la que las dos copias habían divergido.
function BloqueFormaPago({
    tipo, filas, total, pagina, tamano, onPagina, onTamano,
    sortKey, sortDir, onSort, canEdit, nombreSucursal,
    confirmandoId, setConfirmandoId, notas, setNotas, archivo, setArchivo,
    guardando, onConfirmar, textoNotas, textoArchivo,
}) {
    const t = TIPO_PAGO_THEME[tipo] || TIPO_PAGO_THEME.tarjeta;
    const totalPaginas = Math.max(1, Math.ceil(filas.length / tamano));
    const visibles = filas.slice((pagina - 1) * tamano, pagina * tamano);
    return (
        <div data-surface="card" className="rounded-2xl border border-border-card overflow-hidden shadow-[var(--shadow-glass-sm)]">
            {/* Cabecera sobria: el color vive en el ícono y en el monto, no en un
                relleno. Antes era `bg-gradient-to-r` saturado con el rótulo en
                blanco y el "Total pendiente" en `text-white/60`. */}
            <div className="px-5 py-3.5 border-b border-divider bg-surface-card-hover/50 flex items-center gap-3 flex-wrap">
                <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${t.ico}`}>
                    <CreditCard size={15} strokeWidth={2.5} />
                </span>
                <h3 className={`text-label font-black uppercase tracking-widest ${t.texto}`}>
                    {TIPO_PAGO_LABELS[tipo] || tipo}
                </h3>
                <Badge uppercase={false}>{filas.length} transacci{filas.length !== 1 ? 'ones' : 'ón'}</Badge>
                <div className="ml-auto text-right">
                    <div className="text-micro font-bold uppercase tracking-widest text-content-3">Total pendiente</div>
                    <div className={`text-title-sm font-black leading-none mt-0.5 ${t.texto}`}>{<Monto v={total} />}</div>
                </div>
            </div>
            <DataTable
                columns={[
                    { key: 'correlativo', label: 'Correlativo', sortable: true },
                    { key: 'sucursal',    label: 'Sucursal',    sortable: true, hideBelow: 'md' },
                    { key: 'cliente',     label: 'Cliente',     sortable: true, hideBelow: 'lg' },
                    { key: 'fecha',       label: 'Fecha',       sortable: true },
                    { key: 'total',       label: 'Total',       sortable: true },
                    { key: 'accion',      label: '',            align: 'right' },
                ]}
                sortKey={sortKey} sortDir={sortDir} onSort={onSort}
                empty={{ message: 'Sin transacciones' }}
                minWidth="560px"
                footer={
                    <div className="px-5 py-3 flex justify-end">
                        <TablePagination
                            page={pagina} totalPages={totalPaginas} onPageChange={onPagina}
                            pageSize={tamano} onPageSizeChange={onTamano}
                            total={filas.length} unit="transacciones"
                        />
                    </div>
                }
            >
                {visibles.map((r, ri) => {
                    const confirmando = confirmandoId === r.id;
                    return (
                        <React.Fragment key={r.id}>
                            <DataRow index={ri}>
                                <DataCell>
                                    <Badge size="sm">{r.tipo_documento}</Badge>
                                    <div className="font-mono text-body-sm text-content-2 mt-1">{r.correlativo}</div>
                                </DataCell>
                                <DataCell hideBelow="md">{nombreSucursal(r.branch_id)}</DataCell>
                                <DataCell hideBelow="lg" className="max-w-[160px] truncate">{r.cliente || '—'}</DataCell>
                                <DataCell className="whitespace-nowrap">{r.fecha}</DataCell>
                                <DataCell className="text-body-lg font-bold whitespace-nowrap">{<Monto v={r.total} />}</DataCell>
                                <DataCell align="right">
                                    {canEdit && (
                                        <Button variant="ghost" icon={Check}
                                            onClick={() => { setConfirmandoId(confirmando ? null : r.id); setNotas(''); setArchivo(null); }}>
                                            Confirmar
                                        </Button>
                                    )}
                                </DataCell>
                            </DataRow>
                            {confirmando && (
                                <FilaConfirmar
                                    colSpan={6} notas={notas} setNotas={setNotas}
                                    archivo={archivo} setArchivo={setArchivo}
                                    guardando={guardando}
                                    onConfirmar={() => onConfirmar(r.id)}
                                    onCancelar={() => setConfirmandoId(null)}
                                    textoNotas={textoNotas} textoArchivo={textoArchivo}
                                />
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>
        </div>
    );
}

// ─── Tab: Anuladas ────────────────────────────────────────────────────────────
/**
 * Termina el trámite pendiente ante Hacienda de lo que se está mirando.
 *
 * El alcance sale del filtro de sucursal que ya está puesto: si hay una
 * elegida, corrige esa; si no, todas. No se inventa un selector aparte — la
 * píldora de arriba ya dice sobre qué se está trabajando, y tener dos formas de
 * decir lo mismo es como se llega a que no coincidan.
 *
 * Lo mismo que corre solo cada noche a las 22:30; esto es para no esperar.
 */
function BotonRegularizar({ filterBranch, branches, bolsa, canEdit, onDone, pendientes }) {
    const [corriendo, setCorriendo] = useState(false);
    if (!canEdit || !pendientes) return null;

    const sucursal = branches.find(b => String(b.id) === String(filterBranch));
    const ambito   = filterBranch ? (sucursal?.name || 'esta sucursal') : 'todas las sucursales';

    const correr = async () => {
        setCorriendo(true);
        const r = await regularizarDte({
            alcance:  filterBranch ? 'sucursal' : 'todas',
            branchId: filterBranch || null,
            bolsa,
        });
        setCorriendo(false);

        if (!r.ok) {
            useToastStore.getState().showToast('No se pudo completar', mensajeAmigable(r.error), 'error');
            return;
        }
        // Se dice lo que pasó, no "listo": una corrida que resolvió 3 de 8 no es
        // un éxito, y una que resolvió 0 porque no había nada tampoco es un fallo.
        const partes = [`${r.resueltas} de ${r.revisadas}`];
        if (r.con_observaciones) partes.push(`${r.con_observaciones} con observaciones de Hacienda`);
        if (r.fallidas)         partes.push(`${r.fallidas} sin resolver`);
        // Si quedó cola hay que decirlo. Callarla es lo que hace que un tope se
        // lea como "ya está todo".
        if (r.restantes > 0)    partes.push(`quedan ${r.restantes} para la próxima tanda`);
        useToastStore.getState().showToast(
            r.revisadas === 0 ? 'No había nada pendiente'
              : r.restantes > 0 ? 'Tanda enviada a Hacienda'
              : 'Trámite enviado a Hacienda',
            partes.join(' · '),
            (r.fallidas || r.restantes > 0) ? 'warning' : 'success',
        );
        onDone?.();
    };

    return (
        <Button
            variant="secondary" size="sm" icon={ShieldCheck}
            loading={corriendo} onClick={correr}
            title={`Completar ante Hacienda lo pendiente de ${ambito}`}
        >
            {corriendo ? 'Enviando…' : 'Completar ante Hacienda'}
        </Button>
    );
}

function TabAnuladas({ branches, filterBranch, searchTerm, currentUser, canEdit, paused, barraFiltros }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        for (const e of employees) if (e.name) m[e.name] = e.photo || e.photo_url || null;
        return m;
    }, [employees]);

    const [rows, setRows] = useState([]);
    const [resolved, setResolved] = useState([]);
    const [resolvedIds, setResolvedIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [solvingId, setSolvingId] = useState(null);
    const [comment, setComment] = useState('');
    const [saving, setSaving] = useState(false);
    const pollingRef = useRef(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [showAllResolved, setShowAllResolved] = useState(false);
    const resolvedSectionRef = useRef(null);
    const [collapsedBranches, setCollapsedBranches] = useState({});
    const [copiedId, setCopiedId] = useState(null);
    const { visitedIds, toggleVisited, clearVisited } = useVisitados();

    const loadData = useCallback(async () => {
        if (pollingRef.current) return;
        pollingRef.current = true;
        setLoading(true);
        // fetchNulaInvoices pagina con fetchAllRows — el backlog de facturas con
        // estado nulo/NULA puede superar el cap de 1000 filas de PostgREST.
        const [invoicesData, resolutionsRes, historialRes] = await Promise.all([
            fetchNulaInvoices(filterBranch),
            fetchInvoiceResolutionIds(),
            fetchInvoiceResolutionsHistorial('id, invoice_id, comment, resolved_by, resolved_at'),
        ]);

        const resolvedIdSet = new Set((resolutionsRes.data || []).map(r => r.invoice_id));
        const allIds = (historialRes.data || []).map(r => r.invoice_id);
        let invMap = {};
        if (allIds.length > 0) {
            const { data: d, error: dErr } = await fetchInvoicesByIds(allIds, 'id, correlativo, erp_invoice_id, branch_id, tipo_documento, cliente, fecha, total');
            if (dErr) console.error('loadData: fetch resolved invoices failed:', dErr.message);
            for (const inv of (d || [])) invMap[inv.id] = inv;
        }

        setRows(invoicesData || []);
        setResolvedIds(resolvedIdSet);
        setResolved((historialRes.data || []).map(r => ({ ...r, invoice: invMap[r.invoice_id] || null })));
        setLoading(false);
        pollingRef.current = false;
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { if (paused) return; const id = setInterval(loadData, 60_000); return () => clearInterval(id); }, [loadData, paused]);

    const handleSolve = async (invoiceId) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const { data, error } = await insertInvoiceResolution({
            invoice_id: invoiceId, comment: comment.trim() || null, resolved_by: resolvedBy,
        }, 'id, invoice_id, comment, resolved_by, resolved_at');
        if (error) { avisarFalloAlSolventar(error, 'handleSolve'); setSaving(false); return; }
        setResolvedIds(prev => new Set([...prev, invoiceId]));
        const newRec = data?.[0];
        if (newRec) {
            const inv = rows.find(r => r.id === invoiceId);
            setResolved(prev => [{ ...newRec, invoice: inv || null }, ...prev]);
        }
        const correlativo = rows.find(r => r.id === invoiceId)?.correlativo;
        useStaff.getState().appendAuditLog('SOLVENTAR_ANULACION', String(invoiceId), {
            correlativo,
            comment: comment.trim() || null,
        });
        useToastStore.getState().showToast('Anulación solventada', correlativo || '', 'success');
        setSolvingId(null); setComment(''); setSaving(false);
    };

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const now         = svNow();
    const todayStr    = now.toISOString().slice(0, 10);
    const currentMonthStr = now.toISOString().slice(0, 7); // YYYY-MM

    const resolvedMatchesTerm = useCallback((r, s) =>
        tokenMatch(s, String(r.invoice?.erp_invoice_id || ''), r.invoice?.correlativo, r.invoice?.cliente),
    []);

    const resolvedThisMonth = useMemo(() =>
        resolved.filter(r => (r.resolved_at || '').startsWith(currentMonthStr)),
        [resolved, currentMonthStr]
    );
    const resolvedDisplay = useMemo(() => {
        const base = showAllResolved ? resolved : resolvedThisMonth;
        if (!searchTerm) return base;
        return base.filter(r => resolvedMatchesTerm(r, searchTerm));
    }, [resolved, resolvedThisMonth, showAllResolved, searchTerm, resolvedMatchesTerm]);

    useEffect(() => {
        if (!searchTerm) return;
        const matchesAny = resolved.some(r => resolvedMatchesTerm(r, searchTerm));
        if (!matchesAny) return;
        setShowHistorial(true); // eslint-disable-line react-hooks/set-state-in-effect -- auto-expande la sección donde cae un resultado de búsqueda
        const inMonth = resolvedThisMonth.some(r => resolvedMatchesTerm(r, searchTerm));
        if (!inMonth) setShowAllResolved(true);
        setTimeout(() => resolvedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }, [searchTerm, resolved, resolvedMatchesTerm, resolvedThisMonth]);

    const copyErpId = (erpId) => {
        if (!erpId) return;
        if (!visitedIds.has(String(erpId))) {
            navigator.clipboard.writeText(String(erpId));
            setCopiedId(erpId);
            setTimeout(() => setCopiedId(null), 1500);
        }
        toggleVisited(erpId);
    };

    const daysAgoLabel = (fechaStr) => {
        const today = svNow();
        const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const fechaMidnight = new Date(`${fechaStr}T00:00:00`);
        const diff = Math.round((todayMidnight - fechaMidnight) / 86400000);
        if (diff === 0) return 'hoy';
        if (diff === 1) return 'ayer';
        return `hace ${diff}d`;
    };

    const { filtered, isAnuladasFuzzy } = useMemo(() => {
        const active = rows.filter(r => !resolvedIds.has(r.id));
        const { results: list, isFuzzy } = !searchTerm
            ? { results: active, isFuzzy: false }
            : smartFilter(searchTerm, active, r => [r.correlativo, r.cliente, r.codigo_generacion]);
        const ccf  = list.filter(r => r.tipo_documento === 'CCF').sort((a, b) => a.fecha.localeCompare(b.fecha));
        const rest = list.filter(r => r.tipo_documento !== 'CCF').sort((a, b) => a.fecha.localeCompare(b.fecha));
        return { filtered: [...ccf, ...rest], isAnuladasFuzzy: isFuzzy };
    }, [rows, resolvedIds, searchTerm]);

    const activeVisitedCount = useMemo(() => {
        const active = rows.filter(r => !resolvedIds.has(r.id));
        return active.filter(r => r.erp_invoice_id && visitedIds.has(String(r.erp_invoice_id))).length;
    }, [rows, resolvedIds, visitedIds]);

    // ⚠️ El orden de las secciones sale del ID, y hoy acierta de CASUALIDAD.
    // `g` se indexa por `branch_id`, o sea claves que parecen enteros, y
    // `Object.entries()` sobre ésas las devuelve ordenadas NUMÉRICAMENTE — no
    // por inserción (está en la especificación del lenguaje y no avisa; fue el
    // defecto de la Consulta de Inventario del tablero, 2026-08-07). Acá los
    // ids ascendentes —2, 4, 25, 27, 28, 29, 30— dan justo La Popular, Salud
    // 1…5 y Bodega, que es el orden del negocio. Una sala nueva con un id que
    // caiga en el medio lo rompe sin que nada falle.
    // La fecha de adentro NO tiene el problema: '2026-08-07' no es un entero,
    // así que ahí sí manda el orden de inserción.
    const grouped = useMemo(() => {
        const g = {};
        for (const r of filtered) {
            if (!g[r.branch_id]) g[r.branch_id] = {};
            if (!g[r.branch_id][r.fecha]) g[r.branch_id][r.fecha] = [];
            g[r.branch_id][r.fecha].push(r);
        }
        return g;
    }, [filtered]);

    const ccfCount = filtered.filter(r => r.tipo_documento === 'CCF').length;

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Carril de métricas + píldora, en UNA fila (§17.0). Las tarjetas
                eran `<div>` a mano con un cuadrito degradado y su propio juego de
                clases por estado — o sea el vidrio del portal reescrito, que es
                justo lo que `StatCard` existe para evitar. El color va donde ES
                el dato: el número y el ícono. El fondo, nunca. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de anulaciones">
                    <StatCard
                        icon={AlertTriangle} label="Pendientes" value={filtered.length}
                        iconBg={filtered.length > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={filtered.length > 0 ? 'text-danger' : 'text-content-3'}
                        valueCls={filtered.length > 0 ? 'text-danger' : 'text-content'}
                    />
                    <StatCard
                        icon={AlertTriangle} label="CCF urgentes" value={ccfCount}
                        iconBg={ccfCount > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={ccfCount > 0 ? 'text-danger-text' : 'text-content-3'}
                        valueCls={ccfCount > 0 ? 'text-danger-text' : 'text-content'}
                    />
                    <StatCard
                        icon={CheckCircle2} label="Solventadas" value={resolved.length}
                        iconBg={resolved.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                        iconCls={resolved.length > 0 ? 'text-success' : 'text-content-3'}
                        valueCls={resolved.length > 0 ? 'text-success' : 'text-content'}
                    />
                    {/* Los marcadores son del usuario, no del dato: la tarjeta
                        solo aparece cuando hay alguno y limpiarlos es su acción.
                        `tono="warning"` + `active` la dibujan como seleccionada
                        (anillo, no relleno — §17.0). */}
                    {activeVisitedCount > 0 && (
                        <StatCard
                            icon={Check} label="Marcados" value={activeVisitedCount}
                            sub="Limpiar" onClick={clearVisited} active tono="warning"
                            iconBg="bg-warning/10" iconCls="text-warning-text"
                        />
                    )}
                </CarrilCards>
                <div className="flex items-center justify-end gap-2 min-w-0">
                    <BotonRegularizar
                        filterBranch={filterBranch} branches={branches} bolsa="anuladas"
                        canEdit={canEdit} pendientes={filtered.length} onDone={loadData} />
                    {barraFiltros}
                </div>
            </div>

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border border-divider bg-surface-card shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-surface-card-hover/60">
                                <div className="h-3 w-28 skeleton rounded-full" />
                                <div className="h-3 w-12 skeleton rounded-full" />
                            </div>
                            <div className="px-4 py-3 flex flex-wrap gap-1.5">
                                {Array.from({ length: 3 }).map((_, j) => (
                                    <div key={j} className="h-7 w-20 skeleton rounded-xl" />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                    title="Todo está al día" subtitle="No hay anulaciones pendientes por atender en este momento." />
            ) : (
                <div className="space-y-3">
                    {isAnuladasFuzzy && searchTerm && (
                        <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                    )}
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand/10 border border-brand/20 text-label text-brand-text font-medium">
                        <Info size={13} className="text-brand-text shrink-0" />
                        Al resolverse la anulación en sistema, el estado se actualiza automáticamente en el portal.
                    </div>
                    {Object.entries(grouped).map(([branchId, byFecha]) => {
                        const branchTotal = Object.values(byFecha).flat().length;
                        const branchHasCCF = Object.values(byFecha).flat().some(r => r.tipo_documento === 'CCF');
                        const isCollapsed = !!collapsedBranches[branchId];
                        return (
                            <div key={branchId} className="rounded-2xl border border-divider bg-surface-card shadow-sm">
                                <ListRow
                                    density="sm" icon={Building2} iconBoxClass="bg-transparent border-transparent" iconClass={branchHasCCF ? 'text-danger' : 'text-content-3'}
                                    tone={branchHasCCF ? 'danger' : null}
                                    title={<span className="flex items-center gap-2">{getBranch(Number(branchId))}{branchHasCCF && <Badge variant="danger" size="sm">CCF</Badge>}</span>}
                                    onClick={() => setCollapsedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                    aria-expanded={!isCollapsed}
                                    className={`rounded-none border-x-0 border-t-0 ${isCollapsed ? 'border-b-0' : ''}`}
                                    trailing={<>
                                        <span className="text-caption font-black text-content-3">{branchTotal} doc</span>
                                        <ChevronDown size={13} className={`text-content-3 transition-transform duration-[var(--dur-base)] ${isCollapsed ? '-rotate-90' : ''}`} />
                                    </>}
                                />
                                {!isCollapsed && <div className="divide-y divide-divider">
                                    {Object.entries(byFecha).map(([fecha, fechaRows]) => {
                                        const hasCCF   = fechaRows.some(r => r.tipo_documento === 'CCF');
                                        const isToday  = fecha === todayStr;
                                        const dLabel   = daysAgoLabel(fecha);
                                        return (
                                            <div key={fecha} className="px-4 py-3">
                                                <div className="flex items-center gap-2 mb-2.5">
                                                    <span className={`text-label font-black ${hasCCF ? 'text-danger-text' : 'text-content-2'}`}>{fecha}</span>
                                                    <Badge variant={isToday ? 'info' : hasCCF ? 'danger' : 'neutral'} size="sm">{dLabel}</Badge>
                                                </div>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {fechaRows.map(r => {
                                                        const isCCF     = r.tipo_documento === 'CCF';
                                                        const isSolving = solvingId === r.id;
                                                        const isCopied  = copiedId === r.erp_invoice_id;
                                                        const isVisited = visitedIds.has(String(r.erp_invoice_id));
                                                        return (
                                                            <div key={r.id} className={`relative group/tip transition-opacity duration-[var(--dur-slow)] ${isVisited && !isSolving ? 'opacity-40' : ''}`}>
                                                                <ChipDoc
                                                                    estado={isVisited ? 'visitado' : isCCF ? 'ccf' : 'normal'}
                                                                    copiado={isCopied}
                                                                    resuelto={isSolving}
                                                                    onCopiar={() => copyErpId(r.erp_invoice_id)}
                                                                    etiquetaCopia={r.erp_invoice_id ? `#${r.erp_invoice_id}` : '—'}
                                                                    nombreResolver="esta factura"
                                                                    onResolver={canEdit ? () => { isSolving ? (setSolvingId(null), setComment('')) : (setSolvingId(r.id), setComment('')); } : undefined}
                                                                >
                                                                    <span className="text-micro font-black uppercase select-none">{r.tipo_documento}</span>
                                                                </ChipDoc>
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-sidebar pointer-events-none opacity-0 group-hover/tip:opacity-100 focus-within:opacity-100 scale-95 group-hover/tip:scale-100 transition-all duration-[var(--dur-fast)] ease-out w-[210px]">
                                                                    <div data-surface="card" className="px-3.5 py-3 space-y-2">
                                                                        <div>
                                                                            <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Correlativo</p>
                                                                            <p className={`font-mono text-body-sm font-black leading-none ${isCCF ? 'text-danger-text' : 'text-content'}`}>{r.correlativo}</p>
                                                                        </div>
                                                                        {r.cliente && <div>
                                                                            <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Cliente</p>
                                                                            <p className="text-label font-semibold text-content-2 truncate">{r.cliente}</p>
                                                                        </div>}
                                                                        <div className="flex items-center justify-between pt-1 border-t border-divider">
                                                                            <p className="text-micro font-bold uppercase tracking-widest text-content-2">Total</p>
                                                                            <p className={`text-body font-black ${isCCF ? 'text-danger-text' : 'text-content'}`}>{<Monto v={r.total} />}</p>
                                                                        </div>
                                                                    </div>
                                                                    <div className="w-3 h-3 bg-surface-card border-r border-b border-divider rotate-45 mx-auto -mt-1.5 shadow-[var(--shadow-elevation-xs)]" />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                {fechaRows.some(r => r.id === solvingId) && (() => {
                                                    const r = fechaRows.find(r => r.id === solvingId);
                                                    const isCCF = r.tipo_documento === 'CCF';
                                                    return (
                                                        <div className="mt-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                                                            <div className="flex items-center gap-2 mb-2.5">
                                                                <span className={`font-mono text-label font-black ${isCCF ? 'text-danger-text' : 'text-content-2'}`}>{r.correlativo}</span>
                                                                {r.cliente && <span className="text-label text-content-3 truncate">· {r.cliente}</span>}
                                                                <span className="ml-auto text-body-sm font-black text-content-2">{<Monto v={r.total} />}</span>
                                                            </div>
                                                            <div className="flex items-start gap-3">
 <PortalTextarea
     textareaClassName="flex-1"
     rows={2}
     autoFocus
     placeholder="Comentario opcional…"
     value={comment}
     onChange={e => setComment(e.target.value)}
 />
                                                                <div className="flex flex-col gap-1.5 shrink-0">
                                                                    <Button tone="success" disabled={saving} onClick={() => handleSolve(r.id)}>{saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar</Button>
                                                                    <Button variant="secondary" icon={X} onClick={() => { setSolvingId(null); setComment(''); }}>Cancelar</Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    })}
                                </div>}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Historial */}
            {!loading && resolved.length > 0 && (
                <div ref={resolvedSectionRef} className="rounded-2xl border border-divider overflow-hidden bg-surface-card shadow-sm">
                    <ListRow
                        icon={Check} iconClass="text-success" iconBoxClass="bg-success/10 border-success/20"
                        title={`${showAllResolved ? resolved.length : resolvedThisMonth.length} solventada${resolved.length !== 1 ? 's' : ''} ${showAllResolved ? 'en total' : 'este mes'}`}
                        subtitle="Historial de resoluciones"
                        onClick={() => setShowHistorial(v => !v)}
                        aria-expanded={showHistorial}
                        className="rounded-none border-x-0 border-t-0"
                        trailing={<ChevronDown size={16} className={`text-content-3 transition-transform duration-[var(--dur-slow)] ${showHistorial ? 'rotate-180' : ''}`} />}
                    />
                    {showHistorial && (
                        <div className="border-t border-divider">
                            {resolvedDisplay.map((r, i) => {
                                const inv = r.invoice;
                                const photo = empPhotoMap[r.resolved_by] || null;
                                const initials = (r.resolved_by || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                                return (
                                    <div key={r.id} className={`flex items-start gap-3 px-5 py-4 hover:bg-surface-card-hover/40 transition-colors ${i > 0 ? 'border-t border-divider' : ''}`}>
                                        {photo
                                            ? <img src={photo} alt={r.resolved_by} className="w-8 h-8 rounded-full object-cover border border-divider shrink-0 mt-0.5" />
                                            : <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                                                <span className="text-micro font-black text-success-text">{initials}</span>
                                              </div>
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <Badge variant="success" uppercase={false}>{inv?.tipo_documento}</Badge>
                                                {inv?.erp_invoice_id && <span className="font-mono text-body-sm font-black text-content">#{inv.erp_invoice_id}</span>}
                                                <span className="font-mono text-label text-content-3">{inv?.correlativo}</span>
                                                <span className="text-label text-content-3">{getBranch(inv?.branch_id)}</span>
                                                {inv?.total && <span className="text-body-sm font-bold text-content-2 ml-auto">{<Monto v={inv.total} />}</span>}
                                            </div>
                                            {r.comment && <p className="text-body-sm text-content-3 mb-1">"{r.comment}"</p>}
                                            <p className="text-label text-content-3">
                                                <span className="font-semibold text-content-2">{r.resolved_by || '—'}</span>
                                                {r.resolved_at && <> · {new Date(r.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="px-5 py-3 border-t border-divider flex justify-center">
                                <Button variant="ghost" onClick={() => setShowAllResolved(v => !v)}>{showAllResolved ? `Ver solo este mes (${resolvedThisMonth.length})` : `Ver todos (${resolved.length})`}</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tab: Pendiente MH ────────────────────────────────────────────────────────
//
// Esta pestaña es la cola de ESPERA: facturas con `recibido_mh IS NULL`, o sea
// que el sello de Hacienda todavía no llegó. Un sello presente pero corrupto ya
// no entra acá — no se resuelve esperando, así que vive en Observaciones.
//
// El mismo número de gracia que usa el RPC de Observaciones para el código de
// generación: Hacienda tarda hasta 2 días en emitir sello y código, que llegan
// juntos. Antes de eso una factura sin sello no tiene nada de raro. Desde que
// `SIN_SELLO_VENCIDO` salió de aquel catálogo, esta pestaña es la única que
// marca el vencimiento — de ahí el badge en warning de la fila de fecha.
const GRACIA_SELLO_DIAS = 2;

function TabPendienteMH({ branches, filterBranch, searchTerm, currentUser, canEdit, paused, barraFiltros }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        for (const e of employees) if (e.name) m[e.name] = e.photo || e.photo_url || null;
        return m;
    }, [employees]);
    const [rows, setRows]               = useState([]);
    const [resolved, setResolved]       = useState([]);
    const [showResolved, setShowResolved] = useState(false);
    const [showAllResolved, setShowAllResolved] = useState(false);
    const resolvedSectionRef = useRef(null);
    const pollingRef2 = useRef(false);
    const [loading, setLoading]         = useState(true);
    const [solvingId, setSolvingId]     = useState(null);
    const [comment, setComment]         = useState('');
    const [saving, setSaving]           = useState(false);
    const [copiedId, setCopiedId]             = useState(null);
    const [nullCamposIds, setNullCamposIds]   = useState(new Set());
    const [collapsedBranches, setCollapsedBranches] = useState({});
    const { visitedIds, toggleVisited, clearVisited } = useVisitados();

    const now      = svNow();
    const todayStr = now.toISOString().slice(0, 10);
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();

    const getBranch   = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;
    const copyErpId   = (erpId) => {
        if (!erpId) return;
        if (!visitedIds.has(String(erpId))) {
            navigator.clipboard.writeText(String(erpId));
            setCopiedId(erpId);
            setTimeout(() => setCopiedId(null), 1500);
        }
        toggleVisited(erpId);
    };
    const daysAgoLabel = (fechaStr) => {
        const diff = diasDesde(fechaStr);
        if (diff === 0) return 'hoy';
        if (diff === 1) return 'ayer';
        return `hace ${diff}d`;
    };

    const currentMonthStr = svNow().toISOString().slice(0, 7);

    const resolvedMatchesTerm = useCallback((r, s) =>
        tokenMatch(s, String(r.erp_invoice_id || ''), r.correlativo, r.cliente),
    []);

    const resolvedThisMonth = useMemo(() =>
        resolved.filter(r => {
            const date = r.resolution?.resolved_at || r.fecha || '';
            return date.startsWith(currentMonthStr);
        }),
        [resolved, currentMonthStr]
    );
    const resolvedDisplay = useMemo(() => {
        const base = showAllResolved ? resolved : resolvedThisMonth;
        if (!searchTerm) return base;
        return base.filter(r => resolvedMatchesTerm(r, searchTerm));
    }, [resolved, resolvedThisMonth, showAllResolved, searchTerm, resolvedMatchesTerm]);

    useEffect(() => {
        if (!searchTerm) return;
        const matchesAny = resolved.some(r => resolvedMatchesTerm(r, searchTerm));
        if (!matchesAny) return;
        setShowResolved(true); // eslint-disable-line react-hooks/set-state-in-effect -- auto-expande la sección donde cae un resultado de búsqueda
        const inMonth = resolvedThisMonth.some(r => resolvedMatchesTerm(r, searchTerm));
        if (!inMonth) setShowAllResolved(true);
        setTimeout(() => resolvedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }, [searchTerm, resolved, resolvedMatchesTerm, resolvedThisMonth]);

    const loadData = useCallback(async () => {
        if (pollingRef2.current) return;
        pollingRef2.current = true;
        setLoading(true);
        const n = svNow();
        const y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, '0');
        const fini = `${y}-${m}-01`;
        const ffin = `${y}-${m}-${new Date(y, n.getMonth() + 1, 0).getDate()}`;

        // fetchPendingMhInvoices pagina con fetchAllRows — el backlog de
        // pendientes de Hacienda (recibido_mh IS NULL) puede superar 1000 filas.
        const [pendData, { data: resInvs }, { data: allResolutions }, { data: nullsData }] = await Promise.all([
            fetchPendingMhInvoices(filterBranch),
            fetchConfirmedMhInvoices(filterBranch, fini, ffin),
            fetchInvoiceResolutionsHistorial('invoice_id, comment, resolved_by, resolved_at'),
            fetchInvoiceNullIds(),
        ]);

        // Invoices that also have non-MH null campos (e.g. cliente, correlativo)
        setNullCamposIds(new Set((nullsData || []).map(r => r.id)));

        // Exclude already-resolved invoices from the pending list
        const resolvedIds = new Set((allResolutions || []).map(r => r.invoice_id));
        const filteredPend = (pendData || []).filter(r => !resolvedIds.has(r.id));

        // Build resolution map (all resolutions)
        const resMap = {};
        for (const x of (allResolutions || [])) {
            if (!resMap[x.invoice_id]) resMap[x.invoice_id] = x;
        }

        // Invoices confirmed by MH (recibido_mh = true) — already have full data
        const mhConfirmedIds = new Set((resInvs || []).map(r => r.id));

        // Invoices manually resolved via sales_invoice_resolutions (recibido_mh still null)
        const manuallyResolvedIds = [...resolvedIds].filter(id => !mhConfirmedIds.has(id));
        let manuallyResolvedInvs = [];
        if (manuallyResolvedIds.length > 0) {
            const { data: mrData, error: mrErr } = await fetchInvoicesByIds(manuallyResolvedIds, 'id, branch_id, tipo_documento, correlativo, erp_invoice_id, cliente, fecha, total');
            if (mrErr) console.error('loadData: fetch manually resolved invoices failed:', mrErr.message);
            manuallyResolvedInvs = mrData || [];
        }

        const allResolved = [
            ...(resInvs || []).map(inv => ({ ...inv, resolution: resMap[inv.id] || null })),
            ...manuallyResolvedInvs.map(inv => ({ ...inv, resolution: resMap[inv.id] || null })),
        ].sort((a, b) => {
            const da = resMap[a.id]?.resolved_at || a.fecha || '';
            const db = resMap[b.id]?.resolved_at || b.fecha || '';
            return db.localeCompare(da);
        });

        setRows(filteredPend);
        setResolved(allResolved);
        setLoading(false);
        pollingRef2.current = false;
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { if (paused) return; const id = setInterval(loadData, 120_000); return () => clearInterval(id); }, [loadData, paused]);

    const handleSolve = async (invoiceId) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const inv = rows.find(r => r.id === invoiceId);
        // Solo se registra la resolución manual. El sello de Hacienda NO se
        // fabrica desde acá: lo trae el sync cuando MH lo emite, y la factura
        // queda con `recibido_mh` NULL hasta entonces — que es lo que el camino
        // de lectura de abajo ya espera (`manuallyResolvedIds`).
        const { error } = await insertInvoiceResolution({
            invoice_id: invoiceId, comment: comment.trim() || null, resolved_by: resolvedBy,
        });
        if (error) { avisarFalloAlSolventar(error, 'handleSolve (pendiente MH)'); setSaving(false); return; }
        useStaff.getState().appendAuditLog('SOLVENTAR_PENDIENTE_MH', String(invoiceId), {
            correlativo: inv?.correlativo, comment: comment.trim() || null, resolved_by: resolvedBy,
        });
        useToastStore.getState().showToast('Pendiente solventado', inv?.correlativo || '', 'success');
        setResolved(prev => [{ ...inv, resolution: { comment: comment.trim() || null, resolved_by: resolvedBy, resolved_at: new Date().toISOString() } }, ...prev]);
        setRows(prev => prev.filter(r => r.id !== invoiceId));
        setSolvingId(null); setComment(''); setSaving(false);
    };

    const { filtered, isPendienteFuzzy } = useMemo(() => {
        const { results: list, isFuzzy } = !searchTerm
            ? { results: rows, isFuzzy: false }
            : smartFilter(searchTerm, rows, r => [r.correlativo, r.cliente, String(r.erp_invoice_id || '')]);
        const ccf  = list.filter(r => r.tipo_documento === 'CCF');
        const rest = list.filter(r => r.tipo_documento !== 'CCF');
        return { filtered: [...ccf, ...rest], isPendienteFuzzy: isFuzzy };
    }, [rows, searchTerm]);

    const activeVisitedCount = useMemo(() =>
        rows.filter(r => r.erp_invoice_id && visitedIds.has(String(r.erp_invoice_id))).length,
    [rows, visitedIds]);

    const ccfCount = filtered.filter(r => r.tipo_documento === 'CCF').length;

    // Group by branch_id → fecha (CCF rows always first within each fecha)
    // ⚠️ El orden de las secciones sale del ID, y hoy acierta de CASUALIDAD.
    // `g` se indexa por `branch_id`, o sea claves que parecen enteros, y
    // `Object.entries()` sobre ésas las devuelve ordenadas NUMÉRICAMENTE — no
    // por inserción (está en la especificación del lenguaje y no avisa; fue el
    // defecto de la Consulta de Inventario del tablero, 2026-08-07). Acá los
    // ids ascendentes —2, 4, 25, 27, 28, 29, 30— dan justo La Popular, Salud
    // 1…5 y Bodega, que es el orden del negocio. Una sala nueva con un id que
    // caiga en el medio lo rompe sin que nada falle.
    // La fecha de adentro NO tiene el problema: '2026-08-07' no es un entero,
    // así que ahí sí manda el orden de inserción.
    const grouped = useMemo(() => {
        const g = {};
        for (const r of filtered) {
            if (!g[r.branch_id]) g[r.branch_id] = {};
            if (!g[r.branch_id][r.fecha]) g[r.branch_id][r.fecha] = [];
            g[r.branch_id][r.fecha].push(r);
        }
        return g;
    }, [filtered]);

    const daysLeftLabel = daysLeft === 0 ? 'Último día' : daysLeft;
    const daysLeftText  = daysLeft === 0 ? 'text-danger-text' : daysLeft <= 2 ? 'text-danger-text' : daysLeft <= 5 ? 'text-warning-text' : 'text-success-text';
    const daysLeftIconBg = daysLeft <= 2 ? 'bg-danger/10' : daysLeft <= 5 ? 'bg-warning/10' : 'bg-success/10';

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Carril de métricas + píldora en UNA fila (§17.0). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de pendientes de Hacienda">
                    <StatCard
                        icon={Clock} label="Pendientes MH" value={filtered.length}
                        iconBg={filtered.length > 0 ? 'bg-warning/10' : 'bg-surface-card-hover'}
                        iconCls={filtered.length > 0 ? 'text-warning-text' : 'text-content-3'}
                        valueCls={filtered.length > 0 ? 'text-warning-text' : 'text-content'}
                    />
                    <StatCard
                        icon={AlertTriangle} label="CCF urgentes" value={ccfCount}
                        iconBg={ccfCount > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={ccfCount > 0 ? 'text-danger-text' : 'text-content-3'}
                        valueCls={ccfCount > 0 ? 'text-danger-text' : 'text-content'}
                    />
                    <StatCard
                        icon={History} label="Días restantes" value={daysLeftLabel}
                        iconBg={daysLeftIconBg} iconCls={daysLeftText} valueCls={daysLeftText}
                    />
                    {activeVisitedCount > 0 && (
                        <StatCard
                            icon={Check} label="Marcados" value={activeVisitedCount}
                            sub="Limpiar" onClick={clearVisited} active tono="warning"
                            iconBg="bg-warning/10" iconCls="text-warning-text"
                        />
                    )}
                </CarrilCards>
                <div className="flex items-center justify-end gap-2 min-w-0">
                    <BotonRegularizar
                        filterBranch={filterBranch} branches={branches} bolsa="sin_sello"
                        canEdit={canEdit} pendientes={filtered.length} onDone={loadData} />
                    {barraFiltros}
                </div>
            </div>

            {/* Pending list */}
            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border border-divider bg-surface-card shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-surface-card-hover/60">
                                <div className="h-3 w-28 skeleton rounded-full" />
                                <div className="h-3 w-12 skeleton rounded-full" />
                            </div>
                            <div className="px-4 py-3 flex flex-wrap gap-1.5">
                                {Array.from({ length: 3 }).map((_, j) => (
                                    <div key={j} className="h-7 w-20 skeleton rounded-xl" />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-chart-3-text" glowClass="bg-chart-3"
                    title="Sin pendientes de MH" subtitle="Todos los documentos han sido recibidos y confirmados por el Ministerio de Hacienda." />
            ) : (
                <div className="space-y-3">
                    {isPendienteFuzzy && searchTerm && (
                        <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                    )}
                    <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand/10 border border-brand/20 text-label text-brand-text font-medium">
                        <Info size={13} className="text-brand-text shrink-0" />
                        Al corregirse en sistema se confirman automáticamente en el portal.
                    </div>
                    {Object.entries(grouped).map(([branchId, byFecha]) => {
                        const branchTotal = Object.values(byFecha).flat().length;
                        const branchHasCCF = Object.values(byFecha).flat().some(r => r.tipo_documento === 'CCF');
                        const isCollapsed = !!collapsedBranches[branchId];
                        return (
                            <div key={branchId} className="rounded-2xl border border-divider bg-surface-card shadow-sm">
                                {/* Branch header — collapsible */}
                                <ListRow
                                    density="sm" icon={Building2} iconBoxClass="bg-transparent border-transparent" iconClass={branchHasCCF ? 'text-danger' : 'text-content-3'}
                                    tone={branchHasCCF ? 'danger' : null}
                                    title={<span className="flex items-center gap-2">{getBranch(Number(branchId))}{branchHasCCF && <Badge variant="danger" size="sm">CCF</Badge>}</span>}
                                    onClick={() => setCollapsedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                    aria-expanded={!isCollapsed}
                                    className={`rounded-none border-x-0 border-t-0 ${isCollapsed ? 'border-b-0' : ''}`}
                                    trailing={<>
                                        <span className="text-caption font-black text-content-3">{branchTotal} doc</span>
                                        <ChevronDown size={13} className={`text-content-3 transition-transform duration-[var(--dur-base)] ${isCollapsed ? '-rotate-90' : ''}`} />
                                    </>}
                                />

                                {/* Date sections */}
                                {!isCollapsed && <div className="divide-y divide-divider">
                                    {Object.entries(byFecha).map(([fecha, fechaRows]) => {
                                        const hasCCF = fechaRows.some(r => r.tipo_documento === 'CCF');
                                        const isToday = fecha === todayStr;
                                        const dLabel = daysAgoLabel(fecha);
                                        // Pasada la gracia, "hace 3d" deja de ser un dato y pasa a
                                        // ser un aviso: el sello ya tendría que estar. Es lo que
                                        // decía `SIN_SELLO_VENCIDO` en Observaciones, dicho en la
                                        // pestaña que sí puede hacer algo al respecto.
                                        const vencida = diasDesde(fecha) > GRACIA_SELLO_DIAS;

                                        return (
                                            <div key={fecha} className="px-4 py-3">
                                                {/* Date label */}
                                                <div className="flex items-center gap-2 mb-2.5">
                                                    <span className={`text-label font-black ${hasCCF ? 'text-danger-text' : 'text-content-2'}`}>{fecha}</span>
                                                    <Badge variant={isToday ? 'info' : hasCCF ? 'danger' : vencida ? 'warning' : 'neutral'} size="sm">{dLabel}</Badge>
                                                </div>

                                                {/* Pills row */}
                                                <div className="flex flex-wrap gap-1.5">
                                                    {fechaRows.map(r => {
                                                        const isCCF      = r.tipo_documento === 'CCF';
                                                        const isSolving  = solvingId === r.id;
                                                        const isCopied   = copiedId === r.erp_invoice_id;
                                                        const isVisited  = visitedIds.has(String(r.erp_invoice_id));
                                                        const hasNullCampos = nullCamposIds.has(r.id);
                                                        return (
                                                            <div key={r.id} className={`relative group/tip transition-opacity duration-[var(--dur-slow)] ${isVisited && !isSolving ? 'opacity-40' : ''}`}>
                                                                {/* Pill */}
                                                                <ChipDoc
                                                                    estado={isVisited ? 'visitado' : hasNullCampos ? 'nulos' : isCCF ? 'ccf' : 'normal'}
                                                                    copiado={isCopied}
                                                                    resuelto={isSolving}
                                                                    onCopiar={() => copyErpId(r.erp_invoice_id)}
                                                                    etiquetaCopia={r.erp_invoice_id ? `#${r.erp_invoice_id}` : '—'}
                                                                    nombreResolver="esta factura"
                                                                    onResolver={canEdit ? () => { isSolving ? (setSolvingId(null), setComment('')) : (setSolvingId(r.id), setComment('')); } : undefined}
                                                                >
                                                                    <span className="text-micro font-black uppercase select-none">{r.tipo_documento}</span>
                                                                </ChipDoc>

                                                                {/* Tooltip */}
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-sidebar pointer-events-none
                                                                    opacity-0 group-hover/tip:opacity-100 focus-within:opacity-100 scale-95 group-hover/tip:scale-100
                                                                    transition-all duration-[var(--dur-fast)] ease-out w-[210px]">
                                                                    <div data-surface="card" className="px-3.5 py-3">
                                                                        <div className="space-y-2">
                                                                            <div>
                                                                                <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Correlativo</p>
                                                                                <p className={`font-mono text-body-sm font-black leading-none ${isCCF ? 'text-danger-text' : 'text-content'}`}>{r.correlativo}</p>
                                                                            </div>
                                                                            {r.cliente && <div>
                                                                                <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Cliente</p>
                                                                                <p className="text-label font-semibold text-content-2 truncate">{r.cliente}</p>
                                                                            </div>}
                                                                            <div className="flex items-center justify-between pt-1 border-t border-divider">
                                                                                <p className="text-micro font-bold uppercase tracking-widest text-content-2">Total</p>
                                                                                <p className={`text-body font-black ${isCCF ? 'text-danger-text' : 'text-content'}`}>{<Monto v={r.total} />}</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    {/* Arrow */}
                                                                    <div className="w-3 h-3 bg-surface-card border-r border-b border-divider rotate-45 mx-auto -mt-1.5 shadow-[var(--shadow-elevation-xs)]" />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Solve form — shown below pills when ✓ clicked */}
                                                {fechaRows.some(r => r.id === solvingId) && (() => {
                                                    const r    = fechaRows.find(r => r.id === solvingId);
                                                    const isCCF = r.tipo_documento === 'CCF';
                                                    return (
                                                        <div className="mt-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                                                            <div className="flex items-center gap-2 mb-2.5">
                                                                <span className={`font-mono text-label font-black ${isCCF ? 'text-danger-text' : 'text-content-2'}`}>{r.correlativo}</span>
                                                                {r.cliente && <span className="text-label text-content-3 truncate">· {r.cliente}</span>}
                                                                <span className="ml-auto text-body-sm font-black text-content-2">{<Monto v={r.total} />}</span>
                                                            </div>
                                                            <div className="flex items-start gap-3">
                                                                <PortalTextarea
                                                                    textareaClassName="flex-1"
                                                                    rows={2}
                                                                    autoFocus
                                                                    placeholder="Comentario opcional…"
                                                                    value={comment}
                                                                    onChange={e => setComment(e.target.value)}
                                                                />
                                                                <div className="flex flex-col gap-1.5 shrink-0">
                                                                    <Button tone="success" disabled={saving} onClick={() => handleSolve(r.id)}>{saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar</Button>
                                                                    <Button variant="secondary" icon={X} onClick={() => { setSolvingId(null); setComment(''); }}>Cancelar</Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    })}
                                </div>}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Historial solventados */}
            {!loading && resolved.length > 0 && (
                <div ref={resolvedSectionRef} className="rounded-2xl border border-divider overflow-hidden bg-surface-card shadow-sm">
                    <ListRow
                        icon={Check} iconClass="text-success" iconBoxClass="bg-success/10 border-success/20"
                        title={`${showAllResolved ? resolved.length : resolvedThisMonth.length} solventado${resolved.length !== 1 ? 's' : ''} ${showAllResolved ? 'en total' : 'este mes'}`}
                        subtitle="Historial de envíos al MH"
                        onClick={() => setShowResolved(v => !v)}
                        aria-expanded={showResolved}
                        className="rounded-none border-x-0 border-t-0"
                        trailing={<ChevronDown size={16} className={`text-content-3 transition-transform duration-[var(--dur-slow)] ${showResolved ? 'rotate-180' : ''}`} />}
                    />
                    {showResolved && (
                        <div className="border-t border-divider">
                            {resolvedDisplay.map((r, i) => {
                                const resolvedBy = r.resolution?.resolved_by || null;
                                const photo = resolvedBy ? (empPhotoMap[resolvedBy] || null) : null;
                                const initials = (resolvedBy || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                                return (
                                    <div key={r.id} className={`flex items-start gap-3 px-5 py-4 hover:bg-surface-card-hover/40 transition-colors ${i > 0 ? 'border-t border-divider' : ''}`}>
                                        {photo
                                            ? <img src={photo} alt={resolvedBy} className="w-8 h-8 rounded-full object-cover border border-divider shrink-0 mt-0.5" />
                                            : <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                                                <span className="text-micro font-black text-success-text">{initials}</span>
                                              </div>
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento}</Badge>
                                                {r.erp_invoice_id && <span className="font-mono text-body-sm font-black text-content">#{r.erp_invoice_id}</span>}
                                                <span className="font-mono text-label text-content-3">{r.correlativo}</span>
                                                <span className="text-label text-content-3">{getBranch(r.branch_id)}</span>
                                                {r.total && <span className="text-body-sm font-bold text-content-2 ml-auto">{<Monto v={r.total} />}</span>}
                                            </div>
                                            {r.resolution?.comment && <p className="text-body-sm text-content-3 mb-1">"{r.resolution.comment}"</p>}
                                            <p className="text-label text-content-3">
                                                {resolvedBy
                                                    ? <span className="font-semibold text-content-2">{resolvedBy}</span>
                                                    : 'Marcado como recibido'}
                                                {r.resolution?.resolved_at && <> · {new Date(r.resolution.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                                {!r.resolution && <> · {r.fecha}</>}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="px-5 py-3 border-t border-divider flex justify-center">
                                <Button variant="ghost" onClick={() => setShowAllResolved(v => !v)}>{showAllResolved ? `Ver solo este mes (${resolvedThisMonth.length})` : `Ver todos (${resolved.length})`}</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tab: Saltos ──────────────────────────────────────────────────────────────
function TabSaltos({ branches, filterBranch, currentUser, canEdit, barraFiltros }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        for (const e of employees) if (e.name) m[e.name] = e.photo || e.photo_url || null;
        return m;
    }, [employees]);
    const [gaps, setGaps] = useState([]);
    const [nulls, setNulls] = useState([]);
    const [gapResolutions, setGapResolutions] = useState([]);
    const [nullResolvedIds, setNullResolvedIds] = useState(new Set());
    const [loading, setLoading] = useState(true);
    const [solvingGap, setSolvingGap] = useState(null);
    const [solvingNull, setSolvingNull] = useState(null);
    const [comment, setComment] = useState('');
    const [nullComment, setNullComment] = useState('');
    const [saving, setSaving] = useState(false);
    const [nullSaving, setNullSaving] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [showAllResolved, setShowAllResolved] = useState(false);
    const resolvedSectionRef = useRef(null);
    const [collapsedGapBranches, setCollapsedGapBranches] = useState({});
    const [collapsedNullBranches, setCollapsedNullBranches] = useState({});
    const [copiedNullId, setCopiedNullId] = useState(null);

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const load = useCallback(async () => {
        setLoading(true);
        const [
            { data: gData, error: gErr }, { data: nData, error: nErr },
            { data: rData, error: rErr }, { data: nrData, error: nrErr },
        ] = await Promise.all([
            fetchSalesInvoiceGaps(filterBranch), fetchSalesInvoiceNulls(filterBranch),
            fetchGapResolutions(),
            fetchNullResolutionIds(),
        ]);
        if (gErr) console.error('load: fetch sales_invoice_gaps failed:', gErr.message);
        if (nErr) console.error('load: fetch sales_invoice_nulls failed:', nErr.message);
        if (rErr) console.error('load: fetch sales_gap_resolutions failed:', rErr.message);
        if (nrErr) console.error('load: fetch sales_null_resolutions failed:', nrErr.message);
        setGaps(gData || []);
        setNulls(nData || []);
        setGapResolutions(rData || []);
        setNullResolvedIds(new Set((nrData || []).map(r => r.null_id)));
        setLoading(false);
    }, [filterBranch]);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    const gapKey = (g) => `${g.branch_id}__${g.tipo_documento}__${g.gap_from}__${g.gap_to}`;

    const resolvedGapKeys = useMemo(() =>
        new Set(gapResolutions.map(r => `${r.branch_id}__${r.tipo_documento}__${r.gap_from}__${r.gap_to}`)),
        [gapResolutions]
    );

    const pendingGaps = useMemo(() => gaps.filter(g => !resolvedGapKeys.has(gapKey(g))), [gaps, resolvedGapKeys]);
    const resolvedGaps = useMemo(() =>
        gapResolutions.map(r => ({
            ...r,
            gap: gaps.find(g => g.branch_id === r.branch_id && g.tipo_documento === r.tipo_documento && g.gap_from === r.gap_from && g.gap_to === r.gap_to) || null,
        })),
        [gapResolutions, gaps]
    );

    const currentMonthStr = svNow().toISOString().slice(0, 7);
    const resolvedGapsThisMonth = useMemo(() =>
        resolvedGaps.filter(r => (r.resolved_at || '').startsWith(currentMonthStr)),
        [resolvedGaps, currentMonthStr]
    );
    const resolvedGapsDisplay = showAllResolved ? resolvedGaps : resolvedGapsThisMonth;

    const handleSolveGap = async (gap) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const payload = { branch_id: gap.branch_id, tipo_documento: gap.tipo_documento, gap_from: gap.gap_from, gap_to: gap.gap_to, comment: comment.trim() || null, resolved_by: resolvedBy };
        const { data, error } = await insertGapResolution(payload);
        if (error) { avisarFalloAlSolventar(error, 'handleSolveGap'); setSaving(false); return; }
        if (data?.[0]) setGapResolutions(prev => [data[0], ...prev]);
        useStaff.getState().appendAuditLog('SOLVENTAR_SALTO_CORRELATIVO', String(gap.branch_id), {
            tipo_documento: gap.tipo_documento, gap_from: gap.gap_from, gap_to: gap.gap_to,
            branch_name: getBranch(gap.branch_id), comment: comment.trim() || null,
        });
        useToastStore.getState().showToast(
            'Salto solventado', `${gap.tipo_documento} ${gap.gap_from}–${gap.gap_to}`, 'success');
        setSolvingGap(null); setComment(''); setSaving(false);
    };

    const handleSolveNull = async (n) => {
        setNullSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const { error } = await insertNullResolution({
            null_id: n.id, comment: nullComment.trim() || null, resolved_by: resolvedBy,
        });
        if (error) { avisarFalloAlSolventar(error, 'handleSolveNull'); setNullSaving(false); return; }
        useStaff.getState().appendAuditLog('SOLVENTAR_CAMPO_NULO', String(n.id), {
            branch: getBranch(n.branch_id), correlativo: n.correlativo, campos: n.campos_nulos,
            comment: nullComment.trim() || null,
        });
        useToastStore.getState().showToast('Campos nulos solventados', n.correlativo || '', 'success');
        setNullResolvedIds(prev => new Set([...prev, n.id]));
        setSolvingNull(null); setNullComment(''); setNullSaving(false);
    };

    if (loading) return <div className="flex justify-center py-24"><SkeletonText lines={4} className="w-full max-w-md" /></div>;

    const pad7 = n => String(n).padStart(7, '0');

    const copyNullId = (val) => {
        if (!val) return;
        navigator.clipboard.writeText(String(val));
        setCopiedNullId(val);
        setTimeout(() => setCopiedNullId(null), 1500);
    };

    // Group gaps by branch_id
    const gapsByBranch = {};
    for (const g of pendingGaps) {
        if (!gapsByBranch[g.branch_id]) gapsByBranch[g.branch_id] = [];
        gapsByBranch[g.branch_id].push(g);
    }

    // MH-only null campos — these belong in Pendientes MH, not here
    const MH_CAMPOS = new Set(['recibido_mh', 'codigo_generacion']);
    const isMhOnly = (n) => (n.campos_nulos || []).every(c => MH_CAMPOS.has(c));

    // Mismo caso que `grouped` de arriba: el orden de las secciones lo decide
    // el id numérico, y hoy coincide con el del negocio de casualidad.
    const activeNulls = nulls.filter(n => !nullResolvedIds.has(n.id) && !isMhOnly(n));
    const nullsByBranch = {};
    for (const n of activeNulls) {
        if (!nullsByBranch[n.branch_id]) nullsByBranch[n.branch_id] = [];
        nullsByBranch[n.branch_id].push(n);
    }

    return (
        <div className="p-5 md:p-6 space-y-6">

            {/* Carril de métricas + píldora en UNA fila (§17.0). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de saltos de correlativo">
                    <StatCard
                        icon={History} label="Saltos" value={gaps.length}
                        iconBg={gaps.length > 0 ? 'bg-chart-4/10' : 'bg-surface-card-hover'}
                        iconCls={gaps.length > 0 ? 'text-chart-4-text' : 'text-content-3'}
                        valueCls={gaps.length > 0 ? 'text-chart-4-text' : 'text-content'}
                    />
                    <StatCard
                        icon={AlertTriangle} label="Sin resolver" value={pendingGaps.length}
                        iconBg={pendingGaps.length > 0 ? 'bg-danger/10' : 'bg-success/10'}
                        iconCls={pendingGaps.length > 0 ? 'text-danger' : 'text-success'}
                        valueCls={pendingGaps.length > 0 ? 'text-danger' : 'text-success'}
                    />
                    <StatCard
                        icon={CheckCircle2} label="Solventados" value={resolvedGaps.length}
                        iconBg={resolvedGaps.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                        iconCls={resolvedGaps.length > 0 ? 'text-success' : 'text-content-3'}
                        valueCls={resolvedGaps.length > 0 ? 'text-success' : 'text-content'}
                    />
                    <StatCard
                        icon={AlertTriangle} label="Campos nulos" value={activeNulls.length}
                        iconBg={activeNulls.length > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={activeNulls.length > 0 ? 'text-danger' : 'text-content-3'}
                        valueCls={activeNulls.length > 0 ? 'text-danger' : 'text-content'}
                    />
                </CarrilCards>
                {barraFiltros && <div className="flex justify-end min-w-0">{barraFiltros}</div>}
            </div>

            {/* ── Saltos pendientes ── */}
            <div className="space-y-3">
                <h3 className="text-label font-black uppercase tracking-widest text-content-3">Saltos en correlativos</h3>

                {pendingGaps.length === 0 ? (
                    <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                        title="Sin saltos detectados" subtitle="Los correlativos están en orden. No hay brechas." />
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-brand/10 border border-brand/20 text-label text-brand-text font-medium">
                            <Info size={13} className="text-brand-text shrink-0" />
                            Cada salto indica correlativos faltantes entre dos documentos consecutivos.
                        </div>
                        {Object.entries(gapsByBranch).map(([branchId, branchGaps]) => {
                            const isCollapsed = !!collapsedGapBranches[branchId];
                            const hasCCF = branchGaps.some(g => g.tipo_documento === 'CCF');
                            return (
                                <div key={branchId} className="rounded-2xl border border-divider bg-surface-card shadow-sm">
                                    <ListRow
                                        density="sm" icon={Building2} iconBoxClass="bg-transparent border-transparent" iconClass={hasCCF ? 'text-danger' : 'text-content-3'}
                                        tone={hasCCF ? 'danger' : null}
                                        title={<span className="flex items-center gap-2">{getBranch(Number(branchId))}{hasCCF && <Badge variant="danger" size="sm">CCF</Badge>}</span>}
                                        onClick={() => setCollapsedGapBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                        aria-expanded={!isCollapsed}
                                        className={`rounded-none border-x-0 border-t-0 ${isCollapsed ? 'border-b-0' : ''}`}
                                        trailing={<>
                                            <span className="text-caption font-black text-content-3">{branchGaps.length} salto{branchGaps.length !== 1 ? 's' : ''}</span>
                                            <ChevronDown size={13} className={`text-content-3 transition-transform duration-[var(--dur-base)] ${isCollapsed ? '-rotate-90' : ''}`} />
                                        </>}
                                    />
                                    {!isCollapsed && (
                                        <div className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {branchGaps.map((g, i) => {
                                                    const key = gapKey(g);
                                                    const isSolving = solvingGap === key;
                                                    const isCCF = g.tipo_documento === 'CCF';
                                                    return (
                                                        <div key={i} className="relative group/tip">
                                                            <ChipDoc
                                                                estado={isCCF ? 'ccf' : 'salto'}
                                                                resuelto={isSolving}
                                                                etiquetaCopia={`${pad7(g.gap_from)}–${pad7(g.gap_to)}`}
                                                                nombreResolver="este salto de correlativo"
                                                                onResolver={canEdit ? () => { isSolving ? (setSolvingGap(null), setComment('')) : (setSolvingGap(key), setComment('')); } : undefined}
                                                            >
                                                                <span className="text-micro font-black uppercase select-none">{g.tipo_documento}</span>
                                                            </ChipDoc>
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-sidebar pointer-events-none opacity-0 group-hover/tip:opacity-100 focus-within:opacity-100 scale-95 group-hover/tip:scale-100 transition-all duration-[var(--dur-fast)] ease-out w-[200px]">
                                                                <div data-surface="card" className="px-3.5 py-3 space-y-2">
                                                                    <div>
                                                                        <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Rango</p>
                                                                        <p className="font-mono text-label font-black text-content">{pad7(g.gap_from)} → {pad7(g.gap_to)}</p>
                                                                    </div>
                                                                    <div className="flex items-center justify-between pt-1 border-t border-divider">
                                                                        <p className="text-micro font-bold uppercase tracking-widest text-content-2">Faltantes</p>
                                                                        <p className="text-body font-black text-chart-4-text">{g.gap_count}</p>
                                                                    </div>
                                                                    {g.siguiente_correlativo && <div>
                                                                        <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Siguiente</p>
                                                                        <p className="font-mono text-label font-semibold text-content-2">{g.siguiente_correlativo}</p>
                                                                    </div>}
                                                                </div>
                                                                <div className="w-3 h-3 bg-surface-card border-r border-b border-divider rotate-45 mx-auto -mt-1.5 shadow-[var(--shadow-elevation-xs)]" />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {branchGaps.some(g => solvingGap === gapKey(g)) && (() => {
                                                const g = branchGaps.find(g => solvingGap === gapKey(g));
                                                return (
                                                    <div className="mt-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                                                        <p className="font-mono text-label font-black text-content-2 mb-2.5">{pad7(g.gap_from)} → {pad7(g.gap_to)} · <span className="text-chart-4-text">{g.gap_count} faltante{g.gap_count !== 1 ? 's' : ''}</span></p>
                                                        <div className="flex items-start gap-3">
 <PortalTextarea
     textareaClassName="flex-1"
     rows={2}
     autoFocus
     placeholder="Comentario opcional…"
     value={comment}
     onChange={e => setComment(e.target.value)}
 />
                                                            <div className="flex flex-col gap-1.5 shrink-0">
                                                                <Button tone="success" disabled={saving} onClick={() => handleSolveGap(g)}>{saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar</Button>
                                                                <Button variant="secondary" icon={X} onClick={() => { setSolvingGap(null); setComment(''); }}>Cancelar</Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Campos nulos ── */}
            <div className="space-y-3">
                <h3 className="text-label font-black uppercase tracking-widest text-content-3">Campos indefinidos / nulos</h3>
                {activeNulls.length === 0 ? (
                    <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                        title="Sin campos indefinidos" subtitle="Todos los documentos tienen sus campos completos." />
                ) : (
                    <div className="space-y-3">
                        {Object.entries(nullsByBranch).map(([branchId, branchNulls]) => {
                            const isCollapsed = !!collapsedNullBranches[branchId];
                            return (
                                <div key={branchId} className="rounded-2xl border border-divider bg-surface-card shadow-sm">
                                    <ListRow
                                        density="sm" icon={Building2} iconBoxClass="bg-transparent border-transparent" iconClass={'text-content-3'}
                                        title={getBranch(Number(branchId))}
                                        onClick={() => setCollapsedNullBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                        aria-expanded={!isCollapsed}
                                        className={`rounded-none border-x-0 border-t-0 ${isCollapsed ? 'border-b-0' : ''}`}
                                        trailing={<>
                                            <span className="text-caption font-black text-content-3">{branchNulls.length} doc</span>
                                            <ChevronDown size={13} className={`text-content-3 transition-transform duration-[var(--dur-base)] ${isCollapsed ? '-rotate-90' : ''}`} />
                                        </>}
                                    />
                                    {!isCollapsed && (
                                        <div className="px-4 py-3">
                                            <div className="flex flex-wrap gap-1.5">
                                                {branchNulls.map(n => {
                                                    const isSolving = solvingNull === n.id;
                                                    const copyVal = n.erp_invoice_id || n.correlativo;
                                                    const isCopied = copiedNullId === copyVal;
                                                    return (
                                                        <div key={n.id} className="relative group/tip">
                                                            <ChipDoc
                                                                estado="ccf"
                                                                copiado={isCopied}
                                                                resuelto={isSolving}
                                                                onCopiar={() => copyNullId(copyVal)}
                                                                etiquetaCopia={n.erp_invoice_id ? `#${n.erp_invoice_id}` : n.correlativo || `ID ${n.id}`}
                                                                nombreResolver="esta anulada"
                                                                onResolver={canEdit ? () => { isSolving ? (setSolvingNull(null), setNullComment('')) : (setSolvingNull(n.id), setNullComment('')); } : undefined}
                                                            >
                                                                {(n.campos_nulos || []).slice(0, 2).map(c => (
                                                                    <span key={c} className="text-micro font-black uppercase">{c}</span>
                                                                ))}
                                                                {(n.campos_nulos || []).length > 2 && <span className="text-micro font-black">+{n.campos_nulos.length - 2}</span>}
                                                            </ChipDoc>
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 z-sidebar pointer-events-none opacity-0 group-hover/tip:opacity-100 focus-within:opacity-100 scale-95 group-hover/tip:scale-100 transition-all duration-[var(--dur-fast)] ease-out w-[200px]">
                                                                <div data-surface="card" className="px-3.5 py-3 space-y-2">
                                                                    {n.correlativo && <div>
                                                                        <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Correlativo</p>
                                                                        <p className="font-mono text-body-sm font-black text-content">{n.correlativo}</p>
                                                                    </div>}
                                                                    {n.fecha && <div>
                                                                        <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-0.5">Fecha</p>
                                                                        <p className="text-label font-semibold text-content-2">{n.fecha}</p>
                                                                    </div>}
                                                                    <div className="pt-1 border-t border-divider">
                                                                        <p className="text-micro font-bold uppercase tracking-widest text-content-2 mb-1">Campos nulos</p>
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(n.campos_nulos || []).map(c => (
                                                                                <span key={c} className="text-micro font-bold bg-danger/10 text-danger-text px-1.5 py-0.5 rounded">{c}</span>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="w-3 h-3 bg-surface-card border-r border-b border-divider rotate-45 mx-auto -mt-1.5 shadow-[var(--shadow-elevation-xs)]" />
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {branchNulls.some(n => n.id === solvingNull) && (() => {
                                                const n = branchNulls.find(n => n.id === solvingNull);
                                                return (
                                                    <div className="mt-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                                                        <p className="font-mono text-label font-black text-content-2 mb-2.5">{n.correlativo || `#${n.erp_invoice_id}` || `ID ${n.id}`}</p>
                                                        <div className="flex items-start gap-3">
 <PortalTextarea
     textareaClassName="flex-1"
     rows={2}
     autoFocus
     placeholder="Comentario opcional…"
     value={nullComment}
     onChange={e => setNullComment(e.target.value)}
 />
                                                            <div className="flex flex-col gap-1.5 shrink-0">
                                                                <Button tone="success" disabled={nullSaving} onClick={() => handleSolveNull(n)}>{nullSaving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar</Button>
                                                                <Button variant="secondary" icon={X} onClick={() => { setSolvingNull(null); setNullComment(''); }}>Cancelar</Button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Historial solventados ── */}
            {resolvedGaps.length > 0 && (
                <div ref={resolvedSectionRef} className="rounded-2xl border border-divider overflow-hidden bg-surface-card shadow-sm">
                    <ListRow
                        icon={Check} iconClass="text-success" iconBoxClass="bg-success/10 border-success/20"
                        title={`${showAllResolved ? resolvedGaps.length : resolvedGapsThisMonth.length} salto${resolvedGaps.length !== 1 ? 's' : ''} solventado${resolvedGaps.length !== 1 ? 's' : ''} ${showAllResolved ? 'en total' : 'este mes'}`}
                        subtitle="Historial de resoluciones"
                        onClick={() => setShowHistorial(v => !v)}
                        aria-expanded={showHistorial}
                        className="rounded-none border-x-0 border-t-0"
                        trailing={<ChevronDown size={16} className={`text-content-3 transition-transform duration-[var(--dur-slow)] ${showHistorial ? 'rotate-180' : ''}`} />}
                    />
                    {showHistorial && (
                        <div className="border-t border-divider">
                            {resolvedGapsDisplay.map((r, i) => {
                                const photo = r.resolved_by ? (empPhotoMap[r.resolved_by] || null) : null;
                                const initials = (r.resolved_by || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                                return (
                                    <div key={r.id} className={`flex items-start gap-3 px-5 py-4 hover:bg-surface-card-hover/40 transition-colors ${i > 0 ? 'border-t border-divider' : ''}`}>
                                        {photo
                                            ? <img src={photo} alt={r.resolved_by} className="w-8 h-8 rounded-full object-cover border border-divider shrink-0 mt-0.5" />
                                            : <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                                                <span className="text-micro font-black text-success-text">{initials}</span>
                                              </div>
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <Badge variant="success" uppercase={false}>{r.tipo_documento}</Badge>
                                                <span className="text-body font-bold text-content-2">{getBranch(r.branch_id)}</span>
                                                <span className="font-mono text-label text-content-3">{pad7(r.gap_from)} → {pad7(r.gap_to)}</span>
                                            </div>
                                            {r.comment && <p className="text-body-sm text-content-3 mb-1">"{r.comment}"</p>}
                                            <p className="text-label text-content-3">
                                                <span className="font-semibold text-content-2">{r.resolved_by || '—'}</span>
                                                {r.resolved_at && <> · {new Date(r.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="px-5 py-3 border-t border-divider flex justify-center">
                                <Button variant="ghost" onClick={() => setShowAllResolved(v => !v)}>{showAllResolved ? `Ver solo este mes (${resolvedGapsThisMonth.length})` : `Ver todos (${resolvedGaps.length})`}</Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Tab: No Efectivo ─────────────────────────────────────────────────────────
function TabNoEfectivo({ branches, filterBranch, searchTerm, currentUser, canEdit, barraFiltros, selectedMonth }) {
    const [pending, setPending] = useState([]);
    const [confirmedIds, setConfirmedIds] = useState(new Set());
    const [confirmed, setConfirmed] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirmingId, setConfirmingId] = useState(null);
    const [confirmNotes, setConfirmNotes] = useState('');
    const [confirmFile, setConfirmFile] = useState(null);
    const [confirmSaving, setConfirmSaving] = useState(false);

    // Pending pagination: { [tipo]: page }
    const [pendingPages, setPendingPages] = useState({});
    const getPendingPage = (tipo) => pendingPages[tipo] || 1;
    const setPendingPage = (tipo, p) => setPendingPages(prev => ({ ...prev, [tipo]: p }));

    // Confirmed section
    const [filterConfirmedTipo, setFilterConfirmedTipo] = useState('');
    const [filterConfirmedBranch, setFilterConfirmedBranch] = useState('');
    const [showConfirmed, setShowConfirmed] = useState(false);
    const [confirmedPage, setConfirmedPage] = useState(1);

    // Confirmed sort
    const { sortKey: cSortKey, sortDir: cSortDir, toggle: cToggle, sortFn: cSortFn } = useSortable('confirmed_at', 'desc');
    // Los pendientes no se podían ordenar (la tabla del historial sí: dos tablas
    // con dos comportamientos). Un solo estado para los bloques: "de mayor a
    // menor monto" es una intención del usuario, no de una forma de pago.
    const { sortKey: pSortKey, sortDir: pSortDir, toggle: pToggle, sortFn: pSortFn } = useSortable('fecha', 'desc');
    const [pendingSize, setPendingSize] = useState(25);
    const [confirmedSize, setConfirmedSize] = useState(25);



    const loadData = useCallback(async () => {
        setLoading(true);
        const [fini, ffin] = selectedMonth.split('|');

        // fetchNonCashInvoices pagina con fetchAllRows — antes esta query no
        // paginaba pese a filtrar sales_invoices (tabla flagged en CLAUDE.md);
        // un mes con mucho volumen de tarjeta/transferencia podía truncarse en
        // silencio sobre el cap de 1000 filas de PostgREST.
        const [invoicesData, confirmedIdsRes, historialRes] = await Promise.all([
            fetchNonCashInvoices(filterBranch, fini, ffin, NON_CASH_TYPES),
            fetchPaymentConfirmationIds(),
            fetchPaymentConfirmationsHistorial(),
        ]);
        if (confirmedIdsRes.error) console.error('loadData: fetch confirmed ids failed:', confirmedIdsRes.error.message);
        if (historialRes.error) console.error('loadData: fetch confirmation history failed:', historialRes.error.message);

        const cidSet = new Set((confirmedIdsRes.data || []).map(r => r.invoice_id));
        const hData = await signPhotosDeep(historialRes.data || []);
        const hIds = hData.map(r => r.invoice_id);
        let invMap = {};
        if (hIds.length > 0) {
            const { data: d, error: dErr } = await fetchInvoicesByIds(hIds, 'id, correlativo, branch_id, tipo_documento, cliente, fecha, total, tipo_pago');
            if (dErr) console.error('loadData: fetch confirmed invoices failed:', dErr.message);
            for (const inv of (d || [])) invMap[inv.id] = inv;
        }

        setPending(invoicesData || []);
        setConfirmedIds(cidSet);
        setConfirmed(hData.map(r => ({ ...r, invoice: invMap[r.invoice_id] || null })));
        setLoading(false);
    }, [filterBranch, selectedMonth]);

    useEffect(() => { loadData(); }, [loadData]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    const getBranch = useCallback((id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`, [branches]);

    const ordenarPendientes = useCallback((filas) => pSortFn(filas, {
        correlativo: r => r.correlativo || '',
        sucursal:    r => getBranch(r.branch_id),
        cliente:     r => r.cliente || '',
        fecha:       r => `${r.fecha || ''} ${r.hora || ''}`,
        total:       r => parseFloat(r.total || 0),
    }), [pSortFn, getBranch]);

    const { pendingFiltered, isNoEfectivoFuzzy } = useMemo(() => {
        const base = pending.filter(r => !confirmedIds.has(r.id));
        const { results, isFuzzy } = !searchTerm
            ? { results: base, isFuzzy: false }
            : smartFilter(searchTerm, base, r => [r.correlativo, r.cliente, r.tipo_pago]);
        return { pendingFiltered: results, isNoEfectivoFuzzy: isFuzzy };
    }, [pending, confirmedIds, searchTerm]);

    const byTipo = useMemo(() => {
        const groups = {};
        for (const r of pendingFiltered) {
            const t = r.tipo_pago?.toLowerCase() || 'otro';
            if (!groups[t]) groups[t] = [];
            groups[t].push(r);
        }
        return groups;
    }, [pendingFiltered]);

    // Reset pending pages when data changes
    useEffect(() => { setPendingPages({}); }, [pendingFiltered.length, searchTerm]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la página 1 cuando cambia el conjunto

    const CONFIRMED_SORT_ACCESSORS = useMemo(() => ({
        correlativo:   r => r.invoice?.correlativo,
        sucursal:      r => branches.find(b => b.id === r.branch_id)?.name || `Suc. ${r.branch_id}`,
        cliente:       r => r.invoice?.cliente,
        fecha:         r => r.invoice?.fecha,
        total:         r => parseFloat(r.invoice?.total || 0),
        confirmed_by:  r => r.confirmed_by,
        confirmed_at:  r => r.confirmed_at,
        tipo_pago:     r => r.tipo_pago,
    }), [branches]);

    const confirmedFiltered = useMemo(() => {
        let list = confirmed;
        if (filterConfirmedTipo) list = list.filter(r => r.tipo_pago?.toLowerCase() === filterConfirmedTipo);
        if (filterConfirmedBranch) list = list.filter(r => String(r.branch_id) === filterConfirmedBranch);
        return cSortFn(list, CONFIRMED_SORT_ACCESSORS);
    }, [confirmed, filterConfirmedTipo, filterConfirmedBranch, cSortFn, CONFIRMED_SORT_ACCESSORS]);

    useEffect(() => { setConfirmedPage(1); }, [confirmedFiltered.length, filterConfirmedTipo, filterConfirmedBranch]); // eslint-disable-line react-hooks/set-state-in-effect -- volver a la página 1 cuando cambia el filtro

    const confirmedTotalPages = Math.max(1, Math.ceil(confirmedFiltered.length / confirmedSize));
    const confirmedPageRows = confirmedFiltered.slice((confirmedPage - 1) * confirmedSize, confirmedPage * confirmedSize);

    const handleConfirm = async (invoiceId) => {
        setConfirmSaving(true);
        const confirmedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        // Guardar el identificador CRUDO (photo_url), nunca la URL firmada expirable
        const confirmedByPhoto = currentUser?.photo_url || currentUser?.photoRaw || null;

        let proofUrl = null;
        if (confirmFile) {
            const ext = confirmFile.name.split('.').pop();
            // `handleConfirm` es un manejador de evento, no render: `Date.now()`
            // solo desambigua el nombre del archivo que se sube. La regla aparece
            // recién ahora porque hasta este commit el análisis de este archivo se
            // degradaba por un `ref` usado dentro de handlers (el gotcha del React
            // Compiler ya documentado); al migrar a `FileField` ese ref desapareció
            // y el linter pasa a ver el archivo entero.
            const path = `invoices/${invoiceId}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, confirmFile);
            if (!upErr) {
                const { data: urlData } = supabase.storage.from('payment-proofs').getPublicUrl(path);
                proofUrl = urlData?.publicUrl || null;
            }
        }

        const inv = pending.find(r => r.id === invoiceId);
        const payload = {
            invoice_id: invoiceId,
            confirmed_by: confirmedBy,
            confirmed_by_photo: confirmedByPhoto,
            notes: confirmNotes.trim() || null,
            proof_url: proofUrl,
            tipo_pago: inv?.tipo_pago,
            branch_id: inv?.branch_id,
        };

        const { data, error } = await insertPaymentConfirmation(payload);
        if (error) {
            console.error('handleConfirm: insert confirmation failed:', error.message);
            useToastStore.getState().showToast(
                'No se pudo confirmar',
                'El pago no quedó registrado. Si el problema sigue, es que tu rol no tiene permiso de edición en Facturación.',
                'error',
            );
            setConfirmSaving(false); return;
        }
        setConfirmedIds(prev => new Set([...prev, invoiceId]));
        if (data?.[0]) setConfirmed(prev => [{ ...data[0], invoice: inv || null }, ...prev]);

        useStaff.getState().appendAuditLog('CONFIRMAR_PAGO_NO_EFECTIVO', String(invoiceId), {
            correlativo: inv?.correlativo, tipo_pago: inv?.tipo_pago,
            branch_id: inv?.branch_id, has_proof: !!proofUrl,
        });
        useToastStore.getState().showToast('Pago confirmado', inv?.correlativo || '', 'success');

        setConfirmingId(null); setConfirmNotes(''); setConfirmFile(null);
        setConfirmSaving(false);
    };

    const totalPending = useMemo(() => pendingFiltered.reduce((a, r) => a + parseFloat(r.total || 0), 0), [pendingFiltered]);

    const branchFilterOpts = useMemo(() => [
        { value: '', label: 'Todas las sucursales' },
        ...branches.filter(b => SALES_BRANCH_IDS.includes(b.id)).map(b => ({ value: String(b.id), label: b.name })),
    ], [branches]);

    const tipoFilterOpts = useMemo(() => [
        { value: '', label: 'Todos los tipos' },
        ...NON_CASH_TYPES.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
    ], []);

    const CONFIRMED_COLS = [
        { label: 'Tipo Pago', key: 'tipo_pago' },
        { label: 'Correlativo', key: 'correlativo' },
        { label: 'Sucursal', key: 'sucursal' },
        { label: 'Cliente', key: 'cliente' },
        { label: 'Fecha', key: 'fecha' },
        { label: 'Total', key: 'total' },
        { label: 'Confirmado por', key: 'confirmed_by' },
        { label: 'Fecha conf.', key: 'confirmed_at' },
        'Comprobante',
        'Notas',
    ];

    return (
        <div>
            {/* Carril de métricas + píldora en UNA fila (§17.0). Los dos números
                eran texto suelto en una barra propia con su borde inferior: no
                se leían como métrica y la fila no se parecía a la de las otras
                pestañas. El desglose por forma de pago sigue siendo `Badge`,
                que es lo suyo — son etiquetas, no métricas. */}
            <div className="p-5 md:p-6 pb-0 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de pagos no-efectivo">
                        <StatCard
                            icon={CreditCard} label="Pendientes" value={pendingFiltered.length}
                            iconBg={pendingFiltered.length > 0 ? 'bg-chart-1/10' : 'bg-surface-card-hover'}
                            iconCls={pendingFiltered.length > 0 ? 'text-chart-1-text' : 'text-content-3'}
                            valueCls={pendingFiltered.length > 0 ? 'text-chart-1-text' : 'text-content'}
                        />
                        <StatCard
                            icon={CreditCard} label="Total pendiente" value={<Monto v={totalPending} />}
                            iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                            valueCls="text-chart-1-text"
                        />
                        <StatCard
                            icon={CheckCircle2} label="Confirmados" value={confirmed.length}
                            iconBg={confirmed.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                            iconCls={confirmed.length > 0 ? 'text-success' : 'text-content-3'}
                            valueCls={confirmed.length > 0 ? 'text-success' : 'text-content'}
                        />
                    </CarrilCards>
                    {barraFiltros && <div className="flex justify-end min-w-0">{barraFiltros}</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {Object.entries(byTipo).map(([tipo, rows]) => (
                        <Badge key={tipo} variant={TIPO_PAGO_VARIANTE[tipo] || 'neutral'} size="sm">
                            {tipo} {rows.length}
                        </Badge>
                    ))}
                </div>
            </div>

            {loading ? (
                <div className="p-4 md:p-6 space-y-5">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border-2 border-divider overflow-hidden">
                            <div className="h-14 skeleton w-full rounded-none" />
                            <div className="p-4 space-y-2">
                                {Array.from({ length: 4 }).map((_, j) => (
                                    <div key={j} className="flex items-center gap-3 py-2 border-b border-divider">
                                        <div className="h-3 w-32 skeleton rounded-full" />
                                        <div className="h-3 w-20 skeleton rounded-full ml-auto" />
                                        <div className="h-3 w-16 skeleton rounded-full" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : pendingFiltered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-chart-1-text" glowClass="bg-chart-1"
                    title="Sin pagos no-efectivo" subtitle="No hay transacciones pendientes de confirmar en este período." />
            ) : (
                <div className="p-4 md:p-6 space-y-5">
                    {isNoEfectivoFuzzy && searchTerm && (
                        <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                    )}
                    {/* ── Pagos inmediatos ── */}
                    {IMMEDIATE_TIPOS.filter(t => byTipo[t]?.length > 0).map(tipo => (
                        <BloqueFormaPago
                            key={tipo} tipo={tipo}
                            filas={ordenarPendientes(byTipo[tipo] || [])}
                            total={(byTipo[tipo] || []).reduce((a, r) => a + parseFloat(r.total || 0), 0)}
                            pagina={getPendingPage(tipo)} tamano={pendingSize}
                            onPagina={(pg) => setPendingPage(tipo, pg)}
                            onTamano={(sz) => { setPendingSize(sz); setPendingPages({}); }}
                            sortKey={pSortKey} sortDir={pSortDir} onSort={pToggle}
                            canEdit={canEdit} nombreSucursal={getBranch}
                            confirmandoId={confirmingId} setConfirmandoId={setConfirmingId}
                            notas={confirmNotes} setNotas={setConfirmNotes}
                            archivo={confirmFile} setArchivo={setConfirmFile}
                            guardando={confirmSaving} onConfirmar={handleConfirm}
                            textoNotas="Notas del pago — ej: referencia, últimos 4 dígitos, nombre del emisor…"
                            textoArchivo="Comprobante del pago — imagen o PDF"
                        />
                    ))}

                    {/* ── Ventas a Crédito ── */}
                    {CREDIT_TIPOS.filter(t => byTipo[t]?.length > 0).length > 0 && (
                        <>
                            <div className="flex items-center gap-3 pt-2">
                                <div className="flex-1 h-px bg-surface-card-hover" />
                                <span className="text-caption font-black uppercase tracking-[0.15em] text-content-3">Ventas a crédito</span>
                                <div className="flex-1 h-px bg-surface-card-hover" />
                            </div>
                            {CREDIT_TIPOS.filter(t => byTipo[t]?.length > 0).map(tipo => (
                                <BloqueFormaPago
                                    key={tipo} tipo={tipo}
                                    filas={ordenarPendientes(byTipo[tipo] || [])}
                                    total={(byTipo[tipo] || []).reduce((a, r) => a + parseFloat(r.total || 0), 0)}
                                    pagina={getPendingPage(tipo)} tamano={pendingSize}
                                    onPagina={(pg) => setPendingPage(tipo, pg)}
                                    onTamano={(sz) => { setPendingSize(sz); setPendingPages({}); }}
                                    sortKey={pSortKey} sortDir={pSortDir} onSort={pToggle}
                                    canEdit={canEdit} nombreSucursal={getBranch}
                                    confirmandoId={confirmingId} setConfirmandoId={setConfirmingId}
                                    notas={confirmNotes} setNotas={setConfirmNotes}
                                    archivo={confirmFile} setArchivo={setConfirmFile}
                                    guardando={confirmSaving} onConfirmar={handleConfirm}
                                    textoNotas="Notas del crédito — ej: referencia, plazo acordado, responsable…"
                                    textoArchivo="Documento del crédito — imagen o PDF"
                                />
                            ))}
                        </>
                    )}
                </div>
            )}

            {/* Confirmados */}
            {confirmed.length > 0 && (
                <div className="border-t border-divider">
                    <Button variant="secondary" onClick={() => setShowConfirmed(v => !v)}><span className="flex items-center gap-2"><Check size={12} className="text-chart-1-text" strokeWidth={3} />{confirmed.length} confirmado{confirmed.length !== 1 ? 's' : ''}</span>
                        {showConfirmed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</Button>
                    {showConfirmed && (
                        <div>
                            <DataTable
                                columns={[
                                    { key: 'tipo_pago',     label: 'Tipo Pago',     sortable: true },
                                    { key: 'correlativo',   label: 'Correlativo',   sortable: true },
                                    { key: 'sucursal',      label: 'Sucursal',      sortable: true, hideBelow: 'md' },
                                    { key: 'cliente',       label: 'Cliente',       sortable: true, hideBelow: 'lg' },
                                    { key: 'fecha',         label: 'Fecha',         sortable: true },
                                    { key: 'total',         label: 'Total',         sortable: true },
                                    { key: 'confirmed_by',  label: 'Confirmado por', sortable: true },
                                    { key: 'confirmed_at',  label: 'Fecha conf.',   sortable: true },
                                    { key: 'comprobante',   label: 'Comprobante' },
                                    { key: 'notas',         label: 'Notas' },
                                ]}
                                sortKey={cSortKey}
                                sortDir={cSortDir}
                                onSort={cToggle}
                                empty={{ message: 'Sin pagos confirmados' }}
                                minWidth="800px"
                                toolbar={
                                    /* Los dos filtros vivían en un `<div>` propio encima de la
                                       tabla. No van a la píldora —§17 la reserva para lo que filtra
                                       la VISTA, y esto filtra una sub-tabla— sino a `toolbar`, que
                                       es la ranura que `DataTable` tiene justo para eso. El recuento
                                       lo da ahora `TablePagination` con `filteredTotal`. */
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-caption font-bold uppercase text-content-3 tracking-widest shrink-0">Filtrar:</span>
                                        <div className="w-[160px]">
                                            <LiquidSelect value={filterConfirmedTipo} onChange={setFilterConfirmedTipo} options={tipoFilterOpts} placeholder="Tipo pago" compact bare />
                                        </div>
                                        <div className="w-[180px]">
                                            <LiquidSelect value={filterConfirmedBranch} onChange={setFilterConfirmedBranch} options={branchFilterOpts} placeholder="Sucursal" compact bare />
                                        </div>
                                        {(filterConfirmedTipo || filterConfirmedBranch) && (
                                            <Button variant="ghost" icon={X} onClick={() => { setFilterConfirmedTipo(''); setFilterConfirmedBranch(''); }}>Limpiar</Button>
                                        )}
                                    </div>
                                }
                                footer={
                                    <div className="px-5 py-3 flex justify-end">
                                        <TablePagination
                                            page={confirmedPage} totalPages={confirmedTotalPages} onPageChange={setConfirmedPage}
                                            pageSize={confirmedSize} onPageSizeChange={(sz) => { setConfirmedSize(sz); setConfirmedPage(1); }}
                                            total={confirmed.length} filteredTotal={confirmedFiltered.length} unit="confirmados"
                                        />
                                    </div>
                                }
                            >
                                {confirmedPageRows.map((r, ci) => {
                                    const inv = r.invoice;
                                    const tipoPago = r.tipo_pago?.toLowerCase() || '';
                                    const dt = r.confirmed_at ? new Date(r.confirmed_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                                    return (
                                        <DataRow key={r.id} index={ci}>
                                            <DataCell>
                                                <Badge variant={TIPO_PAGO_VARIANTE[tipoPago] || 'neutral'} size="sm">{r.tipo_pago}</Badge>
                                            </DataCell>
                                            <DataCell>
                                                <div className="font-mono text-body-sm text-content-2">{inv?.correlativo || '—'}</div>
                                            </DataCell>
                                            <DataCell hideBelow="md">{getBranch(r.branch_id)}</DataCell>
                                            <DataCell hideBelow="lg" className="max-w-[140px] truncate">{inv?.cliente || '—'}</DataCell>
                                            <DataCell className="whitespace-nowrap">{inv?.fecha || '—'}</DataCell>
                                            <DataCell className="font-bold whitespace-nowrap">{<Monto v={inv?.total} />}</DataCell>
                                            <DataCell>
                                                <div className="flex items-center gap-2">
                                                    {r.confirmed_by_photo ? (
                                                        <img src={r.confirmed_by_photo} alt="" className="w-7 h-7 rounded-full object-cover border border-divider shrink-0" />
                                                    ) : (
                                                        <div className="w-7 h-7 rounded-full bg-surface-card-hover flex items-center justify-center text-content-2 text-caption font-bold shrink-0">
                                                            {r.confirmed_by?.charAt(0)?.toUpperCase() || '?'}
                                                        </div>
                                                    )}
                                                    <span className="text-body-sm font-semibold text-content-2 whitespace-nowrap">{r.confirmed_by || '—'}</span>
                                                </div>
                                            </DataCell>
                                            <DataCell className="whitespace-nowrap">{dt}</DataCell>
                                            <DataCell>
                                                {r.proof_url ? (
                                                    <Button variant="ghost" icon={Paperclip} onClick={() => openStoredFile(r.proof_url)}>Ver <ExternalLink size={10} /></Button>
                                                ) : <span className="text-body-sm text-content-3 italic">Sin comprobante</span>}
                                            </DataCell>
                                            <DataCell className="max-w-[180px]">{r.notes || <span className="italic text-content-3">—</span>}</DataCell>
                                        </DataRow>
                                    );
                                })}
                            </DataTable>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Main View ────────────────────────────────────────────────────────────────
// ─── Tab: Observaciones ───────────────────────────────────────────────────────
//
// Las otras cuatro pestañas miran UN problema conocido cada una. Esta mira
// cualquier cosa que no cuadre, y por eso su catálogo vive del lado del servidor
// (RPC `get_invoice_observations`, migración 20260731172746) en vez de estar
// repartido en filtros de PostgREST.
//
// El caso que la originó: 24 facturas con `recibido_mh = 'undefined'` figuraban
// como CONFIRMADAS por Hacienda, porque el filtro preguntaba `IS NOT NULL` en
// vez de exigir un sello de 40 caracteres. No las vio nadie hasta que el libro
// IVA del ERP no cuadró por $282.58.

// Etiquetas cortas a propósito: la tarjeta de `StatCard` corta alrededor de los
// 14 caracteres, y una etiqueta truncada ("Sin código ge…") no dice nada.
// `SIN_SELLO_VENCIDO` no está y no es un olvido: una factura sin sello es de
// Pendiente MH, que es la cola con la cuenta regresiva del plazo fiscal. El RPC
// dejó de emitirlo (migración de este mismo commit) — ver la nota de la frontera
// en `fetchPendingMhInvoices`.
const OBSERVACIONES = {
    SELLO_INVALIDO:        { label: 'Sello inválido',  variant: 'danger'  },
    SIN_CODIGO_VENCIDO:    { label: 'Sin código',      variant: 'warning' },
    ESTADO_DESCONOCIDO:    { label: 'Estado inválido', variant: 'danger'  },
    TIPO_DOC_DESCONOCIDO:  { label: 'Tipo inválido',   variant: 'warning' },
    SIN_CORRELATIVO:       { label: 'Sin correlativo', variant: 'warning' },
    TOTAL_INVALIDO:        { label: 'Total inválido',  variant: 'danger'  },
    SUMA_NO_CUADRA:        { label: 'No cuadra',       variant: 'warning' },
};

// Un código que este mapa no conoce NO se oculta: se muestra crudo, en warning.
// Es la misma idea que los catch-alls del RPC — si el servidor empieza a
// reportar una clase nueva, tiene que llegar a la pantalla aunque nadie haya
// tocado el frontend todavía. Ocultarla sería repetir el defecto original.
const metaObs = (code) => OBSERVACIONES[code] || { label: code, variant: 'warning' };

// Rango completo a propósito: las observaciones son raras (~190 sobre 338 mil
// facturas) y lo que hace falta es verlas TODAS, no las del mes en curso.
const OBS_DESDE = '2000-01-01';
const OBS_HASTA = '2099-12-31';

function TabObservaciones({ branches, filterBranch, searchTerm, currentUser, canEdit, barraFiltros, obsCode, onConteos }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        for (const e of employees) if (e.name) m[e.name] = e.photo || e.photo_url || null;
        return m;
    }, [employees]);
    const [rows, setRows]       = useState([]);
    const [resoluciones, setResoluciones] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [avisoRes, setAvisoRes] = useState(null);
    const [collapsedBranches, setCollapsedBranches] = useState({});
    const [copiedId, setCopiedId]   = useState(null);
    const [solvingId, setSolvingId] = useState(null);
    const [comment, setComment]     = useState('');
    const [saving, setSaving]       = useState(false);
    const [showResolved, setShowResolved] = useState(false);
    const { visitedIds, toggleVisited, clearVisited } = useVisitados();
    const getBranch = useCallback((id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`, [branches]);

    // El id del ERP es lo que se pega en el sistema para ir a buscar el
    // documento — el mismo dato, el mismo gesto y la MISMA marca que en
    // Pendiente MH. Nació sin la marca, con el argumento de que acá se puede
    // solventar y por tanto el tachado provisorio sobraba; el argumento estaba
    // mal (pedido del usuario, 2026-07-31): solventar es "esto ya se revisó y
    // queda constancia", la marca es "de éste ya me llevé el id", que es lo que
    // se necesita mientras se recorre la lista y todavía no se sabe si hay algo
    // que corregir. Segundo clic la quita.
    const copyErpId = (erpId) => {
        if (!erpId) return;
        if (!visitedIds.has(String(erpId))) {
            navigator.clipboard.writeText(String(erpId));
            setCopiedId(erpId);
            setTimeout(() => setCopiedId(null), 1500);
        }
        toggleVisited(erpId);
    };

    const daysAgoLabel = (fechaStr) => {
        const diff = diasDesde(fechaStr);
        if (diff === 0) return 'hoy';
        if (diff === 1) return 'ayer';
        return `hace ${diff}d`;
    };

    const load = useCallback(async () => {
        setLoading(true);
        const [{ data, error: err }, { data: resData, error: resErr }] = await Promise.all([
            fetchInvoiceObservations(OBS_DESDE, OBS_HASTA, filterBranch),
            fetchObservationResolutions('invoice_id, comment, resolved_by, resolved_at'),
        ]);
        // Un RPC que falla NO puede quedar como "no hay observaciones": ese
        // silencio es exactamente el defecto que esta pestaña vino a cerrar.
        if (err) { setError(mensajeAmigable(err)); setRows([]); }
        else     { setError(null);        setRows(data || []); }
        // Si las resoluciones fallan se muestra TODO como pendiente y se avisa.
        // Falla hacia mostrar de más: una fila ya solventada que reaparece se
        // reconoce; una anomalía escondida por un error de red, no.
        if (resErr) {
            console.error('load (observaciones): fetch sales_observation_resolutions failed:', resErr.message);
            setAvisoRes(resErr.message); setResoluciones([]);
        } else { setAvisoRes(null); setResoluciones(resData || []); }
        setLoading(false);
    }, [filterBranch]);

    // Sin sondeo, a diferencia de Anuladas y Pendiente MH: esto es una superficie
    // de revisión, no una cola en vivo, y el RPC recorre la tabla entera.
    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    // Una factura puede tener varias resoluciones (la tabla es append-only);
    // manda la más reciente, y el orden del select ya viene por resolved_at desc.
    const resueltasMap = useMemo(() => {
        const m = new Map();
        for (const x of resoluciones) if (!m.has(x.invoice_id)) m.set(x.invoice_id, x);
        return m;
    }, [resoluciones]);

    const pendientes = useMemo(() => rows.filter(r => !resueltasMap.has(r.id)), [rows, resueltasMap]);

    const resueltas = useMemo(() =>
        rows.filter(r => resueltasMap.has(r.id))
            .map(r => ({ ...r, resolution: resueltasMap.get(r.id) }))
            .sort((a, b) => String(b.resolution?.resolved_at || '').localeCompare(String(a.resolution?.resolved_at || ''))),
        [rows, resueltasMap]);

    const conteos = useMemo(() => {
        const m = new Map();
        for (const r of pendientes) for (const o of (r.observaciones || [])) m.set(o, (m.get(o) || 0) + 1);
        return [...m.entries()].sort((a, b) => b[1] - a[1]);
    }, [pendientes]);

    // Los conteos suben a la píldora, que es quien dibuja la ranura. `conteos`
    // es un memo estable, así que el efecto corre sólo cuando cambian de verdad.
    useEffect(() => { onConteos?.(conteos); }, [conteos, onConteos]);

    // La edad de la observación más vieja. Es la métrica que dice si esto se
    // está atendiendo, y sin ella hay que bajar hasta el último grupo para
    // enterarse: la más vieja del portal tenía 266 días.
    const diasMasVieja = useMemo(() =>
        pendientes.reduce((max, r) => Math.max(max, diasDesde(r.fecha)), 0),
        [pendientes]);

    const activeVisitedCount = useMemo(() =>
        pendientes.filter(r => r.erp_invoice_id && visitedIds.has(String(r.erp_invoice_id))).length,
        [pendientes, visitedIds]);

    const filtered = useMemo(() => {
        const porCodigo = obsCode
            ? pendientes.filter(r => (r.observaciones || []).includes(obsCode))
            : pendientes;
        if (!searchTerm) return porCodigo;
        const { results } = smartFilter(searchTerm, porCodigo,
            r => [r.correlativo, r.cliente, String(r.erp_invoice_id || ''), ...(r.observaciones || [])]);
        return results;
    }, [pendientes, searchTerm, obsCode]);

    // La resolución NO toca `sales_invoices`: igual que en Pendiente MH, el
    // portal registra que alguien revisó el caso; el dato de la factura lo
    // corrige el ERP y lo trae el sync.
    const handleSolve = async (invoiceId) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const inv = rows.find(r => r.id === invoiceId);
        const { error: err } = await insertObservationResolution({
            invoice_id: invoiceId, comment: comment.trim() || null, resolved_by: resolvedBy,
        });
        if (err) { avisarFalloAlSolventar(err, 'handleSolve (observaciones)'); setSaving(false); return; }
        useStaff.getState().appendAuditLog('SOLVENTAR_OBSERVACION', String(invoiceId), {
            correlativo: inv?.correlativo, observaciones: inv?.observaciones || [],
            comment: comment.trim() || null, resolved_by: resolvedBy,
        });
        useToastStore.getState().showToast('Observación solventada', inv?.correlativo || '', 'success');
        setResoluciones(prev => [{
            invoice_id: invoiceId, comment: comment.trim() || null,
            resolved_by: resolvedBy, resolved_at: new Date().toISOString(),
        }, ...prev]);
        setSolvingId(null); setComment(''); setSaving(false);
    };

    // Mismo agrupado que Pendiente MH: sucursal → fecha → documentos. El RPC ya
    // devuelve ordenado por fecha desc, así que el orden de inserción alcanza.
    // ⚠️ El orden de las secciones sale del ID, y hoy acierta de CASUALIDAD.
    // `g` se indexa por `branch_id`, o sea claves que parecen enteros, y
    // `Object.entries()` sobre ésas las devuelve ordenadas NUMÉRICAMENTE — no
    // por inserción (está en la especificación del lenguaje y no avisa; fue el
    // defecto de la Consulta de Inventario del tablero, 2026-08-07). Acá los
    // ids ascendentes —2, 4, 25, 27, 28, 29, 30— dan justo La Popular, Salud
    // 1…5 y Bodega, que es el orden del negocio. Una sala nueva con un id que
    // caiga en el medio lo rompe sin que nada falle.
    // La fecha de adentro NO tiene el problema: '2026-08-07' no es un entero,
    // así que ahí sí manda el orden de inserción.
    const grouped = useMemo(() => {
        const g = {};
        for (const r of filtered) {
            if (!g[r.branch_id]) g[r.branch_id] = {};
            if (!g[r.branch_id][r.fecha]) g[r.branch_id][r.fecha] = [];
            g[r.branch_id][r.fecha].push(r);
        }
        return g;
    }, [filtered]);

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Tarjetas FIJAS, tres a lo sumo (§17.0): el carril lo dibuja la
                    vista, no el dato. El desglose por código —que era una tarjeta
                    por clase de anomalía, con techo abierto— es ahora la ranura
                    "Observación" de la píldora, con su conteo por opción. */}
                <CarrilCards className="flex-1" ariaLabel="Resumen de observaciones">
                    <StatCard
                        icon={AlertTriangle} label="Facturas" value={pendientes.length}
                        sub={obsCode ? `${filtered.length} en el filtro` : undefined}
                        iconBg={pendientes.length > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={pendientes.length > 0 ? 'text-danger' : 'text-content-3'}
                        valueCls={pendientes.length > 0 ? 'text-danger' : 'text-content'}
                    />
                    <StatCard
                        icon={History} label="Más antigua"
                        value={pendientes.length > 0 ? `${diasMasVieja}d` : '—'}
                        sub="Sin solventar"
                    />
                    {/* Aparece sólo con algo marcado, igual que en Pendiente MH:
                        es la única forma de soltar la marca de todas a la vez. */}
                    {activeVisitedCount > 0 && (
                        <StatCard
                            icon={Check} label="Marcados" value={activeVisitedCount}
                            sub="Limpiar" onClick={clearVisited} active tono="warning"
                            iconBg="bg-warning/10" iconCls="text-warning-text"
                        />
                    )}
                </CarrilCards>
                {barraFiltros}
            </div>

            {error && (
                <Notice variant="danger" icon={AlertTriangle}>
                    No se pudieron cargar las observaciones: {error}
                </Notice>
            )}

            {avisoRes && (
                <Notice variant="warning" icon={AlertTriangle}>
                    No se pudo leer qué observaciones ya fueron solventadas: {avisoRes}. La lista
                    de abajo las incluye a todas.
                </Notice>
            )}

            {loading ? (
                <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border border-divider bg-surface-card shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5 bg-surface-card-hover/60">
                                <div className="h-3 w-28 skeleton rounded-full" />
                                <div className="h-3 w-12 skeleton rounded-full" />
                            </div>
                            <div className="px-4 py-3 space-y-2">
                                {Array.from({ length: 3 }).map((_, j) => (
                                    <div key={j} className="h-7 w-full skeleton rounded-xl" />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : !error && filtered.length === 0 ? (
                // Vacío por FILTRO no es lo mismo que vacío de verdad: con la
                // ranura puesta hay pendientes, sólo que ninguna de esa clase.
                <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                    title={obsCode && pendientes.length > 0 ? 'Sin resultados' : 'Sin observaciones'}
                    subtitle={obsCode && pendientes.length > 0
                        ? `Ninguna de las ${pendientes.length} pendientes cae en "${metaObs(obsCode).label}".`
                        : resueltas.length > 0 && !searchTerm
                            ? 'Todas las observaciones abiertas fueron solventadas.'
                            : 'Ninguna factura tiene datos fuera de lo esperado.'} />
            ) : !error && (
                <div className="space-y-3">
                    {/* Misma anatomía que Pendiente MH: sucursal colapsable → fecha →
                        documentos. Lo que cambia es la hoja: acá cada documento lleva
                        SUS observaciones, que es el dato de la pestaña. */}
                    {Object.entries(grouped).map(([branchId, byFecha]) => {
                        const docs = Object.values(byFecha).flat();
                        const branchHasCCF = docs.some(r => r.tipo_documento === 'CCF');
                        const isCollapsed  = !!collapsedBranches[branchId];
                        return (
                            <div key={branchId} className="rounded-2xl border border-divider bg-surface-card shadow-sm">
                                <ListRow
                                    density="sm" icon={Building2} iconBoxClass="bg-transparent border-transparent"
                                    iconClass={branchHasCCF ? 'text-danger' : 'text-content-3'}
                                    tone={branchHasCCF ? 'danger' : null}
                                    title={<span className="flex items-center gap-2">{getBranch(Number(branchId))}{branchHasCCF && <Badge variant="danger" size="sm">CCF</Badge>}</span>}
                                    onClick={() => setCollapsedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                    aria-expanded={!isCollapsed}
                                    className={`rounded-none border-x-0 border-t-0 ${isCollapsed ? 'border-b-0' : ''}`}
                                    trailing={<>
                                        <span className="text-caption font-black text-content-3">{docs.length} doc</span>
                                        <ChevronDown size={13} className={`text-content-3 transition-transform duration-[var(--dur-base)] ${isCollapsed ? '-rotate-90' : ''}`} />
                                    </>}
                                />

                                {!isCollapsed && <div className="divide-y divide-divider">
                                    {Object.entries(byFecha).map(([fecha, fechaRows]) => {
                                        const hasCCF = fechaRows.some(r => r.tipo_documento === 'CCF');
                                        return (
                                            <div key={fecha} className="px-4 py-3">
                                                <div className="flex items-center gap-2 mb-2.5">
                                                    <span className={`text-label font-black ${hasCCF ? 'text-danger-text' : 'text-content-2'}`}>{fecha}</span>
                                                    <Badge variant={hasCCF ? 'danger' : 'neutral'} size="sm">{daysAgoLabel(fecha)}</Badge>
                                                </div>

                                                <div className="space-y-1.5">
                                                    {fechaRows.map(r => {
                                                        const isCCF     = r.tipo_documento === 'CCF';
                                                        const isSolving = solvingId === r.id;
                                                        const isCopied  = copiedId === r.erp_invoice_id;
                                                        const isVisited = visitedIds.has(String(r.erp_invoice_id));
                                                        return (
                                                            // La fila entera se apaga, no sólo el chip: es lo que
                                                            // deja ver de un vistazo cuánto queda por recorrer.
                                                            // Mientras se solventa vuelve a opacidad plena — es la
                                                            // fila con la que se está trabajando.
                                                            <div key={r.id} className={`flex items-start gap-3 flex-wrap rounded-xl border border-divider bg-surface-card-hover/40 px-3 py-2 transition-opacity duration-[var(--dur-slow)] ${isVisited && !isSolving ? 'opacity-40' : ''}`}>
                                                                {/* El MISMO control de Pendiente MH: copiar el id del ERP │
                                                                    tipo de documento │ solventar. Acá el segmento del medio
                                                                    lleva el tipo, que antes era un `Badge` suelto. */}
                                                                <ChipDoc
                                                                    estado={isVisited ? 'visitado' : isCCF ? 'ccf' : 'normal'}
                                                                    copiado={isCopied}
                                                                    resuelto={isSolving}
                                                                    onCopiar={() => copyErpId(r.erp_invoice_id)}
                                                                    etiquetaCopia={r.erp_invoice_id ? `#${r.erp_invoice_id}` : '—'}
                                                                    nombreResolver="esta observación"
                                                                    onResolver={canEdit ? () => { isSolving ? (setSolvingId(null), setComment('')) : (setSolvingId(r.id), setComment('')); } : undefined}
                                                                >
                                                                    <span className="text-micro font-black uppercase select-none">{r.tipo_documento || '—'}</span>
                                                                </ChipDoc>
                                                                <div className="flex flex-wrap gap-1 shrink-0">
                                                                    {(r.observaciones || []).map(code => {
                                                                        const meta = metaObs(code);
                                                                        return <Badge key={code} variant={meta.variant} size="sm">{meta.label}</Badge>;
                                                                    })}
                                                                </div>
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <span className={`font-mono text-body-sm font-black ${isCCF ? 'text-danger-text' : 'text-content'}`}>{r.correlativo || '—'}</span>
                                                                        {r.cliente && <span className="text-label text-content-3 truncate">· {r.cliente}</span>}
                                                                    </div>
                                                                    {/* El valor crudo del sello cuando NO es un sello: es el
                                                                        dato que delata el problema, así que se muestra. */}
                                                                    {r.recibido_mh && r.recibido_mh.length !== 40 && (
                                                                        <div className="font-mono text-micro text-danger-text mt-0.5">sello: &ldquo;{r.recibido_mh}&rdquo;</div>
                                                                    )}
                                                                </div>
                                                                <span className="text-body-sm font-black text-content-2 shrink-0 ml-auto">{<Monto v={r.total} />}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Formulario de solventar — debajo del grupo de la fecha,
                                                    igual que en Pendiente MH. */}
                                                {fechaRows.some(r => r.id === solvingId) && (() => {
                                                    const r     = fechaRows.find(x => x.id === solvingId);
                                                    const isCCF = r.tipo_documento === 'CCF';
                                                    return (
                                                        <div className="mt-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                                                            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                                                                <span className={`font-mono text-label font-black ${isCCF ? 'text-danger-text' : 'text-content-2'}`}>{r.correlativo}</span>
                                                                {(r.observaciones || []).map(code => {
                                                                    const meta = metaObs(code);
                                                                    return <Badge key={code} variant={meta.variant} size="sm">{meta.label}</Badge>;
                                                                })}
                                                                <span className="ml-auto text-body-sm font-black text-content-2">{<Monto v={r.total} />}</span>
                                                            </div>
                                                            <div className="flex items-start gap-3">
                                                                <PortalTextarea
                                                                    textareaClassName="flex-1"
                                                                    rows={2}
                                                                    autoFocus
                                                                    placeholder="Qué se revisó o corrigió (opcional)…"
                                                                    value={comment}
                                                                    onChange={e => setComment(e.target.value)}
                                                                />
                                                                <div className="flex flex-col gap-1.5 shrink-0">
                                                                    <Button tone="success" disabled={saving} onClick={() => handleSolve(r.id)}>{saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar</Button>
                                                                    <Button variant="secondary" icon={X} onClick={() => { setSolvingId(null); setComment(''); }}>Cancelar</Button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    })}
                                </div>}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Historial de solventadas. Lo que se solventa sale de la lista de
                arriba, así que sin esta sección desaparecería sin dejar rastro
                visible — y la observación sigue existiendo en la factura. */}
            {!loading && resueltas.length > 0 && (
                <div className="rounded-2xl border border-divider overflow-hidden bg-surface-card shadow-sm">
                    <ListRow
                        icon={Check} iconClass="text-success" iconBoxClass="bg-success/10 border-success/20"
                        title={`${resueltas.length} solventada${resueltas.length !== 1 ? 's' : ''}`}
                        subtitle="Observaciones ya revisadas"
                        onClick={() => setShowResolved(v => !v)}
                        aria-expanded={showResolved}
                        className="rounded-none border-x-0 border-t-0"
                        trailing={<ChevronDown size={16} className={`text-content-3 transition-transform duration-[var(--dur-slow)] ${showResolved ? 'rotate-180' : ''}`} />}
                    />
                    {showResolved && (
                        <div className="border-t border-divider">
                            {resueltas.map((r, i) => {
                                const resolvedBy = r.resolution?.resolved_by || null;
                                const photo = resolvedBy ? (empPhotoMap[resolvedBy] || null) : null;
                                const initials = (resolvedBy || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
                                return (
                                    <div key={r.id} className={`flex items-start gap-3 px-5 py-4 hover:bg-surface-card-hover/40 transition-colors ${i > 0 ? 'border-t border-divider' : ''}`}>
                                        {photo
                                            ? <img src={photo} alt={resolvedBy} className="w-8 h-8 rounded-full object-cover border border-divider shrink-0 mt-0.5" />
                                            : <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center shrink-0 mt-0.5">
                                                <span className="text-micro font-black text-success-text">{initials}</span>
                                              </div>
                                        }
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap mb-1">
                                                <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento || '—'}</Badge>
                                                {r.erp_invoice_id && <span className="font-mono text-body-sm font-black text-content">#{r.erp_invoice_id}</span>}
                                                <span className="font-mono text-label text-content-3">{r.correlativo}</span>
                                                <span className="text-label text-content-3">{getBranch(r.branch_id)}</span>
                                                {r.total != null && <span className="text-body-sm font-bold text-content-2 ml-auto">{<Monto v={r.total} />}</span>}
                                            </div>
                                            <div className="flex flex-wrap gap-1 mb-1">
                                                {(r.observaciones || []).map(code => {
                                                    const meta = metaObs(code);
                                                    return <Badge key={code} variant={meta.variant} size="sm">{meta.label}</Badge>;
                                                })}
                                            </div>
                                            {r.resolution?.comment && <p className="text-body-sm text-content-3 mb-1">&ldquo;{r.resolution.comment}&rdquo;</p>}
                                            <p className="text-label text-content-3">
                                                {resolvedBy
                                                    ? <span className="font-semibold text-content-2">{resolvedBy}</span>
                                                    : 'Solventada'}
                                                {r.resolution?.resolved_at && <> · {new Date(r.resolution.resolved_at).toLocaleString('es-SV', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</>}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Observaciones va PEGADA a Pendiente MH: las dos miran el mismo documento en la
// misma ventana de tiempo (una el sello, la otra cualquier otra anomalía) y en la
// práctica se saltan entre sí. Saltos y No Efectivo son otro trabajo.
const TABS = [
    { key: 'anuladas',      label: 'Anuladas'      },
    { key: 'pendiente_mh',  label: 'Pendiente MH'  },
    { key: 'observaciones', label: 'Observaciones' },
    { key: 'saltos',        label: 'Saltos'        },
    { key: 'no_efectivo',   label: 'No Efectivo'   },
];

export default function FacturacionView() {
    const branches = useStaff((state) => state.branches);
    const { user: currentUser, hasPermission, getScope } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();

    // Las pestañas se muestran por `facturacion_tab_*`, pero SOLVENTAR es
    // escritura y va por el módulo padre: es el mismo `can_edit` que exigen las
    // policies de INSERT de las tablas de resoluciones, así que la UI y el RLS
    // dicen lo mismo en vez de ofrecer un botón que el servidor va a rechazar.
    const canEdit = hasPermission('facturacion', 'can_edit');

    // Sondeo automático: decisión de la vista, no de cada pestaña. Ver el
    // descriptor `pausa` de la píldora, más abajo.
    const [paused, setPaused] = useState(false);

    // El mes de No Efectivo vivía como un `LiquidSelect` suelto dentro de la
    // pestaña — un filtro fuera de la píldora, que es justo lo que §17 prohíbe.
    // Sube acá para poder ocupar su ranura; el orden de §17 lo pone después de
    // sucursal (ámbito → tiempo).
    const mesPorDefecto = useMemo(() => {
        const now = svNow();
        const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
        const last = new Date(y, now.getMonth() + 1, 0).getDate();
        return `${y}-${m}-01|${y}-${m}-${last}`;
    }, []);
    const [selectedMonth, setSelectedMonth] = useState(mesPorDefecto);
    const monthOpts = useMemo(() => monthOptions(), []);

    // Pestañas filtradas según permisos
    const VALID_TABS = new Set(['anuladas', 'pendiente_mh', 'saltos', 'no_efectivo', 'observaciones']);
    const allowedTabs = TABS.filter(t => hasPermission(`facturacion_tab_${t.key}`));
    const defaultTab  = allowedTabs[0]?.key ?? 'anuladas';
    const rawTab      = searchParams.get('tab');
    const activeTab   = VALID_TABS.has(rawTab) && allowedTabs.some(t => t.key === rawTab) ? rawTab : defaultTab;
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    // Montar al VISITAR, no al entrar. `hidden` esconde pero no desmonta, y las
    // cinco pestañas cargan sola al montarse (el `paused` que reciben apaga el
    // sondeo de 60 s, no la carga inicial). O sea que abrir «Anuladas» traía
    // también el backlog de Pendiente MH, No Efectivo, Saltos y Observaciones:
    // medido, 6 lecturas de `sales_invoices` —la tabla de 548K filas, paginada
    // con fetchAllRows— por 231 kB, más `get_invoice_observations`, que con
    // 2.9 s era la llamada más lenta de la vista sin estar a la vista.
    // Se quedan montadas después de visitarlas: volver no re-pide ni pierde el
    // filtro, que es lo que el `hidden` compraba.
    const [visitadas, setVisitadas] = useState(() => new Set([activeTab]));
    if (!visitadas.has(activeTab)) setVisitadas(new Set(visitadas).add(activeTab));

    const [filterBranch, setFilterBranch] = useState(
        getScope('facturacion') === 'BRANCH' ? String(currentUser?.branchId || '') : ''
    );
    // El desglose por código de Observaciones vive acá arriba porque es una
    // RANURA de la píldora (§17.0): la pestaña reporta sus conteos y el filtro
    // se elige donde se eligen todos los filtros de la vista. Como tarjetas en
    // el carril eran N métricas para una sola pregunta, y encima no filtraban.
    const [obsCode, setObsCode] = useState('');
    const [obsConteos, setObsConteos] = useState([]);
    const [rawSearch, setRawSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(rawSearch), 350);
        return () => clearTimeout(t);
    }, [rawSearch]);
    const salesBranches = useMemo(
        () => branches.filter(b => SALES_BRANCH_IDS.includes(b.id)),
        [branches]
    );

    const branchOptions = useMemo(() =>
        salesBranches.map(b => ({ value: String(b.id), label: b.name })),
        [salesBranches]
    );


    // Contrato estándar de todo buscador toggleable (DESIGN.md §24): Escape
    // cierra Y limpia; click afuera cierra SOLO si está vacío.

    const hasSearch = activeTab !== 'saltos';

    const searchPlaceholder = {
        anuladas:      'Buscar correlativo o cliente...',
        pendiente_mh:  'Buscar correlativo o cliente...',
        no_efectivo:   'Buscar correlativo, cliente o método...',
        observaciones: 'Buscar correlativo, cliente u observación...',
    }[activeTab] || 'Buscar...';

    // D3.9 (2026-07-27): barra reescrita a mano → canónico. Los tabs pasan por la
    // prop `tabs` (y de paso ganan el dropdown de móvil, que esta vista no tenía:
    // con 4 tabs de label largo la fila competía por ancho).
    //
    // §17: filtros y acciones viven en el CUERPO; el header queda con pestañas y
    // buscador. El enlace a Admin Facturas sigue siendo un `<a>` de verdad
    // —`as: 'a'`— para que se pueda abrir en otra pestaña y un lector de pantalla
    // lo anuncie como enlace y no como botón.
    const filtersContent = (
        <ViewTabBar
            tabs={allowedTabs.map(t => ({ key: t.key, label: t.label }))}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showSearch={hasSearch}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
        />
    );

    // Pausar la actualización automática es de la VISTA, no de una pestaña: las
    // dos que sondean comparten la decisión, y como interruptor su sitio es la
    // píldora (§17, campo `activo` → `aria-pressed` y encendido en el clúster
    // táctil). Antes era un `<Button>` suelto dentro del encabezado de cada
    // pestaña, o sea el mismo control escrito dos veces y en un sitio donde §17
    // no pone controles de vista.
    const puedePausar = activeTab === 'anuladas' || activeTab === 'pendiente_mh';
    const accionesFacturacion = puedePausar ? [{
        key: 'pausa',
        icon: paused ? Play : Pause,
        label: paused ? 'Reanudar' : 'Pausar',
        title: paused ? 'Reanudar actualización automática' : 'Pausar actualización automática',
        activo: paused,
        tone: paused ? 'warning' : undefined,
        onClick: () => setPaused(p => !p),
    }] : [];

    // La píldora se dibuja SIEMPRE: quien tiene alcance de una sola sucursal no
    // ve la ranura de sucursal, pero sí la acción. Antes la condición envolvía la
    // barra entera, así que al mover la acción acá se le habría desaparecido a
    // todo el personal de sucursal.
    const puedeElegirSucursal = getScope('facturacion') !== 'BRANCH';
    const filtrosCuerpo = (
        <FilterBar
            onClear={() => { setFilterBranch(''); setSelectedMonth(mesPorDefecto); setObsCode(''); }}
            activeCount={[
                filterBranch,
                activeTab === 'no_efectivo' && selectedMonth !== mesPorDefecto,
                activeTab === 'observaciones' && !!obsCode,
            ].filter(Boolean).length}
            acciones={accionesFacturacion}>
            {puedeElegirSucursal && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFilterBranch(val || '')} options={branchOptions} />
                </FilterBar.Section>
            )}
            {activeTab === 'no_efectivo' && (
                <FilterBar.Section active={selectedMonth !== mesPorDefecto}
                    onClear={() => setSelectedMonth(mesPorDefecto)} label="período">
                    <LiquidSelect value={selectedMonth} onChange={setSelectedMonth}
                        options={monthOpts} placeholder="Mes" compact bare />
                </FilterBar.Section>
            )}
            {/* El conteo va DENTRO de la opción, como en MIN·MAX: "23 Sello
                inválido" pesa distinto que "1 Sin correlativo", y es el dato por
                el que se elige. `umbral={0}` fuerza el select siempre — con el
                umbral por defecto la forma del control cambiaría según cuántas
                clases de anomalía haya ese día, que es justo lo que se saca. */}
            {activeTab === 'observaciones' && obsConteos.length > 0 && (
                <FilterBar.Section active={!!obsCode}
                    onClear={() => setObsCode('')} label="observación">
                    <FilterBar.Opciones
                        icon={AlertTriangle} label="Observación" placeholder="Observación"
                        ancho="180px" umbral={0}
                        value={obsCode} onChange={setObsCode}
                        options={obsConteos.map(([code, n]) => ({
                            value: code, label: `${n} ${metaObs(code).label}`,
                        }))}
                    />
                </FilterBar.Section>
            )}
        </FilterBar>
    );

    return (
        <GlassViewLayout
            icon={FileText}
            title="Facturación"
            liveIndicator={activeTab === 'anuladas' || activeTab === 'pendiente_mh'}
            filtersContent={filtersContent}
            transparentBody={true}
        >
            {/* La píldora va en la MISMA fila que el carril de tarjetas, a la
                derecha (§17 + §17.0: las tres piezas se reparten el ancho entre
                sí). Antes ocupaba un renglón entero para sí sola encima de la
                tarjeta de contenido — el mismo defecto que se corrigió en
                Personal el 2026-07-30.

                El nodo se construye UNA vez acá y se le entrega a la pestaña
                activa, así que sigue habiendo una sola `FilterBar` montada por
                vista aunque las cuatro pestañas estén en el DOM (las inactivas
                van con `hidden` para no perder su estado). */}
            <div data-surface="card" className=" shadow-[var(--shadow-glass-sm)] overflow-hidden">
                {visitadas.has('anuladas') && (
                    <div className={activeTab === 'anuladas' ? '' : 'hidden'}>
                        <TabAnuladas canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch} currentUser={currentUser}
                            paused={paused} barraFiltros={activeTab === 'anuladas' ? filtrosCuerpo : null} />
                    </div>
                )}
                {visitadas.has('pendiente_mh') && (
                    <div className={activeTab === 'pendiente_mh' ? '' : 'hidden'}>
                        <TabPendienteMH canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch} currentUser={currentUser}
                            paused={paused} barraFiltros={activeTab === 'pendiente_mh' ? filtrosCuerpo : null} />
                    </div>
                )}
                {visitadas.has('saltos') && (
                    <div className={activeTab === 'saltos' ? '' : 'hidden'}>
                        <TabSaltos canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} currentUser={currentUser}
                            barraFiltros={activeTab === 'saltos' ? filtrosCuerpo : null} />
                    </div>
                )}
                {visitadas.has('no_efectivo') && (
                    <div className={activeTab === 'no_efectivo' ? '' : 'hidden'}>
                        <TabNoEfectivo canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch} currentUser={currentUser}
                            barraFiltros={activeTab === 'no_efectivo' ? filtrosCuerpo : null} selectedMonth={selectedMonth} />
                    </div>
                )}
                {visitadas.has('observaciones') && (
                    <div className={activeTab === 'observaciones' ? '' : 'hidden'}>
                        <TabObservaciones canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch}
                            currentUser={currentUser} obsCode={obsCode} onConteos={setObsConteos}
                            barraFiltros={activeTab === 'observaciones' ? filtrosCuerpo : null} />
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
}
