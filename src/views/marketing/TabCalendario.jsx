import React, { useMemo, useState } from 'react';
import { Plus, CalendarDays } from 'lucide-react';
import Button from '../../components/common/Button';
import { EmptyState } from '../../components/common/StateViews';
import useMediaQuery from '../../plataforma/useMediaQuery';
import { CORTE_TELEFONO } from '../../components/common/usarExpediente';
import { hoySV, fechaTexto } from '@nucleo/utils/fecha';
import { semanasDelMes, piezasPorDia, DIAS_SEMANA } from '@nucleo/utils/marketing';
import FichaDePieza from './FichaDePieza';

/**
 * El mes completo. En escritorio, la grilla de siete columnas; en el teléfono,
 * la agenda día por día — una grilla de 7 columnas en 390px deja celdas de
 * 50px donde no entra ni el título.
 *
 * Quien edita arrastra una pieza a otro día para moverla, y toca un día vacío
 * para agregar ahí.
 */
export default function TabCalendario({
    mes, piezas, marcas, comentariosPorPieza, puedeEditar, onAbrir, onNueva, onMover,
}) {
    const enTelefono = useMediaQuery(CORTE_TELEFONO);
    const semanas = useMemo(() => semanasDelMes(mes), [mes]);
    const porDia = useMemo(() => piezasPorDia(piezas), [piezas]);
    const hoy = hoySV();
    const [sobre, setSobre] = useState(null);   // el día sobre el que se arrastra

    if (enTelefono) {
        const dias = semanas.flat().filter(Boolean).filter((d) => porDia[d]?.length);
        if (!dias.length) {
            return (
                <EmptyState icon={CalendarDays} title="Sin piezas este mes"
                    subtitle={puedeEditar ? 'Agrega la primera pieza del calendario.' : 'El diseñador todavía no planificó este mes.'}
                    action={puedeEditar ? <Button icon={Plus} onClick={() => onNueva(null)}>Agregar pieza</Button> : undefined} />
            );
        }
        return (
            <div className="space-y-4">
                {dias.map((d) => (
                    <section key={d} className="space-y-2">
                        <h3 className={`text-label uppercase tracking-wide font-semibold ${d === hoy ? 'text-brand' : 'text-content-2'}`}>
                            {fechaTexto(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                        </h3>
                        {porDia[d].map((p) => (
                            <FichaDePieza key={p.id} pieza={p} marca={marcas[p.marca_id]}
                                comentarios={comentariosPorPieza[p.id]} onAbrir={() => onAbrir(p)} grande />
                        ))}
                    </section>
                ))}
            </div>
        );
    }

    const soltar = (fecha) => (e) => {
        e.preventDefault();
        setSobre(null);
        const id = e.dataTransfer.getData('text/pieza');
        const pieza = piezas.find((p) => p.id === id);
        if (pieza && pieza.fecha !== fecha) onMover(pieza, { fecha });
    };

    return (
        <div data-surface="card" className="overflow-hidden p-0">
            <div className="grid grid-cols-7 border-b border-border-card">
                {DIAS_SEMANA.map((d) => (
                    <div key={d} className="px-2 py-2 text-label uppercase tracking-wide font-semibold text-content-3 text-center">{d}</div>
                ))}
            </div>
            {semanas.map((semana, i) => (
                <div key={i} className="grid grid-cols-7 border-b border-border-card last:border-b-0">
                    {semana.map((d, j) => {
                        if (!d) return <div key={j} className="min-h-[120px] border-r border-border-card last:border-r-0" />;
                        const lista = porDia[d] || [];
                        const esHoy = d === hoy;
                        return (
                            <div key={d}
                                className={`group min-h-[120px] p-1.5 border-r border-border-card last:border-r-0 flex flex-col gap-1 ${sobre === d ? 'bg-surface-card-hover' : ''}`}
                                onDragOver={puedeEditar ? (e) => { e.preventDefault(); setSobre(d); } : undefined}
                                onDragLeave={puedeEditar ? () => setSobre((s) => (s === d ? null : s)) : undefined}
                                onDrop={puedeEditar ? soltar(d) : undefined}>
                                <div className="flex items-center justify-between">
                                    <span className={`text-label tabular-nums font-semibold ${esHoy ? 'text-brand' : 'text-content-2'}`}>
                                        {Number(d.slice(8))}
                                    </span>
                                    {puedeEditar && (
                                        <Button variant="ghost" size="xs" iconOnly icon={Plus}
                                            title={`Agregar pieza el ${fechaTexto(d, { day: 'numeric', month: 'long' })}`}
                                            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                            onClick={() => onNueva(d)} />
                                    )}
                                </div>
                                {lista.map((p) => (
                                    <FichaDePieza key={p.id} pieza={p} marca={marcas[p.marca_id]}
                                        comentarios={comentariosPorPieza[p.id]}
                                        arrastrable={puedeEditar} onAbrir={() => onAbrir(p)} />
                                ))}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
