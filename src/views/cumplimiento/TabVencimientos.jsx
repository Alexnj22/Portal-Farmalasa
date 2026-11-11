import React, { useMemo } from 'react';
import { CalendarClock } from 'lucide-react';
import Badge from '../../components/common/Badge';
import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import { EmptyState } from '../../components/common/StateViews';
import { calendarioDeVencimientos, tonoDeVencimiento } from '@nucleo/utils/cumplimiento';
import { documentosDeSucursal } from '@nucleo/utils/expedienteDeSucursal';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';

/*
 * El calendario de vencimientos de la red (2026-11-11): permisos,
 * credenciales, contratos y extintores, ordenados por fecha. Sale de los
 * MISMOS documentos del expediente de cada sucursal que mira el aviso diario
 * (`check-doc-expiry`, 60/30/7 días): acá se ve todo junto, allá llega el aviso.
 * Se corrige en Sucursales → la sala → Expediente.
 */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export default function TabVencimientos({ branches, branchId }) {
    const hoy = hoySV();
    const filas = useMemo(() => calendarioDeVencimientos(
        (branches || []).filter((b) => !branchId || String(b.id) === String(branchId)), documentosDeSucursal, hoy,
    ), [branches, branchId, hoy]);

    // Agrupado: lo vencido arriba, después mes por mes.
    const grupos = useMemo(() => {
        const g = new Map();
        for (const f of filas) {
            const clave = f.dias < 0 ? 'vencido' : f.vence.slice(0, 7);
            if (!g.has(clave)) g.set(clave, []);
            g.get(clave).push(f);
        }
        return [...g.entries()];
    }, [filas]);

    if (filas.length === 0) {
        return <EmptyState icon={CalendarClock} title="Sin fechas de vencimiento"
            subtitle="Las fechas se anotan en el expediente de cada sucursal." />;
    }

    return (
        <div className="space-y-5">
            {grupos.map(([clave, lista]) => {
                const [a, m] = clave.split('-').map(Number);
                const titulo = clave === 'vencido' ? 'Ya vencidos' : `${MESES[m - 1]} de ${a}`;
                return (
                    <section key={clave}>
                        <TituloDeSeccion nivel="seccion" tono={clave === 'vencido' ? 'danger' : undefined} className="mb-2">{titulo}</TituloDeSeccion>
                        <ul className="space-y-2">
                            {lista.map((f) => (
                                <li key={`${f.branchId}-${f.docId}`} data-surface="card" className="p-3 flex flex-wrap items-center gap-2 justify-between">
                                    <div className="min-w-0">
                                        <p className="text-body-sm font-bold text-content">{f.documento}</p>
                                        <p className="text-caption text-content-3">{f.sala} · vence el {fechaTexto(f.vence, { day: '2-digit', month: 'long', year: 'numeric' })}</p>
                                    </div>
                                    <Badge variant={tonoDeVencimiento(f.dias)} uppercase={false}>
                                        {f.dias < 0 ? `Venció hace ${-f.dias} d` : f.dias === 0 ? 'Vence hoy' : `Faltan ${f.dias} d`}
                                    </Badge>
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}
