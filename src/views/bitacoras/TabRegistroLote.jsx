import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, HelpCircle, Layers, Pill } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import CarrilCards from '../../components/common/CarrilCards';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidModal from '../../components/common/LiquidModal';
import Notice from '../../components/common/Notice';
import PeriodStepper from '../../components/common/PeriodStepper';
import SegmentedControl from '../../components/common/SegmentedControl';
import StatCard from '../../components/common/StatCard';
import { correrPeriodo, fetchRegistroAntibioticosLote, periodoDe } from '@nucleo/data/bitacoras';
import { exportCsv } from '@nucleo/utils/csvExport';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { nombreDelPeriodo } from '@nucleo/utils/cierreDeBitacoras';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import {
    TIPO_MOVIMIENTO, contarPorEstado, csvDelRegistro, enCajas, estadoDeFila, explicarDiferencia,
    filasDelRegistro, saldoCorrido,
} from '@nucleo/utils/registroAntibioticos';

// ═══════════════════════════════════════════════════════════════════════════
// El registro de antibióticos POR LOTE (Guía SRS 3.3/3.4, CRÍTICOS).
//
// Por sucursal y por mes: cada lote con su saldo inicial, lo que entró, lo que
// salió, lo que debería haber y lo que hay. Al tocar un lote se ven sus
// movimientos uno por uno —fecha, documento, de dónde o a quién, quién— con el
// saldo después de cada uno. Todo en UNIDADES (cápsula, tableta, ampolla): es
// la única medida en la que compras, traslados y ventas suman entre sí.
//
// Un lote sin saldo inicial conocido NO se cuadra: se dice, en vez de inventar
// un cero. Desde el 29-oct hay foto diaria por lote, así que desde noviembre
// todos los lotes tienen base.
// ═══════════════════════════════════════════════════════════════════════════

const fmtNum = (v) => (v === null || v === undefined
    ? '—'
    : Number(v).toLocaleString('es-SV', { maximumFractionDigits: 0 }));
const fmtSigno = (v) => (v > 0 ? `+${fmtNum(v)}` : fmtNum(v));
const fmtDia = (f) => fechaTexto(f, { day: 'numeric', month: 'short' }, '—');
const fmtVence = (f) => fechaTexto(f, { month: 'short', year: 'numeric' }, '');

const FILTROS = [
    { value: 'diferencia', label: 'Con diferencia' },
    { value: 'cuadra', label: 'Cuadran' },
    { value: 'sin_base', label: 'Sin saldo inicial' },
    { value: 'todos', label: 'Todos' },
];

const ESTADO = {
    cuadra: { variant: 'success', label: 'Cuadra' },
    diferencia: { variant: 'danger', label: 'Diferencia' },
    sin_base: { variant: 'neutral', label: 'Sin saldo inicial' },
    sin_lote: { variant: 'warning', label: 'Sin lote' },
};

// Cada fila es un lote y tocarla abre sus movimientos: un destino de verdad.
// La primera celda es un bloque (producto, lote y vencimiento en dos líneas).
const MOVIL = {
    usarAccionDeFila: true, apilada: true,
    identidad: 'lote', ancla: 'diferencia', chips: ['existencia'],
};

/** Una cantidad con su equivalente en cajas debajo, cuando aporta. */
function Cantidad({ u, factor, fuerte = false, tono = '' }) {
    const cajas = enCajas(u, factor);
    return (
        <div className="flex flex-col items-end leading-tight">
            <span className={`tabular-nums ${fuerte ? 'font-bold text-content' : 'text-content-2'} ${tono}`}>{fmtNum(u)}</span>
            {cajas && <span className="text-caption text-content-3 tabular-nums whitespace-nowrap">{cajas}</span>}
        </div>
    );
}

function DetalleLote({ fila, registro, onClose }) {
    const movimientos = useMemo(() => saldoCorrido(fila), [fila]);
    const explicacion = explicarDiferencia(fila);
    const estado = estadoDeFila(fila);
    const cp = fila.cuadre_producto;

    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-4xl" ariaLabel={`Lote ${fila.lote}`}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content leading-snug">{fila.producto}</h3>
                    <p className="text-caption text-content-3">
                        Lote {fila.lote}{fila.vence ? ` · vence ${fmtVence(fila.vence)}` : ''}
                        {fila.factor_caja > 1 ? ` · caja de ${fila.factor_caja}` : ''}
                    </p>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={ESTADO[estado].variant} size="md" uppercase={false}>{ESTADO[estado].label}</Badge>
                        {fila.en_el_libro && <Badge variant="info" size="md" uppercase={false}>Va al libro bajo receta</Badge>}
                        {fila.aproximado && <Badge variant="warning" size="md" uppercase={false}>Reparto aproximado</Badge>}
                        {fila.en_vencidos > 0 && (
                            <Badge variant="warning" size="md" uppercase={false}>{fmtNum(fila.en_vencidos)} en vencidos</Badge>
                        )}
                    </div>

                    {explicacion && (
                        <Notice variant={estado === 'diferencia' ? 'warning' : 'info'} compact>{explicacion}</Notice>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        {[
                            ['Saldo inicial', fila.inicial],
                            ['Entradas', fila.entradas],
                            ['Salidas', fila.salidas ? -fila.salidas : 0],
                            ['Debería haber', fila.final_calculado],
                            ['Hay', fila.existencia],
                        ].map(([label, v]) => (
                            <div key={label} className="rounded-lg bg-surface-2 px-3 py-2">
                                <p className="text-caption text-content-3">{label}</p>
                                <Cantidad u={v} factor={fila.factor_caja} fuerte />
                            </div>
                        ))}
                    </div>

                    <DataTable
                        columns={[
                            { key: 'fecha', label: 'Fecha' },
                            { key: 'tipo', label: 'Movimiento' },
                            { key: 'documento', label: 'Documento' },
                            { key: 'quien', label: 'Responsable' },
                            { key: 'unidades', label: 'Unidades', align: 'right' },
                            { key: 'saldo', label: 'Saldo', align: 'right' },
                        ]}
                        minWidth="680px"
                        dense
                        movil={{ identidad: 'tipo', ancla: 'unidades', chips: ['fecha', 'saldo'] }}
                        empty={{ icon: Layers, message: 'Sin movimientos este mes' }}
                    >
                        {movimientos.map((m, i) => (
                            <DataRow key={`${m.fecha}-${m.documento}-${i}`} index={i}>
                                <DataCell><span className="tabular-nums text-content-2">{fmtDia(m.fecha)}</span></DataCell>
                                <DataCell>
                                    <div className="flex flex-col leading-tight">
                                        <span className="text-body-sm font-semibold text-content-2">{TIPO_MOVIMIENTO[m.tipo] ?? m.tipo}</span>
                                        {m.detalle && <span className="text-caption text-content-3">{m.detalle}</span>}
                                    </div>
                                </DataCell>
                                <DataCell><span className="text-caption text-content-2">{m.documento || '—'}</span></DataCell>
                                <DataCell><span className="text-caption text-content-2">{m.responsable || '—'}</span></DataCell>
                                <DataCell align="right">
                                    <span className={`tabular-nums font-semibold ${m.unidades < 0 ? 'text-danger-text' : 'text-success-text'}`}>
                                        {fmtSigno(m.unidades)}{m.aproximado ? '*' : ''}
                                    </span>
                                </DataCell>
                                <DataCell align="right"><span className="tabular-nums text-content-2">{fmtNum(m.saldo)}</span></DataCell>
                            </DataRow>
                        ))}
                    </DataTable>

                    {fila.aproximado && (
                        <p className="text-caption text-content-3">
                            * En ese traslado los lotes anotados no suman lo enviado: la cantidad se repartió entre ellos.
                        </p>
                    )}
                    {cp && (
                        <p className="text-caption text-content-3">
                            El producto entero ({registro?.desde ? `desde el ${fmtDia(registro.desde)}` : 'este mes'}):
                            {' '}inicial {fmtNum(cp.inicial)}, movimientos {fmtSigno(Number(cp.neto))}, hay {fmtNum(cp.existencia)}
                            {cp.diferencia !== null && cp.diferencia !== undefined
                                ? (Number(cp.diferencia) === 0 ? ' — cuadra.' : ` — diferencia ${fmtSigno(Number(cp.diferencia))}.`)
                                : '.'}
                        </p>
                    )}
                </div>
            </LiquidModal.Body>
        </LiquidModal>
    );
}

export default function TabRegistroLote({ branchId, sucursalNombre, fechaVista, busqueda }) {
    const [periodo, setPeriodo] = useState(() => periodoDe(fechaVista));
    const [registro, setRegistro] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [filtro, setFiltro] = useState('diferencia');
    const [abierta, setAbierta] = useState(null);

    useEffect(() => {
        let vivo = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al cambiar de sala o de mes
        setCargando(true);
        setError(null);
        fetchRegistroAntibioticosLote(branchId, periodo).then(({ registro: r, error: e }) => {
            if (!vivo) return;
            setRegistro(r);
            setError(e ? mensajeAmigable(e) : null);
            setCargando(false);
        });
        return () => { vivo = false; };
    }, [branchId, periodo]);

    const filas = useMemo(() => filasDelRegistro(registro), [registro]);
    const cuenta = useMemo(() => contarPorEstado(filas), [filas]);
    const visibles = useMemo(() => filas.filter(f => {
        const estado = estadoDeFila(f);
        if (filtro !== 'todos' && estado !== filtro && !(filtro === 'sin_base' && estado === 'sin_lote')) return false;
        return !busqueda || tokenMatch(`${f.producto} ${f.lote}`, busqueda);
    }), [filas, filtro, busqueda]);

    const descargar = useCallback(() => {
        const { headers, rows } = csvDelRegistro(registro, sucursalNombre);
        exportCsv(headers, rows, `registro-antibioticos-por-lote-${sucursalNombre || branchId}-${periodo}.csv`, 'bitacoras');
    }, [registro, sucursalNombre, branchId, periodo]);

    const enCurso = periodo >= periodoDe(hoySV());
    const r = registro?.resumen;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <PeriodStepper
                    unit="mes"
                    onPrev={() => setPeriodo(p => correrPeriodo(p, -1))}
                    onNext={() => setPeriodo(p => correrPeriodo(p, 1))}
                    nextDisabled={enCurso}
                >
                    <span className="text-body-sm font-bold text-content-2">{nombreDelPeriodo(periodo)}</span>
                </PeriodStepper>
                <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl size="sm" label="Qué lotes ver" value={filtro} onChange={setFiltro}
                        options={FILTROS.map(o => ({
                            ...o,
                            label: `${o.label} (${o.value === 'sin_base' ? cuenta.sin_base + cuenta.sin_lote : cuenta[o.value]})`,
                        }))} />
                    {filas.length > 0 && (
                        <Button variant="secondary" size="sm" icon={Download} onClick={descargar}>Descargar</Button>
                    )}
                </div>
            </div>

            <CarrilCards ariaLabel="Resumen del registro por lote">
                <StatCard icon={Layers} iconBg="bg-info/10" iconCls="text-info-text" label="Lotes"
                    value={r?.lotes ?? '—'} loading={cargando} />
                <StatCard icon={CheckCircle2} iconBg="bg-success/10" iconCls="text-success-text" valueCls="text-success-text"
                    label="Cuadran" value={r?.cuadran ?? '—'} loading={cargando} />
                <StatCard icon={AlertTriangle} iconBg="bg-danger/10" iconCls="text-danger-text" valueCls="text-danger-text"
                    label="Con diferencia" value={r?.con_diferencia ?? '—'} loading={cargando} />
                <StatCard icon={HelpCircle} iconBg="bg-warning/10" iconCls="text-warning-text"
                    label="Sin saldo inicial" value={r?.sin_base ?? '—'} loading={cargando} />
            </CarrilCards>

            {error ? (
                <Notice variant="danger">{error}</Notice>
            ) : registro && (
                <Notice variant="info" compact>
                    {registro.inicial_de === 'foto'
                        ? 'El saldo inicial de cada lote es el del inventario al cierre del mes anterior.'
                        : 'Todavía no hay foto del inventario por lote de antes de este mes: sólo se cuadran los lotes que entraron después del 11 de agosto. Desde noviembre se cuadran todos.'}
                    {' '}
                    {registro.existencia_de === 'ahora'
                        ? 'Lo que «hay» es la existencia de este momento.'
                        : registro.existencia_de === 'foto'
                            ? `Lo que «hay» es el inventario al cierre del ${fmtDia(registro.hasta)}.`
                            : 'De ese mes no quedó foto de cierre: no se puede comparar contra lo que había.'}
                    {r?.sin_lote_unidades > 0 && ` Entraron ${fmtNum(r.sin_lote_unidades)} unidades por traslados hechos fuera del portal, que no dicen su lote.`}
                </Notice>
            )}

            <DataTable
                columns={[
                    { key: 'lote', label: 'Producto y lote' },
                    { key: 'inicial', label: 'Inicial', align: 'right' },
                    { key: 'entradas', label: 'Entradas', align: 'right' },
                    { key: 'salidas', label: 'Salidas', align: 'right' },
                    { key: 'calculado', label: 'Debería', align: 'right' },
                    { key: 'existencia', label: 'Hay', align: 'right' },
                    { key: 'diferencia', label: 'Diferencia', align: 'right' },
                ]}
                loading={cargando}
                minWidth="860px"
                movil={MOVIL}
                empty={{
                    icon: Pill,
                    message: filtro === 'diferencia' ? 'Ningún lote con diferencia este mes' : 'Sin lotes que mostrar',
                }}
            >
                {visibles.map((f, i) => {
                    const estado = estadoDeFila(f);
                    return (
                        <DataRow key={f.clave} index={i} onClick={() => setAbierta(f)}>
                            <DataCell>
                                <div className="flex flex-col gap-0.5 min-w-0">
                                    <span className="text-body-sm font-bold text-content-2 leading-snug">{f.producto}</span>
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="text-caption font-semibold text-content-2">Lote {f.lote}</span>
                                        {f.vence && <span className="text-caption text-content-3">vence {fmtVence(f.vence)}</span>}
                                        {estado !== 'cuadra' && estado !== 'diferencia' && (
                                            <Badge variant={ESTADO[estado].variant} size="sm" uppercase={false}>{ESTADO[estado].label}</Badge>
                                        )}
                                        {f.en_el_libro && <Badge variant="info" size="sm" uppercase={false}>Libro</Badge>}
                                    </div>
                                </div>
                            </DataCell>
                            <DataCell align="right"><Cantidad u={f.inicial} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.entradas} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.salidas} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.final_calculado} factor={f.factor_caja} /></DataCell>
                            <DataCell align="right"><Cantidad u={f.existencia} factor={f.factor_caja} fuerte /></DataCell>
                            <DataCell align="right">
                                {f.diferencia === null
                                    ? <span className="text-caption text-content-3">—</span>
                                    : <span className={`tabular-nums font-bold ${f.diferencia === 0 ? 'text-success-text' : 'text-danger-text'}`}>
                                        {f.diferencia === 0 ? '0' : fmtSigno(f.diferencia)}
                                    </span>}
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>

            {abierta && <DetalleLote fila={abierta} registro={registro} onClose={() => setAbierta(null)} />}
        </div>
    );
}
