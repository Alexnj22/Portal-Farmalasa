import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, HandCoins, Search, UserCircle2 } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import TablePagination from '../common/TablePagination';
import { EmptyState, LoadingState } from '../common/StateViews';
import { useToastStore } from '../../store/toastStore';
import { abonarCredito, DIAS_DE_PLAZO, edadDelCredito } from '../../data/creditos';
import { mensajeAmigable } from '../../utils/errorMessages';
import { formatMoney } from '../../utils/formatNumber';
import { tokenMatch } from '../../utils/searchUtils';
import { usePaginaEnUrl } from '../../hooks/usePaginaEnUrl';

/**
 * Quién debe, desde cuándo, y cobrarle.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Medido el 1-sep antes de escribir una línea: **126 créditos con saldo entre
 * las seis salas, $4,646.21, 43 clientes**. De esos, **35 pasados del mes de
 * plazo** ($443.70) y el más viejo con **462 días**. No había ninguna pantalla
 * que los listara: para saber quién debía había que entrar sala por sala al
 * sistema de la caja y mirar una tabla de 800 filas.
 *
 * ── El plazo es un HALLAZGO, no un candado ────────────────────────────────
 * Pasarse del mes no bloquea nada —el portal no decide a quién se le fía— pero
 * se ve, y se puede filtrar. Un plazo que nadie mira es un plazo que no existe:
 * el crédito de 462 días lo prueba.
 *
 * ── Lo que la lista muestra y el origen no ────────────────────────────────
 * Allá el abono queda a nombre del usuario de la caja, que en tres de las seis
 * salas es una cuenta compartida. Acá, quien cobra es quien tiene la sesión, y
 * eso queda en `creditos_abonos_portal`.
 */

const FORMAS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cheque', 'Voucher', 'Recibo', 'Bitcoin', 'Otro'];

const VER = [
    { value: 'DEBEN',    label: 'Con saldo' },
    { value: 'VENCIDOS', label: 'Pasados del plazo' },
    { value: 'TODOS',    label: 'Todos' },
];

export default function CreditosDeClientes({
    creditos = [], salas, cargando = false, busqueda = '', puedeAbonar = false,
    onLimpiarBusqueda, onAbonado,
}) {
    const showToast = useToastStore((s) => s.showToast);
    const [ver, setVer] = useState('DEBEN');
    const [abonando, setAbonando] = useState(null);

    const conEdad = useMemo(() => creditos.map((c) => ({ ...c, ...edadDelCredito(c.fecha) })), [creditos]);

    const filtrados = useMemo(() => conEdad.filter((c) => {
        if (ver === 'DEBEN' && c.saldo <= 0.004) return false;
        if (ver === 'VENCIDOS' && (c.saldo <= 0.004 || !c.vencido)) return false;
        return tokenMatch(busqueda, c.cliente, c.documento, salas?.get(c.branch_id), String(c.saldo));
    // Los más viejos arriba: son los que hay que ir a cobrar, y es el orden en
    // que alguien recorre la lista con el teléfono en la mano.
    }).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)), [conEdad, ver, busqueda, salas]);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

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
        onAbonado?.();
        return true;
    }, [abonando, showToast, onAbonado]);

    if (cargando) return <LoadingState label="Leyendo los créditos" />;

    if (!filtrados.length) {
        return busqueda ? (
            <EmptyState compact icon={Search} title="Sin resultados"
                subtitle={`Ningún crédito coincide con «${busqueda}».`}
                action={<Button variant="secondary" onClick={onLimpiarBusqueda}>Limpiar la búsqueda</Button>} />
        ) : (
            /* Un vacío FELIZ cuando es «con saldo»: nadie debe nada. Se nombra
               como tal en vez de dejar el mismo cartel gris de «no hay datos». */
            <EmptyState compact icon={HandCoins}
                title={ver === 'VENCIDOS' ? 'Nadie se pasó del plazo' : 'Nadie debe nada'}
                subtitle={ver === 'VENCIDOS'
                    ? `Todos los créditos con saldo están dentro de los ${DIAS_DE_PLAZO} días.`
                    : 'Todos los créditos están pagados.'}
                action={ver !== 'TODOS'
                    ? <Button variant="secondary" onClick={() => setVer('TODOS')}>Ver todos</Button>
                    : undefined} />
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div style={{ width: '190px' }}>
                    <LiquidSelect label="Ver" value={ver} onChange={(v) => setVer(v || 'DEBEN')}
                        options={VER} clearable={false} compact />
                </div>
                <span className="text-caption text-content-3">
                    {filtrados.length} crédito{filtrados.length === 1 ? '' : 's'} ·{' '}
                    <span className="tabular-nums font-bold text-content">
                        {formatMoney(filtrados.reduce((t, c) => t + (Number(c.saldo) || 0), 0))}
                    </span>
                </span>
            </div>

            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                {pagina.map((c) => (
                    <div key={`${c.branch_id}-${c.credito}`} data-surface="card"
                        className="rounded-2xl overflow-hidden flex flex-col">
                        {/* La banda dice el estado antes de leer nada: ámbar es
                            un plazo vencido, y ése es el único que pide acción. */}
                        <span className={`h-[3px] ${c.vencido ? 'bg-warning' : c.saldo > 0.004 ? 'bg-brand' : 'bg-success'}`}
                            aria-hidden="true" />
                        <div className="p-3 flex flex-col gap-2 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                                <span className="min-w-0">
                                    <span className="block text-body-sm font-bold text-content truncate">
                                        {c.cliente}
                                    </span>
                                    <span className="block text-micro text-content-3">
                                        {salas?.get(c.branch_id) || `Sucursal ${c.branch_id}`} · {c.documento}
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

            {abonando && (
                <DialogoAbono credito={abonando} onClose={() => setAbonando(null)} onCobrar={cobrar} />
            )}
        </div>
    );
}

function DialogoAbono({ credito, onClose, onCobrar }) {
    const [monto, setMonto] = useState('');
    const [forma, setForma] = useState('Efectivo');
    const [documento, setDocumento] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const n = Number(monto);
    // El tope es el saldo LEÍDO en pantalla; el servidor lo vuelve a comprobar
    // contra el origen antes de escribir, porque entre una cosa y la otra
    // pueden haber cobrado en la caja.
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
