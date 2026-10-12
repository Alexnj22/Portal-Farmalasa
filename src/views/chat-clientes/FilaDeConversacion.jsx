import React from 'react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import ListRow from '../../components/common/ListRow';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import ChipsDeEstado from './ChipsDeEstado';
import ClienteAvatar from './ClienteAvatar';
import { NIVELES, nombreDeCliente, tipoDeCliente } from './etiquetas';

// Una conversación en la bandeja: quién escribió, qué tipo de cliente es, su
// nivel, en qué estado está (y cuánto lleva esperando), cuántos mensajes esperan
// respuesta y si alguien ya la está atendiendo. `atiende` es la ficha de quien
// la tiene tomada (también si es uno mismo: el chip lo nombra); `tomadaPor`,
// sólo si es OTRA persona (la línea «… está respondiendo»).
export default function FilaDeConversacion({ conversacion: c, activa, tomadaPor, atiende, ahora, onAbrir }) {
    const tipo = tipoDeCliente(c);
    const nivel = NIVELES[c.nivel];
    // La abierta no cuenta como «sin leer»: quien la mira ya la está leyendo.
    const sinLeer = activa ? 0 : Number(c.sin_leer_equipo) || 0;
    return (
        <ListRow surface="card" density="md" onClick={onAbrir} selected={activa}
            className="min-h-[var(--tap-min)]"
            leading={<ClienteAvatar conversacion={c} />}
            iconBoxClass="border-transparent bg-transparent w-9 h-9"
            title={nombreDeCliente(c.cliente)}
            trailing={(
                <span className="flex flex-col items-end gap-1">
                    <span className="text-micro text-content-3 tabular-nums">{cuandoLlego(c.ultimo_mensaje_at)}</span>
                    {sinLeer > 0 && <Badge variant="danger" tone="solid" size="sm" uppercase={false}
                        aria-label={`${sinLeer} sin leer`}>{sinLeer}</Badge>}
                </span>
            )}>
            <span className="flex flex-wrap items-center gap-1 mt-0.5">
                <ChipsDeEstado conversacion={c} atiende={atiende} ahora={ahora} />
                <Badge variant={tipo.variant} size="sm" uppercase={false}>{tipo.label}</Badge>
                {nivel && <Badge variant={nivel.variant} size="sm" uppercase={false}>{nivel.label}</Badge>}
            </span>
            {tomadaPor ? (
                <span className="flex items-center gap-1.5 mt-1 text-label text-brand-text font-semibold min-w-0">
                    <AvatarConEstado emp={tomadaPor} px={18} mostrarChip={false} />
                    <span className="truncate">{shortEmployeeName(tomadaPor)} está respondiendo…</span>
                </span>
            ) : (
                <span className={`block mt-1 text-label truncate ${sinLeer ? 'text-content font-semibold' : 'text-content-3'}`}>
                    {c.ultimo_de === 'equipo' ? 'Equipo: ' : ''}{c.ultimo_texto ?? ''}
                </span>
            )}
        </ListRow>
    );
}
