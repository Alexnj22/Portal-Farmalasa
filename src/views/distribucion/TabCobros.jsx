import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { HandCoins, AlertTriangle, CalendarClock, Wallet, Search, CheckCircle2, TrendingDown, Gauge } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { formatMoney, formatMoneyCorto, formatQty } from '@nucleo/utils/formatNumber';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { usePaginaEnUrl } from '../../plataforma/usePaginaEnUrl';
import { fetchCartera, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { rotuloTipoCliente } from './comun';
import { TRAMOS, tramoDe } from './cartera';
import CarteraClienteModal from './CarteraClienteModal';

// Cuentas por cobrar de la distribuidora: quién debe, desde cuándo, y cobrarle.
// Pedido del usuario (2026-09-30), con la cartera de las farmacias como
// muestra. Todo sale de `dist_cartera()` en una llamada (borrador 0014).
//
// Arriba lo que importa en un vistazo —cuánto hay en la calle, cuánto está
// atrasado, qué vence esta semana y cuánto se cobró este mes— y la antigüedad
// de saldos como una barra: tocar un tramo filtra la lista. La pestaña (en la
// dirección) separa con saldo, atrasados y los que deben más que su límite.

const COLS = [
    { key: 'cliente',  label: 'Cliente',   align: 'left', className: 'w-[240px]' },
    { key: 'saldo',    label: 'Debe',      align: 'right' },
    { key: 'vencido',  label: 'Atrasado',  align: 'right', hideBelow: 'sm' },
    { key: 'limite',   label: 'Límite',    align: 'left', hideBelow: 'md' },
    { key: 'cobro',    label: 'Último cobro', align: 'left', hideBelow: 'lg' },
    { key: 'acciones', label: '',          align: 'right' },
];
// Los mismos colores por tramo en la barra y en los botones, y suben de
// gravedad: verde, ámbar, naranja, rojo (paleta vigente, DESIGN §6).
const COLOR_TRAMO = { al_dia: 'bg-success', '1_30': 'bg-warning', '31_60': 'bg-chart-4', '61_90': 'bg-danger', mas_90: 'bg-chart-6' };

export default function TabCobros({ emisor, puedeVender, puedeConfigurar, buscar, vista = 'saldo' }) {
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState('');
    const [tramo, setTramo] = useState('');
    const [abierto, setAbierto] = useState(null);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError('');
        try {
            setDatos(await fetchCartera());
        } catch (e) {
            console.error('cartera', e);
            setError(mensajeDeDistribucion(e));
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    const r = datos?.resumen ?? {};
    const antiguedad = datos?.antiguedad ?? [];
    const totalAnt = antiguedad.reduce((a, t) => a + Number(t.monto), 0) || 1;
    const clientes = useMemo(() => datos?.clientes ?? [], [datos]);

    const filtrados = useMemo(() => {
        const q = (buscar ?? '').trim();
        return clientes.filter(c =>
            (vista !== 'vencidos' || Number(c.vencido) > 0)
            && (vista !== 'limite' || Number(c.saldo) > Number(c.limite_credito))
            && (!tramo || tramoDe(c.dias_atraso) === tramo)
            && (!q || tokenMatch(q, c.nombre, c.ruta)));
    }, [clientes, vista, tramo, buscar]);
    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtrados.length });
    useEffect(() => { setPage(1); }, [vista, tramo, buscar]); // eslint-disable-line react-hooks/exhaustive-deps
    const pagina = filtrados.slice((page - 1) * pageSize, page * pageSize);

    return (
        <div className="p-3 md:p-5 flex flex-col gap-4">
            {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}

            <CarrilCards ariaLabel="Resumen de la cartera">
                <StatCard icon={Wallet} label="Por cobrar" value={formatMoney(Number(r.por_cobrar ?? 0))} loading={cargando}
                    iconBg="bg-brand/10" iconCls="text-brand-text" sub={`${formatQty(Number(r.clientes ?? 0))} clientes con saldo`} />
                <StatCard icon={AlertTriangle} label="Atrasado" value={formatMoney(Number(r.vencido ?? 0))} loading={cargando}
                    iconBg="bg-danger/10" iconCls="text-danger" valueCls={Number(r.vencido) > 0 ? 'text-danger-text' : undefined}
                    sub={`${formatQty(Number(r.clientes_vencidos ?? 0))} clientes pasados del plazo`} />
                <StatCard icon={CalendarClock} label="Vence en 7 días" value={formatMoney(Number(r.vence_7 ?? 0))} loading={cargando}
                    iconBg="bg-warning/10" iconCls="text-warning" sub="Para cobrar esta semana" />
                <StatCard icon={HandCoins} label="Cobrado este mes" value={formatMoney(Number(r.cobrado_mes ?? 0))} loading={cargando}
                    iconBg="bg-success/10" iconCls="text-success" sub="Cobros sin anular" />
            </CarrilCards>

            {/* ── Antigüedad de saldos: el ancho de cada tramo ES su parte del total ── */}
            <section data-surface="card" className="p-4 flex flex-col gap-3" aria-label="Antigüedad de saldos">
                <div className="flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-body font-black text-content"><Gauge size={16} className="text-brand-text" /> Antigüedad de saldos</h3>
                    {tramo && <Button size="sm" variant="ghost" onClick={() => setTramo('')}>Ver todos</Button>}
                </div>
                <div className="flex h-4 rounded-full overflow-hidden bg-surface-card-hover" data-medida="dato">
                    {antiguedad.map(t => (
                        <span key={t.tramo} className={`${COLOR_TRAMO[t.tramo]} ${tramo && tramo !== t.tramo ? 'opacity-30' : ''}`}
                            style={{ width: `${(Number(t.monto) / totalAnt) * 100}%` }} />
                    ))}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {TRAMOS.map(t => {
                        const monto = Number(antiguedad.find(a => a.tramo === t.key)?.monto ?? 0);
                        const activo = tramo === t.key;
                        return (
                            <button key={t.key} type="button" aria-pressed={activo} data-tramo={t.key}
                                onClick={() => setTramo(activo ? '' : t.key)}
                                className={`text-left rounded-xl px-3 py-2 min-h-[var(--tap-min)] border transition-colors active:scale-[0.98] ${activo ? 'border-brand bg-brand/10' : 'border-divider hover:bg-surface-card-hover'}`}>
                                <span className="flex items-center gap-1.5 text-caption text-content-3">
                                    <span className={`w-2.5 h-2.5 rounded-full ${COLOR_TRAMO[t.key]}`} /> {t.label}
                                </span>
                                <span className="block text-body font-black tabular-nums text-content">{formatMoneyCorto(monto)}</span>
                                <span className="block text-micro text-content-3 tabular-nums">{Math.round((monto / totalAnt) * 100)}%</span>
                            </button>
                        );
                    })}
                </div>
            </section>

            <DataTable
                columns={COLS}
                movil={{ usarAccionDeFila: true }}
                loading={cargando}
                minWidth="320px"
                empty={buscar || tramo
                    ? { icon: Search, message: 'Sin resultados', subtext: 'Ningún cliente coincide con la búsqueda o el tramo.' }
                    : vista === 'vencidos'
                        ? { icon: CheckCircle2, message: 'Sin atrasos', subtext: 'Ningún cliente está pasado del plazo.' }
                        : vista === 'limite'
                            ? { icon: CheckCircle2, message: 'Sin clientes sobre el límite', subtext: 'Todos deben menos que su crédito aprobado.' }
                            : { icon: CheckCircle2, message: 'Sin saldos', subtext: 'Nadie le debe a la distribuidora.' }}
            >
                {pagina.map((c, i) => {
                    const saldo = Number(c.saldo);
                    const limite = Number(c.limite_credito) || 0;
                    const uso = limite > 0 ? Math.min(1, saldo / limite) : 1;
                    const sobre = saldo > limite;
                    return (
                        <DataRow key={c.id} index={i} onClick={() => setAbierto(c)}>
                            <DataCell>
                                <div className="min-w-0 max-w-[240px]">
                                    <p className="text-body-sm font-bold text-content-2 truncate">{c.nombre}</p>
                                    <p className="text-caption text-content-3 truncate">{rotuloTipoCliente(c.tipo)} · {c.ruta} · {c.cuentas} documento{Number(c.cuentas) === 1 ? '' : 's'}</p>
                                </div>
                            </DataCell>
                            <DataCell align="right">
                                <span className="tabular-nums font-black text-content">{formatMoney(saldo)}</span>
                            </DataCell>
                            <DataCell align="right" hideBelow="sm">
                                {Number(c.vencido) > 0 ? (
                                    <div className="flex flex-col items-end gap-0.5">
                                        <span className="tabular-nums font-bold text-danger-text">{formatMoney(c.vencido)}</span>
                                        <Badge size="sm" variant={Number(c.dias_atraso) > 60 ? 'danger' : 'warning'} uppercase={false}>{c.dias_atraso} días</Badge>
                                    </div>
                                ) : <span className="text-caption text-success-text font-bold">Al día</span>}
                            </DataCell>
                            <DataCell hideBelow="md">
                                <div className="w-36">
                                    <div className="flex justify-between text-micro text-content-3 tabular-nums">
                                        <span>{formatMoneyCorto(limite)}</span>
                                        {sobre && <span className="text-danger-text font-bold flex items-center gap-0.5"><TrendingDown size={10} /> sobre el límite</span>}
                                    </div>
                                    <span className="block h-1.5 rounded-full bg-surface-card-hover overflow-hidden mt-1" data-medida="dato">
                                        <span className={`block h-full rounded-full ${sobre ? 'bg-danger' : uso > 0.8 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.max(3, uso * 100)}%` }} />
                                    </span>
                                </div>
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="text-caption text-content-2 tabular-nums">{c.ultimo_cobro ? fechaNumerica(c.ultimo_cobro) : 'Nunca'}</span>
                            </DataCell>
                            <DataCell align="right">
                                {puedeVender && (
                                    <Button size="sm" variant="secondary" icon={HandCoins} onClick={(e) => { e.stopPropagation(); setAbierto(c); }}>Cobrar</Button>
                                )}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {!cargando && filtrados.length > 0 && (
                <TablePagination pageSize={pageSize} onPageSizeChange={setPageSize}
                    page={page} totalPages={totalPages} onPageChange={setPage} total={filtrados.length} unit="clientes" />
            )}

            {abierto && (
                <CarteraClienteModal cliente={abierto} emisor={emisor} puedeCobrar={puedeVender} puedeAnular={puedeConfigurar}
                    onClose={() => setAbierto(null)} onCambio={cargar} />
            )}
        </div>
    );
}
