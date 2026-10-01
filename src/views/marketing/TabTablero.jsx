import React, { useMemo, useState } from 'react';
import Badge from '../../components/common/Badge';
import { fechaTexto } from '@nucleo/utils/fecha';
import { ESTADOS_PIEZA, ESTADOS_DEL_DISENADOR, ESTADOS_DE_SALIDA } from '@nucleo/utils/marketing';
import FichaDePieza from './FichaDePieza';

/**
 * El flujo de trabajo: una columna por estado. Es lo que se ve ANTES de que el
 * mes se publique — cuánto falta y en qué está cada pieza — aunque los diseños
 * todavía no se puedan mirar.
 *
 * Arrastrar sólo mueve entre los estados del diseñador (pendiente, en proceso,
 * finalizado) y, después de aprobada, a programado o publicado. Aprobar y pedir cambios no se hace
 * soltando una tarjeta: eso lo hace quien revisa, con su comentario.
 */
export default function TabTablero({ piezas, marcasDe, comentariosPorPieza, ultimos, personas, puedeMoverla, onAbrir, onMover }) {
    const [sobre, setSobre] = useState(null);
    const porEstado = useMemo(() => {
        const m = Object.fromEntries(ESTADOS_PIEZA.map((e) => [e.value, []]));
        for (const p of piezas) (m[p.estado] ||= []).push(p);
        return m;
    }, [piezas]);

    // Sólo quien creó la pieza la mueve (lo exige también la base).
    const admite = (destino, pieza) => {
        if (!pieza || !puedeMoverla(pieza) || pieza.estado === destino) return false;
        if (ESTADOS_DEL_DISENADOR.includes(destino)) return !['aprobado', 'programado', 'publicado'].includes(pieza.estado);
        if (destino === 'programado') return pieza.estado === 'aprobado';
        return destino === 'publicado' && ['aprobado', 'programado'].includes(pieza.estado);
    };

    const soltar = (destino) => (e) => {
        e.preventDefault();
        setSobre(null);
        const pieza = piezas.find((p) => p.id === e.dataTransfer.getData('text/pieza'));
        if (admite(destino, pieza)) {
            onMover(pieza, destino === 'publicado'
                ? { estado: destino, publicado_en: new Date().toISOString() }
                : { estado: destino });
        }
    };

    return (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x lg:snap-none">
            {ESTADOS_PIEZA.map((e) => {
                const lista = porEstado[e.value] || [];
                const destinoValido = ESTADOS_DEL_DISENADOR.includes(e.value) || ESTADOS_DE_SALIDA.includes(e.value);
                return (
                    <section key={e.value}
                        className={`snap-start shrink-0 w-[78vw] sm:w-64 lg:flex-1 lg:min-w-[200px] rounded-lg p-2 space-y-2 ${sobre === e.value ? 'bg-surface-card-hover' : 'bg-surface-input'}`}
                        onDragOver={destinoValido ? (ev) => { ev.preventDefault(); setSobre(e.value); } : undefined}
                        onDragLeave={destinoValido ? () => setSobre((s) => (s === e.value ? null : s)) : undefined}
                        onDrop={destinoValido ? soltar(e.value) : undefined}
                        aria-label={`${e.label}: ${lista.length}`}>
                        <header className="flex items-center justify-between px-1">
                            <Badge variant={e.variant} size="sm">{e.label}</Badge>
                            <span className="text-label tabular-nums text-content-3">{lista.length}</span>
                        </header>
                        {lista.map((p) => (
                            <div key={p.id} className="space-y-0.5">
                                <span className="text-micro text-content-3 px-1">
                                    {fechaTexto(p.fecha, { weekday: 'short', day: 'numeric', month: 'short' })}
                                </span>
                                <FichaDePieza pieza={p} marcas={marcasDe(p)}
                                    comentarios={comentariosPorPieza[p.id]} cambio={ultimos[p.id]} personas={personas}
                                    arrastrable={puedeMoverla(p) && p.estado !== 'publicado'} onAbrir={() => onAbrir(p)} grande />
                            </div>
                        ))}
                        {!lista.length && <p className="text-micro text-content-3 px-1 py-4 text-center">Sin piezas</p>}
                    </section>
                );
            })}
        </div>
    );
}
