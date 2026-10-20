import React from 'react';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import Badge from '../../components/common/Badge';
import ListRow from '../../components/common/ListRow';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { cuandoLlego } from '@nucleo/utils/notificacionTexto';
import ChipsDeEstado from './ChipsDeEstado';
import ClienteAvatar from './ClienteAvatar';
import AsignadoA from './AsignadoA';
import { nombreDeCliente, tipoDeCliente } from './etiquetas';
import { escribeAhora, useRelojDeEscritura } from './escribiendo';
import { ChipsDeEtiquetas } from './EtiquetasDelCliente';
import { Estrellas } from './Calificacion';
import { etiquetasDe } from '@nucleo/utils/chatClientes';
import ChipPreferente from './Preferente';

// Una conversación en la bandeja: quién escribió, qué tipo de cliente es, su
// nivel, en qué estado está (y cuánto lleva esperando), cuántos mensajes esperan
// respuesta y si alguien ya la está atendiendo. `atiende` es la ficha de quien
// la tiene tomada (también si es uno mismo: el chip lo nombra); `tomadaPor`,
// sólo si es OTRA persona (la línea «… está respondiendo»). Mientras el
// cliente escribe, la vista previa del último mensaje dice «escribiendo…».
//
// (2026-10-13) Las etiquetas del equipo van como chips (hasta tres y «+N»);
// una abierta «Urgente» se tiñe de rojo —y la bandeja la sube—; una resuelta
// que el cliente calificó muestra sus estrellas. Con mensajes sin leer, el
// nombre y la vista previa van en negrita; leída, en peso normal.
export default function FilaDeConversacion({ conversacion: c, activa, tomadaPor, atiende, ahora, onAbrir, equipo }) {
    const tipo = tipoDeCliente(c);
    // La abierta no cuenta como «sin leer»: quien la mira ya la está leyendo.
    const sinLeer = activa ? 0 : Number(c.sin_leer_equipo) || 0;
    const reloj = useRelojDeEscritura([c.cliente_escribiendo_at]);
    const escribe = escribeAhora(c.cliente_escribiendo_at, reloj);
    const urgente = c.estado !== 'resuelta' && etiquetasDe(c).includes('urgente');
    const nombre = nombreDeCliente(c.cliente);
    // Como una bandeja de mensajería (2026-10-20): nombre y hora en el primer
    // renglón, la vista previa con el contador de sin leer en el segundo, y los
    // chips —estado, etiquetas— en el tercero. «Cliente» y el nivel no van
    // como chips: el nivel ya lo dice el anillo de la foto.
    const vistaPrevia = tomadaPor ? (
        <span className="flex items-center gap-1.5 text-label text-brand-text font-semibold min-w-0">
            <AvatarConEstado emp={tomadaPor} px={16} mostrarChip={false} />
            <span className="truncate">{shortEmployeeName(tomadaPor)} está respondiendo…</span>
        </span>
    ) : escribe ? (
        <span className="block text-label truncate italic text-brand-text">escribiendo…</span>
    ) : (
        <span className={`block text-label truncate ${sinLeer ? 'text-content font-semibold' : 'text-content-3 font-normal'}`}>
            {c.ultimo_de === 'equipo' ? 'Equipo: ' : ''}{c.ultimo_texto ?? ''}
        </span>
    );
    return (
        <ListRow surface="card" density="md" onClick={onAbrir} selected={activa}
            tone={urgente && !activa ? 'danger' : null}
            className="min-h-[var(--tap-min)] !items-start"
            leading={<ClienteAvatar conversacion={c} />}
            iconBoxClass="border-transparent bg-transparent w-9 h-9"
            title={(
                <span className="flex items-baseline gap-2 min-w-0">
                    <span className={`flex-1 min-w-0 truncate ${sinLeer ? 'font-black text-content' : 'font-semibold text-content-2'}`}>{nombre}</span>
                    <span className={`shrink-0 text-micro tabular-nums ${sinLeer ? 'text-brand-text font-black' : 'text-content-3 font-medium'}`}>{cuandoLlego(c.ultimo_mensaje_at)}</span>
                </span>
            )}>
            <span className="flex items-center gap-2 mt-0.5 min-w-0">
                <span className="flex-1 min-w-0">{vistaPrevia}</span>
                {sinLeer > 0 && <Badge variant="danger" tone="solid" size="sm" uppercase={false}
                    aria-label={`${sinLeer} sin leer`}>{sinLeer}</Badge>}
            </span>
            <span className="flex flex-wrap items-center gap-1 mt-1.5">
                <ChipsDeEstado conversacion={c} atiende={atiende} ahora={ahora} />
                <ChipPreferente conversacion={c} />
                {(c.es_team || c.es_mayoreo) && <Badge variant={tipo.variant} size="sm" uppercase={false}>{tipo.label}</Badge>}
                {etiquetasDe(c).length > 0 && <ChipsDeEtiquetas conversacion={c} max={2} />}
                {c.calificacion ? <Estrellas valor={c.calificacion} px={10} /> : null}
            </span>
            {c.asignada_a && <AsignadoA conversacion={c} equipo={equipo} className="mt-1" />}
        </ListRow>
    );
}
