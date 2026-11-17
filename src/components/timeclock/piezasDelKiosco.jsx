import React from 'react';
import { CreditCard, FileText, Gift, ScanBarcode, X } from 'lucide-react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { INACTIVO_MS } from './sesionDeCaja';
import { PAGO } from './datosDeLaCola';

// Piezas chicas del kiosco de caja: las etiquetas de un ticket, el anillo de
// los 2 minutos y el aviso que pide el carné.

export function Etiquetas({ p }) {
    return (
        <>
            {p.documento === 'credito_fiscal' && <Badge size="sm" variant="info" icon={FileText}>Crédito fiscal</Badge>}
            {PAGO[p.pago] && <Badge size="sm" variant="neutral" icon={CreditCard}>{PAGO[p.pago]}</Badge>}
            {p.puntos > 0 && <Badge size="sm" variant="success" icon={Gift}>{p.puntos} puntos</Badge>}
            {p.estado === 'enviando' && <Badge size="sm" variant="warning">Llegando</Badge>}
        </>
    );
}

/** El siguiente a cobrar: un ticket grande, con su talón y su corte. */

/** La cuenta de los 2 minutos, como un anillo que se vacía. */
export function Anillo({ restante }) {
    const r = 16;
    const largo = 2 * Math.PI * r;
    const parte = Math.max(0, Math.min(1, restante / INACTIVO_MS));
    const s = Math.max(0, Math.ceil(restante / 1000));
    const poco = restante <= 30_000;
    return (
        <span className={`relative w-11 h-11 shrink-0 flex items-center justify-center ${poco ? 'text-warning-text' : 'text-brand-text'}`}
            role="timer" aria-label={`Se cierra en ${Math.floor(s / 60)} minutos ${s % 60} segundos`}>
            <svg viewBox="0 0 40 40" className="absolute inset-0 -rotate-90" aria-hidden="true">
                <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeOpacity=".15" strokeWidth="3.5" />
                <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"
                    strokeDasharray={largo} strokeDashoffset={largo * (1 - parte)} className="transition-[stroke-dashoffset] duration-[var(--dur-lento)] ease-linear" />
            </svg>
            <span className="text-label font-bold tabular-nums">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
        </span>
    );
}


/** Lo que la barra muestra encima de los botones cuando pide algo. */
export function Pide({ titulo, detalle, aviso, onCancelar }) {
    return (
        <div className="flex items-center gap-4 pb-3" aria-live="polite">
            <span className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-brand/30 animate-[scanPulse_2.2s_var(--ease-spring)_infinite]" />
                <span className="relative w-11 h-11 rounded-full bg-brand/10 text-brand-text flex items-center justify-center">
                    <ScanBarcode size={22} strokeWidth={2} aria-hidden="true" />
                </span>
            </span>
            <div className="min-w-0 flex-1">
                <p className="text-title font-bold text-content">{titulo}</p>
                <p className={`text-body-sm ${aviso ? 'text-warning-text' : 'text-content-3'}`}>{aviso || detalle}</p>
            </div>
            {onCancelar && <Button variant="ghost" icon={X} onClick={onCancelar}>Cancelar</Button>}
        </div>
    );
}

// ── El kiosco ───────────────────────────────────────────────────────────

