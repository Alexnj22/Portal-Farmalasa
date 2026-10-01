import React from 'react';
import PeriodStepper from '../../components/common/PeriodStepper';
import PeriodPicker from '../../components/common/PeriodPicker';
import { hoySV, sumarDias } from '@nucleo/utils/fecha';

// El día que se está mirando, para la ranura «fecha» de la `FilterBar` (§17):
// flechas para correrlo y el calendario del portal en el centro —la misma
// anatomía que Cortes—. Las vistas de un solo día (caja, cierre, ruta) toman el
// primer día si alguien elige un rango.
export default function FiltroDia({ fecha, onChange, max = hoySV() }) {
    return (
        <PeriodStepper unit="día" onPrev={() => onChange(sumarDias(fecha, -1))} onNext={() => onChange(sumarDias(fecha, 1))}
            nextDisabled={!!max && fecha >= max}>
            <PeriodPicker value={`${fecha}|${fecha}`} placeholder="Día…"
                onChange={(v) => { const d = String(v ?? '').split('|')[0] || hoySV(); onChange(max && d > max ? max : d); }} />
        </PeriodStepper>
    );
}
