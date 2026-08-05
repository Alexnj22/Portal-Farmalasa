import React, { useState, useEffect, useMemo } from 'react';
import { Target } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { useStaffStore } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { guardarMetaManual, fetchMetasRows } from '../../data/metas';
import { mensajeAmigable } from '../../utils/errorMessages';
import { ymHoySV, ymSumar, ymLabel, YM_INICIO_HISTORIA } from './metasUtils';

const squircleClass = 'w-12 h-12 rounded-2xl bg-surface-card-hover border border-border-card shadow-sm flex items-center justify-center shrink-0';

// Qué pasa al guardar sobre la meta que ya existe en ese mes y esa sala. El
// servidor decide igual (`upsert_meta_manual` tiene el candado), pero enterarse
// DESPUÉS de apretar Guardar es enterarse tarde: acá el motivo se lee antes.
function situacion(estado, ym, ymActual) {
    if (!estado) {
        return { puede: true, tono: 'info',
            texto: 'Este mes no tiene meta registrada para esta sala. Se guarda como meta oficial.' };
    }
    if (estado === 'confirmada_supervisor') {
        return { puede: false, tono: 'warning',
            texto: 'Esta meta ya fue confirmada y espera al gerente. Para cambiarle el monto, él tiene que devolverla primero.' };
    }
    if (estado === 'oficial' && ym >= ymActual) {
        return { puede: false, tono: 'warning',
            texto: 'Esta meta ya está aprobada y la sala la está persiguiendo. Para corregirla, el gerente tiene que devolverla.' };
    }
    if (estado === 'oficial') {
        return { puede: true, tono: 'warning', pideNota: true,
            texto: 'Este mes ya cerró con su meta. Corregirla cambia el cumplimiento y el bono que dio ese mes, así que hay que dejar dicho por qué.' };
    }
    // propuesta | devuelta
    return { puede: true, tono: 'info',
        texto: 'Esta meta está en revisión. Se cambia el monto y sigue su camino normal: confirmar y aprobar.' };
}

// Ingreso manual de una meta: el histórico que el usuario tiene anotado, o la
// corrección del monto de una propuesta en revisión.
export default function MetaModal({ isOpen, onClose, onSaved, salaOptions, initialYm, initialBranchId }) {
    const { showToast } = useToastStore();
    const ymActual = ymHoySV();
    const [ym, setYm] = useState(ymActual);
    const [branchId, setBranchId] = useState('');
    const [monto, setMonto] = useState('');
    const [nota, setNota] = useState('');
    const [saving, setSaving] = useState(false);
    // clave `branchId|ym` → estado de la meta que ya existe. Se pide una vez al
    // abrir: son pocas filas y evita una consulta por cada cambio de selector.
    const [estados, setEstados] = useState(null);

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

    useEffect(() => {
        if (!isOpen) return;
        setYm(initialYm || ymHoySV());
        setBranchId(initialBranchId ? String(initialBranchId) : '');
        setMonto('');
        setNota('');
    }, [isOpen, initialYm, initialBranchId]);

    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        setEstados(null);
        fetchMetasRows(mesOptions.map((o) => o.value))
            .then((rows) => {
                if (!alive) return;
                const map = {};
                for (const r of rows) map[`${r.branch_id}|${r.year_month}`] = r.estado;
                setEstados(map);
            })
            // Sin la lectura no se adivina: se deja pasar y contesta el servidor,
            // que es quien manda. Peor sería bloquear por una consulta caída.
            .catch(() => { if (alive) setEstados({}); });
        return () => { alive = false; };
    }, [isOpen, mesOptions]);

    const estadoActual = branchId && ym ? estados?.[`${branchId}|${ym}`] : undefined;
    const sit = useMemo(
        () => (branchId && ym && estados ? situacion(estadoActual, ym, ymActual) : null),
        [branchId, ym, estados, estadoActual, ymActual],
    );

    const montoNum = parseFloat(String(monto).replace(/,/g, ''));
    const valido = ym && branchId
        && Number.isFinite(montoNum) && montoNum > 0
        && sit?.puede !== false
        && (!sit?.pideNota || !!nota.trim());

    const guardar = async () => {
        if (!valido || saving) return;
        setSaving(true);
        try {
            await guardarMetaManual({ branchId, yearMonth: ym, monto: montoNum, nota });
            useStaffStore.getState().appendAuditLog('METAS_META_MANUAL', `${branchId}|${ym}`, {
                monto: montoNum, nota: nota || undefined, estadoPrevio: estadoActual || 'sin meta',
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

                {/* El aviso aparece recién con las dos cosas elegidas: antes de
                    eso no hay nada que decir, y un cartel permanente se vuelve
                    parte del decorado. */}
                {sit && <Notice variant={sit.tono}>{sit.texto}</Notice>}

                <PortalInput
                    label="Monto de la meta" name="monto" prefix="$" type="number"
                    value={monto} onChange={(e) => setMonto(e.target.value)}
                    placeholder="0.00"
                    // Con el campo bloqueado, la píldora «requerido» pediría algo
                    // que el propio candado no deja dar.
                    required={sit?.puede !== false}
                    readOnly={sit?.puede === false}
                />
                <PortalInput
                    label={sit?.pideNota ? '¿Por qué se corrige?' : 'Nota (opcional)'}
                    name="nota"
                    value={nota} onChange={(e) => setNota(e.target.value)}
                    placeholder={sit?.pideNota ? 'Ej. la meta original era otra y quedó mal anotada' : 'Ej. meta original del mes'}
                    required={!!sit?.pideNota}
                    readOnly={sit?.puede === false}
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
