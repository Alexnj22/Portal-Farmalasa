import React, { useMemo } from 'react';
import { Inbox, Plus } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import { EmptyState } from '../../components/common/StateViews';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { prioridadDe, estadoSolicitudDe, formatoDe } from '@nucleo/utils/marketing';

// Lo que falta atender va primero; dentro, lo más urgente.
const ORDEN_ESTADO = { nueva: 0, aceptada: 1, entregada: 2, rechazada: 3 };
const ORDEN_PRIORIDAD = { urgente: 0, alta: 1, normal: 2 };

export default function TabSolicitudes({ solicitudes, marcas, personas, busqueda, filtroEstado, onAbrir, onNueva }) {
    const filas = useMemo(() => (solicitudes || [])
        .filter((s) => !filtroEstado || s.estado === filtroEstado)
        .filter((s) => !busqueda || tokenMatch(busqueda, s.titulo, s.descripcion, marcas[s.marca_id]?.nombre))
        .sort((a, b) => (ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado])
            || (ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad])
            || String(b.created_at).localeCompare(a.created_at)),
    [solicitudes, filtroEstado, busqueda, marcas]);

    if (!solicitudes?.length) {
        return (
            <EmptyState icon={Inbox} title="Sin solicitudes"
                subtitle="Pídele al diseñador una pieza: un post de una promoción, una historia de un producto nuevo."
                action={<Button icon={Plus} onClick={onNueva}>Pedir una pieza</Button>} />
        );
    }

    return (
        <DataTable
            columns={[
                { key: 'titulo', label: 'Solicitud' },
                { key: 'marca', label: 'Marca', hideBelow: 'md' },
                { key: 'para', label: 'Para', hideBelow: 'sm' },
                { key: 'prioridad', label: 'Prioridad' },
                { key: 'estado', label: 'Estado' },
                { key: 'quien', label: 'Pidió', hideBelow: 'lg' },
            ]}
            movil={{ usarAccionDeFila: true }}
            empty={{ icon: Inbox, message: 'Sin solicitudes con ese filtro' }}
            minWidth="560px">
            {filas.map((s, i) => {
                const prio = prioridadDe(s.prioridad);
                const est = estadoSolicitudDe(s.estado);
                const quien = personas[s.solicitado_por];
                return (
                    <DataRow key={s.id} index={i} onClick={() => onAbrir(s)}>
                        <DataCell>
                            <div className="min-w-0">
                                <p className="text-body-sm font-semibold text-content truncate">{s.titulo}</p>
                                {(s.formato || s.tipo === 'impreso') && (
                                    <p className="text-micro text-content-3">
                                        {[s.tipo === 'impreso' ? 'Impreso' : null, s.formato && formatoDe(s.formato).label, s.tamano].filter(Boolean).join(' · ')}
                                    </p>
                                )}
                            </div>
                        </DataCell>
                        <DataCell hideBelow="md">{marcas[s.marca_id]?.nombre || '—'}</DataCell>
                        <DataCell hideBelow="sm">{s.fecha_deseada ? fechaTexto(s.fecha_deseada, { day: 'numeric', month: 'short' }) : '—'}</DataCell>
                        <DataCell><Badge variant={prio.variant} size="sm">{prio.label}</Badge></DataCell>
                        <DataCell><Badge variant={est.variant} size="sm">{est.label}</Badge></DataCell>
                        <DataCell hideBelow="lg">
                            <span className="flex items-center gap-1.5 min-w-0">
                                <AvatarConEstado emp={quien || { id: s.solicitado_por }} px={20} radio="rounded-full" marco="" />
                                <span className="truncate">{shortEmployeeName(quien?.name)}</span>
                            </span>
                        </DataCell>
                    </DataRow>
                );
            })}
        </DataTable>
    );
}
