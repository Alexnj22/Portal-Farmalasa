import React from 'react';
import { ScanLine, ShieldAlert } from 'lucide-react';
import { SkeletonText } from './StateViews';

/**
 * La pantalla que espera un carné: el aro que late, los puntos de la ráfaga y
 * el aviso de que tecleado no vale.
 *
 * Nació dentro de `ApoioScanModal` y salió acá el 2026-08-17, cuando el usuario
 * pidió que la entrega del efectivo esperara el carné «así como apoyo». Dicho
 * así, tienen que VERSE igual — y dos copias del mismo panel dejan de verse
 * igual en cuanto una se toca.
 *
 * La lógica de captura es `hooks/useCapturaDeCarne`; esto sólo dibuja lo que
 * ese detector va contando. El código leído no se pinta nunca: son puntos, no
 * caracteres — es una credencial.
 */
export default function EsperaDeCarne({ teclas = 0, manual = false, ocupado = false, ayuda }) {
    return (
        <div className="flex flex-col items-center gap-3 py-3">
            <div className="relative w-16 h-16 rounded-2xl bg-chart-1/10 border-2 border-chart-1/30 flex items-center justify-center">
                {/* §11 — el latido del aro es `animate-pulse` de Tailwind, que
                    además se apaga solo en Solid y con `prefers-reduced-motion`.
                    Con framer-motion latía en los cuatro temas. */}
                <div className="absolute inset-0 rounded-2xl border-2 border-chart-1 pointer-events-none animate-pulse" />
                <ScanLine size={28} className="text-chart-1-text" />
                {ocupado && (
                    <div className="absolute inset-0 rounded-2xl bg-surface-card flex items-center justify-center">
                        <SkeletonText lines={4} className="w-full max-w-md" />
                    </div>
                )}
            </div>

            {teclas > 0 && (
                <div className="flex gap-1.5 h-3 items-center">
                    {Array.from({ length: Math.min(teclas, 10) }).map((_, i) => (
                        <div key={i}
                            className="w-2 h-2 rounded-full bg-chart-1 animate-in zoom-in duration-[var(--dur-base)]"
                            style={{ animationDelay: `${i * 20}ms` }}
                        />
                    ))}
                    {teclas > 10 && <span className="text-caption text-chart-1-text">+{teclas - 10}</span>}
                </div>
            )}

            <p className="text-body-sm text-content-2 text-center">
                {ayuda || <>Apunta el escáner al código de barras<br />del carné del empleado</>}
            </p>

            {manual && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-danger/10 border border-danger/30 text-body-sm text-danger-text">
                    <ShieldAlert size={14} className="shrink-0 text-danger" />
                    Solo se acepta escaneo. No se permite ingreso manual del teclado.
                </div>
            )}
        </div>
    );
}
