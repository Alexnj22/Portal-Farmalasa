import React, { useState } from 'react';
import { Check, Loader2, PackageX } from 'lucide-react';
import Button from '../../components/common/Button';
import PortalTextarea from '../../components/common/PortalTextarea';
import { cerrarFaltante } from '../../data/faltantes';
import { fmtCuando } from './trasladoTexto';

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

const TONO = {
    abierto:     { caja: 'bg-danger/10 ring-danger/25 text-danger-text',   rotulo: 'sin resolver' },
    aparecio:    { caja: 'bg-success/10 ring-success/20 text-success-text', rotulo: 'apareció' },
    no_aparecio: { caja: 'bg-warning/10 ring-warning/20 text-warning-text', rotulo: 'no apareció' },
};

export function FilaFaltante({ faltante: f, onHecho }) {
    const [cerrando, setCerrando] = useState(null);   // 'aparecio' | 'no_aparecio'
    const [nota, setNota] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [error, setError] = useState('');

    const abierto = f.estado === 'abierto';
    const tono = TONO[f.estado] ?? TONO.abierto;

    const cerrar = async (estado) => {
        setOcupado(true); setError('');
        const r = await cerrarFaltante(f.id, estado, nota);
        setOcupado(false);
        if (!r.ok) { setError(r.error ?? 'No se pudo cerrar.'); return; }
        setCerrando(null); setNota('');
        onHecho?.();
    };

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <div className="flex items-start gap-3.5">
                {/* El ANCLA es CUÁNTO faltó: es el número que se cuenta contra
                    el estante, igual que en las otras tarjetas de traslado. */}
                <span className={`shrink-0 w-[3.25rem] rounded-xl px-1 py-1.5 flex flex-col items-center
                                  justify-center ring-1 ring-inset ${tono.caja}`}>
                    <span className="text-h3 font-black leading-none tabular-nums">{f.cantidad}</span>
                    <span className="mt-1 text-[0.5625rem] font-black uppercase tracking-wider leading-none opacity-80">
                        faltó
                    </span>
                </span>

                <div className="flex-1 min-w-0">
                    <p className="text-body font-black text-content leading-snug truncate"
                        title={f.descripcion ?? ''}>
                        {f.descripcion ?? `Producto ${f.erp_product_id ?? ''}`}
                    </p>
                    <p className="text-label font-bold text-content-2 mt-0.5 truncate">
                        {f.origen_branch_name ?? 'otra sala'} → {f.destino_branch_name ?? 'destino'}
                        <span className="text-content-3 font-medium"> · {fmtCuando(f.declarado_at)}</span>
                    </p>
                    <p className="text-micro text-content-3 font-semibold mt-0.5 truncate">
                        {/* El código de la bolsa es lo que deja encontrar el
                            papel; el del traslado, el movimiento en el sistema.
                            Se muestra el que haya — cada familia trae el suyo. */}
                        {f.codigo_bolsa || f.id_traslado || 'sin número'}
                        {f.declarado_por_nombre ? ` · lo vio ${f.declarado_por_nombre}` : ''}
                        {!abierto && ` · ${tono.rotulo}`}
                    </p>
                    {f.nota && (
                        <p className="text-micro text-content-2 mt-1.5 leading-snug">{f.nota}</p>
                    )}
                    {f.resolucion && (
                        <p className="text-micro text-content-2 mt-1.5 leading-snug">
                            <span className="text-content-3">Se resolvió: </span>{f.resolucion}
                            {f.resuelto_por_nombre ? ` — ${f.resuelto_por_nombre}` : ''}
                        </p>
                    )}
                </div>
            </div>

            {error && <p className="text-micro text-danger-text font-semibold leading-snug">{error}</p>}

            {abierto && !cerrando && (
                <div className="flex items-center gap-1.5">
                    {/* «Apareció» no pide nota: la bolsa estaba en el mostrador
                        de al lado y no hay nada más que contar. «No apareció» sí
                        —lo exige la base—, porque es el renglón que alguien va a
                        tener que leer dentro de un mes. */}
                    <Button size="sm" variant="primary" icon={ocupado ? Loader2 : Check}
                        className="min-h-[var(--tap-min)] flex-1"
                        disabled={ocupado} onClick={() => cerrar('aparecio')}>
                        {ocupado ? 'Cerrando…' : 'Apareció'}
                    </Button>
                    <Button size="sm" variant="secondary" icon={PackageX}
                        className="min-h-[var(--tap-min)] flex-1"
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
                            disabled={ocupado || !nota.trim()} onClick={() => cerrar('no_aparecio')}>
                            {ocupado ? 'Cerrando…' : 'Cerrar el faltante'}
                        </Button>
                    </div>
                </div>
            )}
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
export default function FilasFaltante({ faltantes = [], onHecho, vacio = null }) {
    const abiertos = faltantes.filter(f => f.estado === 'abierto');
    const cerrados = faltantes.filter(f => f.estado !== 'abierto');

    if (faltantes.length === 0) return vacio;

    return (
        <div className="flex flex-col gap-4">
            {abiertos.length > 0 && (
                <div className="flex flex-col gap-3">
                    <p className="text-micro font-black uppercase tracking-widest text-content-3">
                        Sin resolver · {abiertos.length}
                    </p>
                    {abiertos.map(f => <FilaFaltante key={f.id} faltante={f} onHecho={onHecho} />)}
                </div>
            )}
            {cerrados.length > 0 && (
                <div className="flex flex-col gap-3">
                    <p className="text-micro font-black uppercase tracking-widest text-content-3">
                        Resueltos en el último mes · {cerrados.length}
                    </p>
                    {cerrados.map(f => <FilaFaltante key={f.id} faltante={f} onHecho={onHecho} />)}
                </div>
            )}
        </div>
    );
}
