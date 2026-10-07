import React, { useState, useEffect, useRef } from 'react';
import { Truck, Loader2, Save } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import Notice from '../../components/common/Notice';
import Button from '../../components/common/Button';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import useBorrador from '@nucleo/hooks/useBorrador';
import { guardarProveedor } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import Interruptor from './Interruptor';
import { leerFormularioDeProveedor, mensajeDeProveedor, proveedorAFormulario } from '@nucleo/utils/distribucionComercial';

// Alta y edición de un proveedor de la distribuidora. `inicial` puede venir
// del documento electrónico del proveedor (nombre, NIT y NRC ya leídos), así
// que registrar uno nuevo desde una compra es confirmar, no escribir.

export default function ProveedorModal({ emisorId, inicial = {}, onClose, onGuardado }) {
    const nuevo = !inicial.id;
    const [f, setF] = useState(() => proveedorAFormulario(inicial));
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const set = (k) => (v) => setF(x => ({ ...x, [k]: v }));

    const { recuperado, descartar } = useBorrador(nuevo && !inicial.nit ? `distribucion-proveedor-nuevo-${emisorId}` : null, f,
        { vale: (v) => !!(v?.nombre || v?.nit) });
    const repuesto = useRef(false);
    useEffect(() => {
        if (repuesto.current || !recuperado) return;
        repuesto.current = true;
        setF(x => ({ ...x, ...recuperado }));
    }, [recuperado]);

    const { nit, nrc, plazo, errNit, errNrc, errPlazo, listo: valido } = leerFormularioDeProveedor(f);
    const listo = valido && !guardando;

    const guardar = async () => {
        setGuardando(true);
        setError('');
        try {
            const id = await guardarProveedor({ ...f, id: inicial.id, emisor_id: emisorId, nit: nit || null, nrc: nrc || null, plazo_dias: plazo });
            useStaff.getState().appendAuditLog(nuevo ? 'DISTRIBUCION_PROVEEDOR_ALTA' : 'DISTRIBUCION_PROVEEDOR_EDICION', String(id),
                { nombre: f.nombre.trim(), nit: nit || null, relacionada: !!f.relacionada });
            descartar();
            onGuardado(id);
        } catch (e) {
            setError(mensajeDeProveedor(e, mensajeDeDistribucion));
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-lg" ariaLabel={nuevo ? 'Nuevo proveedor' : f.nombre}>
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <Truck size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">{nuevo ? 'Nuevo proveedor' : f.nombre}</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-4">
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    <PortalInput label="Nombre o razón social" name="nombre" value={f.nombre} onChange={(e) => set('nombre')(e.target.value)} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <PortalInput label="NIT" name="nit" inputMode="numeric" value={f.nit} onChange={(e) => set('nit')(e.target.value)}
                            hasError={errNit} errorMessage="De 9 a 14 dígitos" helperText="Sin guiones" />
                        <PortalInput label="NRC" name="nrc" inputMode="numeric" value={f.nrc} onChange={(e) => set('nrc')(e.target.value)}
                            hasError={errNrc} errorMessage="De 2 a 8 dígitos" />
                        <PortalInput label="Teléfono" name="telefono" inputMode="tel" value={f.telefono ?? ''} onChange={(e) => set('telefono')(e.target.value)} />
                        <PortalInput label="Correo" name="correo" type="email" value={f.correo ?? ''} onChange={(e) => set('correo')(e.target.value)} />
                        <PortalInput label="Plazo de pago (días)" name="plazo" inputMode="numeric" value={f.plazo_dias}
                            onChange={(e) => set('plazo_dias')(e.target.value)} hasError={errPlazo} errorMessage="De 0 a 180 días"
                            helperText="0 = de contado. Llena solo el vencimiento de sus compras al crédito." />
                    </div>
                    <Interruptor label="Es una empresa relacionada" ayuda="Del mismo grupo (por ejemplo, las farmacias). Se separa en los reportes."
                        checked={!!f.relacionada} onChange={set('relacionada')} />
                    <Interruptor label="Es gran contribuyente" ayuda="Sus Créditos Fiscales pueden traer percepción del 1 %."
                        checked={!!f.gran_contribuyente} onChange={set('gran_contribuyente')} />
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                    <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={!listo} onClick={guardar}>Guardar proveedor</Button>
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
