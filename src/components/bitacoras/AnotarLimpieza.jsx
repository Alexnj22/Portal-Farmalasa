import React, { useCallback, useState } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalTextarea from '../common/PortalTextarea';
import { registrarLimpieza } from '../../data/bitacoras';

// Registrar la limpieza de un turno.
//
// La observación es OPCIONAL a propósito. La norma no pide describir cada
// limpieza —pide que exista el procedimiento escrito y su registro (RTS 5.5.5)—
// y un campo obligatorio que no aporta produce «ok» ciento veinte veces, que es
// exactamente el ruido que hace ilegible un libro. Cuando hay algo que decir,
// el campo está.

const hhmm = (t) => String(t || '').slice(0, 5);

export default function AnotarLimpieza({ area, turno, fecha, onCerrar }) {
    const [obs, setObs] = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);

    const guardar = useCallback(async () => {
        setError(null);
        setGuardando(true);
        const { error: err } = await registrarLimpieza({
            areaId: area.id, fecha, turno: turno.clave, observaciones: obs,
        });
        setGuardando(false);
        if (err) { setError(err); return; }
        onCerrar(true);
    }, [area, fecha, turno, obs, onCerrar]);

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-md" className="h-fit" ariaLabel="Registrar la limpieza">
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">Registrar la limpieza</h3>
                    <p className="text-caption text-content-3 truncate">
                        {area.nombre} · {turno.label} ({hhmm(turno.desde)}–{hhmm(turno.hasta)})
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                <Notice variant="info" icon={Sparkles}>
                    <span className="font-bold">Queda registrada con tu nombre y la hora.</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Si el turno ya pasó, se guarda igual y se marca fuera de hora.
                    </span>
                </Notice>

                <PortalTextarea
                    label="Observaciones (opcional)" name="observaciones"
                    value={obs} onChange={(e) => setObs(e.target.value)}
                    rows={3}
                    placeholder="Sólo si hay algo que anotar: una gotera, un anaquel que hubo que reacomodar…"
                />

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="primary" onClick={guardar} loading={guardando}>
                    Registrar
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
