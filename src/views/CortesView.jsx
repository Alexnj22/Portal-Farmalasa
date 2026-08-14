import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Wallet, CheckCircle2, Ban, Clock, ChevronRight, Search, ShieldCheck, AlertTriangle } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import PeriodStepper from '../components/common/PeriodStepper';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import LiquidModal from '../components/common/LiquidModal';
import PortalTextarea from '../components/common/PortalTextarea';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import { fetchCortesDelDia, fetchMovimientosDelDia, resolverCorte } from '../data/cortes';
import { conTramo, contraste, diferenciaDelCorte, estadoDelDia, severidad, sugerenciasDeCorte } from '../utils/cortesDiagnostico';
import { formatMoney } from '../utils/formatNumber';

const VACIO = [];

// Hora de El Salvador (UTC−6, sin horario de verano). Se calcula así y no con
// la fecha local del equipo porque la fecha del corte es la de la sala: un
// navegador en otro huso mostraría el día equivocado sin avisar.
const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);

const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

const rotularDia = (fecha) =>
    new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });

const hhmm = (hora) => String(hora || '').slice(0, 5);

const TONO_BADGE = { ok: 'success', sobra: 'warning', falta: 'danger' };
const TONO_TEXTO = { ok: 'text-success-text', sobra: 'text-warning-text', falta: 'text-danger-text' };
const ROTULO_SEV = { ok: 'Cuadra', sobra: 'Sobra', falta: 'Falta' };

const MOTIVOS = ['Conteo de prueba', 'Se contó mal', 'Corte repetido'];

/** El monto con su signo explícito: en un control de caja, «+3.39» y «3.39» no dicen lo mismo. */
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));

const CortesView = () => {
    const branches = useStaff((s) => s.branches) || VACIO;
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const showToast = useToastStore((s) => s.showToast);
    const { user, hasPermission } = useAuth();
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');

    const [fecha, setFecha] = useState(hoySV);
    const [cortes, setCortes] = useState(VACIO);
    const [movimientos, setMovimientos] = useState(VACIO);
    const [cargando, setCargando] = useState(true);
    const [salaSel, setSalaSel] = useState(null);
    const [detalle, setDetalle] = useState(null);
    const [modo, setModo] = useState(null);          // 'confirmar' | 'descartar'
    const [motivo, setMotivo] = useState(MOTIVOS[0]);
    const [nota, setNota] = useState('');
    const [guardando, setGuardando] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        const [{ data, error }, movs] = await Promise.all([
            fetchCortesDelDia(fecha),
            fetchMovimientosDelDia(fecha),
        ]);
        if (error) console.error('CortesView: fetch cortes_caja falló:', error.message);
        setCortes(data || VACIO);
        setMovimientos(movs || VACIO);
        setCargando(false);
    }, [fecha]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + al cambiar de día

    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    // Un mapa sala → cortes con su tramo ya calculado. El tramo depende del
    // orden y de qué está descartado, así que se calcula una vez acá y no en
    // cada tarjeta: si se calculara dos veces con criterios distintos, la cifra
    // del resumen y la de la fila dirían cosas diferentes sobre el mismo día.
    const porSala = useMemo(() => {
        const m = new Map();
        for (const c of cortes) {
            if (!m.has(c.branch_id)) m.set(c.branch_id, []);
            m.get(c.branch_id).push(c);
        }
        const salas = [];
        for (const [branchId, lista] of m) {
            const conjunto = conTramo(lista);
            // El spread PRIMERO y las claves propias después: así lo explícito
            // gana siempre. Al revés, `estadoDelDia` pisó `cortes` con su
            // conteo y la lista dejó de ser una lista.
            salas.push({
                ...estadoDelDia(conjunto),
                branchId,
                nombre: nombreSala[branchId] || `Sucursal ${branchId}`,
                cortes: conjunto,
            });
        }
        // Lo que necesita atención primero: mayor diferencia en valor absoluto.
        salas.sort((a, b) => Math.abs(b.acumulado) - Math.abs(a.acumulado) || a.nombre.localeCompare(b.nombre));
        return salas;
    }, [cortes, nombreSala]);

    const salaAbierta = useMemo(
        () => porSala.find((s) => s.branchId === salaSel) || null,
        [porSala, salaSel],
    );

    const movsDeSala = useMemo(
        () => (salaSel == null ? VACIO : movimientos.filter((m) => m.branch_id === salaSel)),
        [movimientos, salaSel],
    );

    const sugerencias = useMemo(
        () => (detalle ? sugerenciasDeCorte(detalle, movsDeSala) : VACIO),
        [detalle, movsDeSala],
    );

    const cerrarDetalle = useCallback(() => { setDetalle(null); setModo(null); setNota(''); setMotivo(MOTIVOS[0]); }, []);

    const resolver = useCallback(async () => {
        if (!detalle || !modo) return;
        setGuardando(true);
        const estado = modo === 'confirmar' ? 'CONFIRMADO' : 'DESCARTADO';
        const { error } = await resolverCorte(detalle.id, estado, {
            motivo: modo === 'descartar' ? motivo : null,
            observaciones: nota,
        });
        setGuardando(false);
        if (error) {
            showToast?.('No se pudo guardar', error.message || 'Vuelve a intentar en un momento.', 'error');
            return;
        }
        appendAuditLog?.(estado === 'CONFIRMADO' ? 'CORTE_CAJA_CONFIRMADO' : 'CORTE_CAJA_DESCARTADO', user?.id, {
            corte_id: detalle.id,
            sucursal: nombreSala[detalle.branch_id],
            hora: detalle.hora,
            diferencia: detalle.diferencia_erp,
            motivo: modo === 'descartar' ? motivo : undefined,
        });
        showToast?.(
            estado === 'CONFIRMADO' ? 'Corte confirmado' : 'Corte descartado',
            `${nombreSala[detalle.branch_id]} · ${hhmm(detalle.hora)}`,
            'success',
        );
        cerrarDetalle();
        cargar();
    }, [detalle, modo, motivo, nota, showToast, appendAuditLog, user, nombreSala, cerrarDetalle, cargar]);

    const filtersContent = (
        <PeriodStepper
            label={rotularDia(fecha)}
            unit="día"
            onPrev={() => { setFecha((f) => correrDia(f, -1)); setSalaSel(null); }}
            onNext={() => { setFecha((f) => correrDia(f, 1)); setSalaSel(null); }}
            onReset={() => { setFecha(hoySV()); setSalaSel(null); }}
            isCurrent={fecha === hoySV()}
            resetLabel="Ir a hoy"
        />
    );

    return (
        <GlassViewLayout icon={Wallet} title="Cortes de caja" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-5">

                {cargando && <LoadingState label="Buscando los cortes del día" />}

                {!cargando && porSala.length === 0 && (
                    <EmptyState
                        icon={Wallet}
                        message="Sin cortes este día"
                        subtext="Todavía no hay ningún corte de caja registrado para esta fecha."
                    />
                )}

                {/* ── El día: una tarjeta por sala ───────────────────────── */}
                {!cargando && porSala.length > 0 && (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {porSala.map((s) => {
                            const sev = severidad(s.acumulado);
                            const abierta = s.branchId === salaSel;
                            return (
                                <button
                                    key={s.branchId}
                                    type="button"
                                    data-surface="card"
                                    data-tono={abierta ? 'brand' : undefined}
                                    className="p-4 text-left w-full"
                                    aria-pressed={abierta}
                                    onClick={() => setSalaSel(abierta ? null : s.branchId)}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-label font-bold text-content">{s.nombre}</span>
                                        <Badge variant={TONO_BADGE[sev]} size="sm">{ROTULO_SEV[sev]}</Badge>
                                    </div>
                                    <div className={`mt-2 text-2xl font-bold tabular-nums ${TONO_TEXTO[sev]}`}>
                                        {conSigno(s.acumulado)}
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2 text-caption text-content-3">
                                        <span>
                                            {s.cantidad} {s.cantidad === 1 ? 'corte' : 'cortes'}
                                            {s.cierre ? ` · cierre ${hhmm(s.cierre.hora)}` : ' · sin cierre'}
                                        </span>
                                        {s.pendientes > 0 && (
                                            <Badge variant="neutral" size="sm">{s.pendientes} sin ver</Badge>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {!cargando && porSala.length > 0 && !salaAbierta && (
                    <Notice variant="info" icon={ChevronRight}>
                        La cifra grande es la diferencia del último corte del día. Como los cortes son
                        acumulativos, ya contiene a los anteriores. Abre una sala para ver qué tramo la
                        produjo.
                    </Notice>
                )}

                {/* ── La sala: la línea de cortes con su tramo ───────────── */}
                {salaAbierta && (
                    <div data-surface="card" className="p-4 md:p-5">
                        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
                            <h3 className="text-body font-bold text-content">{salaAbierta.nombre}</h3>
                            <span className="text-caption text-content-3">
                                Cada cifra es lo que se movió desde el corte anterior
                            </span>
                        </div>

                        <div className="divide-y divide-divider">
                            {salaAbierta.cortes.map((c) => {
                                const esZ = c.tipo === 'Z';
                                const desc = c.estado === 'DESCARTADO';
                                const sev = severidad(c.tramo);
                                return (
                                    <div key={c.id} className="py-3 flex items-center gap-3 flex-wrap">
                                        <span className="text-label font-semibold text-content-2 tabular-nums w-12 shrink-0">
                                            {hhmm(c.hora)}
                                        </span>

                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {esZ ? (
                                                    <>
                                                        <span className="text-label font-semibold text-content-2">Cierre del día</span>
                                                        <Badge variant="info" size="sm">Z</Badge>
                                                    </>
                                                ) : desc ? (
                                                    <>
                                                        <span className="text-label font-semibold text-content-3 line-through tabular-nums">
                                                            {conSigno(diferenciaDelCorte(c).valor)}
                                                        </span>
                                                        <Badge variant="neutral" size="sm" icon={Ban}>Descartado</Badge>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className={`text-body font-bold tabular-nums ${TONO_TEXTO[sev]}`}>
                                                            {conSigno(c.tramo ?? 0)}
                                                        </span>
                                                        <span className="text-caption text-content-3 tabular-nums">
                                                            acumulado {conSigno(c.acumulado ?? 0)}
                                                        </span>
                                                        {contraste(c)?.enDisputa && (
                                                            <Badge variant="danger" size="sm" icon={AlertTriangle}>Dos cifras</Badge>
                                                        )}
                                                        {c.estado === 'CONFIRMADO'
                                                            ? <Badge variant="success" size="sm" icon={CheckCircle2}>Confirmado</Badge>
                                                            : <Badge variant="neutral" size="sm" icon={Clock}>Sin confirmar</Badge>}
                                                    </>
                                                )}
                                            </div>
                                            <div className="text-caption text-content-3 mt-0.5">
                                                {esZ
                                                    ? `Ventas del día ${formatMoney(c.total_declarado)}`
                                                    : desc
                                                        ? (c.motivo_descarte || 'Sin motivo registrado')
                                                        : `Declaró ${formatMoney(c.total_declarado)} · debía haber ${formatMoney(c.esperadoUsado ?? c.esperado)}`}
                                            </div>
                                        </div>

                                        {!esZ && (
                                            <Button
                                                variant="secondary"
                                                size="sm"
                                                icon={Search}
                                                onClick={() => { setDetalle(c); setModo(null); }}
                                            >
                                                Revisar
                                            </Button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* ── El detalle de un corte ─────────────────────────────────── */}
            <LiquidModal
                open={!!detalle}
                onClose={cerrarDetalle}
                maxWidth="max-w-2xl"
                className="max-h-[88vh] h-fit"
                ariaLabel={`Corte de las ${hhmm(detalle?.hora)}`}
            >
                <LiquidModal.Header>
                    <div className="min-w-0">
                        <h3 className="text-body font-bold text-content">
                            Corte de las {hhmm(detalle?.hora)}
                        </h3>
                        <p className="text-caption text-content-3 truncate">
                            {nombreSala[detalle?.branch_id]}
                            {detalle?.turno ? ` · turno ${detalle.turno}` : ''}
                            {detalle?.empleado_texto ? ` · ${detalle.empleado_texto}` : ''}
                        </p>
                    </div>
                </LiquidModal.Header>

                <LiquidModal.Body className="space-y-4">
                    {detalle && (
                        <>
                            {/* Lo que decide */}
                            <div data-surface="card" data-tono={severidad(detalle.tramo) === 'ok' ? undefined : severidad(detalle.tramo) === 'falta' ? 'danger' : 'warning'} className="p-4">
                                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                                    <span className="text-caption text-content-2">Diferencia de este tramo</span>
                                    <span className={`text-2xl font-bold tabular-nums ${TONO_TEXTO[severidad(detalle.tramo)]}`}>
                                        {conSigno(detalle.tramo ?? 0)}
                                    </span>
                                </div>
                                <div className="mt-2 space-y-1 text-caption text-content-3">
                                    <div className="flex justify-between gap-3">
                                        <span>Debía haber</span><span className="tabular-nums">{formatMoney(detalle.esperadoUsado ?? detalle.esperado)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <span>Se declaró</span><span className="tabular-nums">{formatMoney(detalle.total_declarado)}</span>
                                    </div>
                                    <div className="flex justify-between gap-3">
                                        <span>Diferencia acumulada del día</span>
                                        <span className="tabular-nums">{conSigno(detalle.acumulado ?? 0)}</span>
                                    </div>
                                </div>
                            </div>

                            {detalle.fuente === 'guardada' && (
                                <Notice variant="warning" icon={Clock}>
                                    Esta cifra no sale del corte sino de lo que el sistema guardó aparte:
                                    el corte se leyó un buen rato después de hacerse, así que su ticket ya
                                    traía movimientos posteriores adentro. Desde que la captura corre cada
                                    minuto esto no vuelve a pasar.
                                </Notice>
                            )}

                            {/* Las dos fórmulas del origen, cuando no coinciden. */}
                            {contraste(detalle)?.enDisputa && (
                                <Notice variant="danger" icon={AlertTriangle}>
                                    <span className="font-bold">Este corte tiene dos cifras y no coinciden.</span>
                                    <span className="block mt-1 text-content-2">
                                        Lo que el sistema guardó: <b className="tabular-nums">{conSigno(contraste(detalle).difErp)}</b>.
                                        Lo que calcula su propio ticket: <b className="tabular-nums">{conSigno(contraste(detalle).difTicket)}</b>.
                                        Son <b className="tabular-nums">{formatMoney(Math.abs(contraste(detalle).brecha))}</b> de brecha.
                                        {contraste(detalle).comparable
                                            ? ' Las dos se midieron casi a la misma hora, así que no es que una esté vieja.'
                                            : ' El ticket se leyó un rato después del corte, así que parte podría ser de movimientos posteriores.'}
                                    </span>
                                    <span className="block mt-1 text-content-2">
                                        Revisa los movimientos del día antes de dar por bueno un faltante con este corte.
                                    </span>
                                </Notice>
                            )}

                            {/* El desglose, con su advertencia */}
                            <div>
                                <div className="text-caption font-bold uppercase tracking-wide text-content-3 mb-1.5">Desglose</div>
                                <div className="space-y-1 text-caption">
                                    {[
                                        ['Ventas', detalle.tk_venta],
                                        ['Ingresos de caja', detalle.tk_ingresos],
                                        ['Vales', detalle.tk_vales == null ? null : -Math.abs(Number(detalle.tk_vales))],
                                        ['Cobros de crédito', detalle.tk_cobros_credito],
                                        ['Pagos con tarjeta', detalle.tk_tarjeta],
                                        ['Devoluciones', detalle.tk_devoluciones],
                                    ].filter(([, v]) => v != null && Number(v) !== 0).map(([k, v]) => (
                                        <div key={k} className="flex justify-between gap-3">
                                            <span className="text-content-2">{k}</span>
                                            <span className="tabular-nums text-content">{formatMoney(v)}</span>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-micro text-content-3 mt-2 leading-relaxed">
                                    El desglose puede no sumar el «debía haber»: el sistema lo recalcula cada vez
                                    que se pide y ya trae adentro movimientos posteriores a este corte. El «debía
                                    haber» quedó guardado al cortar y no se mueve — es el único que sirve para juzgar.
                                </p>
                            </div>

                            {/* Qué revisar */}
                            {sugerencias.length > 0 && (
                                <div>
                                    <div className="text-caption font-bold uppercase tracking-wide text-content-3 mb-1.5">Qué revisar</div>
                                    <div className="space-y-2">
                                        {sugerencias.map((s, i) => (
                                            <Notice key={i} variant={s.tono === 'danger' ? 'danger' : s.tono === 'warning' ? 'warning' : 'info'}>
                                                <span className="font-bold">{s.titulo}</span>
                                                <span className="block mt-0.5 text-content-2">{s.detalle}</span>
                                            </Notice>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {severidad(detalle.tramo) === 'ok' && detalle.estado === 'PENDIENTE' && (
                                <Notice variant="success" icon={ShieldCheck}>
                                    Este tramo cuadra al centavo. No hay nada que investigar.
                                </Notice>
                            )}

                            {detalle.estado !== 'PENDIENTE' && (
                                <Notice variant="info">
                                    {detalle.estado === 'CONFIRMADO' ? 'Corte confirmado' : `Descartado: ${detalle.motivo_descarte}`}
                                    {detalle.observaciones ? ` · ${detalle.observaciones}` : ''}
                                </Notice>
                            )}

                            {/* Resolver */}
                            {detalle.estado === 'PENDIENTE' && puedeResolver && modo && (
                                <div className="space-y-3">
                                    {modo === 'descartar' && (
                                        <div>
                                            <div className="text-caption font-bold uppercase tracking-wide text-content-3 mb-1.5">
                                                Motivo del descarte
                                            </div>
                                            <div className="flex gap-2 flex-wrap">
                                                {MOTIVOS.map((m) => (
                                                    <Button
                                                        key={m}
                                                        variant={motivo === m ? 'danger' : 'secondary'}
                                                        size="sm"
                                                        onClick={() => setMotivo(m)}
                                                    >
                                                        {m}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <PortalTextarea
                                        label={modo === 'confirmar' ? 'Observación (opcional)' : 'Detalle (opcional)'}
                                        name="nota"
                                        value={nota}
                                        onChange={(e) => setNota(e.target.value)}
                                        rows={2}
                                        placeholder={modo === 'confirmar'
                                            ? 'Qué se encontró, o por qué se acepta la diferencia'
                                            : 'Algo que ayude a entender el descarte'}
                                    />
                                </div>
                            )}
                        </>
                    )}
                </LiquidModal.Body>

                <LiquidModal.Footer>
                    {detalle?.estado === 'PENDIENTE' && puedeResolver ? (
                        modo ? (
                            <>
                                <Button variant="ghost" onClick={() => setModo(null)} disabled={guardando}>Volver</Button>
                                <Button
                                    variant={modo === 'confirmar' ? 'primary' : 'destructive'}
                                    onClick={resolver}
                                    loading={guardando}
                                >
                                    {modo === 'confirmar' ? 'Confirmar corte' : 'Descartar corte'}
                                </Button>
                            </>
                        ) : (
                            <>
                                <Button variant="secondary" icon={Ban} onClick={() => setModo('descartar')}>Descartar</Button>
                                <Button variant="primary" icon={CheckCircle2} onClick={() => setModo('confirmar')}>Confirmar</Button>
                            </>
                        )
                    ) : (
                        <Button variant="secondary" onClick={cerrarDetalle}>Cerrar</Button>
                    )}
                </LiquidModal.Footer>
            </LiquidModal>
        </GlassViewLayout>
    );
};

export default CortesView;
