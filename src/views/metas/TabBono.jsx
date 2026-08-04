import React, { useEffect, useMemo, useState } from 'react';
import { Coins, Users, AlertTriangle, RefreshCw, Wallet, UserMinus, Crown } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import ListRow from '../../components/common/ListRow';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { fetchBonoMetaSala } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, YM_INICIO_HISTORIA, SALAS_VENTA, TRAMO_CFG } from './metasUtils';

const COLS = [
    { key: 'persona', label: 'Persona' },
    { key: 'venta',   label: 'Vendido',     align: 'right' },
    { key: 'pct',     label: '% de la sala', align: 'right' },
    { key: 'bono',    label: 'Bono',        align: 'right' },
];

// El bono de meta de UNA sala, persona por persona. La regla completa y su
// verificación contra el cálculo anterior están en el §12 del plan; acá solo se
// muestra lo que devuelve `get_bono_meta_sala`, sin recalcular nada del lado
// del navegador — el reparto es dinero y vive en un solo lugar.
export default function TabBono({ salaNombre, branchOptions, bonificacionesActivas, reloadKey, defaultBranchId }) {
    const ymActual = ymHoySV();
    const [ym, setYm] = useState(ymActual);
    const [sala, setSala] = useState(() => String(defaultBranchId ?? SALAS_VENTA[0]));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Igual que en las otras pestañas: es la salida del estado de error (§18.1).
    const [intento, setIntento] = useState(0);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de re-fetch al cambiar de mes o de sala
        setError(null);
        fetchBonoMetaSala(sala, ym)
            .then((d) => { if (alive) { setData(d); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar el bono')); setLoading(false); } });
        return () => { alive = false; };
    }, [sala, ym, reloadKey, intento]);

    const esMesActual = ym === ymActual;
    const personas = useMemo(() => data?.personas ?? [], [data]);
    const tramo = data?.tramo ? TRAMO_CFG[data.tramo] : null;
    const sinMeta = data != null && data.meta == null;

    // Las dos fugas se cuentan aparte porque se arreglan distinto: una es un
    // código de vendedor que no existe (se corrige la venta) y la otra es
    // personal de otra sala (se resuelve con la cobertura de horarios).
    const perdido = Number(data?.no_pagado ?? 0);

    return (
        <div className="space-y-4">
            {!bonificacionesActivas && (
                <Notice variant="warning">
                    Bonificaciones suspendidas — el bono se muestra solo como referencia.
                </Notice>
            )}

            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen del bono">
                    <StatCard
                        icon={Coins} label="Bono de la sala"
                        value={data?.bolsa > 0 ? formatMoney(data.bolsa) : '—'}
                        sub={data?.tasa_pct > 0
                            ? `${formatPct(data.tasa_pct, { decimales: 2 })} de lo vendido`
                            : sinMeta ? 'sin meta este mes' : 'no alcanzó el 95%'}
                        iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={Crown} label="Jefatura"
                        value={data?.bolsa > 0 ? formatMoney(data.bolsa_jefatura) : '—'}
                        sub="un cuarto del bono"
                        iconBg="bg-chart-4/10" iconCls="text-chart-4-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={Users} label="Equipo"
                        value={data?.bolsa > 0 ? formatMoney(data.bolsa_equipo) : '—'}
                        sub="tres cuartos, por venta"
                        iconBg="bg-success/10" iconCls="text-success-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={UserMinus} label="Sin repartir"
                        value={perdido > 0 ? formatMoney(perdido) : '—'}
                        valueCls={perdido > 0 ? 'text-warning-text' : undefined}
                        sub={perdido > 0 ? 'no lo cobra nadie' : 'todo tiene dueño'}
                        iconBg="bg-warning/10" iconCls="text-warning-text"
                        loading={loading}
                    />
                </CarrilCards>

                <div className="flex justify-end min-w-0">
                    <FilterBar
                        title="Filtros del bono"
                        activeCount={esMesActual ? 0 : 1}
                        onClear={() => setYm(ymActual)}
                        accionesExtra={data?.pct != null ? (
                            <Badge variant={tramo?.variante || 'neutral'} size="sm">
                                {formatPct(data.pct)} de la meta
                            </Badge>
                        ) : null}
                    >
                        <FilterBar.Section active={!esMesActual} onClear={() => setYm(ymActual)} label="mes">
                            <PeriodStepper
                                unit="mes"
                                label={ymLabel(ym)}
                                isCurrent={esMesActual}
                                onPrev={() => setYm((v) => ymSumar(v, -1))}
                                onNext={() => setYm((v) => ymSumar(v, 1))}
                                onReset={() => setYm(ymActual)}
                                resetLabel="Ir al mes actual"
                                prevDisabled={ym <= YM_INICIO_HISTORIA}
                                nextDisabled={ym >= ymActual}
                            />
                        </FilterBar.Section>
                        <FilterBar.Section label="sala">
                            <FilterBar.Sucursal
                                value={sala}
                                onChange={(v) => setSala(v || String(SALAS_VENTA[0]))}
                                options={branchOptions}
                            />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>

            {error && (
                <EmptyState
                    compact icon={AlertTriangle}
                    iconClass="text-danger" glowClass="bg-danger/30"
                    title="No se pudo cargar el bono"
                    subtitle={error}
                    action={<Button variant="secondary" icon={RefreshCw} onClick={() => setIntento((n) => n + 1)}>Reintentar</Button>}
                />
            )}

            {/* El mes en curso todavía se mueve: decirlo evita que alguien tome
                el número como definitivo. */}
            {!loading && !error && esMesActual && data?.bolsa > 0 && (
                <Notice variant="info">
                    {ymLabel(ym)} está en curso — estos montos cambian con cada venta del mes.
                </Notice>
            )}

            {!loading && !error && sinMeta && (
                <EmptyState
                    compact icon={Wallet}
                    title={`${salaNombre(sala)} no tiene meta en ${ymLabel(ym).toLowerCase()}`}
                    subtitle="El bono se calcula sobre el cumplimiento, así que sin meta no hay reparto."
                />
            )}

            {/* El mes en curso NO «cerró» en nada: al día 4 cualquier sala va en
                un dígito, y decirle «no alcanzó» a un mes que recién empieza es
                falso además de desalentador. */}
            {!loading && !error && !sinMeta && data?.bolsa === 0 && (
                <EmptyState
                    compact icon={Wallet}
                    title={esMesActual ? 'El bono todavía no se gana' : 'La sala no alcanzó el bono'}
                    subtitle={esMesActual
                        ? `${salaNombre(sala)} va en ${formatPct(data.pct)} de la meta. Desde el 95% se gana la mitad del bono y desde el 100%, completo.`
                        : `Cerró en ${formatPct(data.pct)} de la meta; desde el 95% se gana la mitad y desde el 100% el bono completo.`}
                />
            )}

            {(loading || (data?.bolsa > 0 && personas.length > 0)) && (
                <>
                    {/* Teléfono: una fila por persona — la tabla no reflowa (§32). */}
                    <div className="md:hidden space-y-2">
                        {loading ? (
                            <div data-surface="card" className="p-4"><SkeletonText lines={5} /></div>
                        ) : personas.map((p) => (
                            <ListRow
                                key={p.employee_id}
                                icon={p.es_jefe ? Crown : Users}
                                title={p.nombre}
                                subtitle={`${formatMoney(p.venta)} · ${formatPct(p.pct_venta)} de la sala`}
                                trailing={(
                                    <span className="flex flex-col items-end gap-1">
                                        <span className="text-body-sm font-black tabular-nums">{formatMoney(p.bono)}</span>
                                        {p.es_jefe && <Badge variant="chart-4" size="sm">Jefatura</Badge>}
                                        {p.en_prueba && <Badge variant="warning" size="sm">En prueba</Badge>}
                                    </span>
                                )}
                            />
                        ))}
                    </div>

                    <div className="hidden md:block">
                        <DataTable columns={COLS} loading={loading} empty={{
                            icon: Users,
                            message: 'Sin personal en la sala',
                            subtext: 'El reparto necesita al menos una persona activa asignada acá.',
                        }}>
                            {personas.map((p, i) => (
                                <DataRow key={p.employee_id} index={i}>
                                    <DataCell>
                                        <span className="flex items-center gap-2 flex-wrap">
                                            <span className="text-body-sm font-bold">{p.nombre}</span>
                                            {p.es_jefe && <Badge variant="chart-4" size="sm">Jefatura</Badge>}
                                            {p.en_prueba && <Badge variant="warning" size="sm">En prueba</Badge>}
                                        </span>
                                        <span className="block text-label font-semibold text-content-3">{p.rol}</span>
                                    </DataCell>
                                    <DataCell align="right">
                                        <span className="text-body-sm font-semibold tabular-nums text-content-2">{formatMoney(p.venta)}</span>
                                    </DataCell>
                                    <DataCell align="right">
                                        <span className="text-body-sm font-semibold tabular-nums text-content-3">{formatPct(p.pct_venta)}</span>
                                    </DataCell>
                                    <DataCell align="right">
                                        <span className="text-body-sm font-black tabular-nums">{formatMoney(p.bono)}</span>
                                        {p.en_prueba && p.bono_bruto > p.bono && (
                                            <span className="block text-label font-semibold text-content-3 tabular-nums">
                                                mitad de {formatMoney(p.bono_bruto)}
                                            </span>
                                        )}
                                    </DataCell>
                                </DataRow>
                            ))}
                        </DataTable>
                    </div>
                </>
            )}

            {/* Lo que no se reparte se DICE, con su motivo y su monto. En el
                cálculo anterior esto desaparecía dentro de una fila llamada
                «código incorrecto» y nadie sabía de qué estaba hecha. */}
            {!loading && !error && perdido > 0 && (
                <Notice variant="warning" icon={UserMinus}>
                    {formatMoney(perdido)} del bono no lo cobra nadie
                    {data.venta_otra_sala > 0 && (
                        <> — {formatMoney(data.venta_otra_sala)} de lo vendido está a nombre de personal de otra sala</>
                    )}
                    {data.venta_otra_sala > 0 && data.venta_codigo_inexistente > 0 && ' y'}
                    {data.venta_codigo_inexistente > 0 && (
                        <> {formatMoney(data.venta_codigo_inexistente)} a nombre de un código que no existe</>
                    )}
                    . Esa parte no se reparte entre los demás.
                </Notice>
            )}
        </div>
    );
}
