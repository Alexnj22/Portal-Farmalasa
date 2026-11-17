import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Plus, ChevronRight, AlertTriangle, ClipboardList } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import ListRow from '../../components/common/ListRow';
import LiquidSelect from '../../components/common/LiquidSelect';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useResumenWidget } from './tamanoWidget';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fetchPreventasDeSala } from '@nucleo/data/preventas';
import { estadoDePreventa } from '@nucleo/utils/preventaDirecta';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import useRefrescoEnVivo from '@nucleo/hooks/useRefrescoEnVivo';

// Preventa en el Inicio (2026-11-16, lo pidió el usuario): «un widget para ir
// de un solo ahí, que muestre las preventas pendientes de finalizar».
//
// Pendiente = lo que todavía pide algo: en caja sin cobrar (`viva`), o lo que
// no llegó o llegó sin número (`fallida`, `sin_enlace`). Lo cobrado y lo
// anulado sólo suman en el contador de hoy. La lista es la misma de Preventa
// (`preventas_de_sala`, hoy), y tocar una fila abre esa pestaña.

const PENDIENTES = new Set(['viva', 'fallida', 'sin_enlace']);
const CON_PROBLEMA = new Set(['fallida', 'sin_enlace']);
const TOPE = 6;

export default function WidgetPreventa() {
    const navigate = useNavigate();
    const { user, hasPermission, getScope } = useAuth();
    const puedeVender = hasPermission('preventa', 'can_edit');
    const todas = getScope('preventa') === 'ALL';
    const miSala = user?.branchId ?? user?.branch_id ?? null;
    const branches = useStaff((s) => s.branches);
    const salas = useMemo(() => (branches || []).filter((b) => b.type === 'FARMACIA')
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true })), [branches]);
    const [elegida, setElegida] = useState(null);
    // Quien ve todas arranca en la suya si es farmacia (una oficina no vende).
    const miFarmacia = salas.some((b) => Number(b.id) === Number(miSala)) ? Number(miSala) : null;
    const sala = todas ? (elegida ?? miFarmacia ?? salas[0]?.id ?? null) : miSala;

    const [lista, setLista] = useState(null);
    const [error, setError] = useState('');
    const cargar = useCallback(() => {
        if (!sala) return;
        fetchPreventasDeSala(sala, 1)
            .then((l) => { setLista(l); setError(''); })
            .catch((e) => { setLista([]); setError(mensajeAmigable(e, 'No se pudieron leer las preventas.')); });
    }, [sala]);
    useEffect(() => { cargar(); }, [cargar]);
    useRefrescoEnVivo(cargar, { ms: 60_000 });

    const pendientes = (lista ?? []).filter((p) => PENDIENTES.has(p.estado));
    const conProblema = pendientes.filter((p) => CON_PROBLEMA.has(p.estado)).length;
    const cobradas = (lista ?? []).filter((p) => p.estado === 'facturada');
    const totalPendiente = pendientes.reduce((s, p) => s + (Number(p.total) || 0), 0);

    const ir = (extra = '') => navigate(`/preventa${extra}${todas && sala ? `${extra ? '&' : '?'}sala=${sala}` : ''}`);
    const verLista = () => ir('?tab=hoy');
    const nueva = () => ir('?tab=nueva');

    useResumenWidget(lista === null ? null : error ? { texto: 'No se pudo leer', tono: 'danger' }
        : !pendientes.length ? { texto: cobradas.length ? `Nada pendiente · ${cobradas.length} cobradas hoy` : 'Nada pendiente', accion: puedeVender ? { texto: 'Nueva', ir: '/preventa?tab=nueva' } : undefined }
        : {
            valor: pendientes.length,
            texto: `${pendientes.length === 1 ? 'pendiente' : 'pendientes'} · ${formatMoney(totalPendiente)}${conProblema ? ` · ${conProblema} con problema` : ''}`,
            tono: conProblema ? 'danger' : 'warning',
            accion: { texto: 'Ver', ir: '/preventa?tab=hoy' },
        });

    return (
        <div className="flex flex-col h-full min-h-0">
            <div className="flex items-end justify-between gap-3 px-4 pt-3 pb-2 border-b border-divider shrink-0">
                <div className="flex items-end gap-4">
                    <div>
                        <p className={`text-display-lg font-black leading-none tabular-nums ${conProblema ? 'text-danger-text' : 'text-content'}`}>{lista === null ? '—' : pendientes.length}</p>
                        <p className="text-caption font-semibold text-content-3 mt-0.5">por cobrar</p>
                    </div>
                    <div className="mb-1">
                        <p className="text-body font-black tabular-nums text-content-2">{formatMoney(totalPendiente)}</p>
                        <p className="text-micro font-black text-content-3 uppercase tracking-widest">{cobradas.length} cobradas hoy</p>
                    </div>
                </div>
                {puedeVender && <Button size="sm" icon={Plus} onClick={nueva}>Nueva</Button>}
            </div>

            {todas && salas.length > 1 && (
                <div className="px-3 pt-2 shrink-0">
                    <LiquidSelect value={sala} onChange={(v) => setElegida(v ? Number(v) : null)}
                        options={salas.map((b) => ({ value: b.id, label: b.name }))} placeholder="Sucursal" />
                </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-1">
                {lista === null ? (
                    <div className="p-2"><SkeletonText lines={4} /></div>
                ) : error ? (
                    <EmptyState linea icon={AlertTriangle} title={error} />
                ) : pendientes.length === 0 ? (
                    <EmptyState linea icon={ClipboardList} title="Sin preventas pendientes"
                        subtitle={cobradas.length ? `Hoy se cobraron ${cobradas.length}.` : undefined} />
                ) : pendientes.slice(0, TOPE).map((p) => {
                    const est = estadoDePreventa(p);
                    return (
                        <ListRow key={p.id} density="sm" icon={Receipt} onClick={verLista}
                            title={p.cliente ?? 'Cliente frecuente'}
                            subtitle={[p.externo_ref ? `#${p.externo_ref}` : p.codigo, hora12(p.enviada_at ?? p.created_at), p.vendedor ? shortEmployeeName({ name: p.vendedor }) : null].filter(Boolean).join(' · ')}
                            trailing={(
                                <span className="flex flex-col items-end gap-0.5">
                                    <span className="text-label font-black tabular-nums text-content">{formatMoney(p.total)}</span>
                                    <Badge variant={est.tono} size="sm" uppercase={false}>{est.texto}</Badge>
                                </span>
                            )} />
                    );
                })}
                {pendientes.length > TOPE && (
                    <Button variant="ghost" size="sm" className="w-full" onClick={verLista}>
                        Ver las {pendientes.length} <ChevronRight size={14} aria-hidden />
                    </Button>
                )}
            </div>
        </div>
    );
}
