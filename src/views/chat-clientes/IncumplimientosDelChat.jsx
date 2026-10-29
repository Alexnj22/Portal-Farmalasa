import React, { useEffect, useState } from 'react';
import { ShieldAlert, Store, Timer } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { TOPE_INCUMPLIMIENTOS, fetchIncumplimientosDelChat } from '@nucleo/data/chatClientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import { nombreDeCliente } from './etiquetas';

const DIAS = 30;

/**
 * «Incumplimientos» del chat (2026-10-14): las veces que un cliente esperó más
 * de 20 minutos con el chat asignado a alguien que no le contestó. Las
 * registra el servidor (`chat_vigilar_espera`, cada minuto con la farmacia
 * abierta) al mismo tiempo que avisa a supervisión. Sólo para supervisión
 * (rango ≥ 3) o quien edita el chat; la policy de la tabla exige ver el chat.
 *
 * `clientes` (conversación → nombre) sale de la bandeja: la ficha del cliente
 * puede no ser legible para quien mira, y la bandeja ya la trae.
 */
export default function IncumplimientosDelChat({ abierto, onClose, equipo, asegurarEquipo, clientes, onAbrirConversacion }) {
    const [filas, setFilas] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!abierto) return undefined;
        let vivo = true;
        // Al reabrir se ve lo de la vez anterior mientras llega lo nuevo.
        fetchIncumplimientosDelChat(DIAS)
            .then((d) => { if (!vivo) return; setFilas(d); setError(null); asegurarEquipo?.(d.map((f) => f.employee_id)); })
            .catch((err) => { if (vivo) setError(mensajeAmigable(err, 'No se pudo cargar el registro de incumplimientos.')); });
        return () => { vivo = false; };
    }, [abierto, asegurarEquipo]);

    return (
        <LiquidModal open={abierto} onClose={onClose} maxWidth="max-w-2xl" ariaLabel="Incumplimientos del chat">
            <LiquidModal.Header icono={ShieldAlert} tono="danger" titulo="Incumplimientos del chat" onClose={onClose} />
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    <p className="text-caption text-content-2">
                        Clientes que esperaron más de 20 minutos con el chat asignado a alguien que no contestó. Últimos {DIAS} días.
                    </p>
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {!filas && !error && <LoadingState label="Cargando incumplimientos" />}
                    {filas && !filas.length && (
                        <EmptyState icon={ShieldAlert} compact title="Sin incumplimientos"
                            subtitle={`Nadie dejó a un cliente esperando más de 20 minutos en los últimos ${DIAS} días.`} />
                    )}
                    {filas && filas.length >= TOPE_INCUMPLIMIENTOS && (
                        <Notice variant="warning" bloque>Se muestran los {TOPE_INCUMPLIMIENTOS} más recientes.</Notice>
                    )}
                    {filas && filas.length > 0 && (
                        <ul className="flex flex-col gap-1.5">
                            {filas.map((f) => {
                                const emp = equipo?.get?.(f.employee_id) ?? { id: f.employee_id };
                                const cliente = f.conversacion?.cliente?.name ?? clientes?.get?.(f.conversacion_id) ?? null;
                                return (
                                    <li key={f.id} data-surface="card" className="rounded-card px-3 py-2.5 flex items-start gap-3">
                                        <AvatarConEstado emp={emp} px={32} mostrarChip={false} />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-body-sm font-semibold text-content truncate">
                                                {emp.name || emp.first_names ? shortEmployeeName(emp) : 'Alguien del equipo'}
                                            </p>
                                            <p className="text-label text-content-2 truncate">
                                                {cliente ? `No le contestó a ${nombreDeCliente(cliente)}` : 'No le contestó a un cliente'}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-1 mt-1">
                                                <Badge variant="danger" size="sm" uppercase={false} icon={Timer}>{f.minutos} min</Badge>
                                                {f.sala?.name && <Badge variant="neutral" size="sm" uppercase={false} icon={Store}>{f.sala.name}</Badge>}
                                                <span className="text-micro text-content-3 tabular-nums">{fechaHora12(f.created_at)}</span>
                                            </div>
                                        </div>
                                        {onAbrirConversacion && clientes?.has?.(f.conversacion_id) && (
                                            <Button variant="ghost" size="sm" onClick={() => { onAbrirConversacion(f.conversacion_id); onClose(); }}>
                                                Ver chat
                                            </Button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="secondary" onClick={onClose}>Cerrar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
