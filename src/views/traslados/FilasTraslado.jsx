import React, { useState, useEffect } from 'react';
import { ArrowLeftRight, Loader2, PackageCheck, Truck } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalTextarea from '../../components/common/PortalTextarea';
import {
    MOTIVOS_RECHAZO, despacharTraslado, recibirTraslado, rechazarTraslado,
    fetchDisponibilidadTraslado,
} from '../../data/traslados';
import { fmtCuando, fmtFechaLarga, resumenItems, lotesPedidos } from './trasladoTexto';

// Las filas de un traslado, en un solo lugar.
//
// Vivían dentro de `WidgetTransferRequests`. Al nacer la vista `/traslados`
// hacían falta en los dos sitios, y la salida fácil —copiarlas— es la que
// termina con dos filas que se parecen y se comportan distinto: la del widget
// preguntando la disponibilidad antes de despachar y la de la vista no, o al
// revés. El envase cambia (modal angosto contra vista ancha); lo que la fila
// DICE y lo que la fila HACE, no.

/** El recorrido, siempre en el mismo sentido: de dónde sale → a dónde va. */
export function Recorrido({ meta, className = '' }) {
    return (
        <span className={`truncate ${className}`}>
            {meta?.origen_branch_name ?? 'La otra sala'} → {meta?.branch_name ?? 'destino'}
        </span>
    );
}

/* ─── Una solicitud, con sus dos respuestas ───────────────────────────────── */
export function FilaPorConfirmar({ fila, nombrePor, onHecho }) {
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
            if (cancelado || r.error) return;
            setDisp(r.disponibilidad);
            // Si ya no tiene, la única salida honesta es rechazar — y con el
            // motivo que corresponde ya elegido, para no hacer buscar lo que el
            // portal ya sabe. Se decide acá, donde llega la respuesta, y no en
            // un efecto que vigile `disp`: es la misma decisión y un solo sitio.
            if (r.disponibilidad && !r.disponibilidad?.origen?.puede) {
                setModo('rechazo');
                setMotivo('Sin existencia en físico');
            }
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
                    {/* Los lotes que pidieron, cuando el pedido los trae. Van
                        ACÁ —bajo lo que se pide y antes de quién lo pide—
                        porque son parte de qué se pide, no del contexto. */}
                    {lotesPedidos(meta).length > 0 && (
                        <div className="mt-1 flex flex-col gap-0.5">
                            {lotesPedidos(meta).map((l, i) => (
                                <p key={i} className="text-micro text-content-2 font-semibold">
                                    <span className="font-mono text-content-3">{l.lote || 'sin lote'}</span>
                                    {l.vence && <span className="text-content-3"> · {fmtFechaLarga(l.vence)}</span>}
                                    {' — '}{l.unidades} {l.unidades === 1 ? 'unidad' : 'unidades'}
                                </p>
                            ))}
                        </div>
                    )}
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
export function FilaPorRecibir({ fila, onHecho }) {
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
                    <p className="text-micro text-content-3 mt-0.5 flex gap-1">
                        <Recorrido meta={meta} />
                        <span className="shrink-0">· {fmtCuando(fila.updated_at)}</span>
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

// La fila de historial vivía acá y se retiró el 2026-08-07: el historial es una
// lista de REGISTROS y va en `DataTable` (§32), que da la tabla en escritorio,
// las fichas en el teléfono y el vacío, los tres de una. Reportado sobre la
// primera versión de la vista: «no es canónico, dónde están las cards».
// Lo que queda acá son las dos filas de ACCIÓN, que sí son tarjetas porque
// llevan un formulario adentro.
