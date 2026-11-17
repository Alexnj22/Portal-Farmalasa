import React from 'react';
import { AlertCircle, ScanBarcode } from 'lucide-react';
import Notice from '../common/Notice';

// El aviso de «pasa tu carné» del kiosco de caja: un solo lugar para Ventas y
// Caja. El lector siempre está escuchando; esto sólo dice qué va a pasar.
export default function PasaTuCarne({ titulo, detalle, aviso }) {
    return (
        <section data-surface="card" aria-live="polite"
            className="flex flex-col items-center text-center gap-4 px-6 py-8">
            <div className="relative w-28 h-28 flex items-center justify-center">
                <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-chart-1/40 animate-[scanPulse_2.2s_var(--ease-spring)_infinite]" />
                <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-chart-1/40 animate-[scanPulse_2.2s_var(--ease-spring)_infinite]" style={{ animationDelay: '1.1s' }} />
                <span className="relative w-20 h-20 rounded-full border-2 border-chart-1/50 bg-chart-1/15 flex items-center justify-center">
                    <ScanBarcode size={32} strokeWidth={1.5} className="text-chart-1-text" aria-hidden="true" />
                </span>
            </div>
            <div className="flex flex-col gap-1.5">
                <h2 className="text-title font-bold text-content">{titulo}</h2>
                <p className="text-body-sm text-content-3 max-w-[30ch] mx-auto">{detalle}</p>
            </div>
            {aviso && <Notice variant="warning" icon={AlertCircle}>{aviso}</Notice>}
        </section>
    );
}
