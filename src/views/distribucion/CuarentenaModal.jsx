import React, { useState } from 'react';
import { ShieldAlert, Trash2, Truck, PackageCheck, Loader2 } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { resolverCuarentena, mensajeDeDistribucion } from '@nucleo/data/distribucion';

// Lo devuelto que no volvió a la venta (borrador 0017): dañado, vencido o
// dudoso. No cuenta en la existencia hasta que alguien decida. Reingresar
// exige que el lote no esté vencido — la base lo vuelve a mirar.

const ACCIONES = [
    { estado: 'reingresada', label: 'Reingresar', icon: PackageCheck, toast: 'Volvió a la existencia de su lote.' },
    { estado: 'devuelta_proveedor', label: 'Al proveedor', icon: Truck, toast: 'Anotado como devuelto al proveedor.' },
    { estado: 'destruida', label: 'Destruir', icon: Trash2, toast: 'Anotado como destruido.' },
];

export default function CuarentenaModal({ filas, puedeResolver, onClose, onCambio }) {
    const showToast = useToastStore(s => s.showToast);
    const [nota, setNota] = useState({});
    const [ocupado, setOcupado] = useState(null);
    const [error, setError] = useState('');

    const resolver = async (q, a) => {
        setOcupado(`${q.id}:${a.estado}`);
        setError('');
        try {
            await resolverCuarentena(q.id, a.estado, nota[q.id]);
            useStaff.getState().appendAuditLog('DISTRIBUCION_CUARENTENA', String(q.id), { estado: a.estado, unidades: q.unidades, nota: nota[q.id] || null });
            showToast(a.label, a.toast, 'success');
            onCambio();
        } catch (e) {
            setError(mensajeDeDistribucion(e));
        } finally {
            setOcupado(null);
        }
    };

    return (
        <LiquidModal open onClose={ocupado ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel="Cuarentena">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <ShieldAlert size={18} className="text-warning shrink-0" />
                    <h2 className="text-title font-black text-content truncate">En cuarentena</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-3">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {filas.length === 0 ? (
                        <p className="text-caption text-content-3">Nada esperando decisión.</p>
                    ) : (
                        <ul className="divide-y divide-divider">
                            {filas.map(q => (
                                <li key={q.id} className="py-3 flex flex-col gap-2" data-cuarentena={q.id}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-body-sm font-bold text-content-2 truncate">{q.products?.nombre ?? `Producto ${q.product_id}`}</p>
                                            <p className="text-caption text-content-3">
                                                {q.dist_lotes?.lote ? `Lote ${q.dist_lotes.lote} · ` : ''}{fechaNumerica(q.created_at)} · {q.motivo}
                                            </p>
                                        </div>
                                        <span className="text-body font-black tabular-nums text-content shrink-0">{q.unidades} u</span>
                                    </div>
                                    {puedeResolver && (
                                        <div className="flex flex-wrap items-end gap-2">
                                            <PortalInput label="Nota (opcional)" name={`nota-cuarentena-${q.id}`} value={nota[q.id] ?? ''}
                                                onChange={(e) => setNota(n => ({ ...n, [q.id]: e.target.value }))} className="flex-1 min-w-[180px]" />
                                            {ACCIONES.map(a => (
                                                <Button key={a.estado} size="sm" variant="secondary" tone={a.estado === 'destruida' ? 'danger' : undefined}
                                                    icon={ocupado === `${q.id}:${a.estado}` ? Loader2 : a.icon} disabled={!!ocupado} onClick={() => resolver(q, a)}>
                                                    {a.label}
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end w-full">
                    <Button variant="ghost" onClick={onClose} disabled={!!ocupado}>Cerrar</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
