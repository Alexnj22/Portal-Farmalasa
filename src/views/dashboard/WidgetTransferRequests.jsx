import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import LanzadorSolicitud from './LanzadorSolicitud';
import { Flujo, FranjaVacia } from './InstrumentoBaldosa';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import { useNowTick } from '../../hooks/useNowTick';
import { FilaPorConfirmar, FilaPorRecibir } from '../traslados/FilasTraslado';
import {
    fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir,
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
// Ya no pide nada: recibe las dos listas que la baldosa trajo al montarse, así
// que abrir el modal muestra el contenido en vez de un esqueleto.
function PanelTraslados({ porConfirmar, porRecibir, error, onCambio }) {
    const { hasPermission, user } = useAuth();
    const miBranch = user?.branchId ?? user?.branch_id ?? null;
    const employees = useStaffStore(s => s.employees);

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

    /* El mismo reloj que la vista: la tarjeta dice cuánto lleva el traslado en
     * camino, y las dos pantallas comparten la tarjeta — dejarlo sólo en una
     * sería la deriva que el encabezado de `FilasTraslado` viene a evitar. */
    const ahora = useNowTick(60_000);

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
                    <p className="text-body-sm font-black text-content leading-tight">Traslados entre salas</p>
                    <p className="text-micro text-content-3 mt-0.5">
                        Lo que te piden de tu sala y lo que viene en camino
                    </p>
                </div>
            </div>

            {error && <p className="text-label text-danger-text font-medium px-1">{error}</p>}

            {cargando && <SkeletonText lines={3} />}

            {vacio && (
                <EmptyState linea icon={CheckCircle2} title="Sin traslados pendientes" />
            )}

            {!cargando && puedeConfirmar && porConfirmar.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                        Te piden de tu sala
                    </p>
                    {porConfirmar.map(f => (
                        <FilaPorConfirmar key={f.id} fila={f} nombrePor={nombrePor} onHecho={onCambio} />
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
                        <FilaPorRecibir key={f.id} fila={f} onHecho={onCambio} ahora={ahora} />
                    ))}
                </div>
            )}
        </div>
    );
}

/* ─── La baldosa del tablero ──────────────────────────────────────────────── */
//
// Trae las listas al montarse y de ahí sale el número, igual que en «Facturas de
// mi Sala» (v2.515.2). Antes eran cuatro viajes por apertura: contar al montar,
// las dos listas al abrir, y contar OTRA VEZ porque el panel llamaba `onCambio`
// al final de cada carga — incluida la primera, cuando entre el montaje y la
// apertura no había cambiado nada.
//
// El total NO es `porConfirmar.length`: sale del `count` exacto que devuelve la
// misma consulta. La lista está topada en 201 filas, así que contar por su largo
// sería un tope silencioso esperando a que alguien lo cruce.
export default function WidgetTransferRequests() {
    const [porConfirmar, setPorConfirmar] = useState(null);
    const [porRecibir,   setPorRecibir]   = useState(null);
    const [pendientes,   setPendientes]   = useState(null);
    const [error,        setError]        = useState('');

    const cargar = useCallback(async () => {
        const [a, b] = await Promise.all([fetchTrasladosPorConfirmar(), fetchTrasladosPorRecibir()]);
        if (a.error || b.error) setError((a.error ?? b.error).message ?? 'No se pudo leer.');
        setPorConfirmar(a.filas);
        setPorRecibir(b.filas);
        setPendientes(a.total);
    }, []);

    // El `setState` ocurre DESPUÉS del `await`, no en el cuerpo del efecto, así
    // que no encadena renders — la regla no puede distinguirlo. Misma anotación
    // y mismo motivo que en `TrasladosView`.
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    return (
        <LanzadorSolicitud
            icon={ArrowLeftRight}
            label="Traslados entre salas"
            pendientes={pendientes}
            etiquetaPendientes="te piden"
            etiquetaPendientesPlural="te piden"
            vacio="Sin traslados"
            tono="brand"
            maxWidth="max-w-lg"
            descripcion="Pedir producto a otra sala, y confirmar lo que te piden"
            // Las dos mitades del mismo movimiento. La baldosa ya traía las dos
            // listas al montarse y pintaba SÓLO la primera: lo que uno está
            // esperando de otra sala —la mitad que hace levantar el teléfono—
            // estaba en memoria y no se mostraba. Cero consultas nuevas.
            instrumento={porConfirmar === null
                ? <FranjaVacia />
                : <Flujo entra={pendientes ?? 0} sale={porRecibir?.length ?? 0} />}
            detalle={porRecibir?.length ? `${porRecibir.length} esperás` : null}
        >
            {/* Sin `min-h` ni scroller propio: el cuerpo canónico
                (`LiquidModal.Body`) ya scrollea, y el alto lo topa el modal. */}
            {() => (
                <PanelTraslados
                    porConfirmar={porConfirmar}
                    porRecibir={porRecibir}
                    error={error}
                    onCambio={cargar}
                />
            )}
        </LanzadorSolicitud>
    );
}
