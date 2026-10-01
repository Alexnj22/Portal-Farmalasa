import React, { useMemo, useState } from 'react';
import { Plus, Star } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import useMediaQuery from '../../plataforma/useMediaQuery';
import { CORTE_TELEFONO } from '../../components/common/usarExpediente';
import { hoySV, fechaTexto } from '@nucleo/utils/fecha';
import { semanasDelMes, piezasPorDia, DIAS_SEMANA, fechasEspecialesDelMes } from '@nucleo/utils/marketing';
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
    mes, piezas, marcasDe, comentariosPorPieza, ultimos, personas, especiales, puedeEditar, puedeMoverla,
    onAbrir, onNueva, onMover,
}) {
    const enTelefono = useMediaQuery(CORTE_TELEFONO);
    const semanas = useMemo(() => semanasDelMes(mes), [mes]);
    const porDia = useMemo(() => piezasPorDia(piezas), [piezas]);
    const fechas = useMemo(() => fechasEspecialesDelMes(especiales, mes), [especiales, mes]);
    // Tocar una fecha especial la convierte en pieza (quien edita) ya escrita.
    const desdeFecha = (f) => onNueva(f.fecha, {
        titulo: f.nombre, pilar: 'fecha_especial', notas: f.idea || '', fecha: f.fecha,
    });
    const hoy = hoySV();
    const [sobre, setSobre] = useState(null);   // el día sobre el que se arrastra

    if (enTelefono) {
        // El mes entero, día por día, aunque esté vacío: el calendario se ve
        // siempre (pedido del usuario) y cada día vacío es donde se agrega.
        const dias = semanas.flat().filter(Boolean);
        return (
            <div className="space-y-3">
                {dias.map((d) => (
                    <section key={d} className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <h3 className={`text-label uppercase tracking-wide font-semibold ${d === hoy ? 'text-brand' : 'text-content-2'}`}>
                                {fechaTexto(d, { weekday: 'long', day: 'numeric', month: 'long' })}
                            </h3>
                            {puedeEditar && (
                                <Button variant="ghost" size="xs" iconOnly icon={Plus}
                                    title={`Agregar pieza el ${fechaTexto(d, { day: 'numeric', month: 'long' })}`}
                                    onClick={() => onNueva(d)} />
                            )}
                        </div>
                        {(fechas[d] || []).map((f) => (
                            <MarcaDeFecha key={f.id} fecha={f} puedeEditar={puedeEditar} onUsar={() => desdeFecha(f)} />
                        ))}
                        {(porDia[d] || []).map((p) => (
                            <FichaDePieza key={p.id} pieza={p} marcas={marcasDe(p)}
                                comentarios={comentariosPorPieza[p.id]} cambio={ultimos[p.id]} personas={personas}
                                onAbrir={() => onAbrir(p)} grande />
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
        if (pieza && pieza.fecha !== fecha && puedeMoverla(pieza)) onMover(pieza, { fecha });
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
                                {(fechas[d] || []).map((f) => (
                                    <MarcaDeFecha key={f.id} fecha={f} puedeEditar={puedeEditar} onUsar={() => desdeFecha(f)} />
                                ))}
                                {lista.map((p) => (
                                    <FichaDePieza key={p.id} pieza={p} marcas={marcasDe(p)}
                                        comentarios={comentariosPorPieza[p.id]}
                                        arrastrable={puedeMoverla(p)} onAbrir={() => onAbrir(p)} />
                                ))}
                            </div>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}

/**
 * Una fecha especial en el día. Quien edita la toca y nace una pieza con el
 * nombre, el tema y la idea; el resto la ve como recordatorio.
 */
function MarcaDeFecha({ fecha, puedeEditar, onUsar }) {
    const contenido = (
        <>
            <Star size={10} className="shrink-0" aria-hidden />
            <span className="truncate">{fecha.nombre}</span>
        </>
    );
    return puedeEditar ? (
        <Button variant="ghost" size="xs" className="justify-start min-w-0 max-w-full text-chart-8-text"
            title={`${fecha.nombre}${fecha.idea ? ` — ${fecha.idea}` : ''}. Toca para planificar una pieza`} onClick={onUsar}>
            <span className="flex items-center gap-1 min-w-0 text-micro font-semibold">{contenido}</span>
        </Button>
    ) : (
        <LiquidTooltip content={fecha.idea || fecha.nombre}>
            <span className="flex items-center gap-1 min-w-0 text-micro font-semibold text-chart-8-text">{contenido}</span>
        </LiquidTooltip>
    );
}
