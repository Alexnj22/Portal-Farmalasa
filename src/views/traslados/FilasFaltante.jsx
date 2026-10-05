import React, { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Clock, Hash, MessageSquareQuote, PackageCheck, PackageX } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import PortalTextarea from '../../components/common/PortalTextarea';
import { cerrarFaltante, ingresarAparecido } from '@nucleo/data/faltantes';
import { fmtCuando } from '@nucleo/utils/trasladoTexto';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { ChipPersona } from '../solicitudes/PersonasSolicitud';

// Lo que faltó en una bolsa, y qué se hizo con eso.
//
// ── Qué NO es esta pantalla ────────────────────────────────────────────────
// No corrige existencias. Cuando alguien declara un faltante el movimiento ya
// pasó —en una solicitud el sistema le puso el producto a la sala que recibe, y
// en un envío el renglón ya salió del estante de la que manda—, así que cerrar
// un faltante es cerrar el HECHO: se buscó, y apareció o no apareció. Reponerlo,
// ajustarlo o reclamarlo es otro acto y deja su propio rastro.
//
// Mezclar las dos cosas haría que «ya lo revisé» descontara inventario sin que
// nadie lo haya decidido.
//
// ── La excepción: «apareció» en un envío ───────────────────────────────────
// Un renglón de envío marcado «no llegó» sigue en tránsito —salió de una sala y
// no entró a la otra—. Ahí «apareció» RECIBE el movimiento (lo resuelve
// `cerrarFaltante`), y lo que se cerró así antes de que existiera esto lo marca
// `falta_ingresar` y se ingresa desde esta misma fila.

/* Cada estado con su color, su rótulo y su ícono. El ancla, la pastilla y el
 * panel de resolución salen de la MISMA fila: tres piezas que eligieran su
 * color por separado terminan diciendo dos estados distintos sobre una tarjeta. */
const TONO = {
    abierto:     { caja: 'bg-danger/10 ring-danger/25 text-danger-text',    variant: 'danger',  rotulo: 'Sin resolver', icono: AlertTriangle },
    aparecio:    { caja: 'bg-success/10 ring-success/20 text-success-text', variant: 'success', rotulo: 'Apareció',     icono: CheckCircle2 },
    /* «Apareció» que todavía no entró al inventario NO está resuelto: la caja
     * está en el estante y fuera de las existencias de las dos salas. Pintarlo
     * verde bajo «Resueltos» —como se pintaba— escondía justo los que piden
     * una acción (las cuatro de la bolsa E00212, medido el 2026-10-05). */
    por_ingresar: { caja: 'bg-warning/10 ring-warning/20 text-warning-text', variant: 'warning', rotulo: 'Falta ingresar', icono: PackageCheck },
    no_aparecio:  { caja: 'bg-content-3/10 ring-divider text-content-2',     variant: 'neutral', rotulo: 'No apareció',    icono: PackageX },
};

/** El estado que se PINTA: el de la base, salvo «apareció» sin ingresar. */
const estadoVisible = (f) =>
    (f.estado === 'aparecio' && f.falta_ingresar) ? 'por_ingresar' : f.estado;

/* Quién lo vio y quién lo resolvió: foto + nombre corto, con el canónico
 * (`ChipPersona`). La FICHA sale del id —`declarado_por`/`resuelto_por`— y no
 * del nombre, que es un rótulo. Si la función todavía no trae el id, o la
 * persona no está en el maestro, queda el nombre corto sin cara: nunca una
 * cara adivinada por coincidencia de texto. */
function Persona({ id, nombre, personaPor }) {
    const persona = id && personaPor ? personaPor(id) : null;
    if (persona) return <ChipPersona persona={persona} />;
    if (!nombre) return null;
    return <span className="text-caption font-bold text-content-2 truncate">{shortEmployeeName(nombre)}</span>;
}

export function FilaFaltante({ faltante: f, onHecho, personaPor = null }) {
    const [cerrando, setCerrando] = useState(null);   // 'aparecio' | 'no_aparecio'
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');

    const abierto = f.estado === 'abierto';
    const tono = TONO[estadoVisible(f)] ?? TONO.abierto;
    const IconoEstado = tono.icono;
    const codigo = f.codigo_bolsa || f.id_traslado || null;
    const resolvio = f.resuelto_por || f.resuelto_por_nombre;

    const cerrar = async (estado) => {
        setOcupado(true); setError('');
        const r = await cerrarFaltante(f.id, estado, nota);
        setOcupado(false);
        if (!r.ok) { setError(r.error ?? 'No se pudo cerrar.'); return; }
        setCerrando(null); setNota('');
        onHecho?.();
    };

    const ingresar = async () => {
        setOcupado(true); setError('');
        const r = await ingresarAparecido(f);
        setOcupado(false);
        if (!r.ok) { setError(r.error); return; }
        onHecho?.();
    };

    /* `h-full` + el `mt-auto` del pie, igual que las tarjetas de «En camino»:
     * en la rejilla de dos columnas las de una misma fila miden lo mismo y los
     * botones quedan a la misma altura. */
    return (
        <div data-surface="card" className="px-4 py-3.5 flex flex-col gap-2.5 h-full">
            <div className="flex items-start gap-3.5">
                {/* El ANCLA es CUÁNTO faltó: es el número que se cuenta contra
                    el estante, igual que en las otras tarjetas de traslado. */}
                <span className={`shrink-0 w-[3.25rem] rounded-xl px-1 py-1.5 flex flex-col items-center
                                  justify-center ring-1 ring-inset ${tono.caja}`}>
                    <span className="text-title-sm font-black leading-none tabular-nums">{f.cantidad}</span>
                    <span className="mt-1 text-[0.5625rem] font-black uppercase tracking-wider leading-none opacity-80">
                        faltó
                    </span>
                </span>

                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        {/* `line-clamp-2` y no `truncate`: los nombres de
                            producto se distinguen por el final —presentación y
                            laboratorio—, igual que en «En camino». */}
                        <p className="text-body font-black text-content leading-snug line-clamp-2 min-w-0"
                            title={f.descripcion ?? ''}>
                            {f.descripcion ?? `Producto ${f.erp_product_id ?? ''}`}
                        </p>
                        <Badge variant={tono.variant} size="sm" icon={IconoEstado} className="shrink-0 mt-0.5">
                            {tono.rotulo}
                        </Badge>
                    </div>

                    {/* El recorrido: las salas en tinta plena y la flecha
                        apagada, como en «En camino». */}
                    <p className="mt-1 text-label font-bold text-content-2 truncate">
                        {f.origen_branch_name ?? 'otra sala'}
                        <span className="text-content-3 font-medium"> → </span>
                        {f.destino_branch_name ?? 'destino'}
                    </p>

                    {/* El código de la bolsa es lo que deja encontrar el papel;
                        el del traslado, el movimiento en el sistema. Se muestra
                        el que haya — cada familia trae el suyo. */}
                    <p className="mt-1 flex items-center gap-1.5 min-w-0 text-micro font-semibold text-content-3">
                        <Hash size={11} strokeWidth={2.5} className="shrink-0" />
                        <span className="font-mono truncate">{codigo ?? 'sin número'}</span>
                    </p>
                </div>
            </div>

            {/* Lo que escribió quien abrió la caja: es la voz de la sala, va
                como cita y no mezclado con los datos del movimiento. */}
            {f.nota && (
                <p className="flex items-start gap-2 rounded-lg bg-surface-input px-3 py-2 text-caption
                              text-content-2 leading-snug">
                    <MessageSquareQuote size={12} strokeWidth={2.5} className="shrink-0 mt-px text-content-3" />
                    <span className="min-w-0">{f.nota}</span>
                </p>
            )}

            {/* Cómo terminó, en el color de su desenlace — y quién lo cerró,
                aunque no haya escrito nada («apareció» no pide nota). */}
            {!abierto && (f.resolucion || resolvio) && (
                <div className={`rounded-lg px-3 py-2 ring-1 ring-inset ${tono.caja}`}>
                    <div className="flex items-center justify-between gap-2 min-w-0">
                        <p className="flex items-center gap-1.5 text-micro font-black uppercase tracking-wider">
                            <IconoEstado size={12} strokeWidth={2.5} className="shrink-0" />
                            Se resolvió
                        </p>
                        {resolvio && <Persona id={f.resuelto_por} nombre={f.resuelto_por_nombre} personaPor={personaPor} />}
                    </div>
                    {f.resolucion && <p className="mt-1 text-caption text-content-2 leading-snug">{f.resolucion}</p>}
                </div>
            )}

            {error && <p className="text-micro text-danger-text font-semibold leading-snug">{error}</p>}

            <div className="mt-auto pt-2.5 border-t border-divider flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3 min-w-0 text-content-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                        <Clock size={12} strokeWidth={2.5} className="shrink-0" />
                        <span className="text-label font-black truncate">{fmtCuando(f.declarado_at)}</span>
                    </span>
                    {(f.declarado_por || f.declarado_por_nombre) && (
                        <span className="flex items-center gap-1.5 min-w-0">
                            <span className="shrink-0 text-caption font-semibold text-content-3">Lo vio</span>
                            <Persona id={f.declarado_por} nombre={f.declarado_por_nombre} personaPor={personaPor} />
                        </span>
                    )}
                </div>

                {!abierto && f.falta_ingresar && (
                    <div className="flex flex-col gap-1.5">
                        <p className="text-caption text-warning-text font-semibold leading-snug">
                            Apareció, pero todavía no entró al inventario de {f.destino_branch_name ?? 'la sala'}.
                        </p>
                        {/* `soft` y no sólido, igual que «Recibir» en «En camino»:
                            con varias tarjetas, cuatro barras sólidas compiten
                            entre sí y le ganan al producto (§Button · soft). */}
                        <Button size="sm" tone="success" soft icon={PackageCheck}
                            className="min-h-[var(--tap-min)] w-full sm:w-auto sm:self-end" loading={ocupado}
                            disabled={ocupado} onClick={ingresar}>
                            {ocupado ? 'Ingresando…' : 'Ingresar a inventario'}
                        </Button>
                    </div>
                )}

                {abierto && !cerrando && (
                    <div className="flex items-center gap-1.5 sm:justify-end">
                        {/* «Apareció» no pide nota: la bolsa estaba en el mostrador
                            de al lado y no hay nada más que contar. «No apareció» sí
                            —lo exige la base—, porque es el renglón que alguien va a
                            tener que leer dentro de un mes. */}
                        <Button size="sm" tone="success" soft icon={Check}
                            className="min-h-[var(--tap-min)] flex-1 sm:flex-none" loading={ocupado}
                            disabled={ocupado} onClick={() => cerrar('aparecio')}>
                            {ocupado ? (f.falta_ingresar ? 'Ingresando…' : 'Cerrando…') : 'Apareció'}
                        </Button>
                        <Button size="sm" variant="secondary" icon={PackageX}
                            className="min-h-[var(--tap-min)] flex-1 sm:flex-none"
                            disabled={ocupado} onClick={() => setCerrando('no_aparecio')}>
                            No apareció
                        </Button>
                    </div>
                )}

                {cerrando === 'no_aparecio' && (
                    <div className="flex flex-col gap-2">
                        <PortalTextarea
                            rows={2} required
                            label="Qué se hizo"
                            value={nota}
                            onChange={e => setNota(e.target.value)}
                            placeholder="Ej.: se repone en el próximo envío"
                        />
                        <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="ghost" className="min-h-[var(--tap-min)]"
                                disabled={ocupado} onClick={() => { setCerrando(null); setNota(''); }}>
                                Volver
                            </Button>
                            <Button size="sm" variant="warning" className="min-h-[var(--tap-min)] flex-1"
                                loading={ocupado}
                                disabled={ocupado || !nota.trim()} onClick={() => cerrar('no_aparecio')}>
                                {ocupado ? 'Cerrando…' : 'Cerrar el faltante'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * La lista, con los abiertos arriba.
 *
 * Un faltante cerrado sigue a la vista un mes: es lo que deja mirar atrás sin
 * ir al historial, y lo que contesta «¿esto pasa seguido entre estas dos
 * salas?». La función que los trae ya hace ese corte.
 */
export default function FilasFaltante({ faltantes = [], onHecho, vacio = null, personaPor = null }) {
    const abiertos   = faltantes.filter(f => estadoVisible(f) === 'abierto');
    const porIngresar = faltantes.filter(f => estadoVisible(f) === 'por_ingresar');
    const cerrados   = faltantes.filter(f => !['abierto', 'por_ingresar'].includes(estadoVisible(f)));

    return (
        <div className="flex flex-col gap-5">
            {faltantes.length === 0 ? vacio : (
                <>
                    {[
                        { clave: 'abiertos', titulo: 'Sin resolver', filas: abiertos },
                        { clave: 'por_ingresar', titulo: 'Aparecieron, falta ingresarlos', filas: porIngresar },
                        { clave: 'cerrados', titulo: 'Resueltos en el último mes', filas: cerrados },
                    ].map(({ clave, titulo, filas }) => filas.length > 0 && (
                        <section key={clave} className="flex flex-col gap-2">
                            {/* Mismo rótulo de sección que «Envíos». */}
                            <p className="text-caption font-black text-content-2 uppercase tracking-widest px-1">
                                {titulo} · {filas.length}
                            </p>
                            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                {filas.map(f => <FilaFaltante key={f.id} faltante={f} onHecho={onHecho} personaPor={personaPor} />)}
                            </div>
                        </section>
                    ))}
                </>
            )}
        </div>
    );
}
