import React from 'react';
import { Info } from 'lucide-react';
import LiquidTooltip from './LiquidTooltip';

/**
 * NocturnalLegalInfo — el Art. 168 del Código de Trabajo, al lado del campo.
 *
 * Estaba **duplicado literal** en `FormEditPayrollEntry` y `AttendanceAuditView`:
 * mismo texto legal, mismo tooltip, dos copias. Si cambiara la ley —o se
 * corrigiera una cifra— había que acordarse de las dos.
 *
 * Además las dos copias tenían el mismo bug de contraste: el cuerpo usaba
 * `text-content-3`, que sigue el tema, sobre un `bg-slate-900` que no lo sigue.
 * En tema claro eso era gris oscuro sobre fondo oscuro. Acá el texto usa
 * `content-tooltip-2`, que es el token del texto secundario *dentro* del
 * tooltip y no cambia con el tema porque el tooltip tampoco cambia.
 */
export default function NocturnalLegalInfo({ size = 11 }) {
    return (
        <LiquidTooltip
            side="top"
            variant="rich"
            className="ml-1.5 align-middle"
            content={
                <div className="space-y-1.5">
                    <p className="font-black text-chart-3">Art. 168 — Código de Trabajo SV</p>
                    <p className="text-content-tooltip-2">Jornada nocturna: 19:00 – 06:00</p>
                    <p className="text-content-tooltip-2">
                        • Hrs. ordinarias nocturnas: <span className="text-chart-3 font-bold">+25% recargo</span> sobre tarifa diurna
                    </p>
                    <p className="text-content-tooltip-2">
                        • Hrs. extra nocturnas: <span className="text-chart-3 font-bold">×2.25</span> (OT 100% + 25% noct.)
                    </p>
                    <p className="text-content-tooltip-2">• Jornada noct. máx: 7h/día, 39h/sem</p>
                    <p className="text-content-tooltip-2">• Si &gt;4h son nocturnas → turno nocturno</p>
                </div>
            }
        >
            {/* `tabIndex` para que también aparezca con Tab: es información
                legal, no un adorno, y quien navega con teclado la necesita
                igual. `LiquidTooltip` ya escucha foco. */}
            <Info size={size} tabIndex={0} strokeWidth={2}
                className="text-chart-3-text cursor-help outline-none
                    focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-brand focus-visible:outline-offset-2" />
        </LiquidTooltip>
    );
}
