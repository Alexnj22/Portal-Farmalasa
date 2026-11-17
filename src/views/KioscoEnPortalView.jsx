import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, X } from 'lucide-react';
import CajaDelKiosco from '../components/timeclock/CajaDelKiosco';
import { sesionDeCaja } from '../components/timeclock/sesionDeCaja';
import LiquidSelect from '../components/common/LiquidSelect';
import Button from '../components/common/Button';
import Notice from '../components/common/Notice';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';

/**
 * Vista previa del kiosco de caja desde el portal (pedido del usuario,
 * 2026-11-17: «ver el kiosko como se vería en la caja»). A pantalla completa y
 * con el estilo «Mostrador», igual que en la sucursal: inicio, carné o
 * usuario, cola, Vender y Caja. Lo único distinto: entrar usa la sesión de
 * quien mira (no cambia de cuenta) y terminar no la cierra. La cola sale de
 * las preventas de la sucursal elegida arriba.
 */
export default function KioscoEnPortalView() {
    const navigate = useNavigate();
    const { user, getScope } = useAuth();
    const todas = getScope('preventa') === 'ALL';
    const miSala = user?.branchId ?? user?.branch_id ?? null;
    const branches = useStaff((st) => st.branches);
    const opciones = useMemo(() => (branches || []).filter((b) => b.type === 'FARMACIA')
        .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true }))
        .map((b) => ({ value: String(b.id), label: b.name })), [branches]);
    const [salaUrl, setSalaUrl] = usePestanaEnUrl(opciones, String(miSala ?? opciones[0]?.value ?? ''), 'sala');
    const sala = todas ? Number(salaUrl) || null : miSala;
    const nombreSala = opciones.find((o) => Number(o.value) === Number(sala))?.label ?? '';

    const [ahora, setAhora] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setAhora(Date.now()), 15_000);
        return () => clearInterval(id);
    }, []);

    // El estilo del kiosco de caja (como TimeClockView), y al salir, el del portal.
    useEffect(() => {
        const root = document.documentElement;
        const prevTheme = root.getAttribute('data-theme');
        root.setAttribute('data-theme', 'solid');
        root.setAttribute('data-estilo', 'mostrador');
        sesionDeCaja.abiertaPorCarne = false;
        return () => {
            sesionDeCaja.abiertaPorCarne = false;
            if (prevTheme) root.setAttribute('data-theme', prevTheme);
            else root.removeAttribute('data-theme');
            root.removeAttribute('data-estilo');
        };
    }, []);

    const salir = () => navigate('/preventa');

    return (
        <div className="relative h-[100dvh] w-full flex flex-col overflow-hidden bg-surface-page">
            <div className="shrink-0 px-4 py-1.5 flex items-center gap-3 border-b border-border-card bg-brand/10">
                <Eye size={16} className="text-brand-text" aria-hidden="true" />
                <span className="text-label font-semibold text-content">Vista previa del kiosco de caja</span>
                {todas && (
                    <div className="w-56">
                        <LiquidSelect options={opciones} value={salaUrl} onChange={setSalaUrl} placeholder="Elige la sucursal" size="sm" clearable={false} />
                    </div>
                )}
                <Button variant="ghost" size="sm" icon={X} onClick={salir} className="ml-auto">Salir de la vista previa</Button>
            </div>
            {/* La barra queda fija: lo que se desplaza es la pantalla del kiosco. */}
            <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            {sala ? (
                <CajaDelKiosco key={sala} enPortal sala={sala} nombreSala={nombreSala} ahora={ahora}
                    onSalir={salir} marcadorOcupado={false} feedbackAbierto={false} onMarcadorActivo={() => {}}
                    panelMarcador={<Notice variant="info">En la vista previa no se marca asistencia.</Notice>} />
            ) : (
                <p className="m-auto text-body text-content-3">Elige la sucursal.</p>
            )}
            </div>
        </div>
    );
}
