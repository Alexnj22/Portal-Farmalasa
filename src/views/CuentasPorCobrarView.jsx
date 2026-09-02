import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Building2, CalendarClock, HandCoins, RefreshCw, Search, UserCircle2 } from 'lucide-react';
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
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useAuth } from '../context/AuthContext';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { usePaginaEnUrl } from '../hooks/usePaginaEnUrl';
import { abonarCredito, DIAS_DE_PLAZO, edadDelCredito, fetchCreditos, fetchUltimaLectura } from '../data/creditos';
import { mensajeAmigable } from '../utils/errorMessages';
import { formatMoney } from '../utils/formatNumber';
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

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
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
                                <div key={`${c.branch_id}-${c.credito}`} data-surface="card"
                                    className="rounded-2xl overflow-hidden flex flex-col">
                                    {/* La banda dice el estado antes de leer nada:
                                        ámbar es un plazo vencido, y ése es el
                                        único que pide salir a cobrar. */}
                                    <span className={`h-[3px] ${c.vencido ? 'bg-warning' : c.saldo > 0.004 ? 'bg-brand' : 'bg-success'}`}
                                        aria-hidden="true" />
                                    <div className="p-3 flex flex-col gap-2 min-w-0">
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
                                            <Button variant="secondary" size="sm" icon={HandCoins}
                                                onClick={() => setAbonando(c)}>
                                                Abonar
                                            </Button>
                                        )}
                                    </div>
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

            {abonando && (
                <DialogoAbono credito={abonando} onClose={() => setAbonando(null)} onCobrar={cobrar} />
            )}
        </GlassViewLayout>
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
