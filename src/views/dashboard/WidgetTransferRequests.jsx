import React, { useState, useEffect, useCallback } from 'react';
import { ArrowLeftRight, CheckCircle2, Loader2, PackageCheck, Truck, X } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import LanzadorSolicitud from './LanzadorSolicitud';
import PortalTextarea from '../../components/common/PortalTextarea';
import { SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore } from '../../store/staffStore';
import {
    MOTIVOS_RECHAZO, fetchTrasladosPorConfirmar, fetchTrasladosPorRecibir,
    contarTrasladosPorConfirmar, despacharTraslado, recibirTraslado, rechazarTraslado,
    fetchDisponibilidadTraslado,
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

const fmtCuando = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    return mismoDia
        ? d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('es-SV', { day: '2-digit', month: 'short' });
};

/** Lo que se pide, en una línea legible. */
function resumenItems(meta) {
    const items = Array.isArray(meta?.items) ? meta.items : [];
    if (items.length === 0) return 'Sin detalle';
    if (items.length === 1) {
        const i = items[0];
        return `${i.cantidad} ${i.presentacion_tipo} · ${i.descripcion ?? i.erp_product_id}`;
    }
    return `${items.length} productos · ${meta?.total_unidades ?? 0} unidades`;
}

/* ─── Una solicitud, con sus dos respuestas ───────────────────────────────── */
function FilaPorConfirmar({ fila, nombrePor, onHecho }) {
    const [modo,     setModo]     = useState(null);   // null | 'rechazo'
    const [motivo,   setMotivo]   = useState(MOTIVOS_RECHAZO[0]);
    const [texto,    setTexto]    = useState('');
    const [ocupado,  setOcupado]  = useState(false);
    const [error,    setError]    = useState('');
    const [disp,     setDisp]     = useState(null);   // null = todavía no se sabe

    const meta = fila.metadata ?? {};

    // Se pregunta al abrir y no al apretar: entre que alguien pide y alguien
    // contesta, la sala pudo vender lo último que le quedaba —o habérselo
    // enviado a otra sala que pidió antes—. Sin esto, quien confirma se entera
    // recién cuando el sistema le rebota el despacho.
    useEffect(() => {
        let cancelado = false;
        fetchDisponibilidadTraslado(fila.id).then(r => {
            if (!cancelado && !r.error) setDisp(r.disponibilidad);
        });
        return () => { cancelado = true; };
    }, [fila.id]);

    const puede = disp === null ? true : Boolean(disp?.origen?.puede);
    const alternativas = disp?.alternativas ?? [];
    // El texto que viaja en el aviso de rechazo. Se arma acá y no en la base
    // porque acá está el dato fresco que se acaba de mirar.
    const sugerencia = alternativas.length > 0
        ? `Sí hay en ${alternativas.slice(0, 3).map(a => `${a.sala} (${a.unidades})`).join(', ')}`
        : '';

    // Si ya no tiene, la única salida honesta es rechazar — y con el motivo que
    // corresponde ya elegido, para no hacer buscar lo que el portal ya sabe.
    useEffect(() => {
        if (disp && !disp?.origen?.puede) {
            setModo('rechazo');
            setMotivo('Sin existencia en físico');
        }
    }, [disp]);

    const confirmar = async () => {
        setError(''); setOcupado(true);
        const r = await despacharTraslado(fila.id);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo despachar.'); return; }
        onHecho();
    };

    const rechazar = async () => {
        setError(''); setOcupado(true);
        const { error: e } = await rechazarTraslado(fila.id, motivo, texto, sugerencia);
        setOcupado(false);
        if (e) { setError(e.message ?? 'No se pudo rechazar.'); return; }
        onHecho();
    };

    // «Otro» sin texto no explica nada: es el motivo vacío con otro nombre, y la
    // base lo rechaza igual. Se avisa acá para no gastar el viaje.
    const puedeRechazar = motivo !== 'Otro' || texto.trim().length > 0;

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <ArrowLeftRight size={13} className="text-brand-text shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="flex-1 min-w-0">
                    <p className="text-label font-black text-content leading-tight">
                        {resumenItems(meta)}
                    </p>
                    <p className="text-micro text-content-3 mt-0.5 truncate">
                        {nombrePor(fila.employee_id)} · {meta.branch_name ?? 'otra sala'} · {fmtCuando(fila.created_at)}
                    </p>
                    {fila.note && (
                        <p className="text-micro text-content-2 mt-1 leading-snug">{fila.note}</p>
                    )}
                </div>
            </div>

            {/* Lo que la sala tiene AHORA, no cuando se lo pidieron — y ya con
                lo que salió y todavía no aparece en el conteo descontado. */}
            {disp && !puede && (
                <p className="text-micro font-semibold text-danger-text leading-snug">
                    Ya no puedes enviarlo: quedan {disp.origen?.unidades ?? 0}
                    {(disp.origen?.en_vuelo ?? 0) > 0
                        && ` (${disp.origen.en_vuelo} ya salieron y el conteo todavía no lo refleja)`}.
                    {alternativas.length > 0 && ` ${sugerencia}.`}
                </p>
            )}

            {/* El mínimo INFORMA, no impide: que la sala quede en cero es
                decisión de quien despacha. Decisión del usuario, 2026-08-06. */}
            {disp && puede && (disp.origen?.minimo ?? 0) > 0
              && (disp.origen.unidades - disp.pedido) < disp.origen.minimo && (
                <p className="text-micro font-semibold text-warning-text leading-snug">
                    Si lo envías, tu sala queda en {disp.origen.unidades - disp.pedido} y
                    tu mínimo es {disp.origen.minimo}.
                </p>
            )}

            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}

            {modo !== 'rechazo' ? (
                <div className="flex gap-2">
                    <Button size="sm" disabled={ocupado} onClick={confirmar}>
                        {ocupado && <Loader2 size={13} className="animate-spin" />}
                        {ocupado ? 'Enviando...' : 'Confirmar y enviar'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setModo('rechazo')}>
                        No puedo
                    </Button>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <LiquidSelect
                        value={motivo}
                        onChange={v => setMotivo(v ?? MOTIVOS_RECHAZO[0])}
                        options={MOTIVOS_RECHAZO.map(m => ({ value: m, label: m }))}
                        placeholder="Motivo..."
                        clearable={false}
                    />
                    {/* La sugerencia se muestra acá y además viaja en el aviso:
                        quien pidió no tiene por qué volver a buscar dónde hay. */}
                    {alternativas.length > 0 && (
                        <p className="text-micro text-content-3 leading-snug px-1">
                            Se le va a sugerir: {sugerencia}
                        </p>
                    )}
                    <PortalTextarea
                        value={texto}
                        onChange={e => setTexto(e.target.value)}
                        rows={2}
                        placeholder={motivo === 'Otro' ? 'Escribe el motivo' : 'Algo más que agregar (opcional)'}
                    />
                    <div className="flex gap-2">
                        <Button size="sm" variant="destructive" disabled={ocupado || !puedeRechazar} onClick={rechazar}>
                            {ocupado && <Loader2 size={13} className="animate-spin" />}
                            Rechazar
                        </Button>
                        {/* Sin «Volver» cuando ya no tiene: no hay a dónde
                            volver — confirmar sería prometer lo que no está. */}
                        {puede && (
                            <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setModo(null)}>
                                Volver
                            </Button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ─── Lo que pedí y ya salió ──────────────────────────────────────────────── */
function FilaPorRecibir({ fila, onHecho }) {
    const [ocupado, setOcupado] = useState(false);
    const [error,   setError]   = useState('');
    const meta = fila.metadata ?? {};

    const recibir = async () => {
        setError(''); setOcupado(true);
        const r = await recibirTraslado(fila.id);
        setOcupado(false);
        if (!r?.ok) { setError(r?.error ?? 'No se pudo recibir.'); return; }
        onHecho();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-2">
                <Truck size={13} className="text-warning-text shrink-0 mt-0.5" strokeWidth={2.5} />
                <div className="flex-1 min-w-0">
                    <p className="text-label font-black text-content leading-tight">{resumenItems(meta)}</p>
                    {/* La sala a la que va, SIEMPRE. Quien tiene alcance de
                        todas las sucursales ve traslados que no son suyos, y sin
                        el destino escrito no hay cómo distinguirlos. */}
                    <p className="text-micro text-content-3 mt-0.5 truncate">
                        {meta.origen_branch_name ?? 'La otra sala'} → {meta.branch_name ?? 'destino'}
                        {' · '}{fmtCuando(fila.updated_at)}
                    </p>
                </div>
            </div>
            {error && <p className="text-micro text-danger-text font-medium">{error}</p>}
            <Button size="sm" disabled={ocupado} onClick={recibir}>
                {ocupado ? <Loader2 size={13} className="animate-spin" /> : <PackageCheck size={13} />}
                {ocupado ? 'Recibiendo...' : 'Ya llegó, recibir'}
            </Button>
        </div>
    );
}

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
