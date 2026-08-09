import React, { useEffect, useMemo, useState } from 'react';
import { Receipt, Plus, Coins, TrendingUp, Percent, AlertTriangle, RefreshCw, Search, Undo2 } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { fetchMetasGastos, anularMetaGasto } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymLabel, ymLabelCorto } from './metasUtils';

const COLS = [
    { key: 'mes',   label: 'Mes' },
    { key: 'sala',  label: 'Sala' },
    { key: 'gasto', label: 'Gasto del mes',       align: 'right' },
    { key: 'venta', label: 'Le agrega a la meta', align: 'right' },
    { key: 'meta',  label: 'Meta del mes',        align: 'right' },
];

// Los gastos por recuperar: lo que la empresa invierte y quiere que la venta
// devuelva. Acá NO se calcula nada — las cuotas vienen tal como el servidor las
// guardó, con el residuo del redondeo en el último mes. Dividir monto ÷ meses
// en el navegador mostraría 333.333 donde la base tiene 333.34.
export default function TabGastos({ canEdit, reloadKey, onChanged, onAgregarGasto, searchTerm, onClearSearch }) {
    const { showToast } = useToastStore();
    const ymActual = ymHoySV();
    const [gastos, setGastos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [intento, setIntento] = useState(0);
    const [quitando, setQuitando] = useState(null);  // id → abre el campo del motivo
    const [notaQuitar, setNotaQuitar] = useState('');
    const [busy, setBusy] = useState(null);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de re-fetch
        setError(null);
        fetchMetasGastos()
            .then((gs) => { if (alive) { setGastos(gs); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar los gastos')); setLoading(false); } });
        return () => { alive = false; };
    }, [reloadKey, intento]);

    const visibles = useMemo(() => {
        const q = searchTerm?.trim().toLowerCase();
        if (!q) return gastos;
        return gastos.filter((g) =>
            (g.concepto || '').toLowerCase().includes(q)
            || (g.salas || []).some((s) => (s.sala || '').toLowerCase().includes(q)));
    }, [gastos, searchTerm]);

    const resumen = useMemo(() => {
        const vivos = gastos.filter((g) => g.estado === 'activo');
        return {
            cuantos: vivos.length,
            porRecuperar: vivos.reduce((s, g) => s + Number(g.monto_total || 0), 0),
            agregaAMetas: vivos.reduce((s, g) => s + Number(g.venta_viva || 0), 0),
            margen: gastos[0]?.margen_pct ?? 25,
        };
    }, [gastos]);

    const quitar = async (g) => {
        setBusy(g.id);
        try {
            const res = await anularMetaGasto({ id: g.id, nota: notaQuitar.trim() });
            useStaffStore.getState().appendAuditLog('METAS_GASTO_ANULAR', String(g.id), {
                concepto: g.concepto, nota: notaQuitar.trim(), cuotasAnuladas: res?.cuotas_anuladas,
            });
            showToast('Gasto quitado',
                res?.cuotas_anuladas
                    ? `Las metas de ${res.cuotas_anuladas} mes(es) que no arrancaron volvieron a su monto anterior.`
                    : 'No quedaban meses por delante, así que ninguna meta cambió.',
                'success');
            setQuitando(null); setNotaQuitar('');
            onChanged?.();
            setIntento((n) => n + 1);
        } catch (err) {
            showToast('Error', mensajeAmigable(err), 'error');
        } finally {
            setBusy(null);
        }
    };

    if (loading) {
        return (
            <div className="space-y-4">
                <div data-surface="card" className="p-5"><SkeletonText lines={3} /></div>
                <div data-surface="card" className="p-5"><SkeletonText lines={6} /></div>
            </div>
        );
    }
    if (error) {
        return (
            <EmptyState
                compact icon={AlertTriangle}
                iconClass="text-danger" glowClass="bg-danger/30"
                title="No se pudieron cargar los gastos"
                subtitle={error}
                action={<Button variant="secondary" icon={RefreshCw} onClick={() => setIntento((n) => n + 1)}>Reintentar</Button>}
            />
        );
    }

    return (
        <div className="space-y-4">
            {gastos.length > 0 && (
                <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-3">
                    <CarrilCards className="flex-1" ariaLabel="Resumen de gastos">
                        <StatCard
                            icon={Coins} label="Por recuperar"
                            value={formatMoney(resumen.porRecuperar)}
                            sub={`en ${resumen.cuantos} gasto${resumen.cuantos !== 1 ? 's' : ''} activo${resumen.cuantos !== 1 ? 's' : ''}`}
                            iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                        />
                        <StatCard
                            icon={TrendingUp} label="Le agrega a las metas"
                            value={formatMoney(resumen.agregaAMetas)}
                            valueCls="text-chart-1-text"
                            sub="repartido entre los meses que faltan"
                            iconBg="bg-success/10" iconCls="text-success-text"
                        />
                        <StatCard
                            icon={Percent} label="Con ganancia de"
                            value={formatPct(resumen.margen, { decimales: 0 })}
                            sub="recuperar $1 pide $4 de venta"
                        />
                    </CarrilCards>

                    <div className="flex justify-end min-w-0">
                        <FilterBar
                            title="Gastos por recuperar"
                            activeCount={0}
                            acciones={canEdit ? [{
                                key: 'agregar', icon: Plus, label: 'Agregar gasto', variant: 'primary',
                                onClick: onAgregarGasto,
                            }] : []}
                        />
                    </div>
                </div>
            )}

            {visibles.length === 0 ? (
                searchTerm?.trim() ? (
                    <EmptyState
                        compact icon={Search}
                        title="Sin resultados"
                        subtitle={`Ningún gasto coincide con "${searchTerm.trim()}".`}
                        action={onClearSearch && (
                            <Button variant="secondary" onClick={onClearSearch}>Limpiar la búsqueda</Button>
                        )}
                    />
                ) : (
                    <EmptyState
                        compact icon={Receipt}
                        title="Sin gastos cargados"
                        action={canEdit && (
                            <Button variant="primary" icon={Plus} onClick={onAgregarGasto}>Agregar gasto</Button>
                        )}
                    />
                )
            ) : visibles.map((g) => {
                const anulado = g.estado === 'anulado';
                const salas = g.salas || [];
                const cuotas = g.cuotas || [];

                return (
                    <div key={g.id} className={anulado ? 'opacity-75' : undefined}>
                        <DataTable
                            columns={COLS}
                            minWidth="640px"
                            toolbar={(
                                <>
                                    <div className="min-w-0">
                                        <h3 className="text-body-lg font-black leading-tight truncate">{g.concepto}</h3>
                                        <p className="text-label font-semibold text-content-3 mt-0.5">
                                            {salas.map((s) => s.sala).join(' y ')}
                                            {' · '}
                                            {g.meses === 1
                                                ? `se recupera en ${ymLabel(g.ym_inicio).toLowerCase()}`
                                                : `se recupera en ${g.meses} meses, desde ${ymLabel(g.ym_inicio).toLowerCase()}`}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Badge variant={anulado ? 'neutral' : 'success'} size="sm">
                                            {anulado ? 'Quitado' : 'Activo'}
                                        </Badge>
                                        {canEdit && !anulado && (
                                            <Button
                                                variant="secondary" size="sm" icon={Undo2} disabled={busy != null}
                                                onClick={() => { setQuitando(quitando === g.id ? null : g.id); setNotaQuitar(''); }}
                                            >
                                                Quitar
                                            </Button>
                                        )}
                                    </div>
                                </>
                            )}
                            footer={(
                                <>
                                    <span className="text-label font-semibold text-content-3">
                                        {anulado
                                            ? `Se quitó — ${g.anulado_nota || 'sin motivo anotado'}`
                                            : `Lo cargó ${g.creado_por_nombre || 'el portal'}`}
                                    </span>
                                    <span className="text-body-sm font-black tabular-nums">
                                        {formatMoney(g.monto_total)}
                                        <span className="text-content-3 font-semibold"> → </span>
                                        <span className="text-chart-1-text">{formatMoney(g.venta_total)}</span>
                                        <span className="text-content-3 font-semibold"> de meta</span>
                                    </span>
                                </>
                            )}
                        >
                            {cuotas.map((c, i) => {
                                const cuotaAnulada = c.estado === 'anulada';
                                return (
                                    <DataRow key={`${c.year_month}-${c.branch_id}`} index={i}>
                                        <DataCell>
                                            <span className={`text-body-sm font-black whitespace-nowrap ${cuotaAnulada ? 'text-content-3 line-through' : 'text-content-2'}`}>
                                                {ymLabelCorto(c.year_month)}
                                            </span>
                                        </DataCell>
                                        <DataCell><span className="text-body-sm font-bold">{c.sala}</span></DataCell>
                                        <DataCell align="right">
                                            <span className="text-body-sm font-semibold tabular-nums text-content-2">
                                                {formatMoney(c.monto_gasto)}
                                            </span>
                                        </DataCell>
                                        <DataCell align="right">
                                            {cuotaAnulada ? (
                                                <span className="text-label font-semibold text-content-3">ya no cuenta</span>
                                            ) : (
                                                <span className="text-body-sm font-black tabular-nums text-chart-1-text">
                                                    {formatMoney(c.monto_venta)}
                                                </span>
                                            )}
                                        </DataCell>
                                        <DataCell align="right">
                                            {c.monto_meta != null ? (
                                                <span className="text-body-sm font-semibold tabular-nums">{formatMoney(c.monto_meta)}</span>
                                            ) : (
                                                <span className="text-label font-semibold text-content-3">
                                                    {c.year_month <= ymActual ? 'sin meta ese mes' : 'se calcula el 25'}
                                                </span>
                                            )}
                                        </DataCell>
                                    </DataRow>
                                );
                            })}
                        </DataTable>

                        {quitando === g.id && (
                            <div data-surface="card" data-tono="warning" className="mt-3 p-3 space-y-2">
                                <p className="text-label font-semibold text-content-2">
                                    Los meses que todavía no arrancaron vuelven a su meta anterior.
                                    Los que ya empezaron conservan su parte: esa meta ya se persiguió con ese número.
                                </p>
                                <PortalInput
                                    label="¿Por qué se quita?" name={`nota-quitar-${g.id}`}
                                    value={notaQuitar} onChange={(e) => setNotaQuitar(e.target.value)}
                                    placeholder="Ej. se canceló la compra" required
                                />
                                <Button
                                    variant="destructive" icon={Undo2}
                                    disabled={busy != null || !notaQuitar.trim()}
                                    onClick={() => quitar(g)}
                                >
                                    {busy === g.id ? 'Quitando…' : 'Quitar este gasto'}
                                </Button>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
