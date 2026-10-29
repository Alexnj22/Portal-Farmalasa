import React from 'react';
import { Zap, Droplet, Wifi, Smartphone, CalendarDays } from 'lucide-react';
import { LazyInput, SeccionDeFormulario, clampInt } from './BranchHelpers';
import LiquidDatePicker from '../common/LiquidDatePicker';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';

// El tono de cada servicio sale de la paleta cerrada (§6.0) por la ranura
// `tono` de la sección; antes cada uno traía su par de clases escritas a mano.
const SERVICIOS = [
    { id: 'light', icon: Zap, label: 'Energía eléctrica', placeholder: 'Ej: CAESS', accountLabel: 'Nº de NIC / NPE', tono: 'warning' },
    { id: 'water', icon: Droplet, label: 'Agua potable', placeholder: 'Ej: ANDA', accountLabel: 'Nº de cuenta', tono: 'chart-9' },
    { id: 'internet', icon: Wifi, label: 'Internet fijo', placeholder: 'Ej: Tigo / Claro', accountLabel: 'Nº de contrato o teléfono', tono: 'brand' },
    { id: 'mobile', icon: Smartphone, label: 'Telefonía móvil (flota)', placeholder: 'Ej: Claro', accountLabel: 'Nº de teléfono', tono: 'chart-3' },
];

const BranchTabServicios = ({ services, updateServiceField }) => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 w-full">
        {SERVICIOS.map((srv) => (
            <SeccionDeFormulario key={srv.id} icon={srv.icon} titulo={srv.label} tono={srv.tono}>
                <LazyInput
                    label="Proveedor"
                    name={`suc-${srv.id}-proveedor`}
                    placeholder={srv.placeholder}
                    value={services[srv.id]?.provider || ""}
                    onChange={(val) => updateServiceField(srv.id, 'provider', val)}
                />
                <LazyInput
                    label={srv.accountLabel}
                    name={`suc-${srv.id}-cuenta`}
                    inputClassName="tabular-nums"
                    value={services[srv.id]?.account || ""}
                    onChange={(val) => updateServiceField(srv.id, 'account', val)}
                />
                <div className="grid grid-cols-1 gap-4">
                    <LazyInput
                        label="Día de pago (1-31)"
                        name={`suc-${srv.id}-dia`}
                        inputMode="numeric"
                        placeholder="Ej: 15"
                        value={services[srv.id]?.dueDay ?? ""}
                        onChange={(val) => updateServiceField(srv.id, 'dueDay', clampInt(val, 1, 31))}
                    />
                    <div>
                        <span className={rotuloCampo('text-success-text')}>
                            <span className="flex items-center gap-1.5"><CalendarDays size={12} strokeWidth={2.5} aria-hidden="true" /> Último mes pagado</span>
                        </span>
                        <LiquidDatePicker tono="success"
                            mode="month"
                            value={services[srv.id]?.paidThrough || ""}
                            onChange={(val) => updateServiceField(srv.id, 'paidThrough', val)}
                        />
                    </div>
                </div>
            </SeccionDeFormulario>
        ))}
    </div>
);

export default React.memo(BranchTabServicios);
