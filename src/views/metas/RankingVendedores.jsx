import React, { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import SegmentedControl from '../../components/common/SegmentedControl';
import { EmptyState } from '../../components/common/StateViews';
import { formatMoney } from '../../utils/formatNumber';

// Quién está vendiendo este mes. Top 2 resaltado, el resto en gris, y en ROJO
// quien está bajo el promedio de la sala (decisión del usuario 2026-08-05).
//
// El interruptor «total / por día» existe porque sin él el ranking castiga a
// quien faltó. Medido con agosto real: Katherine vendió UN día y ese día hizo
// $334.60 — más que quien trabajó cuatro. Por total queda 6ª; por día, 4ª.
// Marcarla en rojo por el total sería reprocharle la ausencia, no la venta.
//
// Hoy «días» son los días en que efectivamente vendió: es el único dato de
// asistencia que existe (`timesheets.absence_type` está en cero y
// `employee_events` tiene una sola fila). El día que se registren incapacidades
// y vacaciones, el servidor cambia el denominador y esta pantalla no se entera.
const ORDENES = [
    { value: 'total', label: 'Total del mes' },
    { value: 'dia',   label: 'Por día trabajado' },
];

export default function RankingVendedores({ data, compacto = false }) {
    const [orden, setOrden] = useState('total');

    const { filas, promedio, maximo } = useMemo(() => {
        const base = (data?.vendedores || []).map((v) => ({
            ...v,
            venta: Number(v.venta),
            ticket: Number(v.ticket),
            dias: Number(v.dias),
            venta_dia: Number(v.venta_dia),
        }));
        const clave = orden === 'dia' ? 'venta_dia' : 'venta';
        const prom = orden === 'dia' ? Number(data?.promedio_dia || 0) : Number(data?.promedio_venta || 0);
        const ord = [...base].sort((a, b) => b[clave] - a[clave]);
        return { filas: ord, promedio: prom, maximo: ord.length ? ord[0][clave] : 0 };
    }, [data, orden]);

    if (!filas.length) {
        return (
            <div data-surface="card" className="p-5">
                <EmptyState
                    compact icon={Users}
                    title="Sin ventas este mes"
                    subtitle="Cuando alguien registre una venta, aparece acá con su puesto."
                />
            </div>
        );
    }

    const clave = orden === 'dia' ? 'venta_dia' : 'venta';
    const sufijo = orden === 'dia' ? ' por día' : '';

    return (
        <div data-surface="card" className="p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                <div className="min-w-0">
                    <p className="text-caption font-black uppercase tracking-widest text-content-3">
                        Quién está vendiendo · {data?.sala}
                    </p>
                    <p className="text-label font-semibold text-content-3 mt-0.5 tabular-nums">
                        {filas.length} persona{filas.length !== 1 ? 's' : ''} · promedio{' '}
                        <strong className="text-content-2">{formatMoney(promedio)}</strong>{sufijo}
                        {data?.promedio_ticket != null && (
                            <> · ticket de la sala <strong className="text-content-2">{formatMoney(data.promedio_ticket)}</strong></>
                        )}
                    </p>
                </div>
                <SegmentedControl
                    options={ORDENES} value={orden} onChange={setOrden} size="sm"
                    label="Cómo ordenar el ranking"
                />
            </div>

            <ul className="space-y-0.5">
                {filas.map((v, i) => {
                    const valor = v[clave];
                    const bajo = valor < promedio;
                    const top = i < 2;
                    const ancho = maximo > 0 ? Math.max(2, (valor / maximo) * 100) : 0;
                    const marca = maximo > 0 ? Math.min(100, (promedio / maximo) * 100) : 0;
                    // Un solo día trabajado explica un total bajo, así que se
                    // dice en ámbar: nadie debería leer el último puesto sin ese
                    // dato al lado.
                    const pocosDias = v.dias <= 1;

                    return (
                        <li
                            key={`${v.employee_id}-${v.sala}`}
                            className={`grid grid-cols-[26px_1fr_auto] gap-3 items-center rounded-xl px-1.5 py-2 ${
                                top ? 'bg-chart-1/8' : bajo ? 'bg-danger/6' : ''
                            }`}
                        >
                            <span className={`text-label font-black text-center tabular-nums ${
                                top ? 'text-chart-1-text' : bajo ? 'text-danger-text' : 'text-content-3'
                            }`}>
                                {i + 1}º
                            </span>

                            <div className="min-w-0">
                                {/* El recorte va sobre el NOMBRE, no sobre la
                                    línea entera: con `truncate` en el `<p>`, un
                                    nombre largo se comía los dos sufijos y la
                                    sucursal desaparecía sin dejar rastro (medido
                                    en el teléfono: «· La Popular» quedaba 29px
                                    afuera). El nombre se puede acortar; saber de
                                    qué sala es el vendedor, no. */}
                                <p className={`flex items-baseline text-body-sm font-black ${bajo ? 'text-danger-text' : 'text-content'}`}>
                                    <span className="min-w-0 truncate">{v.nombre}</span>
                                    {i === 0 && (
                                        <span className="shrink-0 text-micro font-black uppercase tracking-widest text-chart-1-text">&nbsp;· el más alto</span>
                                    )}
                                    {data?.todas && v.sala && (
                                        <span className="shrink-0 text-micro font-semibold text-content-3">&nbsp;· {v.sala}</span>
                                    )}
                                </p>
                                <p className="text-micro font-semibold text-content-3 tabular-nums mt-0.5">
                                    {v.tickets} tickets · {formatMoney(v.ticket)} c/u ·{' '}
                                    <span className={pocosDias ? 'text-warning-text font-black' : undefined}>
                                        {v.dias} día{v.dias !== 1 ? 's' : ''}
                                    </span>
                                    {' · '}{formatMoney(v.venta_dia)}/día
                                </p>
                                <div className="relative h-1.5 rounded-full bg-surface-card-hover mt-1.5">
                                    <span
                                        className={`absolute inset-y-0 left-0 rounded-full ${
                                            top ? 'bg-chart-1' : bajo ? 'bg-danger' : 'bg-content-3/50'
                                        }`}
                                        style={{ width: `${ancho}%` }}
                                    />
                                    {/* La marca es el promedio: estar a su izquierda
                                        o a su derecha es la respuesta a «¿voy bien?». */}
                                    <span
                                        className="absolute -inset-y-1 w-0.5 rounded-full bg-content-2"
                                        style={{ left: `${marca}%` }}
                                    />
                                </div>
                            </div>

                            <div className="text-right">
                                <p className={`text-body-sm font-black tabular-nums ${bajo ? 'text-danger-text' : 'text-content'}`}>
                                    {formatMoney(valor)}
                                </p>
                                {/* El color no viaja solo: cada fila lo dice con
                                    palabras, para quien no distingue rojo y verde. */}
                                <p className={`text-micro font-black uppercase tracking-wider ${
                                    bajo ? 'text-danger-text' : 'text-success-text'
                                }`}>
                                    {bajo ? 'bajo el promedio' : 'sobre el promedio'}
                                </p>
                            </div>
                        </li>
                    );
                })}
            </ul>

            {!compacto && (
                <p className="text-micro font-semibold text-content-3 mt-3">
                    La marca de cada barra es el promedio.{' '}
                    <strong className="text-warning-text">Quien trabajó un solo día</strong> lo lleva anotado:
                    un total bajo con pocos días no es lo mismo que un total bajo con el mes entero.
                </p>
            )}
        </div>
    );
}
