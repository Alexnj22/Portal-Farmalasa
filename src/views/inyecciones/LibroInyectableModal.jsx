import React, { useEffect, useState } from 'react';
import LiquidModal from '../../components/common/LiquidModal';
import PieDeModal from '../../components/common/PieDeModal';
import Button from '../../components/common/Button';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Notice from '../../components/common/Notice';
import { useToastStore } from '@nucleo/store/toastStore';
import { guardarLibroDeInyectable } from '@nucleo/data/inyecciones';
import { VIAS_DE_APLICACION } from '@nucleo/utils/inyeccionesPendientes';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { loadDraft, saveDraft, clearDraft } from '@nucleo/utils/draftUtils';

/*
 * Los datos del libro de inyectables de una aplicación (2026-11-11): lo que la
 * bitácora no sabía y la norma pide — documento del paciente, médico que la
 * recetó, vía, sitio y observaciones. El medicamento, el lote, quién aplicó y
 * cuándo ya están en la fila. Lo escrito se guarda como borrador.
 */

const VACIO = { documento: '', medico: '', junta_medico: '', via: '', sitio: '', observaciones: '' };

export default function LibroInyectableModal({ fila, libro, onClose, onHecho }) {
    const showToast = useToastStore((s) => s.showToast);
    const clave = `inyeccion-libro:${fila.id}`;
    const [datos, setDatos] = useState(() => loadDraft(clave) || { ...VACIO, ...(libro || {}) });
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => { saveDraft(clave, datos); }, [clave, datos]);
    const poner = (k) => (e) => setDatos((d) => ({ ...d, [k]: e?.target ? e.target.value : e }));

    const guardar = async () => {
        setGuardando(true);
        setError(null);
        try {
            await guardarLibroDeInyectable(fila.id, datos);
            clearDraft(clave);
            showToast('Libro completado', fila.producto, 'success');
            onHecho?.();
        } catch (e) {
            setError(e?.hint || mensajeAmigable(e, 'No se pudo guardar'));
        } finally { setGuardando(false); }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel="Datos del libro de inyectables">
            <LiquidModal.Header titulo="Datos del libro" subtitulo={`${fila.producto} · ${fila.cliente || 'sin cliente'}`}
                onClose={guardando ? undefined : onClose} />
            <LiquidModal.Body className="space-y-4">
                <PortalInput label="DUI u otro documento del paciente" required value={datos.documento} onChange={poner('documento')} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PortalInput label="Médico que la recetó" value={datos.medico} onChange={poner('medico')} />
                    <PortalInput label="Número JVPM" value={datos.junta_medico} onChange={poner('junta_medico')} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <p className="text-caption font-bold text-content-3 mb-1">Vía</p>
                        <LiquidSelect value={datos.via} onChange={(v) => setDatos((d) => ({ ...d, via: v || '' }))}
                            options={VIAS_DE_APLICACION} placeholder="¿Por qué vía?" clearable={false} />
                    </div>
                    <PortalInput label="Sitio de aplicación" placeholder="Glúteo, deltoides…" value={datos.sitio} onChange={poner('sitio')} />
                </div>
                <PortalTextarea label="Observaciones (opcional)" rows={3} maxLength={500}
                    helperText="Si hubo alguna reacción, anótala aquí y también en Cumplimiento → Farmacovigilancia."
                    value={datos.observaciones} onChange={poner('observaciones')} />
                {error && <Notice variant="danger">{error}</Notice>}
            </LiquidModal.Body>
            <PieDeModal>
                <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                <Button variant="primary" loading={guardando} disabled={!datos.documento?.trim() || !datos.via} onClick={guardar}>Guardar</Button>
            </PieDeModal>
        </LiquidModal>
    );
}
