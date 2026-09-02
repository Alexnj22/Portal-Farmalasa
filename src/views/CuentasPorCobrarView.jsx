import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, CalendarClock, HandCoins, RefreshCw, Search, ShoppingBag, UserCircle2 } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import LiquidModal from '../components/common/LiquidModal';
import LiquidSelect from '../components/common/LiquidSelect';
import Notice from '../components/common/Notice';
import PortalInput from '../components/common/PortalInput';
import TablePagination from '../components/common/TablePagination';
import AvatarConEstado from '../components/common/AvatarConEstado';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { usePaginaEnUrl } from '../hooks/usePaginaEnUrl';
import { abonarCredito, DIAS_DE_PLAZO, edadDelCredito, fetchCreditoDetalle, fetchCreditos, fetchUltimaLectura } from '../data/creditos';
import { mensajeAmigable } from '../utils/errorMessages';
import { formatMoney } from '../utils/formatNumber';
/* `fechaCorta` sale de `ticketCampos` y no se reescribe acá: es la MISMA
 * pregunta —«dd/mm/aaaa sin que el huso corra un día»— y el archivo no importa
 * nada, así que no arrastra el maquetador del rollo. Escribirla dos veces es
 * cómo dos pantallas terminan mostrando días distintos. */
import { fechaCorta } from '../utils/ticketCampos';
import { tokenMatch } from '../utils/searchUtils';

/**
 * CUENTAS POR COBRAR — quién debe, desde cuándo, y cobrarle.
 *
 * ── Por qué es una vista y no una pestaña de Efectivo ─────────────────────
 * Nació como la cuarta pestaña de Efectivo y el usuario la sacó de ahí el
 * 2-sep: «agregalo como vista nueva, Cuentas por cobrar». Tiene razón de fondo
 * y no es sólo de acomodo — Efectivo contesta *«¿cuadra el dinero de HOY?»* y
 * esto contesta *«¿quién nos debe de los últimos dos años?»*. Comparten el
 * cajón, no la pregunta: la cartera se revisa en otro momento, la mira otra
 * gente, y su período es todo el histórico y no el día.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Medido el 2026-09-01 leyendo las seis salas de verdad: **2,386 créditos, de
 * los cuales 126 con saldo — $4,646.21 entre 43 clientes**. De esos, **35
 * pasados del mes de plazo** y el más viejo con **462 días**. No había ninguna
 * pantalla que los listara: para saber quién debía había que entrar sala por
 * sala al sistema de la caja y recorrer una tabla de 800 filas.
 *
 * ── El plazo es un HALLAZGO, no un candado ────────────────────────────────
 * Pasarse del mes no bloquea nada —el portal no decide a quién se le fía— pero
 * se ve, y se puede filtrar. Un plazo que nadie mira es un plazo que no existe:
 * el crédito de 462 días lo prueba.
 *
 * ── Lo que esta pantalla guarda y el origen no ────────────────────────────
 * Allá el abono queda a nombre del usuario de la caja, que en varias salas es
 * una cuenta compartida. Acá firma quien tiene la sesión, y eso vive en
 * `creditos_abonos_portal`.
 */

/** Las formas de pago que la caja acepta, tal cual las ofrece su desplegable. */
const FORMAS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', 'Voucher', 'Recibo', 'Bitcoin', 'Otro'];

const VER = [
    { value: 'DEBEN',    label: 'Con saldo' },
    { value: 'VENCIDOS', label: 'Pasados del plazo' },
    { value: 'TODOS',    label: 'Todos' },
];

const VACIO = [];

/** Hace cuánto se leyó la cartera, en palabras. Un reloj exacto obliga a restar
 *  de cabeza; lo que se quiere saber es sólo si está al día. */
function desdeLaLectura(iso) {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (min < 2)  return 'Al día';
    if (min < 60) return `Leído hace ${min} min`;
    const h = Math.round(min / 60);
    return `Leído hace ${h} h`;
}

export default function CuentasPorCobrarView() {
    const { hasPermission, getScope, user } = useAuth();
    const branches = useStaff((s) => s.branches) || VACIO;
    const showToast = useToastStore((s) => s.showToast);

    const puedeAbonar = hasPermission('cuentas_por_cobrar', 'can_edit');
    const alcance     = getScope('cuentas_por_cobrar');

    /* La sala vive en la DIRECCIÓN y no en `useState`: la sesión de sala se
     * cierra sola a los 5 minutos y la recarga volvería a «todas» sin decir
     * nada, con la lista de otra sucursal delante. */
    const [params, setParams] = useSearchParams();
    const sala = params.get('sala') || '';
    const setSala = useCallback((v) => {
        setParams((p) => {
            const q = new URLSearchParams(p);
            if (v) q.set('sala', String(v)); else q.delete('sala');
            q.delete('pagina');
            return q;
        }, { replace: true });
    }, [setParams]);

    const [busqueda, setBusqueda] = useState('');
    const [ver, setVer] = useState('DEBEN');
    const [creditos, setCreditos] = useState(VACIO);
    const [cargando, setCargando] = useState(true);
    const [abonando, setAbonando] = useState(null);
    const [viendo, setViendo] = useState(null);
    const [lectura, setLectura] = useState(null);

    /* Con alcance de una sala, el selector no se dibuja y la lista es la propia
     * —el servidor la acota igual—, así que no hay forma de mirar otra. */
    const salas = useMemo(() => {
        const propias = alcance === 'ALL'
            ? branches
            : branches.filter((b) => b.id === (user?.branchId ?? user?.branch_id));
        return propias.filter((b) => b.name !== 'Bodega' && b.name !== 'Administracion');
    }, [branches, alcance, user]);

    const nombreDeSala = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);


    /* Sale del ESPEJO del portal, que un cron refresca cada hora. Antes se leía
     * en vivo del sistema de la caja y abrir la pantalla costaba seis
     * peticiones EN SERIE —la sucursal vive en su sesión, no se pueden hacer a
     * la vez—, o sea varios segundos de espera cada vez.
     *
     * El cobro sigue releyendo el origen: la lista se mira acá, el cobro se
     * decide allá. */
    const cargar = useCallback(async () => {
        setCargando(true);
        const [r, l] = await Promise.all([
            /* Sólo «Todos» baja el histórico entero (2,387 filas). Los otros dos
             * recortes viven dentro de los que deben, así que la base manda 124
             * y el navegador no filtra nada que ya podía no haber traído. */
            fetchCreditos({ sala: sala || null, soloConSaldo: ver !== 'TODOS' }),
            fetchUltimaLectura(),
        ]);
        if (r?.error) {
            showToast('No se pudo leer la cartera', mensajeAmigable(r.error), 'error');
            setCreditos(VACIO);
        } else {
            setCreditos(r?.creditos || VACIO);
        }
        setLectura(l);
        setCargando(false);
    }, [sala, ver, showToast]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial y al cambiar de sala

    const conEdad = useMemo(
        () => creditos.map((c) => ({ ...c, ...edadDelCredito(c.fecha, c.saldo) })),
        [creditos],
    );

    const filtrados = useMemo(() => conEdad.filter((c) => {
        if (ver === 'DEBEN' && c.saldo <= 0.004) return false;
        if (ver === 'VENCIDOS' && (c.saldo <= 0.004 || !c.vencido)) return false;
        return tokenMatch(busqueda, c.cliente, c.documento, nombreDeSala.get(c.branch_id), String(c.saldo));
    // Los más viejos arriba: son los que hay que ir a cobrar, y es el orden en
    // que alguien recorre la lista con el teléfono en la mano.
    }).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)), [conEdad, ver, busqueda, nombreDeSala]);

    /* 50 y no 25: con 25 la sala más cargada (47 con saldo) quedaba partida en
     * dos páginas y la última fila de la primera mostraba UNA tarjeta con dos
     * huecos al lado. Los tamaños son los del portal —25/50/100— así que el
     * default es lo único que se puede elegir acá. */
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({
        total: filtrados.length, tamPorDefecto: 50,
    });
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    const totalDebido = useMemo(
        () => filtrados.reduce((t, c) => t + (Number(c.saldo) || 0), 0),
        [filtrados],
    );
    const vencidos = useMemo(
        () => conEdad.filter((c) => c.saldo > 0.004 && c.vencido).length,
        [conEdad],
    );

    const cobrar = useCallback(async ({ monto, forma, documento }) => {
        const r = await abonarCredito({
            sala: abonando.branch_id, credito: abonando.credito, monto, forma, documento,
        });
        if (r?.error || r?.ok === false) {
            showToast('No se pudo abonar', mensajeAmigable(r.error || r), 'error');
            return false;
        }
        if (r.aviso) showToast('Quedó algo pendiente', r.aviso, 'warning');
        else {
            showToast('Abono registrado',
                `${abonando.cliente} · queda ${formatMoney(r.saldo_despues)}`, 'success');
        }
        setAbonando(null);
        cargar();
        return true;
    }, [abonando, showToast, cargar]);

    const filtersContent = (
        <ViewTabBar
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder="Buscar por cliente, documento o monto…"
        />
    );

    return (
        <GlassViewLayout icon={HandCoins} title="Cuentas por cobrar" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-4">

                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Las dos cifras que la lista no contesta de un vistazo:
                        cuánto suma lo que se está mirando, y cuántos ya se
                        pasaron del plazo — que es el número que decide si hay
                        que salir a cobrar hoy. */}
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <span className="min-w-0">
                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                                Por cobrar
                            </span>
                            <span className="block text-h3 font-black tabular-nums text-content">
                                {formatMoney(totalDebido)}
                            </span>
                        </span>
                        <span className="min-w-0">
                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">
                                Pasados del plazo
                            </span>
                            <span className={`block text-h3 font-black tabular-nums ${
                                vencidos ? 'text-warning-text' : 'text-content-2'}`}>
                                {vencidos}
                            </span>
                        </span>

                        {/* Cuándo se leyó. Una lista congelada se ve exactamente
                            igual de bien que una fresca, así que el sello es lo
                            único que las distingue. Y se dice en horas y no con
                            un reloj: lo que importa es si está al día. */}
                        {lectura?.corrio_el && (
                            <span className="min-w-0 flex items-center gap-1.5 text-micro text-content-3">
                                <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                {desdeLaLectura(lectura.corrio_el)}
                            </span>
                        )}
                    </div>

                    <FilterBar
                        onClear={() => { setVer('DEBEN'); setSala(''); }}
                        activeCount={(ver !== 'DEBEN' ? 1 : 0) + (sala ? 1 : 0)}
                    >
                        <FilterBar.Section active={ver !== 'DEBEN'} onClear={() => setVer('DEBEN')} label="ver">
                            <FilterBar.Opciones
                                label="Ver" icon={CalendarClock}
                                value={ver} onChange={(v) => { setVer(v || 'DEBEN'); setPage(1); }}
                                options={VER} ancho="185px"
                            />
                        </FilterBar.Section>

                        {/* Con una sola sala no se dibuja: un control con una
                            opción no es una elección, y ocupa el lugar de una. */}
                        {salas.length > 1 && (
                            <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                <FilterBar.Opciones
                                    label="Sucursal" icon={Building2}
                                    value={sala} onChange={(v) => setSala(v || '')}
                                    options={[{ value: '', label: 'Todas' },
                                        ...salas.map((b) => ({ value: String(b.id), label: b.name }))]}
                                    ancho="165px"
                                />
                            </FilterBar.Section>
                        )}
                    </FilterBar>
                </div>

                {cargando ? (
                    <LoadingState label="Leyendo la cartera de las salas" />
                ) : !filtrados.length ? (
                    busqueda ? (
                        <EmptyState compact icon={Search} title="Sin resultados"
                            subtitle={`Ningún crédito coincide con «${busqueda}».`}
                            action={<Button variant="secondary" onClick={() => setBusqueda('')}>Limpiar la búsqueda</Button>} />
                    ) : (
                        /* Un vacío FELIZ cuando es «con saldo»: nadie debe nada.
                           Se nombra como tal en vez de dejar el cartel gris de
                           «no hay datos», que se lee como que algo falló. */
                        <EmptyState compact icon={HandCoins}
                            title={ver === 'VENCIDOS' ? 'Nadie se pasó del plazo' : 'Nadie debe nada'}
                            subtitle={ver === 'VENCIDOS'
                                ? `Todos los créditos con saldo están dentro de los ${DIAS_DE_PLAZO} días.`
                                : 'Todos los créditos están pagados.'}
                            action={ver !== 'TODOS'
                                ? <Button variant="secondary" onClick={() => setVer('TODOS')}>Ver todos</Button>
                                : undefined} />
                    )
                ) : (
                    <>
                        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                            {pagina.map((c) => (
                                <div key={`${c.branch_id}-${c.credito}`}
                                    /* El estado va en el TONO de la tarjeta y no
                                       en una franja de color: DESIGN.md §5.1 —
                                       `[data-surface][data-tono]` sube la
                                       especificidad sola y el estado se lee en el
                                       marcado. Una franja además obligaba a
                                       `overflow-hidden`, que recorta el foco. */
                                    /* Sin `data-tono`: el aro de color decía lo
                                       mismo que la insignia de días y el usuario
                                       lo pidió fuera —«con el badge se
                                       entiende»—. Dos señales para un solo dato
                                       es ruido, y con 25 tarjetas en pantalla el
                                       aro ámbar se comía la jerarquía. */
                                    data-surface="card"
                                    data-interactive
                                    role="button" tabIndex={0}
                                    onClick={() => setViendo(c)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViendo(c); }
                                    }}
                                    className="rounded-2xl p-3 flex flex-col gap-2 min-w-0 text-left
                                               min-h-[var(--tap-min)] active:scale-[0.97] transition-transform">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="min-w-0">
                                            <span className="block text-body-sm font-bold text-content truncate">
                                                {c.cliente}
                                            </span>
                                            <span className="block text-micro text-content-3 truncate">
                                                {nombreDeSala.get(c.branch_id) || `Sucursal ${c.branch_id}`} · {c.documento}
                                            </span>
                                        </span>
                                        {c.saldo > 0.004 && (
                                            <Badge variant={c.vencido ? 'warning' : 'neutral'} size="sm">
                                                {c.dias} día{c.dias === 1 ? '' : 's'}
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Las dos fechas que el usuario pidió ver sin
                                        abrir nada: cuándo compró y cuándo pagó por
                                        última vez. Lo segundo sólo existe para lo
                                        cobrado DESDE el portal, así que se dice con
                                        esas palabras y no con un guion — un guion
                                        se leería como «nunca abonó». */}
                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-content-3">
                                        <span>Compró el {fechaCorta(c.fecha)}</span>
                                        <span aria-hidden="true">·</span>
                                        <span>{c.ultimo_abono_el
                                            ? `Último abono ${fechaCorta(c.ultimo_abono_el)}`
                                            : 'Sin abonos desde el portal'}</span>
                                    </span>

                                    {c.vendedor?.name && (
                                        <span className="flex items-center gap-1.5 text-micro text-content-3 min-w-0">
                                            {/* `AvatarConEstado` y no `LiquidAvatar` a secas: es
                                                el canónico (DESIGN.md §5.4) y resuelve la ficha
                                                por id contra el store, así que la foto —ya
                                                firmada en el arranque— y el aro de vacaciones o
                                                incapacidad salen sin que esta vista sepa nada.
                                                Sin chip: a 20 px no cabe, y acá lo que importa
                                                es la cara. */}
                                            <AvatarConEstado emp={{ id: c.vendedor_id, name: c.vendedor.name }}
                                                px={20} mostrarChip={false} radio="rounded-full" />
                                            <span className="truncate">Le vendió {c.vendedor.name}</span>
                                        </span>
                                    )}

                                    <div className="flex items-end justify-between gap-3 pt-1 border-t border-border/60">
                                        <span className="min-w-0">
                                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">Debe</span>
                                            <span className={`block text-body font-black tabular-nums ${
                                                c.saldo > 0.004 ? 'text-content' : 'text-success-text'}`}>
                                                {formatMoney(c.saldo)}
                                            </span>
                                        </span>
                                        <span className="min-w-0 text-right">
                                            <span className="block text-micro font-black uppercase tracking-widest text-content-3">De</span>
                                            <span className="block text-body-sm tabular-nums text-content-2">
                                                {formatMoney(c.total)}
                                            </span>
                                        </span>
                                    </div>

                                    {puedeAbonar && c.saldo > 0.004 && (
                                        /* `stopPropagation` porque la tarjeta entera
                                           abre el detalle: sin esto, cobrar abriría
                                           además el panel detrás del diálogo. */
                                        <Button variant="secondary" size="sm" icon={HandCoins}
                                            onClick={(e) => { e.stopPropagation(); setAbonando(c); }}>
                                            Abonar
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {filtrados.length > pageSize && (
                            <TablePagination page={page} totalPages={totalPages} onPageChange={setPage}
                                pageSize={pageSize} onPageSizeChange={setPageSize}
                                total={filtrados.length} unit="créditos" />
                        )}
                    </>
                )}
            </div>

            {viendo && (
                <FichaDelCredito credito={viendo} onClose={() => setViendo(null)}
                    onAbonar={puedeAbonar ? () => { setViendo(null); setAbonando(viendo); } : undefined} />
            )}

            {abonando && (
                <DialogoAbono credito={abonando} onClose={() => setAbonando(null)} onCobrar={cobrar} />
            )}
        </GlassViewLayout>
    );
}

/**
 * La ficha completa de un crédito: qué compró, quién le vendió, y cada abono.
 *
 * Pedido del usuario (2-sep): «al tocar la card que muestre toda la información
 * incluido la compra». Los renglones salen de las ventas del portal —los 124
 * créditos con saldo tienen los suyos— así que abrir esto no sale a la red del
 * otro sistema.
 */
function FichaDelCredito({ credito, onClose, onAbonar }) {
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);

    const cargar = useCallback(async () => {
        setCargando(true);
        const d = await fetchCreditoDetalle(credito.id);
        setDatos(d?.error ? null : d);
        setCargando(false);
    }, [credito.id]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- al abrir la ficha

    const c = datos?.credito;
    const compra = datos?.compra || VACIO;
    const abonos = datos?.abonos || VACIO;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Ficha del crédito">
            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-h3 font-bold text-content truncate">{credito.cliente}</h3>
                        <p className="text-body-sm text-content-2 mt-0.5 truncate">
                            {c?.sala || ''}{c?.sala ? ' · ' : ''}{credito.documento}
                        </p>
                    </div>
                    {credito.saldo > 0.004 && (
                        <Badge variant={credito.vencido ? 'warning' : 'neutral'} size="sm">
                            {credito.dias} día{credito.dias === 1 ? '' : 's'}
                        </Badge>
                    )}
                </div>

                {cargando ? <LoadingState label="Abriendo la ficha" /> : (
                    <>
                        {/* Las tres cifras juntas: lo que costó, lo que lleva
                            pagado y lo que falta. Separadas obligan a restar de
                            cabeza, que es de donde salen los errores de cobro. */}
                        <div className="grid grid-cols-3 gap-2">
                            {[['Compró por', c?.total ?? credito.total, 'text-content-2'],
                              ['Lleva pagado', c?.abonado ?? 0, 'text-success-text'],
                              ['Debe', c?.saldo ?? credito.saldo, 'text-content']].map(([r, v, tono]) => (
                                <span key={r} data-surface="card" className="rounded-xl p-2.5 min-w-0">
                                    <span className="block text-micro font-black uppercase tracking-widest text-content-3">{r}</span>
                                    <span className={`block text-body font-black tabular-nums ${tono}`}>{formatMoney(v)}</span>
                                </span>
                            ))}
                        </div>

                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-body-sm">
                            {[['Fecha de compra', fechaCorta(c?.fecha || credito.fecha)],
                              ['Último abono', c?.ultimo_abono_el
                                  ? fechaCorta(c.ultimo_abono_el)
                                  : 'ninguno desde el portal'],
                              ['Documento', `${c?.tipo_doc || ''} ${credito.documento || ''}`.trim()]].map(([k, v]) => (
                                <div key={k} className="flex items-baseline justify-between gap-3 min-w-0">
                                    <dt className="text-content-3 shrink-0">{k}</dt>
                                    <dd className="text-content font-medium text-right truncate">{v}</dd>
                                </div>
                            ))}
                            {/* «Le vendió» va aparte de la lista de arriba porque
                                lleva CARA: en una fila de texto la foto obligaría
                                a alinear por la línea de base y quedaría cortada. */}
                            <div className="flex items-center justify-between gap-3 min-w-0">
                                <dt className="text-content-3 shrink-0">Le vendió</dt>
                                <dd className="flex items-center gap-2 min-w-0">
                                    {c?.vendedor && (
                                        <AvatarConEstado emp={{ id: c.vendedor_id, name: c.vendedor }}
                                            px={26} mostrarChip={false} radio="rounded-full" />
                                    )}
                                    <span className="text-content font-medium truncate">
                                        {c?.vendedor || 'sin registrar'}
                                    </span>
                                </dd>
                            </div>
                        </dl>

                        <section className="space-y-2">
                            <h4 className="flex items-center gap-1.5 text-body-sm font-bold text-content">
                                <ShoppingBag className="w-4 h-4 shrink-0" aria-hidden="true" />
                                Lo que se llevó
                            </h4>
                            {compra.length === 0 ? (
                                <p className="text-body-sm text-content-3">
                                    No se encontraron los productos de esta compra.
                                </p>
                            ) : (
                                /* Lista y no tabla: en el teléfono una tabla de
                                   cuatro columnas se parte o se sale, y acá lo
                                   que importa es el nombre del producto. */
                                <ul className="space-y-1.5">
                                    {compra.map((r) => (
                                        <li key={r.id} className="flex items-baseline justify-between gap-3 min-w-0
                                                                   border-b border-border/40 pb-1.5 last:border-0">
                                            <span className="min-w-0">
                                                <span className="block text-body-sm text-content truncate">{r.descripcion}</span>
                                                <span className="block text-micro text-content-3">
                                                    {Number(r.cantidad)} × {formatMoney(r.precio_unitario)}
                                                    {r.presentacion ? ` · ${r.presentacion}` : ''}
                                                </span>
                                            </span>
                                            <span className="text-body-sm tabular-nums text-content shrink-0">
                                                {formatMoney(r.total_linea)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        <section className="space-y-2">
                            <h4 className="flex items-center gap-1.5 text-body-sm font-bold text-content">
                                <HandCoins className="w-4 h-4 shrink-0" aria-hidden="true" />
                                Abonos
                            </h4>
                            {abonos.length === 0 ? (
                                /* Se dice «desde el portal» a propósito: el otro
                                   sistema no expone la fecha de sus abonos, sólo
                                   el acumulado. Un «sin abonos» a secas sería
                                   falso para un crédito que ya pagó la mitad. */
                                <p className="text-body-sm text-content-3">
                                    Todavía no se le ha cobrado desde el portal.
                                    {(c?.abonado ?? 0) > 0.004 && ` Lleva ${formatMoney(c.abonado)} abonados desde la caja.`}
                                </p>
                            ) : (
                                <ul className="space-y-1.5">
                                    {abonos.map((a) => (
                                        <li key={a.id} className="flex items-baseline justify-between gap-3 min-w-0
                                                                   border-b border-border/40 pb-1.5 last:border-0">
                                            <span className="min-w-0">
                                                <span className="block text-body-sm text-content">
                                                    {formatMoney(a.monto)} · {a.forma}
                                                    {a.documento ? ` (${a.documento})` : ''}
                                                </span>
                                                <span className="block text-micro text-content-3 truncate">
                                                    {new Date(a.created_at).toLocaleString('es-SV', {
                                                        day: '2-digit', month: '2-digit', year: 'numeric',
                                                        hour: '2-digit', minute: '2-digit',
                                                    })} · {a.cobrado_por || 'sin identificar'}
                                                </span>
                                            </span>
                                            <span className="text-micro tabular-nums text-content-3 shrink-0">
                                                quedó {formatMoney(a.saldo_despues)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>
                    </>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cerrar</Button>
                    {onAbonar && credito.saldo > 0.004 && (
                        <Button variant="primary" icon={HandCoins} onClick={onAbonar}>Abonar</Button>
                    )}
                </div>
            </div>
        </LiquidModal>
    );
}

function DialogoAbono({ credito, onClose, onCobrar }) {
    const [monto, setMonto] = useState('');
    const [forma, setForma] = useState('Efectivo');
    const [documento, setDocumento] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const n = Number(monto);
    /* El tope es el saldo LEÍDO en pantalla; el servidor lo vuelve a comprobar
     * contra el origen antes de escribir, porque entre una cosa y la otra
     * pueden haber cobrado en la caja. */
    const excede = Number.isFinite(n) && n > credito.saldo + 0.004;
    const valido = Number.isFinite(n) && n > 0 && !excede;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-sm" ariaLabel="Abonar al crédito">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Abonar al crédito</h3>
                    <p className="text-body-sm text-content-2 mt-1 flex items-center gap-1.5">
                        <UserCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {credito.cliente}
                    </p>
                </div>

                <div className="flex items-baseline justify-between gap-3 text-body-sm">
                    <span className="text-content-2">Debe</span>
                    <span className="tabular-nums font-black text-content">{formatMoney(credito.saldo)}</span>
                </div>

                {/* Nunca `type="number"`: en el teclado del teléfono no tiene
                    separador decimal y la rueda del mouse cambia el monto sin
                    que nadie lo toque. */}
                <PortalInput label="Cuánto abona" inputMode="decimal" value={monto} autoFocus
                    onChange={(e) => setMonto(e.target.value)} placeholder="0.00" />
                <LiquidSelect label="Forma de pago" value={forma} onChange={(v) => setForma(v || 'Efectivo')}
                    options={FORMAS.map((f) => ({ value: f, label: f }))} clearable={false} />
                {forma !== 'Efectivo' && (
                    <PortalInput label="Número de documento" value={documento} maxLength={40}
                        onChange={(e) => setDocumento(e.target.value)} placeholder="si lo hubiere" />
                )}

                {excede && (
                    <Notice variant="danger" icon={AlertTriangle}>
                        No se puede abonar más de lo que debe. Con un monto mayor el crédito quedaría
                        en negativo y el cliente habría pagado de más.
                    </Notice>
                )}

                {forma === 'Efectivo' && (
                    <Notice variant="info">
                        El efectivo entra al cajón y cuenta para el corte del día.
                    </Notice>
                )}

                <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={onClose}>Cancelar</Button>
                    <Button variant="primary" disabled={ocupado || !valido}
                        onClick={async () => {
                            setOcupado(true);
                            await onCobrar({ monto: n, forma, documento: documento.trim() });
                            setOcupado(false);
                        }}>
                        Abonar
                    </Button>
                </div>
            </div>
        </LiquidModal>
    );
}
