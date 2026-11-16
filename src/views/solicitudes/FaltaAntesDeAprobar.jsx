import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import PortalInput from '../../components/common/PortalInput';
import CampoMesAnio from '../../components/common/CampoMesAnio';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import { operarCargaPendiente } from '@nucleo/data/requests';
import { lineasDe } from '@nucleo/utils/movimientoTexto';
import { emitir } from '@plataforma/eventos';

/**
 * Lo que le falta a una carga pendiente antes de aprobarla, con el campo para
 * completarlo ahí mismo (2026-11-16).
 *
 * Nació con MINART AM: el producto se creó con costo 0 y la carga rebotaba
 * ENTERA al aprobarla, sin que la pantalla hubiera dicho nada antes. Al abrir
 * la solicitud, el servidor le pregunta al sistema por cada renglón lo mismo
 * que va a preguntar la carga, y acá se lista lo que falta:
 *
 *  · costo en 0             → se escribe y queda en la ficha del producto
 *  · producto deshabilitado → se habilita en su ficha
 *  · lote / vencimiento     → se completa el renglón; queda anotado quién
 *  · presentación o factor distinto → no se arregla acá: cambia lo que
 *    significa la cantidad, así que se rechaza y se pide de nuevo.
 *
 * Todo sólo LLENA lo vacío. Se muestra sólo a quien decide una carga pendiente.
 */
const TEXTO = {
    costo:        'no tiene costo',
    habilitar:    'está deshabilitado',
    lote:         'lleva control de lote y no dice cuál',
    vence:        'necesita fecha de vencimiento',
    presentacion: 'ya no tiene esa presentación',
    factor:       'cambió de presentación',
    ilegible:     'no se pudo revisar',
};
const NO_SE_ARREGLA = new Set(['presentacion', 'factor', 'ilegible']);

export default function FaltaAntesDeAprobar({ req, meta }) {
    const items = lineasDe(meta);
    const [estado, setEstado] = useState({ cargando: true, faltan: [], completa: true, error: '' });

    const leer = useCallback(() => operarCargaPendiente(req.id, 'revisar').then(r => (r?.ok
        ? { cargando: false, faltan: r.faltan ?? [], completa: r.completa !== false, error: '' }
        : { cargando: false, faltan: [], completa: true, error: r?.error || 'No se pudo revisar la carga.' })),
    [req.id]);

    useEffect(() => {
        let vivo = true;
        leer().then(e => { if (vivo) setEstado(e); });
        return () => { vivo = false; };
    }, [leer]);

    const revisar = useCallback(async () => {
        setEstado(e => ({ ...e, cargando: true, error: '' }));
        setEstado(await leer());
    }, [leer]);

    // Después de arreglar algo se vuelve a revisar: habilitar un producto
    // destapa lo que antes no se podía preguntar (su costo, su lote).
    const alArreglar = useCallback(async ({ cambioLaSolicitud = false } = {}) => {
        if (cambioLaSolicitud) emitir('requests-updated');
        await revisar();
    }, [revisar]);

    if (estado.cargando && estado.faltan.length === 0) {
        return (
            <LoadingState variant="inline" size="sm" label="Revisando que todo pueda entrar…" />
        );
    }
    if (estado.error) {
        return (
            <p className="px-3 text-caption text-content-3">
                No se pudo revisar antes de aprobar: {estado.error}
            </p>
        );
    }
    if (estado.faltan.length === 0) {
        return estado.completa ? null : (
            <p className="px-3 text-caption text-warning-text font-semibold">
                No alcanzó el tiempo para revisar todos los productos; lo que falte se avisa al aprobar.
            </p>
        );
    }

    // Agrupado por renglón: lote y vencimiento del mismo producto van juntos.
    const porLinea = new Map();
    for (const f of estado.faltan) porLinea.set(f.i, [...(porLinea.get(f.i) ?? []), f]);
    const hayQueRechazar = estado.faltan.some(f => NO_SE_ARREGLA.has(f.falta));

    return (
        <div className="px-3 py-2.5 rounded-2xl bg-warning/10 border border-warning/30 space-y-3">
            <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                <p className="text-body-sm text-warning-text font-bold leading-snug">
                    Falta antes de aprobar: así la carga no puede entrar.
                    {hayQueRechazar && ' Lo que no se puede completar aquí obliga a rechazarla y pedirla de nuevo.'}
                </p>
            </div>
            {[...porLinea.entries()].map(([i, fs]) => (
                <RenglonQueFalta key={i} req={req} i={i} item={items[i]} faltas={fs}
                    ocupado={estado.cargando} onArreglado={alArreglar} />
            ))}
        </div>
    );
}

function RenglonQueFalta({ req, i, item, faltas, ocupado, onArreglado }) {
    const tipos = new Set(faltas.map(f => f.falta));
    const nombre = item?.descripcion ?? `Producto #${item?.erp_product_id}`;
    const unidad = item?.presentacion_tipo ? `1 ${item.presentacion_tipo}` : 'la presentación';

    const [costo, setCosto] = useState('');
    const [lote, setLote] = useState('');
    const [vence, setVence] = useState('');
    const [guardando, setGuardando] = useState('');
    const [error, setError] = useState('');

    const correr = async (clave, accion, extra, opciones) => {
        setGuardando(clave);
        setError('');
        const r = await operarCargaPendiente(req.id, accion, { linea: i, ...extra });
        setGuardando('');
        if (r?.ok) await onArreglado(opciones);
        else setError(r?.error || 'No se pudo guardar.');
    };

    const montoCosto = parseFloat(String(costo).replace(',', '.'));
    const costoValido = Number.isFinite(montoCosto) && montoCosto > 0;
    const venceValido = /^\d{4}-\d{2}$/.test(vence);
    const datosListos = (!tipos.has('lote') || lote.trim()) && (!tipos.has('vence') || venceValido);

    return (
        <div className="space-y-2">
            <p className="text-caption text-content-2 font-bold leading-tight">
                {nombre}
                <span className="font-medium text-content-3">
                    {' · '}{faltas.map(f => TEXTO[f.falta] ?? f.falta).join(' · ')}
                </span>
            </p>

            {tipos.has('habilitar') && (
                <Button variant="secondary" size="md" loading={guardando === 'habilitar'} disabled={ocupado}
                    onClick={() => correr('habilitar', 'habilitar_producto', {})}>
                    Habilitar producto
                </Button>
            )}

            {tipos.has('costo') && (
                <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                        <PortalInput label={`Costo de ${unidad}`} name={`costo-${i}`}
                            value={costo} onChange={e => setCosto(e.target.value)}
                            prefix="$" placeholder="0.00" inputMode="decimal" />
                    </div>
                    <Button variant="secondary" size="md" loading={guardando === 'costo'}
                        disabled={!costoValido || ocupado}
                        onClick={() => correr('costo', 'fijar_costo', { costo: montoCosto })}>
                        Guardar costo
                    </Button>
                </div>
            )}

            {(tipos.has('lote') || tipos.has('vence')) && (
                <div className="flex items-end gap-2 flex-wrap">
                    {tipos.has('lote') && (
                        <div className="flex-1 min-w-[140px]">
                            <PortalInput label="Lote" name={`lote-${i}`} value={lote}
                                onChange={e => setLote(e.target.value)} placeholder="El de la caja" />
                        </div>
                    )}
                    {tipos.has('vence') && (
                        <div className="flex-1 min-w-[140px]">
                            <CampoMesAnio label="Vence" value={vence} onChange={setVence} />
                        </div>
                    )}
                    <Button variant="secondary" size="md" loading={guardando === 'datos'}
                        disabled={!datosListos || ocupado}
                        onClick={() => correr('datos', 'corregir_linea', {
                            ...(tipos.has('lote') ? { lote: lote.trim() } : {}),
                            ...(tipos.has('vence') ? { vence } : {}),
                        }, { cambioLaSolicitud: true })}>
                        Guardar
                    </Button>
                </div>
            )}

            {error && <Notice variant="danger" compact>{error}</Notice>}
        </div>
    );
}
