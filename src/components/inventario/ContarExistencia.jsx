import React, { useEffect, useState } from 'react';
import { CheckCircle2, ClipboardCheck, Plus, RotateCcw, AlertTriangle, X } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import Button from '../common/Button';
import PortalInput from '../common/PortalInput';
import LiquidDatePicker from '../common/LiquidDatePicker';
import Notice from '../common/Notice';
import { SkeletonText } from '../common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { contarExistencia, fetchParaContar } from '@nucleo/data/consultasExistencia';

/**
 * La sala cuenta un producto que le preguntaron.
 *
 * Conteo CIEGO: la pantalla no muestra lo que dice el sistema ni, si no
 * cuadra, hacia dónde está la diferencia — sería dictarle el número. Se cuenta
 * por presentación; si el producto es regulado, además por lote (los lotes que
 * la sala tiene salen por nombre y fecha, sin cantidades, y se puede agregar
 * uno que no esté en la lista). Un campo vacío cuenta como cero.
 */
export default function ContarExistencia({ salaId, onCerrar, onContada }) {
    const [datos, setDatos] = useState(null);
    // Un grupo por lote (o uno solo sin lote): { lote, vence, nuevo, cantidades: {tipo: '3'} }.
    const [grupos, setGrupos] = useState([]);
    const [enviando, setEnviando] = useState(false);
    const [resultado, setResultado] = useState(null);
    const [ronda, setRonda] = useState(1);

    useEffect(() => {
        let vivo = true;
        fetchParaContar(salaId).then(({ data, error }) => {
            if (!vivo) return;
            if (error) {
                useToastStore.getState().showToast('Error', mensajeAmigable(error), 'error');
                onCerrar();
                return;
            }
            setDatos(data);
            setRonda(data.ronda);
            setGrupos(data.regulado
                ? (data.lotes ?? []).map(l => ({ lote: l.lote, vence: l.vence, nuevo: false, cantidades: {} }))
                : [{ lote: null, vence: null, nuevo: false, cantidades: {} }]);
        });
        return () => { vivo = false; };
    }, [salaId, onCerrar]);

    const cambiar = (i, cambio) => setGrupos(gs => gs.map((g, j) => (j === i ? { ...g, ...cambio } : g)));
    const ponerCantidad = (i, tipo, valor) => setGrupos(gs => gs.map((g, j) => (
        j === i ? { ...g, cantidades: { ...g.cantidades, [tipo]: valor } } : g)));

    // Un lote nuevo con algo contado necesita número y fecha: sin ellos no se
    // podría cargar si hiciera falta.
    const loteIncompleto = grupos.some(g => g.nuevo
        && Object.values(g.cantidades).some(v => Number(v) > 0)
        && (!String(g.lote ?? '').trim() || !g.vence));

    const enviar = async () => {
        const conteo = grupos.flatMap(g => (datos.presentaciones ?? []).map(p => ({
            tipo: p.tipo, factor: p.factor,
            cantidad: Number(g.cantidades[p.tipo] || 0),
            ...(datos.regulado ? { lote: String(g.lote ?? '').trim().toUpperCase(), vence: g.vence || null } : {}),
        }))).filter(c => c.cantidad > 0 || !datos.regulado);
        setEnviando(true);
        const { data, error } = await contarExistencia(salaId, conteo);
        setEnviando(false);
        if (error) {
            useToastStore.getState().showToast('No se guardó', mensajeAmigable(error), 'error');
            return;
        }
        onContada?.();
        if (data.estado === 'RECONTAR') {
            // Se borra lo escrito: un reconteo que arranca con los números de
            // antes se confirma sin contar.
            setGrupos(gs => gs.filter(g => !g.nuevo).map(g => ({ ...g, cantidades: {} })));
            setRonda(2);
            return;
        }
        setResultado(data);
    };

    const titulo = datos?.nombre ?? 'Contar existencia';
    return (
        <LiquidModal open onClose={enviando ? undefined : onCerrar} maxWidth="max-w-lg" ariaLabel="Contar existencia">
            <LiquidModal.Header titulo={titulo} icono={ClipboardCheck} tono="brand"
                subtitulo={datos ? `${datos.sala} · cuenta lo que hay en el estante` : undefined}
                onClose={enviando ? undefined : onCerrar} />
            <LiquidModal.Body className="space-y-4">
                {!datos ? <SkeletonText lines={4} /> : resultado ? (
                    <Resultado resultado={resultado} />
                ) : (
                    <>
                        {ronda === 2 ? (
                            <Notice variant="warning" icon={RotateCcw}>
                                No coincide con lo que dice el sistema. Vuelve a contar con calma, presentación por
                                presentación{datos.regulado ? ' y lote por lote' : ''}.
                            </Notice>
                        ) : (
                            <p className="text-label text-content-2">
                                Escribe cuántas hay de cada presentación. Lo que dejes vacío cuenta como cero.
                                Los vencidos apartados no se cuentan.
                            </p>
                        )}

                        {datos.regulado && grupos.length === 0 && (
                            <p className="text-label text-content-3">
                                La sala no tiene lotes de este producto en el sistema. Si hay en el estante, agrega el lote.
                            </p>
                        )}

                        {grupos.map((g, i) => (
                            <div key={i} data-surface="card" className="px-3.5 py-3 space-y-2.5">
                                {datos.regulado && (g.nuevo ? (
                                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                                        <PortalInput label="Lote" name={`lote-${i}`} value={g.lote ?? ''}
                                            onChange={(e) => cambiar(i, { lote: e.target.value })} />
                                        <div className="space-y-1">
                                            <p className="text-label font-bold text-content-3">Vence</p>
                                            <LiquidDatePicker value={g.vence ?? ''} onChange={(v) => cambiar(i, { vence: v })} />
                                        </div>
                                        <Button variant="ghost" size="sm" icon={X} iconOnly title="Quitar el lote"
                                            onClick={() => setGrupos(gs => gs.filter((_, j) => j !== i))} />
                                    </div>
                                ) : (
                                    <p className="text-body-sm font-black text-content">
                                        Lote {g.lote}
                                        {g.vence && <span className="text-content-3 font-bold"> · vence {fechaNumerica(g.vence)}</span>}
                                    </p>
                                ))}
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {(datos.presentaciones ?? []).map(p => (
                                        <PortalInput key={p.tipo} name={`cant-${i}-${p.tipo}`}
                                            label={`${p.tipo}${p.factor > 1 ? ` (${p.factor})` : ''}`}
                                            type="text" inputMode="numeric" maskType="INTEGER"
                                            value={g.cantidades[p.tipo] ?? ''}
                                            onChange={(e) => ponerCantidad(i, p.tipo, e.target.value)}
                                            inputClassName="tabular-nums" />
                                    ))}
                                </div>
                            </div>
                        ))}

                        {datos.regulado && (
                            <Button variant="secondary" size="sm" icon={Plus}
                                onClick={() => setGrupos(gs => [...gs, { lote: '', vence: '', nuevo: true, cantidades: {} }])}>
                                Hay otro lote
                            </Button>
                        )}
                    </>
                )}
            </LiquidModal.Body>
            <LiquidModal.Footer>
                {resultado ? (
                    <Button variant="primary" onClick={onCerrar}>Listo</Button>
                ) : (
                    <>
                        <Button variant="ghost" onClick={onCerrar} disabled={enviando}>Cancelar</Button>
                        <Button variant="primary" icon={CheckCircle2} loading={enviando}
                            disabled={!datos || loteIncompleto} onClick={enviar}>
                            {ronda === 2 ? 'Enviar reconteo' : 'Enviar conteo'}
                        </Button>
                    </>
                )}
            </LiquidModal.Footer>
        </LiquidModal>
    );
}

function Resultado({ resultado: r }) {
    if (r.estado === 'CUADRA') {
        return (
            <Notice variant="success" icon={CheckCircle2}>
                Cuadra. Lo que contaste coincide con el sistema; no hay que ajustar nada.
            </Notice>
        );
    }
    const falta = Number(r.diferencia) < 0;
    return (
        <Notice variant={falta ? 'danger' : 'warning'} icon={AlertTriangle}>
            No cuadra: {falta ? 'faltan' : 'sobran'} {r.texto}. Quien aprueba inventario lo revisa y hace el ajuste;
            tú no tienes que hacer nada más.
        </Notice>
    );
}
