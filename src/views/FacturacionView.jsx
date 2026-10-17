import React, { useState, useEffect, useMemo, useCallback, useRef, memo } from 'react';
import { useBusqueda } from '@nucleo/hooks/useBusqueda';
import { useVisitados } from '@nucleo/hooks/useVisitados';
import AvatarConEstado from '../components/common/AvatarConEstado';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import ViewTabBar from '../components/common/ViewTabBar';
import Badge from '../components/common/Badge';
import { useSearchParams } from 'react-router-dom';
import {
    FileText, AlertTriangle, Clock, CreditCard, Building2,
    Loader2, Search, X, Check, History,
    ChevronDown, CheckCircle2, Paperclip, ExternalLink, Copy, Info,
    ShieldCheck, Ban, Hash, ArrowRight
} from 'lucide-react';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useAuth } from '@nucleo/context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import { EmptyState } from '../components/common/StateViews';
import { tokenMatch, smartFilter } from '@nucleo/utils/searchUtils';
import LiquidSelect from '../components/common/LiquidSelect';
import FilterBar from '../components/common/FilterBar';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import ListRow from '../components/common/ListRow';
import { DataTable, DataRow, DataCell, useExpandStyle } from '../components/common/DataTable';
import ExpedienteMovil from '../components/common/ExpedienteMovil';
import { useExpedienteMovil } from '../components/common/usarExpediente';
import TablePagination from '../components/common/TablePagination';
import { openStoredFile, subirArchivo } from '@nucleo/utils/storageFiles';
import { signPhotosDeep } from '@nucleo/utils/storageFiles';
import FileField from '../components/common/FileField';
import PortalTextarea from '../components/common/PortalTextarea';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12, fechaHora12 } from '@nucleo/utils/hora';
import {
    regularizarDte,
    fetchNulaInvoices, fetchPendingMhInvoices, fetchConfirmedMhInvoices, countConfirmedMhInvoices,
    fetchInvoicesByIds, fetchInvoiceResolutionIds, fetchInvoiceResolutionsHistorial, insertInvoiceResolution,
    fetchExcluidasDelBarrido,
    fetchInvoiceNullIds, fetchSalesInvoiceNulls, insertNullResolution, fetchNullResolutionIds,
    fetchSalesInvoiceGaps, fetchGapResolutions, insertGapResolution,
    fetchNonCashInvoices, fetchPaymentConfirmationIds, fetchPaymentConfirmationsHistorial, insertPaymentConfirmation,
    fetchInvoiceObservations, fetchObservationResolutions, insertObservationResolution,
} from '@nucleo/data/facturacion';
import { useToastStore } from '@nucleo/store/toastStore';

// Los cuatro "Solventar" fallaban en silencio: las tablas de resoluciones tenían
// RLS sin policy de INSERT, así que Postgres rechazaba la escritura y la vista no
// avisaba (dos de los cuatro handlers ni desestructuraban `error`, y auditaban
// igual — `audit_logs` quedó con acciones que nunca ocurrieron). La policy ya
// existe; esto es la otra mitad: que un fallo se VEA.
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { diasEntre, fechaNumerica, fechaTexto, hoySV, relojSV } from '@nucleo/utils/fecha';
import {
    conteoDeObservaciones, esSolventable, metaObs, NON_CASH_TYPES, OBSERVACIONES, diasQuedanDelMes, observacionesPendientes, observacionesSolventadas, resumenDeRegularizacion, resumenDeRegularizarUna, sinResolver,
    claveDeSalto, correlativo7, filaDeSaltoSolventado, nulosPendientes, saltosPendientes, saltosSolventados,
} from '@nucleo/utils/colasDeFacturacion';
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
// NON_CASH_TYPES: núcleo (`colasDeFacturacion`).
const IMMEDIATE_TIPOS = ['tarjeta', 'transferencia', 'cheque', 'bitcoin'];
const CREDIT_TIPOS    = ['credito'];

// Categórico puro (T7, paleta cerrada cat-1..9) — 5 métodos de pago sin
// severidad, solo necesitan distinguirse entre sí en la tabla.
// Era la paleta SOFT de `Badge` escrita a mano, una fila por forma de pago.
// Ahora guarda el NOMBRE de la variante y el color lo pone el canónico.
// El color por tipo de documento. Mismo criterio que en VentasView, pero cada
// vista tiene el suyo: son dos archivos sin nada compartido entre ellos.
// `COF` es el que de verdad devuelve el sistema para la factura de consumidor
// final — `FCF` estaba escrito de memoria y nunca coincidió con un dato real, así
// que esas píldoras salían en gris. Se dejan los dos: el mapa no cuesta nada y
// borrar el que no aparece hoy es apostar a que nunca aparezca.
const VARIANTE_DOC = { CCF: 'danger', COF: 'chart-1', FCF: 'chart-1' };

const TIPO_PAGO_VARIANTE = {
    efectivo: 'chart-6',
    tarjeta: 'chart-1', credito: 'chart-3', transferencia: 'chart-9',
    bitcoin: 'chart-4', cheque:  'chart-9',
};


const TIPO_PAGO_LABELS = {
    // `efectivo` no estaba: los tres sitios que usaban este mapa miraban SOLO
    // las formas de pago que no son efectivo. La cola de Hacienda las muestra
    // todas, y sin esta línea el 100% de sus documentos decía «efectivo» en
    // minúscula porque caía en el `|| tipo` del final.
    efectivo:      'Efectivo',
    tarjeta:       'Tarjeta',
    credito:       'Crédito',
    transferencia: 'Transferencia',
    cheque:        'Cheque',
    bitcoin:       'Bitcoin',
};

// El tipo de cliente decide qué se puede hacer con el documento: al
// contribuyente el circuito automático NO le corrige la ficha (decisión del
// 2026-08-09), así que su pendiente se resuelve a mano. Por eso va en la
// tarjeta y no escondido en un tooltip.
//
// Categórico puro, sin severidad: un contribuyente no es «peor» que un
// consumidor. `neutral` para el que no tiene ficha ligada — que es un tercer
// estado real, no un vacío.
// Sólo variantes que `Badge` define de verdad (1, 3, 4, 6, 8, 9). Pedirle una
// que no existe no falla: dibuja la píldora SIN fondo, en silencio — es el
// mismo motivo por el que el canónico las escribe literales y no en un bucle.
const CATEGORIA_CLIENTE_VARIANTE = {
    Contribuyente: 'chart-3',
    Consumidor:    'chart-8',
};

const TIPO_PAGO_THEME = {
 tarjeta:       { ico: 'bg-chart-1/10 text-chart-1-text', texto: 'text-chart-1-text' },
 credito:       { ico: 'bg-chart-3/10 text-chart-3-text', texto: 'text-chart-3-text' },
 transferencia: { ico: 'bg-chart-9/10 text-chart-9-text', texto: 'text-chart-9-text' },
 cheque:        { ico: 'bg-chart-9/10 text-chart-9-text', texto: 'text-chart-9-text' },
 bitcoin:       { ico: 'bg-chart-4/10 text-chart-4-text', texto: 'text-chart-4-text' },
};

// SV time

// Días cumplidos desde una fecha `YYYY-MM-DD`, contra medianoche de hoy en SV.
// Va a nivel de módulo porque lo usan dos pestañas y además entra en un
// `useMemo`: como función local se recrearía en cada render.
function diasDesde(fechaStr) {
    // Antes restaba las 6 horas y después leía la hora LOCAL, que las restaba
    // otra vez: entre la medianoche y las 6 am contaba un día de menos.
    return diasEntre(fechaStr, hoySV());
}

function monthOptions() {
    const opts = [];
    const now = relojSV();
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

// ── Las piezas de las colas (2026-10-17) ─────────────────────────────────
// Anuladas, Pendiente MH, Saltos y Observaciones tienen la misma anatomía
// —sucursal → fecha → documento, un formulario para solventar y un
// historial— y estaba escrita cuatro veces, con cuatro hojas distintas. Tres
// de ellas eran una píldora `#id │ TIPO │ ✓` cuyo dato (correlativo, cliente,
// total) vivía en un tooltip, o sea que **en el teléfono no existía**: la
// lista entera era una hilera de números sin decir de qué documento se trata.
// Pendiente MH ya lo había resuelto con tarjetas el 2026-08-16; acá se
// generaliza su tarjeta y las otras tres la usan.
//
// `ChipDoc`, el control de tres segmentos que vivía acá, se fue con ellas.

const diasAtrasTexto = (fecha) => {
    const d = diasDesde(fecha);
    if (d <= 0) return 'hoy';
    if (d === 1) return 'ayer';
    return `hace ${d} días`;
};

// «jue. 15 oct.» en vez de `2026-10-15`: la fecha cruda es la del dato; ésta
// es la que se lee.
const fechaLegible = (fecha) =>
    fechaTexto(fecha, { weekday: 'short', day: 'numeric', month: 'short' }, fecha || '—');

/** Encabezado de sucursal, plegable. Mismo control en las cuatro colas. */
function EncabezadoSucursal({ nombre, cuenta, unidad = 'doc', ccf = false, monto = null, plegada, onToggle }) {
    const { hasPermission } = useAuth();
    return (
        <ListRow
            surface="card"
            density="sm" icon={Building2} iconBoxClass="bg-transparent border-transparent"
            iconClass={ccf ? 'text-danger' : 'text-content-3'}
            tone={ccf ? 'danger' : null}
            title={<span className="flex items-center gap-2">{nombre}{ccf && <Badge variant="danger" size="sm">CCF</Badge>}</span>}
            onClick={onToggle}
            aria-expanded={!plegada}
            trailing={<>
                {monto != null && hasPermission('facturacion_ver_montos') && (
                    <span className="hidden sm:inline text-caption font-bold text-content-2 tabular-nums">{fmt(monto)}</span>
                )}
                <Badge size="sm" uppercase={false}>{cuenta} {unidad}</Badge>
                <ChevronDown size={13} className={`text-content-3 transition-transform duration-[var(--dur-base)] ${plegada ? '-rotate-90' : ''}`} />
            </>}
        />
    );
}

/**
 * El formulario de «solventar»: un comentario y dos botones. Estaba escrito
 * cinco veces. En el teléfono los botones van DEBAJO del comentario, a lo
 * ancho: al lado le dejaban al texto menos de la mitad de la pantalla.
 */
function FormularioSolventar({ encabezado, comment, setComment, saving, onConfirmar, onCancelar, placeholder = 'Comentario opcional…' }) {
    return (
        <div className="mt-2.5 rounded-xl border border-success/30 bg-success/10 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-[var(--dur-fast)]">
            {encabezado && <div className="flex items-center gap-2 mb-2.5 flex-wrap min-w-0">{encabezado}</div>}
            <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <PortalTextarea
                    className="flex-1"
                    rows={2}
                    autoFocus
                    placeholder={placeholder}
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                />
                <div className="flex sm:flex-col gap-1.5 shrink-0">
                    <Button tone="success" disabled={saving} onClick={onConfirmar} className="flex-1 sm:flex-none justify-center">
                        {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Confirmar
                    </Button>
                    <Button variant="secondary" icon={X} onClick={onCancelar} className="flex-1 sm:flex-none justify-center">Cancelar</Button>
                </div>
            </div>
        </div>
    );
}

/**
 * Un historial plegable: la fila que lo abre, la lista y un pie opcional.
 * Las cuatro colas lo tenían, cada una con su copia.
 */
function SeccionHistorial({ refSeccion, titulo, subtitulo, abierta, onToggle, children, pie }) {
    return (
        <div ref={refSeccion} data-surface="card" className="overflow-hidden">
            <ListRow
                icon={Check} iconClass="text-success" iconBoxClass="bg-success/10 border-success/20"
                title={titulo}
                subtitle={subtitulo}
                onClick={onToggle}
                aria-expanded={abierta}
                className="rounded-none border-x-0 border-t-0"
                trailing={<ChevronDown size={16} className={`text-content-3 transition-transform duration-[var(--dur-slow)] ${abierta ? 'rotate-180' : ''}`} />}
            />
            {abierta && (
                <div className="border-t border-divider">
                    {children}
                    {pie && <div className="px-5 py-3 border-t border-divider flex justify-center">{pie}</div>}
                </div>
            )}
        </div>
    );
}

/**
 * Una fila del historial: quién (foto + nombre corto, el canon del portal),
 * cuándo, el comentario, y lo que identifica al documento en `children`.
 * El nombre que trae la fila es el COMPLETO —se guardó así—, y pintarlo
 * crudo al lado de un avatar con iniciales es lo que el canon prohíbe.
 */
function FilaHistorial({ quien, nombre, sinNombre = '—', cuando, cuandoTexto, comentario, primera, children, pie }) {
    return (
        <div className={`flex items-start gap-3 px-5 py-4 hover:bg-surface-card-hover/40 transition-colors ${primera ? '' : 'border-t border-divider'}`}>
            <AvatarConEstado emp={quien} px={32} radio="rounded-full" marco="" />
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1 min-w-0">{children}</div>
                {pie}
                {comentario && <p className="text-body-sm text-content-3 mb-1 break-words">&ldquo;{comentario}&rdquo;</p>}
                <p className="text-label text-content-3">
                    {nombre
                        ? <span className="font-semibold text-content-2">{shortEmployeeName(quien || nombre)}</span>
                        : sinNombre}
                    {cuando && <> · {fechaHora12(cuando, { month: 'short', day: '2-digit' })}</>}
                    {!cuando && cuandoTexto && <> · {cuandoTexto}</>}
                </p>
            </div>
        </div>
    );
}

/** El esqueleto de una cola de tarjetas: tiene la FORMA de lo que llega. */
function EsqueletoCola({ grupos = 2, tarjetas = 2 }) {
    return (
        <div className="space-y-6">
            {Array.from({ length: grupos }).map((_, i) => (
                <div key={i} className="space-y-2.5">
                    <div data-surface="card" className="flex items-center justify-between px-4 py-3">
                        <div className="h-3 w-28 skeleton rounded-full" />
                        <div className="h-3 w-12 skeleton rounded-full" />
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                        {Array.from({ length: tarjetas }).map((_, j) => (
                            <div key={j} data-surface="card" className="px-3.5 py-3 space-y-2.5">
                                <div className="h-3 w-40 skeleton rounded-full" />
                                <div className="h-3 w-32 skeleton rounded-full" />
                                <div className="h-7 w-full skeleton rounded-xl" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** El botón que copia el número interno y deja la marca de «ya lo fui a buscar». */
function BotonCopiarId({ erpId, copiado, visitado, onCopiar }) {
    return (
        <Button
            variant="secondary" size="sm"
            icon={copiado || visitado ? Check : Copy}
            onClick={onCopiar}
            disabled={!erpId}
            aria-label={copiado ? 'Copiado' : `Copiar ${erpId ? `#${erpId}` : 'el número'}`}
            title={visitado ? 'Ya copiado — tocar de nuevo quita la marca' : 'Copiar el número interno'}
            className="font-mono"
        >
            {erpId ? `#${erpId}` : '—'}
        </Button>
    );
}

const GRILLA_TARJETAS = 'grid grid-cols-1 gap-2.5 sm:grid-cols-2 2xl:grid-cols-3';

// ─── La tarjeta de un documento pendiente de Hacienda (2026-08-16) ──────────
//
// Reemplaza la píldora con tooltip. El tooltip tenía tres datos —correlativo,
// cliente y total— y **en un teléfono no existe**: sin hover, la lista entera
// era una hilera de `#349572 COF ✓` sin decir de qué documento se trata. En
// escritorio tampoco servía para comparar: había que apuntar de a uno y el dato
// desaparecía al mover el puntero.
//
// Lo que la tarjeta agrega es lo que hace falta para decidir sin abrir nada:
// el TIPO DE CLIENTE —a un contribuyente el circuito automático no le corrige
// la ficha (decisión del 2026-08-09), así que ése se resuelve a mano— y la
// FORMA DE PAGO.
//
// Es una tarjeta CANÓNICA: `data-surface="card"`, no tres clases que le copian
// el color. La diferencia no es de estilo — el canónico trae el `backdrop-filter`
// del vidrio, las seis capas de sombra, el realce del borde al apuntarla, el gel
// al presionarla y el radio del tema. Copiar `bg-surface-card` deja todo eso
// afuera y en modo claro la tarjeta desaparece contra la página (DESIGN.md
// §5.0.1). Por eso también dejó de vivir dentro de otra tarjeta: anidarlas era
// lo que obligaba a pintarla a mano.
//
// El estado va por `data-tono`, que es lo que sube la especificidad por encima
// del canónico (§5.1): un `border-danger/40` suelto NO lo pisa.
// Desde el 2026-10-17 es la tarjeta de TODAS las colas de documentos (Anuladas,
// Pendiente MH, Observaciones). Lo que cambia entre ellas son las acciones
// (`acciones`) y lo que la cola agrega a la hoja (`children`: las
// observaciones, el motivo de Hacienda). El tipo de cliente y la forma de
// pago se pintan sólo si la fila los trae — Anuladas no tiene ficha ligada, y
// un «Sin ficha» ahí diría algo que no se midió.
const TarjetaDocumento = memo(({
    r, tono: tonoForzado, tonoFecha = null, isVisited, isCopied, onCopiar, acciones, children,
}) => {
    const isCCF = r.tipo_documento === 'CCF';
    const tono = tonoForzado !== undefined ? tonoForzado : (isCCF ? 'danger' : undefined);
    const categoria = r.cliente_categoria;
    const traeCategoria = 'cliente_categoria' in r;
    return (
        <div
            data-surface="card"
            data-tono={tono}
            className={`px-3.5 py-3 flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)] transition-opacity ${
                isVisited && tono !== 'warning' ? 'opacity-40 hover:opacity-80' : ''}`}>
            {/* Documento y monto */}
            <div className="flex items-start gap-2">
                <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento || '—'}</Badge>
                {/* `min-w-0` o el `truncate` no recorta: un hijo de flex no baja
                    de su ancho de contenido sin él. */}
                <p className={`flex-1 min-w-0 truncate font-mono text-label font-black ${isCCF ? 'text-danger-text' : 'text-content'}`}
                    title={r.correlativo || undefined}>
                    {r.correlativo || '—'}
                </p>
                <p className={`shrink-0 text-body-sm font-black tabular-nums ${isCCF ? 'text-danger-text' : 'text-content'}`}>
                    <Monto v={r.total} />
                </p>
            </div>

            {/* Cliente */}
            <p className="mt-1.5 truncate text-label font-semibold text-content-2" title={r.cliente || undefined}>
                {r.cliente || 'Sin cliente'}
            </p>

            {/* Cuándo. Vive en la tarjeta y no en un encabezado por día: con un
                documento por fecha —lo normal en esta cola— cada encabezado
                ocupaba una fila entera de la grilla para una sola tarjeta. */}
            {r.fecha && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro font-bold text-content-3">
                    <span className="capitalize">{fechaLegible(r.fecha)}</span>
                    {r.hora && <span className="tabular-nums">· {hora12(r.hora)}</span>}
                    <Badge variant={tonoFecha || (diasDesde(r.fecha) === 0 ? 'info' : 'neutral')} size="sm" uppercase={false}>
                        {diasAtrasTexto(r.fecha)}
                    </Badge>
                </div>
            )}

            {/* Tipo de cliente · forma de pago */}
            {(traeCategoria || r.tipo_pago) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {/* Sin ficha ligada NO es lo mismo que sin categoría: se dice,
                        porque es justo el caso que no se puede corregir solo. */}
                    {traeCategoria && (
                        <Badge variant={CATEGORIA_CLIENTE_VARIANTE[categoria] || 'neutral'} size="sm">
                            {categoria || 'Sin ficha'}
                        </Badge>
                    )}
                    {r.tipo_pago && (
                        <Badge variant={TIPO_PAGO_VARIANTE[r.tipo_pago] || 'neutral'} size="sm">
                            {TIPO_PAGO_LABELS[r.tipo_pago] || r.tipo_pago}
                        </Badge>
                    )}
                </div>
            )}

            {children}

            {/* Acciones — `mt-auto` las alinea al pie en una fila de la grilla
                donde la tarjeta de al lado es más alta. */}
            <div className="mt-auto pt-2.5">
                <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5">
                    <BotonCopiarId erpId={r.erp_invoice_id} copiado={isCopied} visitado={isVisited} onCopiar={onCopiar} />
                    {acciones && <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{acciones}</div>}
                </div>
            </div>
        </div>
    );
});

// ─── La marca "ya me llevé este id al ERP" ────────────────────────────────────
//
// Se apaga la fila y se tacha el chip: es lo que permite recorrer una lista de
// 157 documentos sin perder el hilo de cuáles ya se fueron a buscar al sistema.
//
// La clave de localStorage es UNA para todas las pestañas, a propósito: la marca
// es del DOCUMENTO, no de la lista donde se lo encontró. Era el mismo bloque
// copiado en Anuladas y en Pendiente MH; Observaciones habría sido la tercera
// copia (pedido del usuario, 2026-07-31).
// Vive en el núcleo (`@nucleo/hooks/useVisitados`) para que la app la use igual.

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
// El formulario de confirmación: la nota, el comprobante y los dos botones.
//
// `comoPanel` devuelve el MISMO cuerpo sin el envoltorio `<tr><td colSpan>`.
// En escritorio vive en la fila hermana; en el teléfono `DataTable` pinta fichas
// y esa fila no se dibuja, así que el mismo cuerpo se monta en
// `ExpedienteMovil`. Escrito una vez para que no puedan divergir: confirmar un
// pago era imposible desde el teléfono, y el botón que lo abría respondía sin
// llevar a ningún lado.
//
// El eje también cambia: en escritorio los dos botones van a la DERECHA del
// formulario porque ahí sobra ancho; en 390px van DEBAJO, que es el único lugar
// donde caben sin encogerse por debajo del objetivo de dedo.
function FilaConfirmar({ colSpan, notas, setNotas, archivo, setArchivo, guardando, onConfirmar, onCancelar, textoNotas, textoArchivo, comoPanel = false }) {
    const tk = useExpandStyle();
    const cuerpo = (
        <div className={comoPanel ? 'flex flex-col gap-3' : 'flex items-start gap-3 max-w-3xl'}>
            <div className="flex-1 space-y-2 min-w-0">
                <PortalTextarea rows={2} autoFocus={!comoPanel} placeholder={textoNotas}
                    value={notas} onChange={e => setNotas(e.target.value)} />
                <FileField accept="image/*,application/pdf" density="sm"
                    file={archivo} onChange={setArchivo} hint={textoArchivo} />
            </div>
            <div className={comoPanel ? 'flex flex-col gap-2' : 'flex flex-col gap-2 shrink-0'}>
                <Button tone="success" disabled={guardando} onClick={onConfirmar}
                    className={comoPanel ? 'w-full justify-center' : ''}>
                    {guardando ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirmar
                </Button>
                <Button variant="secondary" icon={X} onClick={onCancelar}
                    className={comoPanel ? 'w-full justify-center' : ''}>Cancelar</Button>
            </div>
        </div>
    );

    if (comoPanel) return cuerpo;

    return (
        <tr>
            <td colSpan={colSpan} className={`px-5 py-4 border-t ${tk.expandBg} ${tk.expandBorderColor}`}>
                {cuerpo}
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
    // El formulario de confirmación vive en un `<tr colSpan>` hermano, que en el
    // teléfono no se pinta: `DataTable` ahí dibuja fichas. Va al expediente.
    const { enTelefono, abierto: aConfirmar } = useExpedienteMovil(visibles, confirmandoId);
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
                /* `acciones: 'mantener'`: «Confirmar» es la única acción de esta
                   pantalla y vivía en una columna que el teléfono no pinta —o
                   sea que una transacción no se podía confirmar desde el
                   teléfono—. El formulario que abre va al expediente, abajo. */
                movil={{ identidad: 'correlativo', ancla: 'total', chips: ['fecha', 'cliente'], acciones: 'mantener' }}
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
                                    {/* En una línea: apilados doblaban el alto de cada fila. */}
                                    <div className="flex items-center gap-2 whitespace-nowrap">
                                        <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento}</Badge>
                                        <span className="font-mono text-body-sm text-content-2">{r.correlativo}</span>
                                    </div>
                                </DataCell>
                                <DataCell hideBelow="md">{nombreSucursal(r.branch_id)}</DataCell>
                                <DataCell hideBelow="lg" className="max-w-[160px] truncate">{r.cliente || '—'}</DataCell>
                                <DataCell className="whitespace-nowrap tabular-nums">
                                    {fechaNumerica(r.fecha, { anio: 'corto' })}
                                    {r.hora && <span className="block text-micro text-content-3">{hora12(r.hora)}</span>}
                                </DataCell>
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
                            {/* Sólo en escritorio: en el teléfono esta fila
                                hermana no se dibuja y el formulario va al
                                expediente, después de la tabla. */}
                            {confirmando && !enTelefono && (
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

            {/* El formulario de confirmación, en el teléfono. */}
            <ExpedienteMovil
                abierto={aConfirmar}
                onClose={() => setConfirmandoId(null)}
                titulo={aConfirmar ? `Confirmar ${aConfirmar.correlativo}` : 'Confirmar'}
                subtitulo={aConfirmar ? `${aConfirmar.fecha} · ${nombreSucursal(aConfirmar.branch_id)}` : undefined}
            >
                {(r) => (
                    <FilaConfirmar comoPanel
                        notas={notas} setNotas={setNotas}
                        archivo={archivo} setArchivo={setArchivo}
                        guardando={guardando}
                        onConfirmar={() => onConfirmar(r.id)}
                        onCancelar={() => setConfirmandoId(null)}
                        textoNotas={textoNotas} textoArchivo={textoArchivo}
                    />
                )}
            </ExpedienteMovil>
        </div>
    );
}

/**
 * Solventar todas: corregir lo que haga falta y enviar a Hacienda lo pendiente
 * de lo que se está mirando.
 *
 * El alcance sale del filtro de sucursal que ya está puesto: si hay una
 * elegida, corrige esa; si no, todas. No se inventa un selector aparte — la
 * píldora de arriba ya dice sobre qué se está trabajando, y tener dos formas de
 * decir lo mismo es como se llega a que no coincidan.
 *
 * Lo mismo que corre solo cada noche a las 22:30; esto es para no esperar.
 *
 * ── Por qué es una función y ya no un `<Button>` (2026-08-16) ──────────────
 * Vivía como botón suelto al lado de la píldora de filtros, o sea en el único
 * sitio donde §17 dice que NO van los controles de vista. `FilterBar` lleva los
 * filtros **y las acciones**, y las acciones son DESCRIPTORES —no JSX— porque
 * el mismo control se dibuja de dos maneras: `TabBarAction` en la píldora de
 * escritorio y un botón del clúster en la barra flotante táctil. Como botón
 * suelto, en un teléfono quedaba fuera del alcance del pulgar.
 */
async function solventarTodas({ filterBranch, bolsa, onDone }) {
    const r = await regularizarDte({
        alcance:  filterBranch ? 'sucursal' : 'todas',
        branchId: filterBranch || null,
        bolsa,
    });

    if (!r.ok) {
        useToastStore.getState().showToast('No se pudo completar', mensajeAmigable(r.error), 'error');
        return;
    }
    // Qué se dice, con sus razones: `resumenDeRegularizacion` (núcleo, lo
    // mismo que la app).
    const { titulo, texto, tono } = resumenDeRegularizacion(r);
    useToastStore.getState().showToast(titulo, texto, tono);
    onDone?.();
}

// ─── Tab: Anuladas ────────────────────────────────────────────────────────────
function TabAnuladas({ branches, filterBranch, searchTerm, currentUser, canEdit, barraFiltros, recargaRef, onCuenta }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        // Devuelve la FICHA y no sólo la foto: `AvatarConEstado` necesita el
        // id para resolver el aro, y lo único que trae la fila es el NOMBRE de
        // quien resolvió. Con la ficha entera se recupera.
        for (const e of employees) if (e.name) m[e.name] = e;
        return m;
    }, [employees]);

    const [rows, setRows] = useState([]);
    const [resolved, setResolved] = useState([]);
    const [resolvedIds, setResolvedIds] = useState(new Set());
    // Las que se cerraron SIN trámite ante Hacienda, por decisión escrita.
    const [excluidas, setExcluidas] = useState(new Set());
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
        const [invoicesData, resolutionsRes, historialRes, excluidasRes] = await Promise.all([
            fetchNulaInvoices(filterBranch),
            fetchInvoiceResolutionIds(),
            fetchInvoiceResolutionsHistorial('id, invoice_id, comment, resolved_by, resolved_at'),
            fetchExcluidasDelBarrido(),
        ]);

        // Falla hacia NO pintar el badge: si esta lectura se cae, la fila se ve
        // como cualquier otra solventada —que es lo que es— en vez de mentir
        // sobre por qué se cerró.
        if (excluidasRes.error) {
            console.error('loadData: fetch dte_excluidas_del_barrido failed:', excluidasRes.error.message);
        }
        setExcluidas(new Set((excluidasRes.data || []).map(e => e.invoice_id)));

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
    useEffect(() => { const id = setInterval(loadData, 60_000); return () => clearInterval(id); }, [loadData]);
    // El botón manda su recarga a la vista: la acción «Solventar todas» vive en
    // la píldora de filtros, que es hermana de la pestaña y no su madre.
    useEffect(() => { if (recargaRef) recargaRef.current = loadData; }, [loadData, recargaRef]);

    const handleSolve = async (invoiceId) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const { data, error } = await insertInvoiceResolution({
            invoice_id: invoiceId, comment: comment.trim() || null, resolved_by: resolvedBy,
        }, 'id, invoice_id, comment, resolved_by, resolved_at', {
            accion: 'SOLVENTAR_ANULACION', correlativo: rows.find(r => r.id === invoiceId)?.correlativo,
        });
        if (error) { avisarFalloAlSolventar(error, 'handleSolve'); setSaving(false); return; }
        setResolvedIds(prev => new Set([...prev, invoiceId]));
        const newRec = data?.[0];
        if (newRec) {
            const inv = rows.find(r => r.id === invoiceId);
            setResolved(prev => [{ ...newRec, invoice: inv || null }, ...prev]);
        }
        const correlativo = rows.find(r => r.id === invoiceId)?.correlativo;
        useToastStore.getState().showToast('Anulación solventada', correlativo || '', 'success');
        setSolvingId(null); setComment(''); setSaving(false);
    };

    const getBranch = (id) => branches.find(b => b.id === id)?.name || `Suc. ${id}`;

    const now         = relojSV();
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
    // La más vieja sin atender: es la métrica que dice si la cola se está
    // trabajando. Una anulada de ayer es rutina; una de hace tres semanas es
    // un documento que Hacienda sigue contando como venta.
    const diasMasVieja = useMemo(() =>
        filtered.reduce((max, r) => Math.max(max, diasDesde(r.fecha)), 0),
    [filtered]);
    const montoPendiente = useMemo(() =>
        filtered.reduce((a, r) => a + parseFloat(r.total || 0), 0),
    [filtered]);

    const verMontos = useAuth().hasPermission('facturacion_ver_montos');

    // El número de la pestaña sube a la vista (ver `cuentas` en FacturacionView).
    useEffect(() => { if (!loading) onCuenta?.(filtered.length); }, [loading, filtered.length, onCuenta]);

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Carril de métricas + píldora, en UNA fila (§17.0). El color va
                donde ES el dato: el número y el ícono. El fondo, nunca. */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de anulaciones">
                    <StatCard
                        loading={loading}
                        icon={Ban} label="Pendientes" value={filtered.length}
                        sub={filtered.length > 0 ? (verMontos ? fmt(montoPendiente) : 'Por atender') : 'Nada por atender'}
                        iconBg={filtered.length > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={filtered.length > 0 ? 'text-danger' : 'text-content-3'}
                        valueCls={filtered.length > 0 ? 'text-danger' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={AlertTriangle} label="CCF urgentes" value={ccfCount}
                        sub={ccfCount > 0 ? 'Crédito fiscal' : undefined}
                        iconBg={ccfCount > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={ccfCount > 0 ? 'text-danger-text' : 'text-content-3'}
                        valueCls={ccfCount > 0 ? 'text-danger-text' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={History} label="Más antigua"
                        value={filtered.length > 0 ? `${diasMasVieja}d` : '—'}
                        sub="Sin solventar"
                        iconCls={diasMasVieja > 7 ? 'text-warning-text' : 'text-content-3'}
                        iconBg={diasMasVieja > 7 ? 'bg-warning/10' : 'bg-surface-card-hover'}
                        valueCls={diasMasVieja > 7 ? 'text-warning-text' : 'text-content'}
                    />
                    {/* Era el total HISTÓRICO rotulado como si fuera de ahora.
                        Lo que dice si la cola se mueve es lo de este mes. */}
                    <StatCard
                        loading={loading}
                        icon={CheckCircle2} label="Solventadas" value={resolvedThisMonth.length}
                        sub="Este mes"
                        iconBg={resolvedThisMonth.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                        iconCls={resolvedThisMonth.length > 0 ? 'text-success' : 'text-content-3'}
                        valueCls={resolvedThisMonth.length > 0 ? 'text-success' : 'text-content'}
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
                    {barraFiltros}
                </div>
            </div>

            {loading ? (
                <EsqueletoCola />
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                    title={searchTerm ? 'Sin resultados' : 'Todo está al día'}
                    subtitle={searchTerm
                        ? `Ninguna anulación pendiente coincide con «${searchTerm}».`
                        : 'No hay anulaciones pendientes por atender en este momento.'} />
            ) : (
                <div className="space-y-6">
                    {isAnuladasFuzzy && searchTerm && (
                        <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                    )}
                    <Notice variant="info" icon={Info}>
                        Copia el número para buscar la factura en la caja. Cuando la anulación se resuelve allá, sale sola de esta lista.
                    </Notice>
                    {Object.entries(grouped).map(([branchId, byFecha]) => {
                        const docs = Object.values(byFecha).flat();
                        const branchHasCCF = docs.some(r => r.tipo_documento === 'CCF');
                        const isCollapsed = !!collapsedBranches[branchId];
                        const enCurso = docs.find(r => r.id === solvingId);
                        return (
                            <section key={branchId} className="space-y-2.5">
                                <EncabezadoSucursal
                                    nombre={getBranch(Number(branchId))}
                                    cuenta={docs.length} ccf={branchHasCCF}
                                    monto={docs.reduce((a, r) => a + parseFloat(r.total || 0), 0)}
                                    plegada={isCollapsed}
                                    onToggle={() => setCollapsedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                />
                                {!isCollapsed && (<>
                                    <div className={GRILLA_TARJETAS}>
                                                    {docs.map(r => {
                                                        const isSolving = solvingId === r.id;
                                                        return (
                                                            <TarjetaDocumento
                                                                tonoFecha={r.tipo_documento === 'CCF' ? 'danger' : null}
                                                                key={r.id}
                                                                r={r}
                                                                tono={isSolving ? 'warning' : undefined}
                                                                isCopied={copiedId === r.erp_invoice_id}
                                                                isVisited={visitedIds.has(String(r.erp_invoice_id))}
                                                                onCopiar={() => copyErpId(r.erp_invoice_id)}
                                                                acciones={canEdit && (
                                                                    <Button
                                                                        variant="secondary" size="sm"
                                                                        tone={isSolving ? 'danger' : 'success'} soft={!isSolving}
                                                                        icon={isSolving ? X : Check}
                                                                        aria-pressed={isSolving}
                                                                        onClick={() => { setSolvingId(isSolving ? null : r.id); setComment(''); }}
                                                                    >
                                                                        {isSolving ? 'Cancelar' : 'Solventar'}
                                                                    </Button>
                                                                )}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                    {enCurso && (
                                                    <FormularioSolventar
                                                        encabezado={<>
                                                            <span className={`font-mono text-label font-black ${enCurso.tipo_documento === 'CCF' ? 'text-danger-text' : 'text-content-2'}`}>{enCurso.correlativo}</span>
                                                            {enCurso.cliente && <span className="text-label text-content-3 truncate min-w-0">· {enCurso.cliente}</span>}
                                                            <span className="ml-auto text-body-sm font-black text-content-2"><Monto v={enCurso.total} /></span>
                                                        </>}
                                                        comment={comment} setComment={setComment} saving={saving}
                                                        placeholder="Qué se hizo con la anulación (opcional)…"
                                                        onConfirmar={() => handleSolve(enCurso.id)}
                                                        onCancelar={() => { setSolvingId(null); setComment(''); }}
                                                    />
                                                )}
                                </>)}
                            </section>
                        );
                    })}
                </div>
            )}

            {/* Historial */}
            {!loading && resolved.length > 0 && (
                <SeccionHistorial
                    refSeccion={resolvedSectionRef}
                    titulo={`${showAllResolved ? resolved.length : resolvedThisMonth.length} solventada${(showAllResolved ? resolved.length : resolvedThisMonth.length) !== 1 ? 's' : ''} ${showAllResolved ? 'en total' : 'este mes'}`}
                    subtitulo="Historial de resoluciones"
                    abierta={showHistorial}
                    onToggle={() => setShowHistorial(v => !v)}
                    pie={<Button variant="ghost" onClick={() => setShowAllResolved(v => !v)}>{showAllResolved ? `Ver solo este mes (${resolvedThisMonth.length})` : `Ver todos (${resolved.length})`}</Button>}
                >
                    {resolvedDisplay.length === 0 && (
                        <p className="px-5 py-4 text-label text-content-3">Nada solventado en este período.</p>
                    )}
                    {resolvedDisplay.map((r, i) => {
                        const inv = r.invoice;
                        return (
                            <FilaHistorial key={r.id} primera={i === 0}
                                quien={empPhotoMap[r.resolved_by] || null} nombre={r.resolved_by}
                                cuando={r.resolved_at} comentario={r.comment}>
                                <Badge variant={VARIANTE_DOC[inv?.tipo_documento] || 'neutral'} size="sm">{inv?.tipo_documento || '—'}</Badge>
                                {/* «Solventado internamente» no es un matiz del mismo
                                    cierre: las demás se cerraron ante Hacienda y ésta
                                    NO se le mandó nunca, a propósito. Sin el rótulo,
                                    las dos se leen igual en la lista. */}
                                {excluidas.has(r.invoice_id) && (
                                    <Badge variant="warning" uppercase={false}>Solventado internamente</Badge>
                                )}
                                {inv?.erp_invoice_id && <span className="font-mono text-body-sm font-black text-content">#{inv.erp_invoice_id}</span>}
                                <span className="font-mono text-label text-content-3">{inv?.correlativo}</span>
                                <span className="text-label text-content-3">{getBranch(inv?.branch_id)}</span>
                                {inv?.total != null && <span className="text-body-sm font-bold text-content-2 ml-auto tabular-nums"><Monto v={inv.total} /></span>}
                            </FilaHistorial>
                        );
                    })}
                </SeccionHistorial>
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

function TabPendienteMH({ branches, filterBranch, searchTerm, currentUser, canEdit, barraFiltros, recargaRef, onCuenta }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        // Devuelve la FICHA y no sólo la foto: `AvatarConEstado` necesita el
        // id para resolver el aro, y lo único que trae la fila es el NOMBRE de
        // quien resolvió. Con la ficha entera se recupera.
        for (const e of employees) if (e.name) m[e.name] = e;
        return m;
    }, [employees]);
    const [rows, setRows]               = useState([]);
    const [resolved, setResolved]       = useState([]);
    // El conteo real del mes lo cuenta el SERVIDOR. Contar el array traído decía
    // «1000» —el cap de PostgREST— sobre 10,770 reales.
    const [confirmadasMes, setConfirmadasMes] = useState(null);
    const [showResolved, setShowResolved] = useState(false);
    const [showAllResolved, setShowAllResolved] = useState(false);
    const resolvedSectionRef = useRef(null);
    const pollingRef2 = useRef(false);
    const [loading, setLoading]         = useState(true);
    const [solvingId, setSolvingId]     = useState(null);
    const [comment, setComment]         = useState('');
    const [saving, setSaving]           = useState(false);
    const [copiedId, setCopiedId]             = useState(null);
    const [enviandoId, setEnviandoId]         = useState(null);
    const [nullCamposIds, setNullCamposIds]   = useState(new Set());
    const [collapsedBranches, setCollapsedBranches] = useState({});
    const { visitedIds, toggleVisited, clearVisited } = useVisitados();

    const now      = relojSV();
    const daysLeft = diasQuedanDelMes(now);

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

    const currentMonthStr = relojSV().toISOString().slice(0, 7);

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
        const n = relojSV();
        const y = n.getFullYear(), m = String(n.getMonth() + 1).padStart(2, '0');
        const fini = `${y}-${m}-01`;
        const ffin = `${y}-${m}-${new Date(y, n.getMonth() + 1, 0).getDate()}`;

        // `fetchPendingMhInvoices` LANZA si el servidor rechaza —sin permiso de
        // Facturación, por ejemplo—. Sin el try/finally de abajo esa excepción
        // dejaba la vista clavada en esqueletos para siempre: `setLoading(false)`
        // y el candado del sondeo quedaban sin ejecutar, y el fallo se leía como
        // "está cargando".
        let pendData, resInvs, allResolutions, nullsData, confirmadas;
        try {
            [pendData, { data: resInvs }, { data: allResolutions }, { data: nullsData },
             { count: confirmadas }] = await Promise.all([
                fetchPendingMhInvoices(filterBranch),
                fetchConfirmedMhInvoices(filterBranch, fini, ffin),
                fetchInvoiceResolutionsHistorial('invoice_id, comment, resolved_by, resolved_at'),
                fetchInvoiceNullIds(),
                countConfirmedMhInvoices(filterBranch, fini, ffin),
            ]);
        } catch (e) {
            console.error('loadData (pendiente MH):', e?.message || e);
            useToastStore.getState().showToast(
                'No se pudo cargar la cola de Hacienda',
                mensajeAmigable(e, 'Inténtalo de nuevo en un momento.'),
                'error',
            );
            setLoading(false);
            pollingRef2.current = false;
            return;
        }

        // Invoices that also have non-MH null campos (e.g. cliente, correlativo)
        setNullCamposIds(new Set((nullsData || []).map(r => r.id)));

        // Exclude already-resolved invoices from the pending list
        const resolvedIds = new Set((allResolutions || []).map(r => r.invoice_id));
        const filteredPend = sinResolver(pendData, allResolutions);

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
        setConfirmadasMes(confirmadas ?? 0);
        setLoading(false);
        pollingRef2.current = false;
    }, [filterBranch]);

    useEffect(() => { loadData(); }, [loadData]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos
    useEffect(() => { const id = setInterval(loadData, 120_000); return () => clearInterval(id); }, [loadData]);
    useEffect(() => { if (recargaRef) recargaRef.current = loadData; }, [loadData, recargaRef]);

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
        }, undefined, { accion: 'SOLVENTAR_PENDIENTE_MH', correlativo: inv?.correlativo, resolved_by: resolvedBy });
        if (error) { avisarFalloAlSolventar(error, 'handleSolve (pendiente MH)'); setSaving(false); return; }
        useToastStore.getState().showToast('Pendiente solventado', inv?.correlativo || '', 'success');
        setResolved(prev => [{ ...inv, resolution: { comment: comment.trim() || null, resolved_by: resolvedBy, resolved_at: new Date().toISOString() } }, ...prev]);
        setRows(prev => prev.filter(r => r.id !== invoiceId));
        setSolvingId(null); setComment(''); setSaving(false);
    };

    /**
     * Solventar UNA: corregir lo que haga falta y volver a mandarla.
     *
     * El servidor hace el ciclo entero —envía, y si Hacienda la rechaza por un
     * dato del cliente que se sabe corregir, corrige esa ficha y reenvía— así
     * que acá sólo se informa el resultado FINAL. La corrección se acota al
     * cliente de esta factura: apretar un botón en una fila no puede terminar
     * escribiendo las fichas de otros clientes.
     *
     * El sello NO lo escribe el portal: lo trae el sync. Por eso al terminar se
     * recarga en vez de sacar la fila de la lista a mano.
     */
    const handleRegularizarUna = async (r) => {
        setEnviandoId(r.id);
        const res = await regularizarDte({ alcance: 'una', invoiceId: r.id }, { correlativo: r.correlativo });
        setEnviandoId(null);

        if (!res.ok) {
            useToastStore.getState().showToast('No se pudo enviar', mensajeAmigable(res.error), 'error');
            return;
        }
        // El texto sale del núcleo (`resumenDeRegularizarUna`): el motivo de
        // Hacienda, palabra por palabra, si no entró.
        const { titulo, texto, tono } = resumenDeRegularizarUna(res, r.correlativo);
        useToastStore.getState().showToast(titulo, texto, tono);
        loadData();
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
    // Cuántas ya pasaron la gracia de Hacienda: ésas no se van a arreglar
    // esperando, y son las que hay que mirar primero.
    const vencidas = useMemo(() => filtered.filter(r => diasDesde(r.fecha) > GRACIA_SELLO_DIAS).length, [filtered]);

    useEffect(() => { if (!loading) onCuenta?.(filtered.length); }, [loading, filtered.length, onCuenta]);

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Carril de métricas + píldora en UNA fila (§17.0). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de pendientes de Hacienda">
                    <StatCard
                        loading={loading}
                        icon={Clock} label="Sin sello" value={filtered.length}
                        sub={filtered.length > 0 ? 'Esperan a Hacienda' : 'Todo sellado'}
                        iconBg={filtered.length > 0 ? 'bg-warning/10' : 'bg-surface-card-hover'}
                        iconCls={filtered.length > 0 ? 'text-warning-text' : 'text-content-3'}
                        valueCls={filtered.length > 0 ? 'text-warning-text' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={AlertTriangle} label="Vencidas" value={vencidas}
                        sub={`Más de ${GRACIA_SELLO_DIAS} días`}
                        iconBg={vencidas > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={vencidas > 0 ? 'text-danger-text' : 'text-content-3'}
                        valueCls={vencidas > 0 ? 'text-danger-text' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={AlertTriangle} label="CCF urgentes" value={ccfCount}
                        sub={ccfCount > 0 ? 'Crédito fiscal' : undefined}
                        iconBg={ccfCount > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={ccfCount > 0 ? 'text-danger-text' : 'text-content-3'}
                        valueCls={ccfCount > 0 ? 'text-danger-text' : 'text-content'}
                    />
                    <StatCard
                        icon={History} label="Al cierre" value={daysLeftLabel}
                        sub={daysLeft === 0 ? 'Hoy cierra el mes' : `día${daysLeft === 1 ? '' : 's'} del mes`}
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
                    {barraFiltros}
                </div>
            </div>

            {/* Pending list */}
            {loading ? (
                <EsqueletoCola />
            ) : filtered.length === 0 ? (
                <EmptyState icon={CheckCircle2} iconClass="text-chart-3-text" glowClass="bg-chart-3"
                    title={searchTerm ? 'Sin resultados' : 'Sin pendientes'}
                    subtitle={searchTerm
                        ? `Ningún documento pendiente coincide con «${searchTerm}».`
                        : 'Todos los documentos tienen su sello de recepción.'} />
            ) : (
                <div className="space-y-6">
                    {isPendienteFuzzy && searchTerm && (
                        <Notice variant="warning" icon={Search}>
                            Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                        </Notice>
                    )}
                    {Object.entries(grouped).map(([branchId, byFecha]) => {
                        const docs = Object.values(byFecha).flat();
                        const branchHasCCF = docs.some(r => r.tipo_documento === 'CCF');
                        const isCollapsed = !!collapsedBranches[branchId];
                        const enCurso = docs.find(r => r.id === solvingId);
                        return (
                            // ── Sin tarjeta envolvente, a propósito (2026-08-16) ──
                            // La sucursal es un encabezado (`ListRow`, que ES el
                            // canónico de fila-tarjeta) y cada documento es una
                            // `data-surface="card"` de verdad: anidarlas da dos
                            // anillos concéntricos (DESIGN.md §5.1).
                            <section key={branchId} className="space-y-2.5">
                                <EncabezadoSucursal
                                    nombre={getBranch(Number(branchId))}
                                    cuenta={docs.length} ccf={branchHasCCF}
                                    monto={docs.reduce((a, r) => a + parseFloat(r.total || 0), 0)}
                                    plegada={isCollapsed}
                                    onToggle={() => setCollapsedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                />

                                {!isCollapsed && (<>
                                    <div className={GRILLA_TARJETAS}>
                                                    {docs.map(r => {
                                                        const isSolving = solvingId === r.id;
                                                        return (
                                                            <TarjetaDocumento
                                                                tonoFecha={r.tipo_documento === 'CCF' ? 'danger' : diasDesde(r.fecha) > GRACIA_SELLO_DIAS ? 'warning' : null}
                                                                key={r.id}
                                                                r={r}
                                                                tono={isSolving ? 'warning'
                                                                    : r.tipo_documento === 'CCF' ? 'danger'
                                                                    : nullCamposIds.has(r.id) ? 'chart-3' : undefined}
                                                                isCopied={copiedId === r.erp_invoice_id}
                                                                isVisited={visitedIds.has(String(r.erp_invoice_id))}
                                                                onCopiar={() => copyErpId(r.erp_invoice_id)}
                                                                acciones={canEdit && (<>
                                                                    {/* La salida manual: quedó atendido por fuera y se
                                                                        anota. No manda nada a Hacienda. */}
                                                                    {/* Sólo ícono: con los tres botones con rótulo la fila
                                                                        no entraba en la tarjeta y se partía en dos. El
                                                                        nombre va en `title`, que en la hoja táctil vuelve a
                                                                        ser rótulo. */}
                                                                    <Button
                                                                        variant="secondary" size="sm" iconOnly
                                                                        tone={isSolving ? 'danger' : null}
                                                                        icon={isSolving ? X : Check}
                                                                        onClick={() => { setSolvingId(isSolving ? null : r.id); setComment(''); }}
                                                                        aria-pressed={isSolving}
                                                                        title={isSolving ? 'Cancelar' : 'Marcar revisada (atendida por fuera, sin enviar)'}
                                                                    />
                                                                    {/* Solventar de verdad: corrige la ficha si hace
                                                                        falta y vuelve a mandar el documento. */}
                                                                    <Button
                                                                        variant="secondary" size="sm" tone="success" soft
                                                                        icon={ShieldCheck}
                                                                        loading={enviandoId === r.id}
                                                                        onClick={() => handleRegularizarUna(r)}
                                                                        title="Corregir lo que haga falta y enviar este documento a Hacienda"
                                                                    >
                                                                        {enviandoId === r.id ? 'Enviando…' : 'Solventar'}
                                                                    </Button>
                                                                </>)}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                    {enCurso && (
                                                    <FormularioSolventar
                                                        encabezado={<>
                                                            <span className={`font-mono text-label font-black ${enCurso.tipo_documento === 'CCF' ? 'text-danger-text' : 'text-content-2'}`}>{enCurso.correlativo}</span>
                                                            {enCurso.cliente && <span className="text-label text-content-3 truncate min-w-0">· {enCurso.cliente}</span>}
                                                            <span className="ml-auto text-body-sm font-black text-content-2"><Monto v={enCurso.total} /></span>
                                                        </>}
                                                        comment={comment} setComment={setComment} saving={saving}
                                                        placeholder="Cómo se atendió (opcional)…"
                                                        onConfirmar={() => handleSolve(enCurso.id)}
                                                        onCancelar={() => { setSolvingId(null); setComment(''); }}
                                                    />
                                                )}
                                </>)}
                            </section>
                        );
                    })}
                </div>
            )}

            {/* Historial solventados */}
            {!loading && resolved.length > 0 && (
                <SeccionHistorial
                    refSeccion={resolvedSectionRef}
                    // El número del mes es el del SERVIDOR; el de la lista, lo
                    // que se está mostrando. Son dos cosas distintas y se dicen
                    // las dos (el encabezado llegó a anunciar «1000» sobre 10,770).
                    titulo={`${(confirmadasMes ?? resolvedThisMonth.length).toLocaleString('es-SV')} confirmada${confirmadasMes === 1 ? '' : 's'} por Hacienda este mes`}
                    subtitulo={`Historial de envíos · se muestran ${resolvedDisplay.length.toLocaleString('es-SV')}`}
                    abierta={showResolved}
                    onToggle={() => setShowResolved(v => !v)}
                    // «Ver todos» prometía traer el resto y no podía: la lista
                    // está topeada a propósito. Lo que hace es incluir las de
                    // meses anteriores —las marcadas a mano—, así que eso dice.
                    pie={resolved.length > resolvedThisMonth.length && (
                        <Button variant="ghost" onClick={() => setShowAllResolved(v => !v)}>
                            {showAllResolved
                                ? 'Ver solo este mes'
                                : `Ver también meses anteriores (${resolved.length - resolvedThisMonth.length})`}
                        </Button>
                    )}
                >
                    {resolvedDisplay.map((r, i) => {
                        const resolvedBy = r.resolution?.resolved_by || null;
                        return (
                            <FilaHistorial key={r.id} primera={i === 0}
                                quien={resolvedBy ? (empPhotoMap[resolvedBy] || null) : null}
                                nombre={resolvedBy} sinNombre="Recibida por Hacienda"
                                cuando={r.resolution?.resolved_at}
                                cuandoTexto={!r.resolution ? fechaLegible(r.fecha) : undefined}
                                comentario={r.resolution?.comment}>
                                <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento}</Badge>
                                {r.erp_invoice_id && <span className="font-mono text-body-sm font-black text-content">#{r.erp_invoice_id}</span>}
                                <span className="font-mono text-label text-content-3">{r.correlativo}</span>
                                <span className="text-label text-content-3">{getBranch(r.branch_id)}</span>
                                {r.total != null && <span className="text-body-sm font-bold text-content-2 ml-auto tabular-nums"><Monto v={r.total} /></span>}
                            </FilaHistorial>
                        );
                    })}
                </SeccionHistorial>
            )}
        </div>
    );
}

// ─── Tab: Saltos ──────────────────────────────────────────────────────────────
function TabSaltos({ branches, filterBranch, currentUser, canEdit, barraFiltros, onCuenta }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        // Devuelve la FICHA y no sólo la foto: `AvatarConEstado` necesita el
        // id para resolver el aro, y lo único que trae la fila es el NOMBRE de
        // quien resolvió. Con la ficha entera se recupera.
        for (const e of employees) if (e.name) m[e.name] = e;
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

    // Qué está pendiente, qué se solventó y la fila que se escribe salen del
    // núcleo (`colasDeFacturacion`): la app solventa igual.
    const gapKey = claveDeSalto;
    const pendingGaps = useMemo(() => saltosPendientes(gaps, gapResolutions), [gaps, gapResolutions]);
    const resolvedGaps = useMemo(() => saltosSolventados(gaps, gapResolutions), [gapResolutions, gaps]);

    const currentMonthStr = relojSV().toISOString().slice(0, 7);
    const resolvedGapsThisMonth = useMemo(() =>
        saltosSolventados(gaps, gapResolutions, currentMonthStr),
        [gaps, gapResolutions, currentMonthStr]
    );
    const resolvedGapsDisplay = showAllResolved ? resolvedGaps : resolvedGapsThisMonth;

    const handleSolveGap = async (gap) => {
        setSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const payload = filaDeSaltoSolventado(gap, comment, resolvedBy);
        const { data, error } = await insertGapResolution(payload, { branch_name: getBranch(gap.branch_id) });
        if (error) { avisarFalloAlSolventar(error, 'handleSolveGap'); setSaving(false); return; }
        if (data?.[0]) setGapResolutions(prev => [data[0], ...prev]);
        useToastStore.getState().showToast(
            'Salto solventado', `${gap.tipo_documento} ${gap.gap_from}–${gap.gap_to}`, 'success');
        setSolvingGap(null); setComment(''); setSaving(false);
    };

    const handleSolveNull = async (n) => {
        setNullSaving(true);
        const resolvedBy = currentUser?.name || currentUser?.email || 'Desconocido';
        const { error } = await insertNullResolution({
            null_id: n.id, comment: nullComment.trim() || null, resolved_by: resolvedBy,
        }, { branch: getBranch(n.branch_id), correlativo: n.correlativo, campos: n.campos_nulos });
        if (error) { avisarFalloAlSolventar(error, 'handleSolveNull'); setNullSaving(false); return; }
        useToastStore.getState().showToast('Campos nulos solventados', n.correlativo || '', 'success');
        setNullResolvedIds(prev => new Set([...prev, n.id]));
        setSolvingNull(null); setNullComment(''); setNullSaving(false);
    };

    const pad7 = correlativo7;

    const copyNullId = (val) => {
        if (!val) return;
        navigator.clipboard.writeText(String(val));
        setCopiedNullId(val);
        setTimeout(() => setCopiedNullId(null), 1500);
    };

    // Mismo caso que `grouped` de las otras colas: el orden de las secciones lo
    // decide el id numérico, y hoy coincide con el del negocio de casualidad.
    const gapsByBranch = {};
    for (const g of pendingGaps) {
        if (!gapsByBranch[g.branch_id]) gapsByBranch[g.branch_id] = [];
        gapsByBranch[g.branch_id].push(g);
    }

    // Los nulos que son sólo de Hacienda van en Pendientes MH (`nulosPendientes`).
    const activeNulls = nulosPendientes(nulls, nullResolvedIds);
    const nullsByBranch = {};
    for (const n of activeNulls) {
        if (!nullsByBranch[n.branch_id]) nullsByBranch[n.branch_id] = [];
        nullsByBranch[n.branch_id].push(n);
    }

    // Cuántos NÚMEROS faltan, no cuántos huecos: un salto de 1 y uno de 40
    // contaban igual en la tarjeta.
    const faltantes = pendingGaps.reduce((a, g) => a + (Number(g.gap_count) || 0), 0);

    useEffect(() => {
        if (!loading) onCuenta?.(pendingGaps.length + activeNulls.length);
    }, [loading, pendingGaps.length, activeNulls.length, onCuenta]);

    return (
        <div className="p-5 md:p-6 space-y-6">

            {/* Carril de métricas + píldora en UNA fila (§17.0). */}
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen de saltos de correlativo">
                    <StatCard
                        loading={loading}
                        icon={Hash} label="Saltos abiertos" value={pendingGaps.length}
                        sub={pendingGaps.length > 0 ? `${faltantes} número${faltantes !== 1 ? 's' : ''} faltante${faltantes !== 1 ? 's' : ''}` : 'Correlativos en orden'}
                        iconBg={pendingGaps.length > 0 ? 'bg-danger/10' : 'bg-success/10'}
                        iconCls={pendingGaps.length > 0 ? 'text-danger' : 'text-success'}
                        valueCls={pendingGaps.length > 0 ? 'text-danger' : 'text-success'}
                    />
                    <StatCard
                        loading={loading}
                        icon={AlertTriangle} label="Campos nulos" value={activeNulls.length}
                        sub={activeNulls.length > 0 ? 'Documentos incompletos' : undefined}
                        iconBg={activeNulls.length > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={activeNulls.length > 0 ? 'text-danger' : 'text-content-3'}
                        valueCls={activeNulls.length > 0 ? 'text-danger' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={CheckCircle2} label="Solventados" value={resolvedGapsThisMonth.length}
                        sub={`Este mes · ${resolvedGaps.length} en total`}
                        iconBg={resolvedGapsThisMonth.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                        iconCls={resolvedGapsThisMonth.length > 0 ? 'text-success' : 'text-content-3'}
                        valueCls={resolvedGapsThisMonth.length > 0 ? 'text-success' : 'text-content'}
                    />
                </CarrilCards>
                {barraFiltros && <div className="flex justify-end min-w-0">{barraFiltros}</div>}
            </div>

            {loading ? <EsqueletoCola /> : (<>

            {/* ── Saltos pendientes ── */}
            <div className="space-y-3">
                <h3 className="text-label font-black uppercase tracking-widest text-content-3 px-1">Saltos en correlativos</h3>

                {pendingGaps.length === 0 ? (
                    <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                        linea title="Sin saltos detectados" subtitle="Los correlativos están en orden. No hay brechas." />
                ) : (
                    <div className="space-y-6">
                        <Notice variant="info" icon={Info}>
                            Cada salto son números que faltan entre dos documentos emitidos seguidos. Si se anularon o se usaron en otra caja, se anota y se solventa.
                        </Notice>
                        {Object.entries(gapsByBranch).map(([branchId, branchGaps]) => {
                            const isCollapsed = !!collapsedGapBranches[branchId];
                            const hasCCF = branchGaps.some(g => g.tipo_documento === 'CCF');
                            const enCurso = branchGaps.find(g => solvingGap === gapKey(g));
                            return (
                                <section key={branchId} className="space-y-2.5">
                                    <EncabezadoSucursal
                                        nombre={getBranch(Number(branchId))}
                                        cuenta={branchGaps.length} unidad={branchGaps.length !== 1 ? 'saltos' : 'salto'}
                                        ccf={hasCCF} plegada={isCollapsed}
                                        onToggle={() => setCollapsedGapBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                    />
                                    {!isCollapsed && (<>
                                        <div className={GRILLA_TARJETAS}>
                                            {branchGaps.map((g) => {
                                                const key = gapKey(g);
                                                const isSolving = solvingGap === key;
                                                const isCCF = g.tipo_documento === 'CCF';
                                                return (
                                                    // El rango, cuántos faltan y el documento que
                                                    // destapó el hueco. Antes vivían en un tooltip,
                                                    // que en el teléfono no existe.
                                                    <div key={key} data-surface="card"
                                                        data-tono={isSolving ? 'warning' : isCCF ? 'danger' : undefined}
                                                        className="px-3.5 py-3 flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                                                        <div className="flex items-center gap-2">
                                                            <Badge variant={VARIANTE_DOC[g.tipo_documento] || 'neutral'} size="sm">{g.tipo_documento || '—'}</Badge>
                                                            <p className="flex-1 min-w-0 flex items-center gap-1.5 font-mono text-label font-black text-content">
                                                                <span>{pad7(g.gap_from)}</span>
                                                                <ArrowRight size={11} className="text-content-3 shrink-0" />
                                                                <span>{pad7(g.gap_to)}</span>
                                                            </p>
                                                            <Badge variant="chart-4" size="sm" uppercase={false}>
                                                                {g.gap_count} faltante{g.gap_count !== 1 ? 's' : ''}
                                                            </Badge>
                                                        </div>
                                                        {(g.siguiente_correlativo || g.fecha_siguiente) && (
                                                            <p className="mt-1.5 text-label text-content-3 truncate">
                                                                Después vino{' '}
                                                                {g.siguiente_correlativo && <span className="font-mono font-semibold text-content-2">{g.siguiente_correlativo}</span>}
                                                                {g.fecha_siguiente && <> · <span className="capitalize">{fechaLegible(g.fecha_siguiente)}</span></>}
                                                            </p>
                                                        )}
                                                        {canEdit && (
                                                            <div className="mt-auto pt-2.5">
                                                                <div className="flex justify-end border-t border-divider pt-2.5">
                                                                    <Button
                                                                        variant="secondary" size="sm"
                                                                        tone={isSolving ? 'danger' : 'success'} soft={!isSolving}
                                                                        icon={isSolving ? X : Check}
                                                                        aria-pressed={isSolving}
                                                                        onClick={() => { setSolvingGap(isSolving ? null : key); setComment(''); }}
                                                                    >
                                                                        {isSolving ? 'Cancelar' : 'Solventar'}
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* Un salto que el portal SABE qué era: la factura existió, se
                                            emitió, y el sistema de ventas la eliminó después (Salud 3,
                                            16-oct-2026). Va visible y no en el tooltip: en el teléfono el
                                            tooltip no existe, y es lo que hay que ir a resolver. */}
                                        {branchGaps.flatMap(g => g.desaparecidas || []).map((d) => (
                                            <Notice key={d.correlativo} variant={d.con_sello ? 'danger' : 'warning'} icon={AlertTriangle}>
                                                <span className="font-bold">
                                                    {d.correlativo?.endsWith('_CCF') ? 'Crédito fiscal' : 'Factura'} {pad7(Number(String(d.correlativo).split('_')[0]))} · se eliminó después de emitida
                                                </span>
                                                <span className="block mt-0.5 font-normal">
                                                    {fechaTexto(d.fecha, { day: '2-digit', month: 'short' })} {hora12(d.hora)} · <Monto v={d.total} /> · {d.tipo_pago || '—'} · {d.cliente || '—'}
                                                </span>
                                                <span className="block mt-0.5 font-normal">
                                                    {d.con_sello
                                                        ? 'Hacienda la tiene recibida: hay que invalidarla o restituirla. Ya no cuenta como venta en el portal.'
                                                        : 'No llegó a Hacienda. Ya no cuenta como venta en el portal.'}
                                                </span>
                                            </Notice>
                                        ))}
                                        {enCurso && (
                                            <FormularioSolventar
                                                encabezado={
                                                    <p className="font-mono text-label font-black text-content-2">
                                                        {getBranch(enCurso.branch_id)} · {enCurso.tipo_documento} {pad7(enCurso.gap_from)} → {pad7(enCurso.gap_to)} · <span className="text-chart-4-text">{enCurso.gap_count} faltante{enCurso.gap_count !== 1 ? 's' : ''}</span>
                                                    </p>
                                                }
                                                comment={comment} setComment={setComment} saving={saving}
                                                placeholder="Qué pasó con esos números (opcional)…"
                                                onConfirmar={() => handleSolveGap(enCurso)}
                                                onCancelar={() => { setSolvingGap(null); setComment(''); }}
                                            />
                                        )}
                                    </>)}
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Campos nulos ── */}
            <div className="space-y-3">
                <h3 className="text-label font-black uppercase tracking-widest text-content-3 px-1">Campos indefinidos / nulos</h3>
                {activeNulls.length === 0 ? (
                    <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                        linea title="Sin campos indefinidos" subtitle="Todos los documentos tienen sus campos completos." />
                ) : (
                    <div className="space-y-6">
                        {Object.entries(nullsByBranch).map(([branchId, branchNulls]) => {
                            const isCollapsed = !!collapsedNullBranches[branchId];
                            const enCurso = branchNulls.find(n => n.id === solvingNull);
                            return (
                                <section key={branchId} className="space-y-2.5">
                                    <EncabezadoSucursal
                                        nombre={getBranch(Number(branchId))}
                                        cuenta={branchNulls.length} plegada={isCollapsed}
                                        onToggle={() => setCollapsedNullBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                    />
                                    {!isCollapsed && (<>
                                        <div className={GRILLA_TARJETAS}>
                                            {branchNulls.map(n => {
                                                const isSolving = solvingNull === n.id;
                                                const copyVal = n.erp_invoice_id || n.correlativo;
                                                return (
                                                    <div key={n.id} data-surface="card"
                                                        data-tono={isSolving ? 'warning' : 'danger'}
                                                        className="px-3.5 py-3 flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-base)]">
                                                        <div className="flex items-start gap-2">
                                                            <p className="flex-1 min-w-0 truncate font-mono text-label font-black text-content" title={n.correlativo || undefined}>
                                                                {n.correlativo || `ID ${n.id}`}
                                                            </p>
                                                            {n.fecha && <span className="shrink-0 text-micro font-bold text-content-3 capitalize">{fechaLegible(n.fecha)}</span>}
                                                        </div>
                                                        <p className="mt-1.5 text-micro font-bold uppercase tracking-widest text-content-3">Le falta</p>
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {(n.campos_nulos || []).map(c => (
                                                                <Badge key={c} variant="danger" size="sm" uppercase={false}>{c}</Badge>
                                                            ))}
                                                        </div>
                                                        <div className="mt-auto pt-2.5">
                                                            <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5">
                                                                <BotonCopiarId erpId={copyVal} copiado={copiedNullId === copyVal} onCopiar={() => copyNullId(copyVal)} />
                                                                {canEdit && (
                                                                    <Button
                                                                        variant="secondary" size="sm" className="ml-auto"
                                                                        tone={isSolving ? 'danger' : 'success'} soft={!isSolving}
                                                                        icon={isSolving ? X : Check}
                                                                        aria-pressed={isSolving}
                                                                        onClick={() => { setSolvingNull(isSolving ? null : n.id); setNullComment(''); }}
                                                                    >
                                                                        {isSolving ? 'Cancelar' : 'Solventar'}
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {enCurso && (
                                            <FormularioSolventar
                                                encabezado={<p className="font-mono text-label font-black text-content-2">{enCurso.correlativo || (enCurso.erp_invoice_id ? `#${enCurso.erp_invoice_id}` : `ID ${enCurso.id}`)}</p>}
                                                comment={nullComment} setComment={setNullComment} saving={nullSaving}
                                                onConfirmar={() => handleSolveNull(enCurso)}
                                                onCancelar={() => { setSolvingNull(null); setNullComment(''); }}
                                            />
                                        )}
                                    </>)}
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ── Historial solventados ── */}
            {resolvedGaps.length > 0 && (
                <SeccionHistorial
                    refSeccion={resolvedSectionRef}
                    titulo={`${showAllResolved ? resolvedGaps.length : resolvedGapsThisMonth.length} salto${(showAllResolved ? resolvedGaps.length : resolvedGapsThisMonth.length) !== 1 ? 's' : ''} solventado${(showAllResolved ? resolvedGaps.length : resolvedGapsThisMonth.length) !== 1 ? 's' : ''} ${showAllResolved ? 'en total' : 'este mes'}`}
                    subtitulo="Historial de resoluciones"
                    abierta={showHistorial}
                    onToggle={() => setShowHistorial(v => !v)}
                    pie={<Button variant="ghost" onClick={() => setShowAllResolved(v => !v)}>{showAllResolved ? `Ver solo este mes (${resolvedGapsThisMonth.length})` : `Ver todos (${resolvedGaps.length})`}</Button>}
                >
                    {resolvedGapsDisplay.length === 0 && (
                        <p className="px-5 py-4 text-label text-content-3">Nada solventado este mes.</p>
                    )}
                    {resolvedGapsDisplay.map((r, i) => (
                        <FilaHistorial key={r.id} primera={i === 0}
                            quien={r.resolved_by ? (empPhotoMap[r.resolved_by] || null) : null}
                            nombre={r.resolved_by} cuando={r.resolved_at} comentario={r.comment}>
                            <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento}</Badge>
                            <span className="text-body font-bold text-content-2">{getBranch(r.branch_id)}</span>
                            <span className="font-mono text-label text-content-3">{pad7(r.gap_from)} → {pad7(r.gap_to)}</span>
                        </FilaHistorial>
                    ))}
                </SeccionHistorial>
            )}
            </>)}
        </div>
    );
}

// ─── Tab: No Efectivo ─────────────────────────────────────────────────────────
function TabNoEfectivo({ branches, filterBranch, searchTerm, currentUser, canEdit, barraFiltros, selectedMonth, onCuenta }) {
    const employees = useStaff((state) => state.employees);
    // Quién confirmó: la ficha por el nombre guardado, para la foto y el
    // nombre corto (antes la foto nunca salía: preguntaba por un campo que la
    // fila no trae).
    const empPorNombre = useMemo(() => {
        const m = {};
        for (const e of employees) if (e.name) m[e.name] = e;
        return m;
    }, [employees]);
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
            // Si la subida falla, NO se confirma (decisión del usuario,
            // 2026-09-26). Antes se seguía sin comprobante y en silencio: la
            // persona adjuntó el archivo, vio «Pago confirmado» en verde, y el
            // pago quedaba sin comprobante sin que nadie lo supiera. Quien no
            // adjunta nada sigue confirmando igual que siempre.
            try {
                proofUrl = await subirArchivo('payment-proofs', path, confirmFile);
            } catch (e) {
                console.error('handleConfirm: subir comprobante:', e?.message);
                useToastStore.getState().showToast(
                    'No se pudo subir el comprobante',
                    'El pago no se confirmó. Revisa la conexión e intenta de nuevo.',
                    'error',
                );
                setConfirmSaving(false); return;
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

        const { data, error } = await insertPaymentConfirmation(payload, { correlativo: inv?.correlativo });
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

        useToastStore.getState().showToast('Pago confirmado', inv?.correlativo || '', 'success');

        setConfirmingId(null); setConfirmNotes(''); setConfirmFile(null);
        setConfirmSaving(false);
    };

    const totalPending = useMemo(() => pendingFiltered.reduce((a, r) => a + parseFloat(r.total || 0), 0), [pendingFiltered]);

    useEffect(() => { if (!loading) onCuenta?.(pendingFiltered.length); }, [loading, pendingFiltered.length, onCuenta]);

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
                            loading={loading}
                            icon={CreditCard} label="Por confirmar" value={pendingFiltered.length}
                            sub={pendingFiltered.length > 0 ? 'Tarjeta, transferencia, crédito…' : 'Todo confirmado'}
                            iconBg={pendingFiltered.length > 0 ? 'bg-chart-1/10' : 'bg-surface-card-hover'}
                            iconCls={pendingFiltered.length > 0 ? 'text-chart-1-text' : 'text-content-3'}
                            valueCls={pendingFiltered.length > 0 ? 'text-chart-1-text' : 'text-content'}
                        />
                        <StatCard
                            loading={loading}
                            icon={CreditCard} label="Monto" value={<Monto v={totalPending} />}
                            sub="Por confirmar"
                            iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                            valueCls="text-chart-1-text"
                        />
                        <StatCard
                            loading={loading}
                            icon={CheckCircle2} label="Confirmados" value={confirmed.length}
                            sub="Historial completo"
                            iconBg={confirmed.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                            iconCls={confirmed.length > 0 ? 'text-success' : 'text-content-3'}
                            valueCls={confirmed.length > 0 ? 'text-success' : 'text-content'}
                        />
                    </CarrilCards>
                    {barraFiltros && <div className="flex justify-end min-w-0">{barraFiltros}</div>}
                </div>
                {/* El desglose por forma de pago: etiquetas, no métricas. Decía
                    «tarjeta 5» en minúscula — el código crudo, no el rótulo. */}
                {!loading && Object.keys(byTipo).length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {Object.entries(byTipo).map(([tipo, rows]) => (
                            <Badge key={tipo} variant={TIPO_PAGO_VARIANTE[tipo] || 'neutral'} size="sm" uppercase={false}>
                                {TIPO_PAGO_LABELS[tipo] || tipo} · {rows.length}
                            </Badge>
                        ))}
                    </div>
                )}
            </div>

            {loading ? (
                <div className="p-4 md:p-6 space-y-5">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} data-surface="card" className="overflow-hidden">
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
                    title={searchTerm ? 'Sin resultados' : 'Nada por confirmar'}
                    subtitle={searchTerm
                        ? `Ningún pago pendiente coincide con «${searchTerm}».`
                        : 'No hay pagos con tarjeta, transferencia o crédito pendientes de confirmar en este mes.'} />
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

            {/* Confirmados — misma anatomía que los historiales de las otras
                colas. Era un `Button` secundario suelto pegado al borde, sin
                margen, que no se leía como sección. */}
            {confirmed.length > 0 && (
                <div className="px-4 md:px-6 pb-5 md:pb-6">
                <SeccionHistorial
                    titulo={`${confirmed.length.toLocaleString('es-SV')} pago${confirmed.length !== 1 ? 's' : ''} confirmado${confirmed.length !== 1 ? 's' : ''}`}
                    subtitulo="Historial de confirmaciones, con su comprobante"
                    abierta={showConfirmed}
                    onToggle={() => setShowConfirmed(v => !v)}
                >
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
                                    const dt = r.confirmed_at ? fechaHora12(r.confirmed_at, { month: 'short', day: '2-digit' }) : '—';
                                    return (
                                        <DataRow key={r.id} index={ci}>
                                            <DataCell>
                                                <Badge variant={TIPO_PAGO_VARIANTE[tipoPago] || 'neutral'} size="sm">{TIPO_PAGO_LABELS[tipoPago] || r.tipo_pago}</Badge>
                                            </DataCell>
                                            <DataCell>
                                                <div className="font-mono text-body-sm text-content-2">{inv?.correlativo || '—'}</div>
                                            </DataCell>
                                            <DataCell hideBelow="md">{getBranch(r.branch_id)}</DataCell>
                                            <DataCell hideBelow="lg" className="max-w-[140px] truncate">{inv?.cliente || '—'}</DataCell>
                                            <DataCell className="whitespace-nowrap tabular-nums">{fechaNumerica(inv?.fecha, { anio: 'corto', vacio: '—' })}</DataCell>
                                            <DataCell className="font-bold whitespace-nowrap">{<Monto v={inv?.total} />}</DataCell>
                                            <DataCell>
                                                <div className="flex items-center gap-2">
                                                    <AvatarConEstado emp={empPorNombre[r.confirmed_by] || null} px={28} radio="rounded-full" marco="" />
                                                    <span className="text-body-sm font-semibold text-content-2 whitespace-nowrap">
                                                        {r.confirmed_by ? shortEmployeeName(empPorNombre[r.confirmed_by] || r.confirmed_by) : '—'}
                                                    </span>
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
                </SeccionHistorial>
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
// dejó de emitirlo (migración 20260731203801) — ver la nota de la frontera
// en `fetchPendingMhInvoices`.
//
// `RECHAZADA_POR_HACIENDA` **no lo contradice**, y conviene no confundirlos: no
// mira el plazo, mira que Hacienda ya contestó que no y que el reintento
// automático ya se ejercitó. Una factura así no está esperando nada — no se
// arregla sola, y la frontera de esta pestaña siempre fue ésa.
// El catálogo de observaciones y qué se puede solventar: `colasDeFacturacion`
// (núcleo, lo mismo de la app).

// Rango completo a propósito: las observaciones son raras (~190 sobre 338 mil
// facturas) y lo que hace falta es verlas TODAS, no las del mes en curso.
const OBS_DESDE = '2000-01-01';
const OBS_HASTA = '2099-12-31';

function TabObservaciones({ branches, filterBranch, searchTerm, currentUser, canEdit, barraFiltros, obsCode, onConteos, onCuenta }) {
    const employees = useStaff((state) => state.employees);
    const empPhotoMap = useMemo(() => {
        const m = {};
        // Devuelve la FICHA y no sólo la foto: `AvatarConEstado` necesita el
        // id para resolver el aro, y lo único que trae la fila es el NOMBRE de
        // quien resolvió. Con la ficha entera se recupera.
        for (const e of employees) if (e.name) m[e.name] = e;
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
    // `|| !esSolventable(r)`: una resolución vieja no puede tapar un rechazo de
    // Hacienda que llegó después. La tabla no distingue por código, así que la
    // distinción se hace acá.
    const pendientes = useMemo(() => observacionesPendientes(rows, resoluciones), [rows, resoluciones]);

    // Manda la resolución más reciente (la tabla es append-only). La regla vive
    // en el núcleo para que la app pinte el mismo historial.
    const resueltas = useMemo(() => observacionesSolventadas(rows, resoluciones), [rows, resoluciones]);

    const conteos = useMemo(() => conteoDeObservaciones(pendientes), [pendientes]);

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
        }, { correlativo: inv?.correlativo, observaciones: inv?.observaciones || [], resolved_by: resolvedBy });
        if (err) { avisarFalloAlSolventar(err, 'handleSolve (observaciones)'); setSaving(false); return; }
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

    useEffect(() => { if (!loading) onCuenta?.(error ? 0 : filtered.length); }, [loading, error, filtered.length, onCuenta]);

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                {/* Tarjetas FIJAS (§17.0): el carril lo dibuja la vista, no el
                    dato. El desglose por código es la ranura "Observación" de
                    la píldora, con su conteo por opción. */}
                <CarrilCards className="flex-1" ariaLabel="Resumen de observaciones">
                    <StatCard
                        loading={loading}
                        icon={AlertTriangle} label="Facturas" value={pendientes.length}
                        sub={obsCode ? `${filtered.length} en el filtro` : 'Con anomalías'}
                        iconBg={pendientes.length > 0 ? 'bg-danger/10' : 'bg-surface-card-hover'}
                        iconCls={pendientes.length > 0 ? 'text-danger' : 'text-content-3'}
                        valueCls={pendientes.length > 0 ? 'text-danger' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={History} label="Más antigua"
                        value={pendientes.length > 0 ? `${diasMasVieja}d` : '—'}
                        sub="Sin solventar"
                        iconCls={diasMasVieja > 30 ? 'text-warning-text' : 'text-content-3'}
                        iconBg={diasMasVieja > 30 ? 'bg-warning/10' : 'bg-surface-card-hover'}
                        valueCls={diasMasVieja > 30 ? 'text-warning-text' : 'text-content'}
                    />
                    <StatCard
                        loading={loading}
                        icon={CheckCircle2} label="Solventadas" value={resueltas.length}
                        sub="Ya revisadas"
                        iconBg={resueltas.length > 0 ? 'bg-success/10' : 'bg-surface-card-hover'}
                        iconCls={resueltas.length > 0 ? 'text-success' : 'text-content-3'}
                        valueCls={resueltas.length > 0 ? 'text-success' : 'text-content'}
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
                <div className="flex items-center justify-end gap-2 min-w-0">
                    {barraFiltros}
                </div>
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
                <EsqueletoCola />
            ) : !error && filtered.length === 0 ? (
                // Vacío por FILTRO no es lo mismo que vacío de verdad: con la
                // ranura puesta hay pendientes, sólo que ninguna de esa clase.
                <EmptyState icon={CheckCircle2} iconClass="text-success" glowClass="bg-success"
                    title={(obsCode || searchTerm) && pendientes.length > 0 ? 'Sin resultados' : 'Sin observaciones'}
                    subtitle={obsCode && pendientes.length > 0
                        ? `Ninguna de las ${pendientes.length} pendientes cae en "${metaObs(obsCode).label}".`
                        : searchTerm && pendientes.length > 0
                            ? `Ninguna observación pendiente coincide con «${searchTerm}».`
                            : resueltas.length > 0
                                ? 'Todas las observaciones abiertas fueron solventadas.'
                                : 'Ninguna factura tiene datos fuera de lo esperado.'} />
            ) : !error && (
                <div className="space-y-6">
                    {/* Misma anatomía que Pendiente MH: sucursal colapsable → fecha →
                        tarjetas. Lo que cambia es la hoja: acá cada documento lleva
                        SUS observaciones, que es el dato de la pestaña. */}
                    {Object.entries(grouped).map(([branchId, byFecha]) => {
                        const docs = Object.values(byFecha).flat();
                        const branchHasCCF = docs.some(r => r.tipo_documento === 'CCF');
                        const isCollapsed  = !!collapsedBranches[branchId];
                        const enCurso = docs.find(x => x.id === solvingId);
                        return (
                            <section key={branchId} className="space-y-2.5">
                                <EncabezadoSucursal
                                    nombre={getBranch(Number(branchId))}
                                    cuenta={docs.length} ccf={branchHasCCF}
                                    plegada={isCollapsed}
                                    onToggle={() => setCollapsedBranches(prev => ({ ...prev, [branchId]: !prev[branchId] }))}
                                />

                                {!isCollapsed && (<>
                                    <div className={GRILLA_TARJETAS}>
                                                    {docs.map(r => {
                                                        const isSolving = solvingId === r.id;
                                                        const solventable = esSolventable(r);
                                                        return (
                                                            <TarjetaDocumento
                                                                tonoFecha={r.tipo_documento === 'CCF' ? 'danger' : null}
                                                                key={r.id}
                                                                r={r}
                                                                tono={isSolving ? 'warning' : undefined}
                                                                isCopied={copiedId === r.erp_invoice_id}
                                                                isVisited={visitedIds.has(String(r.erp_invoice_id))}
                                                                onCopiar={() => copyErpId(r.erp_invoice_id)}
                                                                acciones={canEdit && solventable && (
                                                                    <Button
                                                                        variant="secondary" size="sm"
                                                                        tone={isSolving ? 'danger' : 'success'} soft={!isSolving}
                                                                        icon={isSolving ? X : Check}
                                                                        aria-pressed={isSolving}
                                                                        onClick={() => { setSolvingId(isSolving ? null : r.id); setComment(''); }}
                                                                    >
                                                                        {isSolving ? 'Cancelar' : 'Solventar'}
                                                                    </Button>
                                                                )}
                                                            >
                                                                {/* Las observaciones: el dato de la pestaña. */}
                                                                <div className="mt-2 flex flex-wrap gap-1">
                                                                    {(r.observaciones || []).map(code => {
                                                                        const meta = metaObs(code);
                                                                        return <Badge key={code} variant={meta.variant} size="sm" uppercase={false}>{meta.label}</Badge>;
                                                                    })}
                                                                </div>
                                                                {/* El valor crudo del sello cuando NO es un sello: es el
                                                                    dato que delata el problema, así que se muestra. */}
                                                                {r.recibido_mh && r.recibido_mh.length !== 40 && (
                                                                    <div className="font-mono text-micro text-danger-text mt-1.5 break-all">sello: &ldquo;{r.recibido_mh}&rdquo;</div>
                                                                )}
                                                                {/* Lo que contestó Hacienda, literal y completo. Un
                                                                    código no dice qué corregir: «[receptor.direccion.
                                                                    distrito] VALOR NO ES PERMITIDO» sí. */}
                                                                {(r.motivos_mh || []).length > 0 && (
                                                                    <div className="mt-1.5 space-y-0.5 rounded-lg bg-danger/10 px-2 py-1.5">
                                                                        {r.motivos_mh.map((m, i) => (
                                                                            <div key={`${i}-${m}`} className="text-micro text-danger-text break-words">{m}</div>
                                                                        ))}
                                                                        {!solventable && (
                                                                            <div className="text-micro text-content-3">
                                                                                Se cierra sola cuando llegue el sello.
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </TarjetaDocumento>
                                                        );
                                                    })}
                                                </div>
                                    {enCurso && (
                                                    <FormularioSolventar
                                                        encabezado={<>
                                                            <span className={`font-mono text-label font-black ${enCurso.tipo_documento === 'CCF' ? 'text-danger-text' : 'text-content-2'}`}>{enCurso.correlativo}</span>
                                                            {(enCurso.observaciones || []).map(code => {
                                                                const meta = metaObs(code);
                                                                return <Badge key={code} variant={meta.variant} size="sm" uppercase={false}>{meta.label}</Badge>;
                                                            })}
                                                            <span className="ml-auto text-body-sm font-black text-content-2"><Monto v={enCurso.total} /></span>
                                                        </>}
                                                        comment={comment} setComment={setComment} saving={saving}
                                                        placeholder="Qué se revisó o corrigió (opcional)…"
                                                        onConfirmar={() => handleSolve(enCurso.id)}
                                                        onCancelar={() => { setSolvingId(null); setComment(''); }}
                                                    />
                                                )}
                                </>)}
                            </section>
                        );
                    })}
                </div>
            )}

            {/* Historial de solventadas. Lo que se solventa sale de la lista de
                arriba, así que sin esta sección desaparecería sin dejar rastro
                visible — y la observación sigue existiendo en la factura. */}
            {!loading && resueltas.length > 0 && (
                <SeccionHistorial
                    titulo={`${resueltas.length} solventada${resueltas.length !== 1 ? 's' : ''}`}
                    subtitulo="Observaciones ya revisadas"
                    abierta={showResolved}
                    onToggle={() => setShowResolved(v => !v)}
                >
                    {resueltas.map((r, i) => {
                        const resolvedBy = r.resolution?.resolved_by || null;
                        return (
                            <FilaHistorial key={r.id} primera={i === 0}
                                quien={resolvedBy ? (empPhotoMap[resolvedBy] || null) : null}
                                nombre={resolvedBy} sinNombre="Solventada"
                                cuando={r.resolution?.resolved_at}
                                comentario={r.resolution?.comment}
                                pie={(r.observaciones || []).length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-1">
                                        {r.observaciones.map(code => {
                                            const meta = metaObs(code);
                                            return <Badge key={code} variant={meta.variant} size="sm" uppercase={false}>{meta.label}</Badge>;
                                        })}
                                    </div>
                                )}>
                                <Badge variant={VARIANTE_DOC[r.tipo_documento] || 'neutral'} size="sm">{r.tipo_documento || '—'}</Badge>
                                {r.erp_invoice_id && <span className="font-mono text-body-sm font-black text-content">#{r.erp_invoice_id}</span>}
                                <span className="font-mono text-label text-content-3">{r.correlativo}</span>
                                <span className="text-label text-content-3">{getBranch(r.branch_id)}</span>
                                {r.total != null && <span className="text-body-sm font-bold text-content-2 ml-auto tabular-nums"><Monto v={r.total} /></span>}
                            </FilaHistorial>
                        );
                    })}
                </SeccionHistorial>
            )}
        </div>
    );
}

// Observaciones va PEGADA a Pendiente MH: las dos miran el mismo documento en la
// misma ventana de tiempo (una el sello, la otra cualquier otra anomalía) y en la
// práctica se saltan entre sí. Saltos y No Efectivo son otro trabajo.
//
// `tono` es el color del número de la pestaña: rojo donde lo pendiente es un
// documento fiscal mal cerrado, ámbar donde es algo que espera.
const TABS = [
    { key: 'anuladas',      label: 'Anuladas',      icon: Ban,           tono: 'danger'  },
    { key: 'pendiente_mh',  label: 'Pendiente MH',  icon: Clock,         tono: 'warning' },
    { key: 'observaciones', label: 'Observaciones', icon: AlertTriangle, tono: 'danger'  },
    { key: 'saltos',        label: 'Saltos',        icon: Hash,          tono: 'warning' },
    { key: 'no_efectivo',   label: 'No Efectivo',   icon: CreditCard,    tono: 'neutral' },
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
    const [solventando, setSolventando] = useState(false);
    // El cable entre la píldora de filtros y la pestaña activa: la acción vive
    // acá y los datos allá, y son hermanas, no una hija de la otra.
    const recargaRef = useRef(null);

    // El mes de No Efectivo vivía como un `LiquidSelect` suelto dentro de la
    // pestaña — un filtro fuera de la píldora, que es justo lo que §17 prohíbe.
    // Sube acá para poder ocupar su ranura; el orden de §17 lo pone después de
    // sucursal (ámbito → tiempo).
    const mesPorDefecto = useMemo(() => {
        const now = relojSV();
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
    // cinco pestañas cargan solas al montarse. O sea que abrir «Anuladas» traía
    // también el backlog de Pendiente MH, No Efectivo, Saltos y Observaciones:
    // medido, 6 lecturas de `sales_invoices` —la tabla de 548K filas, paginada
    // con fetchAllRows— por 231 kB, más `get_invoice_observations`, que con
    // 2.9 s era la llamada más lenta de la vista sin estar a la vista.
    // Se quedan montadas después de visitarlas: volver no re-pide ni pierde el
    // filtro, que es lo que el `hidden` compraba.
    const [visitadas, setVisitadas] = useState(() => new Set([activeTab]));
    if (!visitadas.has(activeTab)) setVisitadas(new Set(visitadas).add(activeTab));

    // ── El número de cada pestaña (2026-10-17) ──────────────────────────────
    // Cada pestaña reporta cuánto tiene pendiente al terminar de cargar, y la
    // barra lo pinta en su píldora. Sólo de las VISITADAS: las demás no cargan
    // hasta que se abren (ver arriba), y un número inventado —o un cero que
    // no se midió— diría que ahí no hay nada. Una vez visitada se queda
    // montada y su número sigue al día con el sondeo.
    const [cuentas, setCuentas] = useState({});
    const reportarCuenta = useMemo(() => {
        const m = {};
        for (const t of TABS) m[t.key] = (n) => setCuentas(prev => (prev[t.key] === n ? prev : { ...prev, [t.key]: n }));
        return m;
    }, []);

    const [filterBranch, setFilterBranch] = useState(
        getScope('facturacion') !== 'ALL' ? String(currentUser?.branchId || '') : ''
    );
    // El desglose por código de Observaciones vive acá arriba porque es una
    // RANURA de la píldora (§17.0): la pestaña reporta sus conteos y el filtro
    // se elige donde se eligen todos los filtros de la vista. Como tarjetas en
    // el carril eran N métricas para una sola pregunta, y encima no filtraban.
    const [obsCode, setObsCode] = useState('');
    const [obsConteos, setObsConteos] = useState([]);
    const [rawSearch, setRawSearch, debouncedSearch] = useBusqueda();
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
            tabs={allowedTabs.map(t => ({ key: t.key, label: t.label, icon: t.icon, cuenta: cuentas[t.key], tono: cuentas[t.key] ? t.tono : undefined }))}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            showSearch={hasSearch}
            searchValue={rawSearch}
            onSearchChange={setRawSearch}
            placeholder={searchPlaceholder}
        />
    );

    // ── «Solventar todas», la acción de la vista (2026-08-16) ───────────────
    // Aquí vivía «Pausar», que apagaba el sondeo automático. Se quitó a pedido
    // del usuario: la lista se relee sola cada uno o dos minutos y nadie
    // necesitaba congelarla — era un interruptor de más en una barra donde cada
    // control compite por el pulgar.
    //
    // La acción de verdad es ésta, y va acá porque §17 dice que los controles
    // de la vista viven en la píldora de filtros. Como descriptor, además, la
    // barra flotante táctil la dibuja sola en el clúster del pulgar; como
    // `<Button>` suelto al lado de la píldora se quedaba fuera.
    const bolsaDeLaPestana = activeTab === 'anuladas' ? 'anuladas'
                           : activeTab === 'pendiente_mh' ? 'sin_sello' : null;
    const accionesFacturacion = (bolsaDeLaPestana && canEdit) ? [{
        key: 'solventar-todas',
        icon: solventando ? Loader2 : ShieldCheck,
        label: solventando ? 'Enviando…' : 'Solventar todas',
        // El rótulo del clúster táctil es otro texto a propósito: medido en un
        // iPhone 13 con tres acciones, «Solventar» —9 caracteres, el techo justo
        // de `LARGO_ROTULO_CLUSTER`— sale cortado como «SOLVENT…». Un rótulo con
        // puntos suspensivos no nombra nada, y el nombre completo sigue estando
        // en el tooltip y en el panel de «Otros».
        rotulo: 'Enviar',
        title: `Corregir lo que haga falta y enviar a Hacienda lo pendiente de ${
            filterBranch ? (branches.find(b => String(b.id) === String(filterBranch))?.name || 'esta sucursal')
                         : 'todas las sucursales'}`,
        disabled: solventando,
        tone: 'success',
        onClick: async () => {
            setSolventando(true);
            // La pestaña publica su recarga en `recargaRef`; si por lo que sea
            // no llegó, el sondeo de un minuto la trae igual — degrada, no falla.
            await solventarTodas({
                filterBranch, bolsa: bolsaDeLaPestana,
                onDone: () => recargaRef.current?.(),
            });
            setSolventando(false);
        },
    }] : [];

    // La píldora se dibuja SIEMPRE: quien tiene alcance de una sola sucursal no
    // ve la ranura de sucursal, pero sí la acción. Antes la condición envolvía la
    // barra entera, así que al mover la acción acá se le habría desaparecido a
    // todo el personal de sucursal.
    const puedeElegirSucursal = getScope('facturacion') === 'ALL';
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
                        <TabAnuladas onCuenta={reportarCuenta.anuladas} canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch} currentUser={currentUser}
                            recargaRef={recargaRef} barraFiltros={activeTab === 'anuladas' ? filtrosCuerpo : null} />
                    </div>
                )}
                {visitadas.has('pendiente_mh') && (
                    <div className={activeTab === 'pendiente_mh' ? '' : 'hidden'}>
                        <TabPendienteMH onCuenta={reportarCuenta.pendiente_mh} canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch} currentUser={currentUser}
                            recargaRef={recargaRef} barraFiltros={activeTab === 'pendiente_mh' ? filtrosCuerpo : null} />
                    </div>
                )}
                {visitadas.has('saltos') && (
                    <div className={activeTab === 'saltos' ? '' : 'hidden'}>
                        <TabSaltos onCuenta={reportarCuenta.saltos} canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} currentUser={currentUser}
                            barraFiltros={activeTab === 'saltos' ? filtrosCuerpo : null} />
                    </div>
                )}
                {visitadas.has('no_efectivo') && (
                    <div className={activeTab === 'no_efectivo' ? '' : 'hidden'}>
                        <TabNoEfectivo onCuenta={reportarCuenta.no_efectivo} canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch} currentUser={currentUser}
                            barraFiltros={activeTab === 'no_efectivo' ? filtrosCuerpo : null} selectedMonth={selectedMonth} />
                    </div>
                )}
                {visitadas.has('observaciones') && (
                    <div className={activeTab === 'observaciones' ? '' : 'hidden'}>
                        <TabObservaciones onCuenta={reportarCuenta.observaciones} canEdit={canEdit} branches={salesBranches} filterBranch={filterBranch} searchTerm={debouncedSearch}
                            currentUser={currentUser} obsCode={obsCode} onConteos={setObsConteos}
                            barraFiltros={activeTab === 'observaciones' ? filtrosCuerpo : null} />
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
}
