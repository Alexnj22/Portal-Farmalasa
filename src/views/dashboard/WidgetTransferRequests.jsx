import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import LanzadorSolicitud from './LanzadorSolicitud';
import { SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { FilaPorConfirmar, FilaPorRecibir } from '../traslados/FilasTraslado';
import {
    fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir, contarTrasladosPorConfirmar,
} from '../../data/traslados';

// Widget «Traslados entre Salas».
//
// Es el otro extremo de la lista de faltantes de Consulta de Inventario: allá
// una sala pide lo que no tiene, y acá la sala que lo tiene confirma o dice que
// no. Las dos mitades del mismo movimiento.
//
// ── Por qué no vive en Solicitudes ────────────────────────────────────────
// Porque quien confirma un traslado no tiene por qué poder aprobar vacaciones.
// El permiso es `traslados`, aparte de `requests`, y esta pantalla es la única
// que lo consulta. Mandar el aviso a /requests dejaría a una jefatura de sala
// mirando una vista que su permiso no abre.
//
// ── Dos listas, porque son dos momentos ───────────────────────────────────
// «Por confirmar» es lo que otra sala me pide. «Por recibir» es lo que yo pedí,
// ya salió y todavía no entró — el estado que el sistema llama NO RECIBIDO y
// que hoy tiene 20 traslados parados, el más viejo de hace más de una semana.
// Sin la segunda, el producto queda en tránsito y nadie vuelve a mirarlo.

// Las filas —la de confirmar, la de recibir— viven en
// `views/traslados/FilasTraslado.jsx`: las usa también la vista `/traslados`, y
// dos copias de la misma fila terminan comportándose distinto.

/* ─── El contenido del modal ──────────────────────────────────────────────── */
function PanelTraslados({ onCambio }) {
    const { hasPermission, user } = useAuth();
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const employees = useStaffStore(s => s.employees);
    const [porConfirmar, setPorConfirmar] = useState(null);
    const [porRecibir,   setPorRecibir]   = useState(null);
    const [error,        setError]        = useState('');

    // Confirmar un traslado es el permiso `traslados`; recibir lo que uno pidió
    // no lo necesita. Son dos cosas distintas y por eso son dos secciones: la
    // primera solo aparece para quien puede decidir sobre el producto de su
    // sala. El RLS ya no le mostraría las filas de todos modos — esto evita el
    // encabezado de una lista que siempre va a estar vacía.
    const puedeConfirmar = hasPermission('traslados', 'can_approve');

    const nombrePor = useCallback((id) => {
        const e = (employees ?? []).find(x => x.id === id);
        return e?.name ?? 'Alguien';
    }, [employees]);

    const cargar = useCallback(async () => {
        const [a, b] = await Promise.all([fetchTrasladosPorConfirmar(), fetchTrasladosPorRecibir()]);
        if (a.error || b.error) setError((a.error ?? b.error).message ?? 'No se pudo leer.');
        setPorConfirmar(a.filas);
        setPorRecibir(b.filas);
        onCambio?.();
    }, [onCambio]);

    useEffect(() => { cargar(); }, [cargar]);

    const cargando = porConfirmar === null || porRecibir === null;
    const vacio = !cargando
        && (!puedeConfirmar || porConfirmar.length === 0)
        && porRecibir.length === 0;

    return (
        <div className="flex flex-col gap-4 flex-1 min-h-0">
            {/* El encabezado NO es decoración: sin él el modal se abre en una
                caja con un mensaje suelto y no dice qué se abrió. Los otros
                widgets de la familia se explican solos por su contenido —cinco
                tarjetas rotuladas, un buscador—; este puede estar vacío, y un
                vacío sin título no se entiende. Visto en el navegador. */}
            <div className="flex items-center gap-2.5 shrink-0">
                <div className="w-9 h-9 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
                    <ArrowLeftRight size={16} strokeWidth={2} className="text-brand-text" />
                </div>
                <div className="min-w-0">
                    <p className="text-body-sm font-black text-content leading-tight">Traslados entre Salas</p>
                    <p className="text-micro text-content-3 mt-0.5">
                        Lo que te piden de tu sala y lo que viene en camino
                    </p>
                </div>
            </div>

            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

            {cargando && <SkeletonText lines={3} />}

            {vacio && (
                <div className="flex flex-col items-center justify-center flex-1 gap-2 py-8">
                    <CheckCircle2 size={28} strokeWidth={1.5} className="text-content-3" />
                    <p className="text-label font-semibold text-content-3 text-center leading-snug">
                        Nada por confirmar<br />ni por recibir
                    </p>
                </div>
            )}

            {!cargando && puedeConfirmar && porConfirmar.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Te piden de tu sala
                    </p>
                    {porConfirmar.map(f => (
                        <FilaPorConfirmar key={f.id} fila={f} nombrePor={nombrePor} onHecho={cargar} />
                    ))}
                </div>
            )}

            {!cargando && porRecibir.length > 0 && (
                <div className="flex flex-col gap-2">
                    {/* «a tu sala» solo si TODOS son de la sala propia. Con
                        alcance de todas las sucursales entran los de otras, y
                        ahí ese encabezado dice algo falso — visto en la prueba
                        del 2026-08-06, donde Salud 1 leía «en camino a tu sala»
                        sobre un traslado que iba a Salud 2. */}
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        {porRecibir.every(f => String(f.metadata?.branch_id ?? '') === String(miBranch ?? ''))
                            ? 'En camino a tu sala'
                            : 'En camino'}
                    </p>
                    {porRecibir.map(f => (
                        <FilaPorRecibir key={f.id} fila={f} onHecho={cargar} />
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
export default function WidgetTransferRequests() {
    const [pendientes, setPendientes] = useState(null);

    const contar = useCallback(() => {
        contarTrasladosPorConfirmar().then(r => setPendientes(r.total));
    }, []);

    useEffect(() => { contar(); }, [contar]);

    return (
        <LanzadorSolicitud
            icon={ArrowLeftRight}
            label="Traslados entre Salas"
            pendientes={pendientes}
            etiquetaPendientes="te piden"
            etiquetaPendientesPlural="te piden"
            vacio="Nada pendiente"
            tono="brand"
            maxWidth="max-w-lg"
            descripcion="Pedir producto a otra sala, y confirmar lo que te piden"
        >
            {/* Sin `min-h` ni scroller propio: el cuerpo canónico
                (`LiquidModal.Body`) ya scrollea, y el alto lo topa el modal. */}
            {() => <PanelTraslados onCambio={contar} />}
        </LanzadorSolicitud>
    );
}
