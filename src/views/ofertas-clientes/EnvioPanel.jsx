import React, { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import Switch from '../../components/common/Switch';
import { SkeletonText } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fetchAjustesEnvio, guardarAjustesEnvio } from '@nucleo/data/reservas';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';

// ═══════════════════════════════════════════════════════════════════════════
// Entrega a domicilio de la app (2026-10-07): si se ofrece, cuánto cuesta y
// desde qué monto es gratis. La app lo lee al abrir el carrito; el servidor
// vuelve a calcular el envío al reservar, así que lo que se guarda acá es lo
// que se cobra.
// ═══════════════════════════════════════════════════════════════════════════

export default function EnvioPanel({ puedeEditar, showToast }) {
    const { user } = useAuth();
    const appendAuditLog = useStaff((st) => st.appendAuditLog);
    const [cfg, setCfg] = useState(null);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        fetchAjustesEnvio().then((d) => setCfg({
            activo: !!d?.envio_activo, costo: String(d?.envio_costo ?? ''), gratisDesde: d?.envio_gratis_desde == null ? '' : String(d.envio_gratis_desde), nota: d?.envio_nota ?? '',
        })).catch((err) => { console.error('EnvioPanel', err); setCfg({ activo: false, costo: '', gratisDesde: '', nota: '' }); });
    }, []);

    if (!cfg) return <SkeletonText lines={2} />;
    const costo = Number(cfg.costo);
    const valido = cfg.costo !== '' && costo >= 0 && (cfg.gratisDesde === '' || Number(cfg.gratisDesde) > 0);

    const guardar = async () => {
        setGuardando(true);
        try {
            await guardarAjustesEnvio(cfg, user?.id);
            appendAuditLog?.('APP_ENVIO_AJUSTES', null, { activo: cfg.activo, costo, gratis_desde: cfg.gratisDesde || null })?.catch?.(() => {});
            showToast('Envío guardado', cfg.activo ? `Envío ${formatMoney(costo)}${cfg.gratisDesde ? `, gratis desde ${formatMoney(Number(cfg.gratisDesde))}` : ''}.` : 'La app ya no ofrece entrega a domicilio.', 'success');
        } catch (err) {
            showToast('No se pudo guardar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <section className="rounded-xl border border-border-subtle p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Truck className="h-5 w-5 text-content-2" aria-hidden />
                    <h3 className="text-body font-semibold text-content">Entrega a domicilio</h3>
                </div>
                <Switch checked={cfg.activo} disabled={!puedeEditar} onChange={(v) => setCfg((x) => ({ ...x, activo: v }))} label="Ofrecer entrega a domicilio en la app" />
            </div>
            {cfg.activo && (
                <div className="grid gap-3 sm:grid-cols-2">
                    <PortalInput label="Costo del envío ($)" type="text" inputMode="decimal" maskType="DECIMAL" value={cfg.costo} readOnly={!puedeEditar}
                        onChange={(e) => setCfg((x) => ({ ...x, costo: e.target.value }))} />
                    <PortalInput label="Gratis desde ($, opcional)" type="text" inputMode="decimal" maskType="DECIMAL" value={cfg.gratisDesde} readOnly={!puedeEditar}
                        onChange={(e) => setCfg((x) => ({ ...x, gratisDesde: e.target.value }))} />
                    <div className="sm:col-span-2">
                        <PortalTextarea label="Nota que ve el cliente" rows={2} maxLength={200} value={cfg.nota} readOnly={!puedeEditar}
                            onChange={(e) => setCfg((x) => ({ ...x, nota: e.target.value }))} />
                    </div>
                </div>
            )}
            {puedeEditar && (
                <div className="flex justify-end">
                    <Button size="sm" disabled={!valido} loading={guardando} onClick={guardar}>Guardar</Button>
                </div>
            )}
        </section>
    );
}
