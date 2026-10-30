import React, { useMemo, useState } from 'react';
import { UserRound } from 'lucide-react';
import LiquidModal from '../common/LiquidModal';
import SegmentedControl from '../common/SegmentedControl';
import Button from '../common/Button';
import { gruposDeNombre } from '@nucleo/utils/nameUtils';
import { elegirNombreEnElPortal } from '@nucleo/data/employeeSelfService';
import { useStaffStore } from '@nucleo/store/staffStore';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

/**
 * Cuál de sus nombres y cuál de sus apellidos usa la persona en el portal.
 *
 * Pedido del usuario (2026-10-30): «cuando vuelvan a entrar al portal, que les
 * pregunte qué nombre y qué apellido quieren usar, así el portal muestra esos
 * siempre en todos lados». Tres decisiones suyas:
 *   · se elige entre los PROPIOS nombres de la ficha, no se escribe un apodo;
 *   · la primera vez es obligatoria (`obligatorio`): no hay cerrar, pero ya
 *     viene marcado el de siempre, así que confirmar es un toque;
 *   · después se cambia desde Mi perfil, con este mismo diálogo.
 *
 * El nombre legal no cambia: planilla, CSV, contratos y PDF lo siguen usando
 * completo.
 */
export default function ElegirNombreDialog({ empleado, open, onClose, obligatorio = false }) {
    // Montado sólo abierto: así cada apertura arranca de lo que la ficha dice hoy.
    if (!open || !empleado) return null;
    return <Dialogo empleado={empleado} onClose={onClose} obligatorio={obligatorio} />;
}

const enLista = (lista, valor) => lista.find(x => x.toUpperCase() === String(valor || '').toUpperCase());

function Dialogo({ empleado, onClose, obligatorio }) {
    const nombres = useMemo(() => gruposDeNombre(empleado.first_names), [empleado.first_names]);
    const apellidos = useMemo(() => gruposDeNombre(empleado.last_names), [empleado.last_names]);
    // Lo que ya eligió, o el primero de cada uno.
    const [nombre, setNombre] = useState(() => enLista(nombres, empleado.nombre_preferido) || nombres[0] || '');
    const [apellido, setApellido] = useState(() => enLista(apellidos, empleado.apellido_preferido) || apellidos[0] || '');
    const [guardando, setGuardando] = useState(false);

    const guardar = async () => {
        setGuardando(true);
        const { data, error } = await elegirNombreEnElPortal(nombre, apellido);
        setGuardando(false);
        if (error) {
            useToastStore.getState().showToast('No se pudo guardar', mensajeAmigable(error), 'error');
            return;
        }
        useStaffStore.getState().setEmployees(lista => lista.map(e =>
            String(e.id) === String(empleado.id) ? { ...e, ...data } : e));
        useStaffStore.getState().appendAuditLog?.('ELEGIR_NOMBRE_EN_EL_PORTAL', empleado.id,
            { nombre_preferido: data?.nombre_preferido, apellido_preferido: data?.apellido_preferido });
        onClose?.();
    };

    const opciones = (lista) => lista.map(x => ({ value: x, label: x }));
    const columnas = (lista) => (lista.length >= 3 ? 3 : 2);

    return (
        <LiquidModal open onClose={obligatorio ? undefined : onClose} soloConBoton={obligatorio}
            maxWidth="max-w-md" ariaLabel="Cómo quieres que aparezca tu nombre">
            <LiquidModal.Header icono={UserRound} tono="brand"
                titulo="¿Cómo quieres que aparezca tu nombre?"
                subtitulo="Elige uno de tus nombres y uno de tus apellidos."
                onClose={obligatorio ? undefined : onClose} />
            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    {nombres.length > 1 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-label font-bold text-content-2">Tu nombre</p>
                            <SegmentedControl layout="block" columns={columnas(nombres)} label="Tu nombre"
                                options={opciones(nombres)} value={nombre} onChange={setNombre} />
                        </div>
                    )}
                    {apellidos.length > 1 && (
                        <div className="flex flex-col gap-2">
                            <p className="text-label font-bold text-content-2">Tu apellido</p>
                            <SegmentedControl layout="block" columns={columnas(apellidos)} label="Tu apellido"
                                options={opciones(apellidos)} value={apellido} onChange={setApellido} />
                        </div>
                    )}
                    <div className="rounded-card border border-border-card bg-surface-card-hover px-4 py-3">
                        <p className="text-micro font-bold uppercase tracking-wider text-content-3">Así te verán en el portal</p>
                        <p className="text-title-sm font-black text-content mt-1">{`${nombre} ${apellido}`.trim()}</p>
                    </div>
                    <p className="text-caption text-content-3">
                        Tu nombre completo no cambia: planilla, contratos y documentos lo siguen usando. Puedes cambiar esto cuando quieras desde Mi perfil.
                    </p>
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                {obligatorio ? <span aria-hidden /> : <Button variant="secondary" onClick={onClose}>Cancelar</Button>}
                <Button onClick={guardar} loading={guardando} disabled={!nombre || !apellido}>Guardar</Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
