import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CajaDelKiosco from '../components/timeclock/CajaDelKiosco';
import LiquidSelect from '../components/common/LiquidSelect';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';

/**
 * El kiosco de caja visto desde el portal (pedido del usuario, 2026-11-17:
 * «que la pueda ver desde mi computadora en el portal»). La misma pantalla
 * que el equipo de la sucursal, con la sesión de quien mira: sin carné, sin
 * cuenta regresiva, y la cola sale de las preventas de la sucursal elegida.
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

    return (
        // Dentro del marco del portal (el menú queda a la vista): la pantalla
        // del kiosco ocupa el alto visible y no la ventana entera.
        <div className="flex flex-col min-h-[calc(100dvh-var(--sa-top)-var(--sa-bottom))]">
            {todas && (
                <div className="shrink-0 px-4 py-2 border-b border-border-card flex items-center gap-3">
                    <span className="text-label text-content-3">Sucursal</span>
                    <div className="w-60">
                        <LiquidSelect options={opciones} value={salaUrl} onChange={setSalaUrl} placeholder="Elige la sucursal" />
                    </div>
                </div>
            )}
            {sala ? (
                <CajaDelKiosco key={sala} enPortal sala={sala} nombreSala={nombreSala} ahora={ahora}
                    onSalir={() => navigate('/preventa')} panelMarcador={null}
                    marcadorOcupado={false} feedbackAbierto={false} onMarcadorActivo={() => {}} />
            ) : (
                <p className="m-auto text-body text-content-3">Elige la sucursal.</p>
            )}
        </div>
    );
}
