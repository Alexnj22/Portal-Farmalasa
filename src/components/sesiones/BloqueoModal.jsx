import React, { useState } from 'react';
import { ShieldOff, AlertTriangle } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import Button from '../common/Button';
import LiquidSelect from '../common/LiquidSelect';
import PortalInput from '../common/PortalInput';
import Notice from '../common/Notice';

// Bloquear a alguien es más grave que cerrarle una conexión, y el diálogo tiene
// que decirlo: cerrar una conexión sólo impide renovar el acceso, mientras que
// el bloqueo deja a la persona sin leer ni escribir NADA desde la siguiente
// petición, y sin poder volver a entrar.
//
// Las duraciones son opciones y no un campo de fecha libre: quien bloquea está
// reaccionando a algo y no quiere calcular una fecha. «Indefinido» es explícito
// —no el valor por defecto— porque es el que no se deshace solo.
const DURACIONES = [
    { value: '1',    label: '1 hora' },
    { value: '8',    label: '8 horas' },
    { value: '24',   label: '1 día' },
    { value: '168',  label: '1 semana' },
    { value: 'inf',  label: 'Indefinido, hasta que lo quite' },
];

export default function BloqueoModal({ persona, onCancelar, onConfirmar, procesando }) {
    const [duracion, setDuracion] = useState('24');
    const [motivo, setMotivo] = useState('');

    const confirmar = () => {
        const hasta = duracion === 'inf'
            ? null   // null = indefinido, así lo entiende `block_employee`
            : new Date(Date.now() + Number(duracion) * 3_600_000).toISOString();
        onConfirmar(hasta, motivo);
    };

    return (
        <LiquidModal
            open={!!persona}
            onClose={procesando ? undefined : onCancelar}
            maxWidth="max-w-md"
            ariaLabel={`Bloquear a ${persona?.empleado || ''}`}
        >
            <LiquidModal.Header>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-danger/[0.12] border border-danger/30 flex items-center justify-center shrink-0">
                        <ShieldOff size={16} className="text-danger" />
                    </div>
                    <div className="min-w-0">
                        <h3 className="text-body font-bold text-content truncate">Bloquear a {persona?.empleado}</h3>
                        <p className="text-caption text-content-3">Le quita el acceso al portal por completo.</p>
                    </div>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                <Notice variant="warning" icon={AlertTriangle}>
                    Se cierran todas sus conexiones y deja de poder entrar. A diferencia de cerrar
                    una conexión, esto además le impide leer y escribir cualquier cosa desde el
                    momento en que se aplica.
                </Notice>

                <div>
                    <label className="text-caption font-black uppercase tracking-widest text-content-3 mb-1.5 block">
                        Por cuánto tiempo
                    </label>
                    <LiquidSelect value={duracion} onChange={setDuracion} options={DURACIONES} />
                </div>

                <PortalInput
                    label="Motivo (opcional)"
                    value={motivo}
                    onChange={e => setMotivo(e.target.value)}
                    placeholder="Queda registrado junto al bloqueo"
                />
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="secondary" onClick={onCancelar} disabled={procesando}>Cancelar</Button>
                <Button variant="destructive" icon={ShieldOff} onClick={confirmar} disabled={procesando}>
                    {procesando ? 'Bloqueando…' : 'Bloquear'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
