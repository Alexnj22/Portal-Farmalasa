import React, { useState, useEffect, useMemo } from 'react';
import { Target } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { guardarMetaManual } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, YM_INICIO_HISTORIA } from './metasUtils';

const squircleClass = 'w-12 h-12 rounded-2xl bg-surface-card-hover border border-border-card shadow-sm flex items-center justify-center shrink-0';

// Ingreso manual de una meta: el histórico que el usuario tiene anotado, o el
// mes en curso/siguiente mientras el flujo de propuestas (Fase 2) no exista.
export default function MetaModal({ isOpen, onClose, onSaved, salaOptions, initialYm, initialBranchId }) {
    const { showToast } = useToastStore();
    const [ym, setYm] = useState(ymHoySV());
    const [branchId, setBranchId] = useState('');
    const [monto, setMonto] = useState('');
    const [nota, setNota] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setYm(initialYm || ymHoySV());
        setBranchId(initialBranchId ? String(initialBranchId) : '');
        setMonto('');
        setNota('');
    }, [isOpen, initialYm, initialBranchId]);

    // De mayo 2025 (primer mes con ventas en el portal) al mes siguiente,
    // el más reciente primero.
    const mesOptions = useMemo(() => {
        const out = [];
        let cursor = ymSumar(ymHoySV(), 1);
        while (cursor >= YM_INICIO_HISTORIA) {
            out.push({ value: cursor, label: ymLabel(cursor) });
            cursor = ymSumar(cursor, -1);
        }
        return out;
    }, []);

    const montoNum = parseFloat(String(monto).replace(/,/g, ''));
    const valido = ym && branchId && Number.isFinite(montoNum) && montoNum > 0;

    const guardar = async () => {
        if (!valido || saving) return;
        setSaving(true);
        try {
            await guardarMetaManual({ branchId, yearMonth: ym, monto: montoNum, nota });
            useStaffStore.getState().appendAuditLog('METAS_META_MANUAL', `${branchId}|${ym}`, {
                monto: montoNum, nota: nota || undefined,
            });
            showToast('Meta guardada', `${ymLabel(ym)} quedó con su meta registrada.`, 'success');
            onSaved?.();
            onClose();
        } catch (err) {
            showToast('Error', mensajeAmigable(err, 'No se pudo guardar la meta'), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <LiquidModal open={isOpen} onClose={onClose} maxWidth="max-w-md" ariaLabel="Agregar meta">
            <div className="flex-none px-6 py-6 border-b border-border-card flex items-center gap-4">
                <div className={`${squircleClass} text-brand-text`}><Target size={22} strokeWidth={2.5} /></div>
                <div>
                    <h3 className="font-black text-content uppercase tracking-tighter text-lg leading-none mb-1">Agregar meta</h3>
                    <p className="text-caption font-bold text-content-3 uppercase tracking-[0.2em]">Metas por sala</p>
                </div>
            </div>

            <div className="px-6 py-6 space-y-4 overflow-y-auto">
                <div>
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Mes</p>
                    <LiquidSelect value={ym} onChange={setYm} options={mesOptions} placeholder="Mes" />
                </div>
                <div>
                    <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1 mb-1.5">Sala</p>
                    <LiquidSelect value={branchId} onChange={setBranchId} options={salaOptions} placeholder="Sala" />
                </div>
                <PortalInput
                    label="Monto de la meta" name="monto" prefix="$" type="number"
                    value={monto} onChange={(e) => setMonto(e.target.value)}
                    placeholder="0.00" required
                />
                <PortalInput
                    label="Nota (opcional)" name="nota"
                    value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder="Ej. meta original del mes"
                />
                <p className="text-label font-semibold text-content-3 leading-relaxed">
                    La venta del mes se calcula sola con los datos del portal.
                    Queda registrado quién agregó esta meta.
                </p>
            </div>

            <LiquidModal.Footer>
                <Button variant="secondary" size="lg" disabled={saving} onClick={onClose}>Cancelar</Button>
                <Button variant="primary" size="lg" disabled={!valido || saving} onClick={guardar}>
                    {saving ? 'Guardando…' : 'Guardar meta'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
