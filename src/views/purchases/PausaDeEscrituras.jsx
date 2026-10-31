import React, { useState } from 'react';
import { PauseCircle, PlayCircle } from 'lucide-react';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import ConfirmModal from '../../components/common/ConfirmModal';
import PortalInput from '../../components/common/PortalInput';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { cambiarPausaDeCompras } from '@nucleo/data/cargarCompra';

// El interruptor de Cargar compra. Pausado, el servidor rechaza toda escritura
// al sistema; esto sólo lo dice y deja a Gerencia/Administración cambiarlo
// (quién puede lo decide la base: `puede_cambiar`).
export default function PausaDeEscrituras({ estado, onCambio }) {
    const [abierto, setAbierto] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [guardando, setG] = useState(false);
    const [error, setError] = useState('');
    if (!estado) return null;
    const pausada = !!estado.pausada;
    if (!pausada && !estado.puede_cambiar) return null;

    const cambiar = async () => {
        setG(true); setError('');
        const { estado: e, error: err } = await cambiarPausaDeCompras(!pausada, pausada ? null : motivo.trim());
        setG(false);
        if (err) { setError(err); return; }
        setAbierto(false); setMotivo('');
        onCambio?.(e);
    };

    return (
        <>
            {pausada ? (
                <Notice variant="danger" icon={PauseCircle}>
                    <span className="flex items-center gap-2 flex-wrap">
                        <span className="flex-1 min-w-[14rem]">
                            <b>Escrituras al sistema pausadas</b>{estado.motivo ? `: ${estado.motivo}` : ''}.
                            {' '}No se registran compras, ni productos nuevos, ni envíos a salas.
                            {estado.por_nombre && ` Lo pausó ${shortEmployeeName(estado.por_nombre)}`}
                            {estado.desde && ` el ${fechaNumerica(estado.desde.slice(0, 10))}`}.
                        </span>
                        {estado.puede_cambiar && (
                            <Button size="xs" icon={PlayCircle} onClick={() => setAbierto(true)}>Reanudar</Button>
                        )}
                    </span>
                </Notice>
            ) : (
                <div className="flex justify-end">
                    <Button size="xs" variant="ghost" icon={PauseCircle} onClick={() => setAbierto(true)}>Pausar escrituras</Button>
                </div>
            )}
            {abierto && (
                <ConfirmModal isOpen onClose={() => !guardando && setAbierto(false)} onConfirm={cambiar}
                    isProcessing={guardando} isDestructive={!pausada}
                    title={pausada ? 'Reanudar escrituras' : 'Pausar escrituras'}
                    confirmText={pausada ? 'Reanudar' : 'Pausar'}
                    confirmDisabled={!pausada && !motivo.trim()}
                    message={pausada ? (
                        <>Cargar compra vuelve a escribir en el sistema.{error && <p className="text-danger-text mt-2">{error}</p>}</>
                    ) : (
                        <div className="space-y-2 text-left">
                            <p>Mientras esté pausado no se registran compras, ni productos nuevos, ni envíos a salas, ni salidas de erróneos. Se puede seguir revisando.</p>
                            <PortalInput compact labelDenso label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)}
                                placeholder="Ej.: revisando una carga con diferencias" />
                            {error && <p className="text-danger-text">{error}</p>}
                        </div>
                    )} />
            )}
        </>
    );
}
