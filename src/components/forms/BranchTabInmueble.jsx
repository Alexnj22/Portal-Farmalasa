import React from 'react';
import { OPCIONES_DE_EXTINTOR } from '@nucleo/utils/edicionDeSucursal';
import { Building2, Home, Trash2, User, Phone, DollarSign, CalendarDays, Landmark, FileText, AlertCircle, Flame, BugOff, KeyRound } from 'lucide-react';
import { LazyInput, Switch, FileUploader, SeccionDeFormulario, clampInt, formatPhoneMask } from './BranchHelpers';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';
import SegmentedControl from '../common/SegmentedControl';
import Notice from '../common/Notice';
import { EmptyState } from '../common/StateViews';
import { rotuloCampo } from '@nucleo/utils/rotuloDeCampo';
import { fechaTexto } from '@nucleo/utils/fecha';

const safeParse = (obj) => {
    if (typeof obj === 'object' && obj !== null) return obj;
    try { return JSON.parse(obj) || {}; } catch { return {}; }
};

const RotuloFecha = ({ children, tono = 'text-warning-text', icon: Icon = AlertCircle }) => (
    <span className={rotuloCampo(tono)}>
        <span className="flex items-center gap-1.5"><Icon size={12} strokeWidth={3} aria-hidden="true" /> {children}</span>
    </span>
);

const PieDocumento = ({ children }) => <div className="pt-4 border-t border-divider mt-auto">{children}</div>;

// Propio / alquilado es UNA de DOS opciones: `SegmentedControl` (§15.3), no un
// interruptor con un rótulo pintado a cada lado.
const TENENCIA = [
    { value: 'OWNED', label: 'Propio', icon: Home },
    { value: 'RENTED', label: 'Alquilado', icon: KeyRound },
];

const BranchTabInmueble = ({
    isRented, rent, rentContract, legal, setFormData,
    updateNestedSetting, handleContractChange, getTabStatus
}) => {
    // Si tiene inyecciones, los desechos son obligatorios.
    const hasInjections = !!legal.injections;
    const isWasteManagementActive = hasInjections || !!legal.wasteManagement;

    const faltaAlquiler = getTabStatus(3) === 'red';

    const cambiarTenencia = (siguiente) => {
        if (!siguiente || siguiente === (isRented ? 'RENTED' : 'OWNED')) return;
        setFormData(prev => ({
            ...prev,
            propertyType: siguiente,
            settings: {
                ...safeParse(prev.settings),
                propertyType: siguiente,
                rent: siguiente === "RENTED" ? (safeParse(prev.settings)?.rent || { contract: {} }) : null
            }
        }));
    };

    const archivo = (campoArchivo, campoUrl) => (f) => {
        updateNestedSetting('legal', campoArchivo, f);
        if (!f) updateNestedSetting('legal', campoUrl, null);
    };

    return (
        <div className="space-y-4 w-full">

            <SeccionDeFormulario icon={Home} titulo="Inmueble"
                accion={<SegmentedControl size="sm" label="Tenencia del local" options={TENENCIA}
                    value={isRented ? 'RENTED' : 'OWNED'} onChange={cambiarTenencia} />}>
                {isRented ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <LazyInput
                            className="md:col-span-2"
                            label="Arrendante (dueño)"
                            name="suc-arrendante"
                            required
                            hasError={faltaAlquiler && !rent.landlordName}
                            icon={User}
                            placeholder="Ej: Juan Pérez"
                            value={rent.landlordName ?? ""}
                            onChange={(val) => updateNestedSetting('rent', 'landlordName', val)}
                        />
                        <LazyInput
                            label="Teléfono"
                            name="suc-arrendante-telefono"
                            required
                            hasError={faltaAlquiler && !rent.landlordPhone}
                            icon={Phone}
                            inputMode="tel"
                            placeholder="2300-0000"
                            pattern="[0-9]{4}-[0-9]{4}"
                            value={rent.landlordPhone ?? ""}
                            onChange={(val) => updateNestedSetting('rent', 'landlordPhone', formatPhoneMask(val))}
                            maxLength={9}
                        />
                        <LazyInput
                            label="Mensualidad"
                            name="suc-mensualidad"
                            required
                            hasError={faltaAlquiler && !rent.amount}
                            inputMode="decimal"
                            maskType="DECIMAL"
                            icon={DollarSign}
                            placeholder="0.00"
                            inputClassName="tabular-nums"
                            value={rent.amount ?? ""}
                            onChange={(val) => updateNestedSetting('rent', 'amount', val === "" ? null : Number(val))}
                        />
                        <div>
                            <span className={rotuloCampo('text-content-3')}>Inicio del contrato</span>
                            <LiquidDatePicker hasError={faltaAlquiler && !rentContract.startDate}
                                value={rentContract.startDate ?? ""}
                                onChange={(val) => handleContractChange('startDate', val || null)}
                            />
                        </div>
                        <LazyInput
                            label="Vigencia (meses)"
                            name="suc-vigencia"
                            required
                            hasError={faltaAlquiler && !rentContract.termMonths}
                            inputMode="numeric"
                            icon={CalendarDays}
                            placeholder="Ej: 12"
                            value={rentContract.termMonths ?? ""}
                            onChange={(val) => handleContractChange('termMonths', val === "" ? null : clampInt(val, 1, 240))}
                        />

                        {rentContract.endDate && (
                            <Notice variant="warning" icon={AlertCircle} className="md:col-span-2">
                                El contrato vence el {fechaTexto(rentContract.endDate)}
                            </Notice>
                        )}

                        <div className="md:col-span-2 pt-4 border-t border-divider">
                            <FileUploader
                                label="Contrato de arrendamiento (PDF)"
                                file={rentContract.documentFile}
                                url={rentContract.documentUrl}
                                onChange={(f) => {
                                    handleContractChange('documentFile', f);
                                    if (!f) handleContractChange('documentUrl', null);
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <EmptyState linea icon={Building2} title="Local propio: sin datos de alquiler" />
                )}
            </SeccionDeFormulario>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SeccionDeFormulario icon={Landmark} titulo="Permisos municipales">
                    <LazyInput
                        label="Nº de cuenta municipal"
                        name="suc-cuenta-municipal"
                        icon={FileText}
                        placeholder="Ej: 12345-A"
                        value={legal.municipalAccount || ""}
                        onChange={(val) => updateNestedSetting('legal', 'municipalAccount', val)}
                    />
                    <div>
                        <RotuloFecha>Próxima renovación o pago</RotuloFecha>
                        <LiquidDatePicker tono="warning"
                            value={legal.municipalExpiration || ""}
                            onChange={(val) => updateNestedSetting('legal', 'municipalExpiration', val)}
                        />
                    </div>
                    <PieDocumento>
                        <FileUploader label="Solvencia municipal (PDF)" file={legal.municipalFile} url={legal.municipalUrl}
                            onChange={archivo('municipalFile', 'municipalUrl')} />
                    </PieDocumento>
                </SeccionDeFormulario>

                <SeccionDeFormulario icon={Trash2} titulo="Desechos bioinfecciosos" tono="danger"
                    subtitulo={hasInjections ? 'Obligatorio: la sucursal aplica inyecciones' : undefined}
                    accion={<Switch label="Desechos bioinfecciosos"
                        on={isWasteManagementActive}
                        disabled={hasInjections}
                        onToggle={() => { if (!hasInjections) updateNestedSetting('legal', 'wasteManagement', !legal.wasteManagement); }} />}>
                    {isWasteManagementActive ? (
                        <>
                            <div>
                                <RotuloFecha>Vencimiento del contrato</RotuloFecha>
                                <LiquidDatePicker tono="warning"
                                    value={legal.wasteExpiration || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'wasteExpiration', val)}
                                />
                            </div>
                            <PieDocumento>
                                <FileUploader label="Contrato de desechos (PDF)" file={legal.wasteFile} url={legal.wasteUrl}
                                    onChange={archivo('wasteFile', 'wasteUrl')} />
                            </PieDocumento>
                        </>
                    ) : <EmptyState linea icon={Trash2} title="Desactivado" />}
                </SeccionDeFormulario>

                <SeccionDeFormulario icon={Flame} titulo="Extintores" tono="chart-4">
                    <div className="grid grid-cols-1 gap-4">
                        <LazyInput
                            label="Cantidad"
                            name="suc-extintores"
                            inputMode="numeric"
                            placeholder="Ej: 2"
                            value={legal.extinguisherCount ?? ""}
                            onChange={(val) => updateNestedSetting('legal', 'extinguisherCount', val ? clampInt(val, 0, 99) : null)}
                        />
                        <div>
                            <span id="suc-extintor-tipo" className={rotuloCampo('text-content-3')}>Tipo principal</span>
                            <LiquidSelect
                                ariaLabelledBy="suc-extintor-tipo"
                                value={legal.extinguisherType || ""}
                                onChange={(val) => updateNestedSetting('legal', 'extinguisherType', val)}
                                options={OPCIONES_DE_EXTINTOR}
                                placeholder="Elegir tipo"
                                clearLabel="Ninguno"
                            />
                        </div>
                    </div>
                    <div>
                        <RotuloFecha>Vencimiento de la recarga</RotuloFecha>
                        <LiquidDatePicker tono="warning"
                            value={legal.extinguisherExpiration || ""}
                            onChange={(val) => updateNestedSetting('legal', 'extinguisherExpiration', val)}
                        />
                    </div>
                </SeccionDeFormulario>

                <SeccionDeFormulario icon={BugOff} titulo="Control de plagas" tono="success">
                    <LazyInput
                        label="Empresa proveedora"
                        name="suc-fumigadora"
                        icon={Building2}
                        placeholder="Nombre de la empresa"
                        value={legal.pestControlCompany || ""}
                        onChange={(val) => updateNestedSetting('legal', 'pestControlCompany', val)}
                    />
                    <div>
                        <RotuloFecha tono="text-content-3" icon={CalendarDays}>Última fumigación</RotuloFecha>
                        <LiquidDatePicker
                            value={legal.lastFumigationDate || ""}
                            onChange={(val) => updateNestedSetting('legal', 'lastFumigationDate', val)}
                        />
                    </div>
                    <PieDocumento>
                        <FileUploader label="Certificado de fumigación (PDF)" file={legal.fumigationFile} url={legal.fumigationUrl}
                            onChange={archivo('fumigationFile', 'fumigationUrl')} />
                    </PieDocumento>
                </SeccionDeFormulario>
            </div>
        </div>
    );
};

export default React.memo(BranchTabInmueble);
