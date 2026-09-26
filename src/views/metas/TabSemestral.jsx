import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { tokenMatch } from '../../utils/searchUtils';
import {
    CalendarRange, Users, UserX, Lock, Unlock, Download, AlertTriangle, RefreshCw, Coins, Check, X,
} from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import StatCard from '../../components/common/StatCard';
import CarrilCards from '../../components/common/CarrilCards';
import FilterBar from '../../components/common/FilterBar';
import PeriodStepper from '../../components/common/PeriodStepper';
import ConfirmModal from '../../components/common/ConfirmModal';
import PromptModal from '../../components/common/PromptModal';
import TablePagination from '../../components/common/TablePagination';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { EmptyState } from '../../components/common/StateViews';
import usePaginaEnUrl from '../../plataforma/usePaginaEnUrl';
import { formatMoney } from '../../utils/formatNumber';
import { shortEmployeeName } from '../../utils/nameUtils';
import { exportCsv } from '../../utils/csvExport';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchBonoSemestral, decidirBonoSemestral, aprobarBonoSemestral } from '../../data/metas';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import {
    ymHoySV, ymLabelCorto, semestreDe, semestreSumar, semestreLabel, semestrePagoLabel,
} from '../../utils/metasUtils';

// El primer semestre con la foto del cierre: julio y agosto de 2026 se tomaron
// el 22-sep al crear el módulo. Enero–junio 2026 se pagó en julio fuera del
// portal, así que no hay nada que mostrar antes de acá.
const SEMESTRE_INICIO = '2026-S2';

const ESTADO_MES = {
    cerrado:     { variant: 'success', rotulo: 'cerrado' },
    provisional: { variant: 'warning', rotulo: 'en curso' },
    futuro:      { variant: 'neutral', rotulo: 'pendiente' },
};

const STATUS_ROTULO = {
    INACTIVO: 'Inactivo', BAJA: 'De baja', LIQUIDADO: 'Liquidado', SUSPENDIDO: 'Suspendido',
};

/**
 * El pago semestral del bono de meta — docs/planes-cerrados/PLAN-BONOS-DOS-CALENDARIOS-2026-09-22.md.
 *
 * El bono se gana cada mes (pestaña Bono) y se PAGA dos veces al año: enero–
 * junio en la 1ª quincena de julio y julio–diciembre en la 1ª de enero. Esta
 * pestaña es la hoja de ese pago: el bono de cada mes por persona y la suma.
 *
 * ── Por qué los meses vienen de una foto ────────────────────────────────────
 * El bono de un mes se reparte entre el personal ACTIVO de la sala. Recalcular
 * enero en julio lo repartiría con el personal de julio: quien se fue en marzo
 * desaparecería de su propio enero. El cierre del día 5 fotografía a cada
 * persona, y esta hoja suma esas fotos. El mes que sigue abierto se calcula en
 * vivo y se marca «en curso».
 *
 * ── Quien ya no trabaja ─────────────────────────────────────────────────────
 * No se paga ni se niega solo: gerencia decide por cada persona, con motivo.
 * Sin esa decisión el semestre no se puede aprobar.
 *
 * ── Aprobar congela ─────────────────────────────────────────────────────────
 * Una hoja aprobada no se recalcula ni cambia si alguien pasa a baja después:
 * es la que se paga. Reabrir se puede, con motivo.
 */
export default function TabSemestral({ canApprove, searchTerm = '' }) {
    const ymActual = ymHoySV();
    const semActual = semestreDe(ymActual);
    const [sem, setSem] = useState(semActual);
    const [hoja, setHoja] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [intento, setIntento] = useState(0);
    const [ocupado, setOcupado] = useState(false);
    const [confirmar, setConfirmar] = useState(false);
    const [reabrir, setReabrir] = useState(false);
    const [decidir, setDecidir] = useState(null);          // { persona, pagar } | null
    const showToast = useToastStore((s) => s.showToast);
    const empleados = useStaffStore((s) => s.employees);

    useEffect(() => {
        let alive = true;
        setLoading(true); // eslint-disable-line react-hooks/set-state-in-effect -- reset del skeleton antes de pedir otro semestre
        setError(null);
        fetchBonoSemestral(sem)
            .then((d) => { if (alive) { setHoja(d); setLoading(false); } })
            .catch((err) => {
                if (!alive) return;
                setError(err?.code === '42501'
                    ? 'El pago semestral necesita ver las metas de todas las salas, y tu cargo no tiene ese alcance.'
                    : mensajeAmigable(err, 'No se pudo cargar el pago semestral'));
                setLoading(false);
            });
        return () => { alive = false; };
    }, [sem, intento]);

    // El nombre sale del canónico. La ficha completa está en el store; quien ya
    // no trabaja puede no estar ahí, y entonces se acorta el nombre que trae la hoja.
    const nombreDe = useCallback((p) => {
        const emp = (empleados || []).find((e) => e.id === p.employee_id);
        return shortEmployeeName(emp || { name: p.nombre });
    }, [empleados]);

    const meses = useMemo(() => (Array.isArray(hoja?.meses) ? hoja.meses : []), [hoja]);
    const todas = useMemo(() => (Array.isArray(hoja?.personas) ? hoja.personas : []), [hoja]);
    // Los totales de arriba cuentan a TODOS; la búsqueda sólo recorta la tabla.
    const personas = todas;
    const filtradas = useMemo(() => {
        if (!searchTerm.trim()) return todas;
        return todas.filter((p) => tokenMatch(searchTerm, p.nombre, p.code));
    }, [todas, searchTerm]);
    const aprobado = hoja?.estado === 'aprobado';
    const terminado = meses.length === 6 && meses[5].ym < ymActual;
    const todosCerrados = meses.length === 6 && meses.every((m) => m.estado === 'cerrado');
    const informativo = meses.some((m) => m.estado !== 'futuro' && m.informativo);

    const aPagar = personas.filter((p) => p.pagar).reduce((a, p) => a + Number(p.total || 0), 0);
    const porDecidir = personas.filter((p) => !p.activo && !p.decision).length;
    const hayInactivos = personas.some((p) => !p.activo);

    const { page, pageSize, totalPages, setPage, setPageSize } = usePaginaEnUrl({ total: filtradas.length });
    const visibles = useMemo(
        () => filtradas.slice((page - 1) * pageSize, page * pageSize),
        [filtradas, page, pageSize],
    );

    const correr = useCallback(async (fn, accion, detalle, fallo) => {
        setOcupado(true);
        try {
            setHoja(await fn());
            useStaffStore.getState().appendAuditLog(accion, 'bono_semestre', { semestre: sem, ...detalle });
            return true;
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, fallo), 'error');
            return false;
        } finally {
            setOcupado(false);
        }
    }, [sem, showToast]);

    const exportar = () => {
        exportCsv(
            ['PERSONA', 'CODIGO', 'SALA', ...meses.map((m) => ymLabelCorto(m.ym).toUpperCase()), 'TOTAL', 'SE PAGA'],
            personas.map((p) => [
                p.nombre, p.code || '', (p.salas || []).join(' / '),
                ...meses.map((m) => Number(p.por_mes?.[m.ym] ?? 0)),
                Number(p.total || 0),
                p.pagar ? 'SI' : (p.decision ? 'NO' : 'POR DECIDIR'),
            ]),
            `bono_semestral_${sem}.csv`,
            'metas',
        );
    };

    const columnas = useMemo(() => [
        { key: 'persona', label: 'Persona' },
        { key: 'salas', label: 'Sala', hideBelow: 'md' },
        ...meses.map((m) => ({ key: m.ym, label: ymLabelCorto(m.ym), align: 'right', hideBelow: 'lg' })),
        { key: 'total', label: 'Total', align: 'right' },
        ...(canApprove && hayInactivos && !aprobado ? [{ key: 'acciones', label: '' }] : []),
    ], [meses, canApprove, hayInactivos, aprobado]);

    return (
        <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <CarrilCards className="flex-1" ariaLabel="Resumen del pago semestral">
                    <StatCard
                        icon={Coins} label={aprobado ? 'Se paga' : 'A pagar'}
                        value={personas.length ? formatMoney(aPagar) : '—'}
                        sub={semestrePagoLabel(sem)}
                        iconBg="bg-chart-1/10" iconCls="text-chart-1-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={Users} label="Personas"
                        value={personas.length || '—'}
                        sub="con bono en el semestre"
                        loading={loading}
                    />
                    <StatCard
                        icon={UserX} label="Por decidir"
                        value={porDecidir || '—'}
                        valueCls={porDecidir > 0 ? 'text-warning-text' : undefined}
                        sub={porDecidir > 0 ? 'ya no trabajan' : 'nadie pendiente'}
                        iconBg="bg-warning/10" iconCls="text-warning-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={aprobado ? Lock : CalendarRange} label="Estado"
                        value={aprobado ? 'Aprobado' : terminado ? 'Por aprobar' : 'Acumulando'}
                        valueCls={aprobado ? 'text-success-text' : undefined}
                        sub={aprobado && hoja?.aprobado_por
                            ? `por ${shortEmployeeName(hoja.aprobado_por)}`
                            : `${meses.filter((m) => m.estado === 'cerrado').length} de 6 meses cerrados`}
                        iconBg={aprobado ? 'bg-success/10' : 'bg-brand/10'}
                        iconCls={aprobado ? 'text-success-text' : 'text-brand-text'}
                        loading={loading}
                    />
                </CarrilCards>

                <div className="flex justify-end min-w-0">
                    <FilterBar
                        title="Filtros del pago semestral"
                        activeCount={sem === semActual ? 0 : 1}
                        onClear={() => setSem(semActual)}
                    >
                        <FilterBar.Section active={sem !== semActual} onClear={() => setSem(semActual)} label="semestre">
                            <PeriodStepper
                                unit="semestre"
                                label={semestreLabel(sem)}
                                isCurrent={sem === semActual}
                                onPrev={() => setSem((v) => semestreSumar(v, -1))}
                                onNext={() => setSem((v) => semestreSumar(v, 1))}
                                onReset={() => setSem(semActual)}
                                resetLabel="Ir al semestre actual"
                                prevDisabled={sem <= SEMESTRE_INICIO}
                                nextDisabled={sem >= semActual}
                            />
                        </FilterBar.Section>
                    </FilterBar>
                </div>
            </div>

            {error && (
                <EmptyState
                    compact icon={AlertTriangle}
                    iconClass="text-danger" glowClass="bg-danger/30"
                    title="No se pudo cargar el pago semestral"
                    subtitle={error}
                    action={<Button variant="secondary" icon={RefreshCw} onClick={() => setIntento((n) => n + 1)}>Reintentar</Button>}
                />
            )}

            {!loading && !error && (
                <>
                    <div data-surface="card" className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-body-sm font-black text-content">
                                {semestreLabel(sem)} · se paga en la {semestrePagoLabel(sem)}
                            </p>
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {meses.map((m) => (
                                    <Badge key={m.ym} variant={ESTADO_MES[m.estado]?.variant || 'neutral'} size="sm">
                                        {ymLabelCorto(m.ym)} · {ESTADO_MES[m.estado]?.rotulo || m.estado}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {canApprove && !aprobado && terminado && todosCerrados && (
                                <Button icon={Lock} disabled={ocupado || porDecidir > 0}
                                    title={porDecidir > 0 ? 'Primero hay que decidir por quienes ya no trabajan' : undefined}
                                    onClick={() => setConfirmar(true)}>
                                    Aprobar
                                </Button>
                            )}
                            {canApprove && aprobado && (
                                <Button variant="secondary" icon={Unlock} disabled={ocupado}
                                    onClick={() => setReabrir(true)}>
                                    Reabrir
                                </Button>
                            )}
                            {personas.length > 0 && (
                                <Button variant="secondary" icon={Download} onClick={exportar}>
                                    Descargar
                                </Button>
                            )}
                        </div>
                    </div>

                    {informativo && (
                        <Notice variant="warning" icon={AlertTriangle}>
                            <span className="font-semibold">Las bonificaciones están apagadas.</span>{' '}
                            Estos montos dicen lo que se habría ganado; se vuelven dinero cuando se
                            activan en la pestaña Bono.
                        </Notice>
                    )}

                    {!aprobado && !terminado && (
                        <Notice variant="info">
                            El semestre sigue abierto: los meses cerrados ya no cambian y el mes en
                            curso se mueve con cada venta. Se aprueba cuando cierre el último mes
                            (el cierre corre el día 5).
                        </Notice>
                    )}

                    {aprobado && hoja?.nota && (
                        <p className="text-caption text-content-3">Nota: {hoja.nota}</p>
                    )}
                </>
            )}

            {!error && (loading || personas.length > 0) && (
                <>
                    <DataTable
                        columns={columnas}
                        loading={loading}
                        minWidth="320px"
                        movil={{ chips: ['salas'] }}
                        empty={{ icon: Coins, message: 'Nadie ganó bono en este semestre' }}
                    >
                        {visibles.map((p, i) => (
                            <DataRow key={p.employee_id} index={i}>
                                <DataCell>
                                    <span className="flex items-center gap-2 flex-wrap">
                                        <span className="text-body-sm font-bold">{nombreDe(p)}</span>
                                        {!p.activo && (
                                            <Badge variant="warning" size="sm">{STATUS_ROTULO[p.status] || 'Ya no trabaja'}</Badge>
                                        )}
                                        {p.decision && (
                                            <Badge variant={p.decision.pagar ? 'success' : 'danger'} size="sm">
                                                {p.decision.pagar ? 'Se paga' : 'No se paga'}
                                            </Badge>
                                        )}
                                    </span>
                                    {p.decision?.motivo && (
                                        <span className="block text-micro text-content-3">
                                            {p.decision.motivo}{p.decision.por ? ` · ${shortEmployeeName(p.decision.por)}` : ''}
                                        </span>
                                    )}
                                </DataCell>
                                <DataCell hideBelow="md">
                                    <span className="text-caption text-content-3">{(p.salas || []).join(' / ') || '—'}</span>
                                </DataCell>
                                {meses.map((m) => (
                                    <DataCell key={m.ym} align="right" hideBelow="lg">
                                        <span className="tabular-nums text-content-2">
                                            {Number(p.por_mes?.[m.ym]) > 0 ? formatMoney(p.por_mes[m.ym]) : '—'}
                                        </span>
                                    </DataCell>
                                ))}
                                <DataCell align="right">
                                    <span className={`font-black tabular-nums ${p.pagar ? 'text-content' : 'text-content-3 line-through'}`}>
                                        {formatMoney(p.total)}
                                    </span>
                                </DataCell>
                                {canApprove && hayInactivos && !aprobado && (
                                    <DataCell align="right">
                                        {!p.activo && (
                                            <span className="flex justify-end gap-1.5">
                                                <Button size="sm" variant="secondary" icon={Check} disabled={ocupado}
                                                    onClick={() => setDecidir({ persona: p, pagar: true })}>
                                                    Pagar
                                                </Button>
                                                <Button size="sm" variant="secondary" icon={X} disabled={ocupado}
                                                    onClick={() => setDecidir({ persona: p, pagar: false })}>
                                                    No pagar
                                                </Button>
                                            </span>
                                        )}
                                    </DataCell>
                                )}
                            </DataRow>
                        ))}
                    </DataTable>

                    {!loading && (
                        <TablePagination
                            page={page}
                            totalPages={totalPages}
                            onPageChange={setPage}
                            pageSize={pageSize}
                            onPageSizeChange={setPageSize}
                            total={filtradas.length}
                            unit="personas"
                        />
                    )}
                </>
            )}

            {!loading && !error && personas.length === 0 && (
                <EmptyState
                    compact icon={Coins}
                    title="Nadie ganó bono en este semestre"
                    subtitle="Ninguna sala llegó al 95% de su meta en los meses que van."
                />
            )}

            <ConfirmModal
                isOpen={confirmar}
                onClose={() => setConfirmar(false)}
                onConfirm={async () => {
                    setConfirmar(false);
                    const ok = await correr(() => aprobarBonoSemestral(sem, true),
                        'METAS_BONO_SEMESTRE_APROBAR', { a_pagar: aPagar }, 'Vuelve a intentarlo.');
                    if (ok) showToast('Semestre aprobado', `${formatMoney(aPagar)} quedan congelados.`, 'success');
                }}
                title={`Aprobar ${semestreLabel(sem).toLowerCase()}`}
                message={`Quedan congelados ${formatMoney(aPagar)} para ${personas.filter((p) => p.pagar).length} personas. A partir de aquí la hoja no cambia: es la que se paga.`}
                confirmText="Aprobar"
                isProcessing={ocupado}
            />

            <PromptModal
                isOpen={reabrir}
                onClose={() => setReabrir(false)}
                onConfirm={async (texto) => {
                    setReabrir(false);
                    await correr(() => aprobarBonoSemestral(sem, false, texto),
                        'METAS_BONO_SEMESTRE_REABRIR', { motivo: texto }, 'Vuelve a intentarlo.');
                }}
                title={`Reabrir ${semestreLabel(sem).toLowerCase()}`}
                message="Esto deshace la aprobación y la hoja vuelve a calcularse. Escribe por qué."
                placeholder="Faltó decidir por una persona…"
                confirmText="Reabrir"
                cancelText="Volver"
                isProcessing={ocupado}
                required
            />

            <PromptModal
                isOpen={!!decidir}
                onClose={() => setDecidir(null)}
                onConfirm={async (texto) => {
                    const d = decidir;
                    setDecidir(null);
                    const ok = await correr(
                        () => decidirBonoSemestral({ semestre: sem, employeeId: d.persona.employee_id, pagar: d.pagar, motivo: texto }),
                        'METAS_BONO_SEMESTRE_DECISION',
                        { employee_id: d.persona.employee_id, pagar: d.pagar, motivo: texto },
                        'Vuelve a intentarlo.');
                    if (ok) showToast('Decisión guardada', d.pagar ? 'Cobra lo acumulado.' : 'No cobra lo acumulado.', 'success');
                }}
                title={decidir ? `${decidir.pagar ? 'Pagar' : 'No pagar'} a ${nombreDe(decidir.persona)}` : ''}
                message={decidir
                    ? `Acumuló ${formatMoney(decidir.persona.total)} en el semestre y ya no trabaja. Escribe el motivo de la decisión.`
                    : ''}
                placeholder={decidir?.pagar ? 'Renunció con preaviso y cumplió el semestre…' : 'Despido por falta grave…'}
                confirmText={decidir?.pagar ? 'Pagar' : 'No pagar'}
                cancelText="Volver"
                isProcessing={ocupado}
                required
            />
        </div>
    );
}
