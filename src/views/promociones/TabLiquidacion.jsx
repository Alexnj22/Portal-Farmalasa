import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Wallet, AlertTriangle, Calculator, Check, Lock, Unlock, Download, Users,
} from 'lucide-react';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import TablePagination from '../../components/common/TablePagination';
import LiquidSelect from '../../components/common/LiquidSelect';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import ConfirmModal from '../../components/common/ConfirmModal';
import PromptModal from '../../components/common/PromptModal';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import usePaginaEnUrl from '../../hooks/usePaginaEnUrl';
import {
    fetchLiquidacion, calcularLiquidacion, aprobarLiquidacion,
} from '../../data/liquidacion';
import { exportCsv } from '../../utils/csvExport';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fmtMoneda, mesAnterior, mesesRecientes, rotuloMes } from './promocionesUtils';
import Campo from './Campo';

/**
 * La liquidación mensual: lo que le toca a cada persona, de los tres programas.
 *
 * ── Por qué una sola hoja y no tres pantallas ───────────────────────────────
 * El bono de meta, el de las promociones por producto y el de laboratorio se
 * calculan en sitios distintos y con reglas distintas. Quien arma la planilla
 * necesita UN número por persona: sumarlos a mano de tres pantallas es cómo se
 * paga de menos y nadie lo nota, porque las tres están bien.
 *
 * ── En qué mes cae cada bono ────────────────────────────────────────────────
 * Meta y laboratorio pagan en SU mes. Una promoción por producto paga entera en
 * el mes en que TERMINÓ —su bono depende del corte del lote, que sólo es
 * definitivo al cerrar— y un excedente, en el mes en que se aprobó. El detalle
 * y el porqué están en la migración de las tablas.
 *
 * ── Calcular no es aprobar ──────────────────────────────────────────────────
 * Calcular rehace el borrador cuantas veces haga falta. Aprobar lo CONGELA: a
 * partir de ahí la hoja no se recalcula ni se toca, porque es la que se pagó.
 * Reabrir se puede, con permiso de gerencia y con el motivo escrito.
 */
export default function TabLiquidacion({ puedeEditar, puedeAprobar }) {
    const meses = useMemo(() => mesesRecientes(), []);
    // Arranca en el mes ANTERIOR: el mes en curso todavía se mueve, y una hoja
    // que cambia sola entre dos miradas no sirve para pagar. Sale de
    // `mesAnterior()` y no de una posición de la lista — `meses[1]` se leía como
    // «el anterior» y era otro mes.
    const [mes, setMes] = useState(mesAnterior);

    const [hoja, setHoja] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [ocupado, setOcupado] = useState(false);
    const [fallo, setFallo] = useState(null);
    const [confirmar, setConfirmar] = useState(false);
    const [reabrir, setReabrir] = useState(false);

    useEffect(() => {
        if (!mes) return undefined;
        let vivo = true;
        setCargando(true);
        setError(null);
        fetchLiquidacion(mes)
            .then((d) => { if (vivo) setHoja(d); })
            .catch((e) => { if (vivo) setError(e); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [mes]);

    const personas = useMemo(
        () => (Array.isArray(hoja?.personas) ? hoja.personas : []),
        [hoja],
    );
    const fondos = useMemo(
        () => (Array.isArray(hoja?.fondos) ? hoja.fondos : []),
        [hoja],
    );

    const { page, pageSize, totalPages, setPage, setPageSize } =
        usePaginaEnUrl({ total: personas.length });

    const visibles = useMemo(
        () => personas.slice((page - 1) * pageSize, page * pageSize),
        [personas, page, pageSize],
    );

    const correr = useCallback(async (fn, mensaje) => {
        setOcupado(true);
        setFallo(null);
        try {
            setHoja(await fn());
        } catch (e) {
            setFallo(mensajeAmigable(e, mensaje));
        } finally {
            setOcupado(false);
        }
    }, []);

    const exportar = () => {
        exportCsv(
            ['PERSONA', 'CODIGO', 'SALA', 'META', 'PROMOCION', 'LABORATORIO',
             'EXCEDENTE', 'TOTAL'],
            personas.map((p) => [
                p.nombre, p.code || '', p.sala || '',
                p.meta ?? 0, p.producto ?? 0, p.laboratorio ?? 0,
                p.excedente ?? 0, p.total ?? 0,
            ]),
            `liquidacion_${mes}.csv`,
            'promociones',
        );
    };

    const estado = hoja?.estado || 'sin_armar';
    const aprobada = estado === 'aprobada';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <Campo rotulo="Mes">
                    <LiquidSelect
                        value={mes}
                        onChange={setMes}
                        options={meses}
                        clearable={false}
                        ariaLabel="Mes de la liquidación"
                    />
                </Campo>

                <Badge variant={aprobada ? 'success' : estado === 'borrador' ? 'warning' : 'neutral'}>
                    {aprobada ? 'Aprobada' : estado === 'borrador' ? 'Borrador' : 'Sin armar'}
                </Badge>

                {puedeEditar && !aprobada && (
                    <Button
                        icon={Calculator}
                        loading={ocupado}
                        onClick={() => correr(() => calcularLiquidacion(mes),
                            'No se pudo armar la liquidación.')}
                    >
                        {hoja?.existe ? 'Volver a calcular' : 'Calcular'}
                    </Button>
                )}

                {puedeAprobar && hoja?.existe && !aprobada && (
                    <Button variant="secondary" icon={Lock} disabled={ocupado}
                        onClick={() => setConfirmar(true)}>
                        Aprobar
                    </Button>
                )}

                {puedeAprobar && aprobada && (
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

            {/* El aviso va SIEMPRE que la hoja sea informativa, aunque esté
                aprobada: una hoja aprobada de un mes suspendido sigue sin ser
                plata, y verla firmada invita a leerla como si lo fuera. */}
            {hoja?.informativa && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-semibold">Esto no se paga.</span>{' '}
                    Las bonificaciones estaban suspendidas en {rotuloMes(mes)}, así que la
                    hoja dice lo que <em>se habría ganado</em>.
                </Notice>
            )}

            {fallo && <Notice variant="danger" icon={AlertTriangle}>{fallo}</Notice>}

            {cargando ? <LoadingState label="Cargando la liquidación…" /> : error ? (
                <Notice variant="danger" icon={AlertTriangle}>
                    {error.code === '42501'
                        ? 'Tu cargo todavía no tiene el módulo de Promociones. Hay que otorgarlo en Ajustes → Permisos.'
                        : (error.message || 'No se pudo cargar la liquidación.')}
                </Notice>
            ) : !hoja?.existe ? (
                <EmptyState
                    icon={Wallet}
                    title={`Sin liquidación de ${rotuloMes(mes)}`}
                    subtitle={puedeEditar
                        ? 'Calcularla junta el bono de meta, el de las promociones y el de laboratorio en una sola hoja por persona.'
                        : 'Todavía nadie la armó. La arma Supervisión o Administración.'}
                />
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-card border border-border-card p-3">
                        <Total rotulo="Total del mes" valor={fmtMoneda(hoja.total)} destacado />
                        <Total rotulo="A las personas" valor={fmtMoneda(hoja.total_personas)} />
                        <Total rotulo="A los fondos" valor={fmtMoneda(hoja.total_fondos)} />
                        <Total rotulo="Cobran" valor={String(hoja.gente ?? 0)} />
                    </div>

                    {(hoja.calculada_por || hoja.aprobada_por) && (
                        <p className="text-caption text-content-3">
                            {hoja.calculada_por && <>La armó {hoja.calculada_por}. </>}
                            {hoja.aprobada_por && <>La aprobó {hoja.aprobada_por}.</>}
                        </p>
                    )}

                    {personas.length === 0 ? (
                        <EmptyState
                            icon={Users}
                            title="Sin bonos que liquidar"
                            subtitle="Ninguna sala llegó a su meta, ninguna promoción cerró este mes y no hay excedentes aprobados."
                        />
                    ) : (
                        <>
                            <DataTable
                                columns={[
                                    { key: 'nombre',      label: 'Persona' },
                                    { key: 'sala',        label: 'Sala', hideBelow: 'md' },
                                    { key: 'meta',        label: 'Meta', align: 'right', hideBelow: 'lg' },
                                    { key: 'producto',    label: 'Promoción', align: 'right', hideBelow: 'lg' },
                                    { key: 'laboratorio', label: 'Laboratorio', align: 'right', hideBelow: 'lg' },
                                    { key: 'excedente',   label: 'Excedente', align: 'right', hideBelow: 'xl' },
                                    { key: 'total',       label: 'Total', align: 'right' },
                                ]}
                                minWidth="320px"
                                /* En la ficha del teléfono sólo la SALA acompaña al
                                   total. Sin declararlo, `DataTable` elige por su
                                   cuenta dos columnas de contexto y las pinta sin
                                   rótulo: al haber cuatro columnas de dinero, salía
                                   un monto suelto que no se puede interpretar —y para
                                   quien cobró por promoción y no por meta, un guion.
                                   El desglose completo, con sus rótulos, está a un
                                   toque en la hoja. */
                                movil={{ chips: ['sala'] }}
                                empty={{ icon: Wallet, message: 'Sin bonos que liquidar' }}
                            >
                                {visibles.map((p, i) => (
                                    <DataRow key={p.employee_id} index={i}>
                                        <DataCell>
                                            <span className="font-medium text-content">{p.nombre}</span>
                                            {p.code && (
                                                <span className="block text-micro text-content-3 tabular-nums">
                                                    {p.code}
                                                </span>
                                            )}
                                        </DataCell>
                                        <DataCell hideBelow="md">
                                            <span className="text-caption text-content-3">{p.sala || '—'}</span>
                                        </DataCell>
                                        {/* Las celdas van SUELTAS y no envueltas en un
                                            componente propio. `DataTable` arma la ficha del
                                            teléfono leyendo el `children` de la enésima
                                            `DataCell`, así que un `<Monto>` que DEVUELVE la
                                            celda no tiene children: la fila de la tabla se
                                            veía bien y el renglón de contexto de la ficha
                                            salía vacío, que es la mitad que nadie mira. */}
                                        <DataCell align="right" hideBelow="lg">
                                            <Monto valor={p.meta} />
                                        </DataCell>
                                        <DataCell align="right" hideBelow="lg">
                                            <Monto valor={p.producto} />
                                        </DataCell>
                                        <DataCell align="right" hideBelow="lg">
                                            <Monto valor={p.laboratorio} />
                                        </DataCell>
                                        <DataCell align="right" hideBelow="xl">
                                            <Monto valor={p.excedente} />
                                        </DataCell>
                                        <DataCell align="right">
                                            <span className="font-semibold text-brand tabular-nums">
                                                {fmtMoneda(p.total)}
                                            </span>
                                        </DataCell>
                                    </DataRow>
                                ))}
                            </DataTable>

                            {/* Hermano suelto del DataTable, nunca envuelto (DESIGN.md §14). */}
                            <TablePagination
                                page={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                                pageSize={pageSize}
                                onPageSizeChange={setPageSize}
                                total={personas.length}
                                unit="personas"
                            />
                        </>
                    )}

                    {fondos.length > 0 && (
                        <section className="space-y-2">
                            <h3 className="text-subtitle font-semibold text-content">
                                Fondos de área
                            </h3>
                            <p className="text-caption text-content-3">
                                No son de nadie en particular: los genera la venta de las
                                promociones y se reparten aparte.
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {fondos.map((f) => (
                                    <div key={f.area} data-surface="card"
                                        className="rounded-card border border-border-card bg-surface-card p-3">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className="text-label uppercase tracking-wide font-semibold text-content-2">
                                                {f.area === 'bodega' ? 'Bodega' : 'Administración'}
                                            </span>
                                            <span className="text-subtitle font-semibold text-content tabular-nums">
                                                {fmtMoneda(f.total)}
                                            </span>
                                        </div>
                                        {Array.isArray(f.conceptos) && f.conceptos.map((c) => (
                                            <p key={c.concepto}
                                                className="text-caption text-content-3 mt-1 flex justify-between gap-2">
                                                <span className="truncate">{c.concepto}</span>
                                                <span className="tabular-nums shrink-0">{fmtMoneda(c.monto)}</span>
                                            </p>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}

            <ConfirmModal
                isOpen={confirmar}
                onClose={() => setConfirmar(false)}
                onConfirm={() => {
                    setConfirmar(false);
                    correr(() => aprobarLiquidacion(mes, true), 'No se pudo aprobar.');
                }}
                title={`Aprobar la liquidación de ${rotuloMes(mes)}`}
                message={`Quedan congelados ${fmtMoneda(hoja?.total)} en ${hoja?.gente ?? 0} personas. A partir de aquí la hoja no se recalcula: es la que se paga.`}
                confirmText="Aprobar"
                isProcessing={ocupado}
            />

            {/* Reabrir EXIGE el motivo — lo pide la pantalla y lo exige la base,
                así que nadie descubre el freno después de mandar. */}
            <PromptModal
                isOpen={reabrir}
                onClose={() => setReabrir(false)}
                onConfirm={(texto) => {
                    setReabrir(false);
                    correr(() => aprobarLiquidacion(mes, false, texto), 'No se pudo reabrir.');
                }}
                title={`Reabrir ${rotuloMes(mes)}`}
                message="Esto deshace la aprobación y deja la hoja en borrador. Escribe por qué."
                placeholder="Faltó una promoción que cerró el último día…"
                confirmText="Reabrir"
                cancelText="Volver"
                isProcessing={ocupado}
                required
            />
        </div>
    );
}

/**
 * Un guion y no un cero: «no le tocó nada de este programa» y «le tocaron cero»
 * se leen igual en un número, y sólo uno de los dos es un dato.
 *
 * Devuelve el CONTENIDO de la celda, no la celda: `DataTable` mapea la enésima
 * `DataCell` a la enésima columna y lee su `children`, así que un componente que
 * envuelve la celda le esconde el valor a la ficha del teléfono.
 */
function Monto({ valor }) {
    return (
        <span className="tabular-nums text-content-2">
            {Number(valor) > 0 ? fmtMoneda(valor) : '—'}
        </span>
    );
}

function Total({ rotulo, valor, destacado = false }) {
    return (
        <div className="min-w-0">
            <span className="block text-micro uppercase tracking-wide text-content-3 font-semibold">
                {rotulo}
            </span>
            <span className={`text-subtitle font-semibold tabular-nums ${destacado ? 'text-brand' : 'text-content'}`}>
                {valor}
            </span>
        </div>
    );
}
