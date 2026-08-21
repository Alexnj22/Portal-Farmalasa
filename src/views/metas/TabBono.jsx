import React, { useEffect, useMemo, useState } from 'react';
import { Coins, Users, AlertTriangle, RefreshCw, Wallet, UserMinus, Crown } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Switch from '../../components/common/Switch';
import SegmentedControl from '../../components/common/SegmentedControl';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import ListRow from '../../components/common/ListRow';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { SkeletonText, EmptyState } from '../../components/common/StateViews';
import { formatMoney, formatPct } from '../../utils/formatNumber';
import { fetchBonoMetaSala, setBonificaciones } from '../../data/metas';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, YM_INICIO_HISTORIA, SALAS_VENTA, TRAMO_CFG } from './metasUtils';

const COLS_BASE = [
    { key: 'persona', label: 'Persona' },
    { key: 'venta',   label: 'Vendido',      align: 'right' },
    { key: 'pct',     label: '% de la sala', align: 'right' },
    { key: 'bono',    label: 'Bono hoy',     align: 'right' },
];
// La columna de proyección solo existe mientras el mes se puede mover.
const COL_PROY = { key: 'proy', label: 'Si cierra así', align: 'right' };

// Hasta cuándo valen las bonificaciones. Son las dos únicas respuestas que el
// servidor entiende: con «Este mes» la vigencia queda en el mes en curso y el
// bono se apaga solo al cambiar de mes.
const VIGENCIAS = [
    { value: 'mes',     label: 'Este mes' },
    { value: 'siempre', label: 'Indefinido' },
];

// El bono de meta de UNA sala, persona por persona. La regla completa y su
// verificación contra el cálculo anterior están en el §12 del plan; acá solo se
// muestra lo que devuelve `get_bono_meta_sala`, sin recalcular nada del lado
// del navegador — el reparto es dinero y vive en un solo lugar.
export default function TabBono({
    salaNombre, branchOptions, alcanceTodas = false, canEdit, bonificacionesActivas, bonificacionesHastaYm,
    onCambioBono, reloadKey, defaultBranchId,
}) {
    const ymActual = ymHoySV();
    const showToast = useToastStore((s) => s.showToast);
    const [ym, setYm] = useState(ymActual);
    const [sala, setSala] = useState(() => String(defaultBranchId ?? SALAS_VENTA[0]));
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Igual que en las otras pestañas: es la salida del estado de error (§18.1).
    const [intento, setIntento] = useState(0);

    useEffect(() => {
        let alive = true;
        setLoading(true);   // reset del skeleton antes de re-fetch al cambiar de mes o de sala
        setError(null);
        fetchBonoMetaSala(sala, ym)
            .then((d) => { if (alive) { setData(d); setLoading(false); } })
            .catch((err) => { if (alive) { setError(mensajeAmigable(err, 'Error al cargar el bono')); setLoading(false); } });
        return () => { alive = false; };
    }, [sala, ym, reloadKey, intento]);

    const esMesActual = ym === ymActual;
    const personas = useMemo(() => data?.personas ?? [], [data]);
    const tramo = data?.tramo ? TRAMO_CFG[data.tramo] : null;
    const tramoProy = data?.tramo_proyectado ? TRAMO_CFG[data.tramo_proyectado] : null;
    const sinMeta = data != null && data.meta == null;
    // La meta puede existir y NO estar aprobada todavía. El reparto se calcula
    // igual —sirve para ver por dónde va— pero decir el monto de cada persona
    // sobre una meta que el gerente aún puede devolver, sin avisarlo, es
    // prometer un número que no está firmado. El Tablero ya lo marca; acá, que
    // es la pantalla del dinero, faltaba.
    const metaSinAprobar = data?.meta != null && data.estado_meta && data.estado_meta !== 'oficial';

    // Al día 4 la bolsa de HOY siempre es cero: si la tabla dependiera solo de
    // ella, el mes en curso —el único que todavía se puede cambiar— se vería
    // vacío todos los días hasta fin de mes. Con proyección hay qué mostrar.
    const hayProyeccion = Number(data?.bolsa_proyectada ?? 0) > 0;
    const hayReparto = Number(data?.bolsa ?? 0) > 0 || hayProyeccion;
    const cols = useMemo(() => (hayProyeccion ? [...COLS_BASE, COL_PROY] : COLS_BASE), [hayProyeccion]);

    // Las dos fugas se cuentan aparte porque se arreglan distinto: una es un
    // código de vendedor que no existe (se corrige la venta) y la otra es
    // personal de otra sala (se resuelve con la cobertura de horarios).
    const perdido = Number(data?.no_pagado ?? 0);

    // ── El interruptor ────────────────────────────────────────────────────────
    // Vive acá, en la pestaña del bono, y no en una pantalla de configuración:
    // es la decisión de esta pantalla y quien la toma está mirando el reparto.
    //
    // «Este mes» no es un adorno del interruptor: es la diferencia entre un
    // bono que se apaga solo el día 1 y uno que sigue encendido hasta que
    // alguien se acuerde. El mes lo pone el servidor.
    const [guardando, setGuardando] = useState(false);
    const soloEsteMes = !!bonificacionesHastaYm;

    const cambiarBono = async (activas, esteMes) => {
        setGuardando(true);
        try {
            const r = await setBonificaciones(activas, esteMes);
            useStaffStore.getState().appendAuditLog('METAS_BONO_INTERRUPTOR', 'metas_config', {
                bonificaciones_activas: r?.bonificaciones_activas,
                bonificaciones_hasta_ym: r?.bonificaciones_hasta_ym ?? null,
            });
            showToast(
                activas ? 'Bonificaciones activadas' : 'Bonificaciones apagadas',
                activas
                    ? (esteMes ? `Sólo por ${ymLabel(ymActual).toLowerCase()}.` : 'Sin fecha de fin.')
                    : 'Las pantallas vuelven a hablar solo de la meta.',
                'success',
            );
            onCambioBono?.();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Vuelve a intentarlo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="space-y-4">
            <div data-surface="card" className="p-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <Switch
                            checked={!!bonificacionesActivas}
                            disabled={!canEdit || guardando}
                            variant="success"
                            label={bonificacionesActivas ? 'Apagar las bonificaciones' : 'Activar las bonificaciones'}
                            onChange={canEdit ? (on) => cambiarBono(on, on ? soloEsteMes : false) : undefined}
                        />
                        <p className="text-body-sm font-black text-content">
                            {bonificacionesActivas ? 'Bonificaciones activas' : 'Bonificaciones apagadas'}
                        </p>
                    </div>
                    <p className="text-label font-semibold text-content-3 mt-1.5">
                        {bonificacionesActivas
                            ? (soloEsteMes
                                ? <>Sólo por <strong className="text-content-2">{ymLabel(bonificacionesHastaYm).toLowerCase()}</strong> — el día 1 se apagan solas.</>
                                : 'Sin fecha de fin: siguen activas hasta que las apagues.')
                            : 'Las pantallas hablan de la meta y no nombran el bono en ningún lado.'}
                    </p>
                </div>

                {/* Hasta cuándo: sólo tiene sentido con el interruptor encendido. */}
                {bonificacionesActivas && canEdit && (
                    <SegmentedControl
                        options={VIGENCIAS}
                        value={soloEsteMes ? 'mes' : 'siempre'}
                        onChange={(v) => cambiarBono(true, v === 'mes')}
                        size="sm"
                        label="Hasta cuándo valen las bonificaciones"
                    />
                )}
            </div>

            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen del bono">
                    <StatCard
                        icon={Coins} label="Bono de la sala"
                        value={data?.bolsa > 0 ? formatMoney(data.bolsa) : '—'}
                        sub={data?.tasa_pct > 0
                            ? `${formatPct(data.tasa_pct, { decimales: 2 })} de lo vendido`
                            : sinMeta ? 'sin meta este mes'
                            : hayProyeccion ? `${formatMoney(data.bolsa_proyectada)} si cierra así`
                            : 'no alcanzó el 95%'}
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
                        {/* Sólo con alcance sobre todas. Sin él la sala queda
                            en `defaultBranchId`, que ya es la propia. */}
                        {alcanceTodas && (
                        <FilterBar.Section label="sala">
                            <FilterBar.Sucursal
                                value={sala}
                                onChange={(v) => setSala(v || String(SALAS_VENTA[0]))}
                                options={branchOptions}
                            />
                        </FilterBar.Section>
                        )}
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

            {!loading && !error && metaSinAprobar && (
                <Notice variant="warning" icon={AlertTriangle}>
                    La meta de {salaNombre(sala)} en {ymLabel(ym).toLowerCase()} todavía
                    no está aprobada, así que este reparto es una referencia: si el monto
                    de la meta cambia, cambia lo que le toca a cada persona.
                </Notice>
            )}

            {/* El mes en curso todavía se mueve. Decir en cuánto va a cerrar es
                lo que permite perseguir el bono en vez de enterarse el día 1 del
                mes siguiente — y deja claro que lo de hoy no es definitivo. */}
            {!loading && !error && esMesActual && hayProyeccion && (
                <Notice variant="info">
                    Si {salaNombre(sala)} sigue a este ritmo cierra en{' '}
                    <strong>{formatMoney(data.proyeccion)}</strong> —{' '}
                    <strong className={tramoProy?.textCls || ''}>{formatPct(data.pct_proyectado)}</strong> de la meta,
                    y el bono de la sala sería <strong>{formatMoney(data.bolsa_proyectada)}</strong>.
                    {data.tramo_proyectado === 'medio' && (
                        <> Llegando al 100% se duplica: le faltan {formatMoney(Math.max(0, data.meta - data.proyeccion))}.</>
                    )}
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
            {!loading && !error && !sinMeta && !hayReparto && (
                <EmptyState
                    compact icon={Wallet}
                    title={esMesActual ? 'El bono todavía no se gana' : 'La sala no alcanzó el bono'}
                    subtitle={esMesActual
                        ? `${salaNombre(sala)} va en ${formatPct(data.pct)} de la meta y, al ritmo de hoy, cerraría en ${formatPct(data.pct_proyectado)}. Desde el 95% se gana la mitad del bono y desde el 100%, completo.`
                        : `Cerró en ${formatPct(data.pct)} de la meta; desde el 95% se gana la mitad y desde el 100% el bono completo.`}
                />
            )}

            {(loading || (hayReparto && personas.length > 0)) && (
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
                                        {hayProyeccion && (
                                            <span className="text-label font-semibold text-chart-1-text tabular-nums">
                                                {formatMoney(p.bono_proyectado)} si cierra así
                                            </span>
                                        )}
                                        {p.es_jefe && <Badge variant="chart-4" size="sm">Jefatura</Badge>}
                                        {p.en_prueba && <Badge variant="warning" size="sm">En prueba</Badge>}
                                    </span>
                                )}
                            />
                        ))}
                    </div>

                    <div className="hidden md:block">
                        <DataTable columns={cols} loading={loading} empty={{
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
                                    {hayProyeccion && (
                                        <DataCell align="right">
                                            <span className="text-body-sm font-black tabular-nums text-chart-1-text">
                                                {formatMoney(p.bono_proyectado)}
                                            </span>
                                        </DataCell>
                                    )}
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
