import React, { memo, useCallback } from 'react';
import { Camera, Images, Loader2, Smartphone, X } from 'lucide-react';
import useCoarsePointer from '../../plataforma/useCoarsePointer';
import { PROPS_CAMARA } from '@nucleo/utils/capturaDeFoto';
import useFotoDelTelefono from './useFotoDelTelefono';

/**
 * FotosDeEvidencia — la tira de fotos de un formulario: miniaturas, agregar y
 * quitar.
 *
 * Canónico creado el 2026-08-19. Existía dos veces con el marcado IDÉNTICO
 * —`DevolverModal` y el descargue por daño de `WidgetInventoryMovement`—, y las
 * dos traían el mismo defecto: el `capture="environment"` que decían usar para
 * abrir la cámara no abría nada, porque su `accept` era una lista fina sin el
 * token `image/*` (el porqué, en `capturaDeFoto.js`). Un bug copiado dos veces
 * es la señal de que faltaba nombrar la pieza.
 *
 * ── Dos entradas, no una ──────────────────────────────────────────────────
 * Cámara y galería son azulejos separados. Un solo control no puede dar las
 * dos: con `capture` el teléfono va derecho a la cámara y no deja elegir una
 * foto que ya está; sin `capture` nunca ofrece la cámara. Y las dos hacen falta
 * — se fotografía el producto en el momento, pero también se adjunta la foto
 * que alguien ya había tomado.
 *
 * El azulejo de cámara sólo aparece con el dedo: en escritorio `capture` se
 * ignora y quedarían dos azulejos abriendo el mismo diálogo de archivos.
 *
 * ── Y en escritorio, el teléfono (2026-10-29) ─────────────────────────────
 * La computadora de la sala no tiene cámara: sin un camino al teléfono, la
 * foto del daño obligaba a mandársela a uno mismo por otro lado y bajarla.
 * Reportado en un descarte por daño. Es su gemelo: con el dedo ya está la
 * cámara ahí mismo, así que sólo aparece en escritorio (mismo criterio que
 * `FileField`).
 */

// El `accept` del azulejo de galería se queda fino a propósito: es el que filtra
// lo que se puede elegir del disco, y tiene que seguir coincidiendo con los
// `allowed_mime_types` del bucket. La cámara siempre devuelve un JPEG.
const ACCEPT_ARCHIVO = 'image/jpeg,image/png,image/webp';

const AZULEJO = 'w-20 h-20 rounded-xl border border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors';

const FotosDeEvidencia = memo(({
    fotos,
    onCambio,
    max = 3,
    maxMB = 10,
    // La tira se pinta en `warning` cuando la foto es obligatoria y todavía no
    // hay ninguna: no es decoración, es lo que falta para poder enviar.
    resaltar = false,
    onError,
    alt = 'Foto',
}) => {
    const esTactil = useCoarsePointer();
    const falta = resaltar && fotos.length === 0;

    const sumar = useCallback(f => {
        if (f.size > maxMB * 1024 * 1024) { onError?.(`La foto no puede pasar de ${maxMB} MB`); return; }
        onError?.('');
        onCambio(prev => [...prev, f].slice(0, max));
    }, [max, maxMB, onCambio, onError]);

    const agregar = useCallback(ev => {
        const f = ev.target.files?.[0];
        ev.target.value = '';   // permite volver a elegir la misma
        if (f) sumar(f);
    }, [sumar]);

    const telefono = useFotoDelTelefono(sumar, { etiqueta: alt, onError });

    const claseAzulejo = falta
        ? `${AZULEJO} border-warning/50 bg-warning/[0.06] hover:border-warning`
        : `${AZULEJO} border-border-card bg-surface-card-hover hover:border-brand/40`;
    const claseIcono = falta ? 'text-warning-text' : 'text-content-3';

    return (
        <div className="flex items-center gap-2 flex-wrap">
            {fotos.map((f, i) => (
                <div key={`${f.name}-${i}`} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border-card bg-surface-card-hover">
                    <img src={URL.createObjectURL(f)} alt={`${alt} ${i + 1}`}
                        className="w-full h-full object-cover"
                        onLoad={ev => URL.revokeObjectURL(ev.currentTarget.src)} />
                    {/* 24px y no 16: es un objetivo táctil sobre una foto, y
                        errarle borra la evidencia que se acaba de tomar. */}
                    <button type="button" aria-label={`Quitar la foto ${i + 1}`}
                        onClick={() => onCambio(prev => prev.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-surface-card border border-divider shadow-sm flex items-center justify-center hover:bg-danger/10 transition-colors">
                        <X size={12} strokeWidth={3} className="text-content-2" />
                    </button>
                </div>
            ))}

            {fotos.length < max && esTactil && (
                <label className={claseAzulejo}>
                    <input type="file" {...PROPS_CAMARA} className="sr-only"
                        aria-label="Tomar la foto con la cámara" onChange={agregar} />
                    <Camera size={20} strokeWidth={2} className={claseIcono} />
                    <span className={`text-micro font-bold ${claseIcono}`}>Cámara</span>
                </label>
            )}

            {fotos.length < max && (
                <label className={claseAzulejo}>
                    <input type="file" accept={ACCEPT_ARCHIVO} className="sr-only"
                        aria-label="Elegir una foto ya guardada" onChange={agregar} />
                    <Images size={20} strokeWidth={2} className={claseIcono} />
                    <span className={`text-micro font-bold ${claseIcono}`}>
                        {esTactil ? 'Galería' : (fotos.length === 0 ? 'Agregar' : 'Otra')}
                    </span>
                </label>
            )}

            {fotos.length < max && !esTactil && (
                <button type="button" className={claseAzulejo}
                    onClick={telefono.pedir} disabled={telefono.pidiendo || telefono.esperando}
                    aria-label="Tomar la foto con el teléfono">
                    {telefono.pidiendo
                        ? <Loader2 size={20} strokeWidth={2} className={`${claseIcono} animate-spin`} />
                        : <Smartphone size={20} strokeWidth={2} className={claseIcono} />}
                    <span className={`text-micro font-bold ${claseIcono}`}>
                        {telefono.esperando ? 'Esperando…' : 'Teléfono'}
                    </span>
                </button>
            )}
            {telefono.dialogo}
        </div>
    );
});

FotosDeEvidencia.displayName = 'FotosDeEvidencia';

export default FotosDeEvidencia;
