import React, { useMemo } from 'react';
import Badge from '../common/Badge';
import { ShieldCheck, FileBadge, ShieldAlert, FileWarning, Syringe, AlertCircle } from 'lucide-react';
import { LazyInput, Switch, FileUploader } from './BranchHelpers';
import LiquidDatePicker from '../common/LiquidDatePicker';
import LiquidSelect from '../common/LiquidSelect';
import Button from '../common/Button';

const BranchTabLegal = ({
    legal, updateNestedSetting, availableRegents,
    availablePharmacovigilance, availableNurses, toggleNurse
}) => {

    // 🚨 GPU LOCK: Mantenemos el scroll a 60 FPS
    const gpuLockStyle = {
        transform: 'translateZ(0)',
        WebkitBackfaceVisibility: 'hidden',
        backfaceVisibility: 'hidden',
        willChange: 'transform'
    };

    // 🚨 ESTILOS LIQUID GLASS
    const islandClass = "bg-surface-card rounded-modal p-6 border border-border-card shadow-[var(--shadow-elevation-xs)] flex flex-col h-full";
    const islandHoverClass = "transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] hover:translate-y-[var(--lift-card)] hover:shadow-[var(--shadow-elevation-sm)] hover:bg-surface-card hover:border-border-card";
    const inputHoverClass = "transition-[box-shadow,border-color] duration-300 hover:shadow-md hover:border-brand/30 focus-within:ring-4 focus-within:ring-brand/10";

    const regentOptions = useMemo(() =>
        availableRegents.map(e => ({ value: e.id, label: e.name }))
        , [availableRegents]);

    const pharmaOptions = useMemo(() =>
        availablePharmacovigilance.map(e => ({ value: e.id, label: e.name }))
        , [availablePharmacovigilance]);

    return (
        <div className="space-y-6 w-full" style={gpuLockStyle}>

            {/* 🚨 GRID PRINCIPAL: 2 COLUMNAS (Para las 4 tarjetas operativas) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">

                {/* ISLA 1: LICENCIA SRS */}
                <div className={`${islandClass} ${islandHoverClass}`} style={gpuLockStyle}>
                    <h4 className="text-body font-black uppercase tracking-widest text-brand-text mb-5 flex items-center gap-2">
                        <ShieldCheck size={18} strokeWidth={2.5} /> Licencia de Funcionamiento (CSSP/DNM)
                    </h4>
                    {/* 🚨 CONTENIDO EN 1 COLUMNA (flex-col) */}
                    <div className="flex flex-col flex-1 gap-4">
                        <div>
                            <label className="text-caption font-black uppercase text-content-3 ml-1 mb-2 block">Número de Resolución</label>
                            <LazyInput
                                placeholder="Ej: SRS-2024-001"
                                value={legal.srsPermit || ""}
                                onChange={(val) => updateNestedSetting('legal', 'srsPermit', val)}
                                className={`!bg-surface-card shadow-sm h-[42px] text-body border-divider ${inputHoverClass}`}
                            />
                        </div>
                        <div className="relative focus-within:z-sidebar">
                            <label className="text-caption font-black uppercase text-warning ml-1 mb-2 block flex items-center gap-1.5">
                                <AlertCircle size={12} strokeWidth={3} /> Vencimiento de Licencia
                            </label>
                            <div className={`bg-warning/10 rounded-2xl border border-warning/30 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                <LiquidDatePicker
                                    value={legal.srsExpiration || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'srsExpiration', val)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>
                        {/* mt-auto empuja el uploader siempre al fondo de la tarjeta */}
                        <div className="pt-4 border-t border-divider mt-auto">
                            <FileUploader
                                label="Documento Físico Licencia (PDF)"
                                file={legal.srsPermitFile}
                                url={legal.srsPermitUrl}
                                onChange={(f) => {
                                    updateNestedSetting('legal', 'srsPermitFile', f);
                                    if (!f) updateNestedSetting('legal', 'srsPermitUrl', null);
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* ISLA 2: REGENCIA FARMACÉUTICA */}
                <div className={`${islandClass} ${islandHoverClass}`} style={gpuLockStyle}>
                    <h4 className="text-body font-black uppercase tracking-widest text-brand-text mb-5 flex items-center gap-2">
                        <FileBadge size={18} strokeWidth={2.5} /> Regencia Farmacéutica
                    </h4>
                    <div className="flex flex-col flex-1 gap-4">
                        <div className="relative focus-within:z-sidebar">
                            <label className="text-caption font-black uppercase text-content-3 ml-1 mb-2 block flex items-center justify-between">
                                Regente Asignado
                                {availableRegents.length === 0 && <Badge variant="warning" size="sm" uppercase={false}>Sin personal</Badge>}
                            </label>
                            <LiquidSelect
                                value={legal.regentEmployeeId || ""}
                                onChange={(val) => updateNestedSetting('legal', 'regentEmployeeId', val)}
                                options={regentOptions}
                                placeholder="-- Seleccionar --"
                            />
                        </div>
                        <div className="relative focus-within:z-sidebar">
                            <label className="text-caption font-black uppercase text-warning ml-1 mb-2 block flex items-center gap-1.5">
                                <AlertCircle size={12} strokeWidth={3} /> Vencimiento Credencial
                            </label>
                            <div className={`bg-warning/10 rounded-2xl border border-warning/30 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                <LiquidDatePicker
                                    value={legal.regentCredentialExp || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'regentCredentialExp', val)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>
                        <div className="pt-4 border-t border-divider mt-auto">
                            <FileUploader
                                label="Contrato de Regencia (PDF)"
                                file={legal.regentCredentialFile}
                                url={legal.regentCredentialUrl}
                                onChange={(f) => {
                                    updateNestedSetting('legal', 'regentCredentialFile', f);
                                    if (!f) updateNestedSetting('legal', 'regentCredentialUrl', null);
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* ISLA 3: FARMACOVIGILANCIA */}
                <div className={`${islandClass} ${islandHoverClass}`} style={gpuLockStyle}>
                    <h4 className="text-body font-black uppercase tracking-widest text-brand-text mb-5 flex items-center gap-2">
                        <ShieldAlert size={18} strokeWidth={2.5} /> Referente de Farmacovigilancia
                    </h4>
                    <div className="flex flex-col flex-1 gap-4">
                        <div className="relative focus-within:z-sidebar">
                            <label className="text-caption font-black uppercase text-content-3 ml-1 mb-2 block flex items-center justify-between">
                                Referente Asignado
                                {availablePharmacovigilance.length === 0 && <Badge variant="warning" size="sm" uppercase={false}>Sin personal</Badge>}
                            </label>
                            <LiquidSelect
                                value={legal.pharmacovigilanceEmployeeId || ""}
                                onChange={(val) => updateNestedSetting('legal', 'pharmacovigilanceEmployeeId', val)}
                                options={pharmaOptions}
                                placeholder="-- Seleccionar --"
                            />
                        </div>
                        <div className="relative focus-within:z-sidebar">
                            <label className="text-caption font-black uppercase text-warning ml-1 mb-2 block flex items-center gap-1.5">
                                <AlertCircle size={12} strokeWidth={3} /> Vencimiento Credencial
                            </label>
                            <div className={`bg-warning/10 rounded-2xl border border-warning/30 shadow-sm flex items-center h-[42px] px-1 relative ${inputHoverClass}`}>
                                <LiquidDatePicker
                                    value={legal.pharmacovigilanceExp || ""}
                                    onChange={(val) => updateNestedSetting('legal', 'pharmacovigilanceExp', val)}
                                    placeholder="DD/MM/AAAA"
                                />
                            </div>
                        </div>
                        <div className="pt-4 border-t border-divider mt-auto">
                            <FileUploader
                                label="Contrato / Designación (PDF)"
                                file={legal.farmacovigilanciaAuthFile}
                                url={legal.farmacovigilanciaAuthUrl}
                                onChange={(f) => {
                                    updateNestedSetting('legal', 'farmacovigilanciaAuthFile', f);
                                    if (!f) updateNestedSetting('legal', 'farmacovigilanciaAuthUrl', null);
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* ISLA 4: ÁREA DE INYECTABLES */}
                <div className={`${islandClass} ${islandHoverClass}`} style={gpuLockStyle}>
                    <div className="flex items-center justify-between mb-5">
                        <h4 className="text-body font-black uppercase tracking-widest text-brand-text flex items-center gap-2">
                            <Syringe size={18} strokeWidth={2.5} /> Área Inyectables
                        </h4>
                        <Switch label="Aplica inyecciones" on={legal.injections || false} onToggle={() => updateNestedSetting('legal', 'injections', !legal.injections)} />
                    </div>
                    {legal.injections ? (
                        <div className="flex flex-col flex-1 gap-4">
                            <div>
                                <label className="text-caption font-black uppercase text-content-3 ml-1 mb-2 block">Enfermeros Autorizados</label>
                                {availableNurses.length === 0 ? (
                                    <p className="text-warning text-caption font-bold p-3 bg-warning/10 rounded-2xl border border-warning/30 text-center shadow-sm">No hay personal de enfermería registrado en esta sucursal.</p>
                                ) : (
                                    <div data-surface="card" className="flex flex-wrap gap-2 p-3.5 max-h-[100px] overflow-y-auto custom-scrollbar">
                                        {availableNurses.map(emp => {
                                            const isSelected = (legal.nurses || []).includes(emp.id);
                                            return (
                                                <Button
                                                    size="sm"
                                                    tone="chart-9"
                                                    key={emp.id}
                                                    type="button"
                                                    onClick={() => toggleNurse(emp.id)}
                                                >{emp.name.split(' ')[0]} {isSelected && '✓'}</Button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <div className="pt-4 border-t border-divider mt-auto">
                                <FileUploader
                                    label="Permiso de Área (PDF)"
                                    file={legal.nursingServicePermitFile}
                                    url={legal.nursingServicePermitUrl}
                                    onChange={(f) => {
                                        updateNestedSetting('legal', 'nursingServicePermitFile', f);
                                        if (!f) updateNestedSetting('legal', 'nursingServicePermitUrl', null);
                                    }}
                                />
                            </div>
                        </div>
                    ) : (
                        <div data-surface="card" className="flex-1 flex items-center justify-center py-8 text-center border-2 border-dashed">
                            <p className="text-content-2 font-bold text-caption uppercase tracking-widest flex items-center gap-1.5">
                                <AlertCircle size={14} /> Módulo Desactivado
                            </p>
                        </div>
                    )}
                </div>

            </div>

            {/* 🚨 BLOQUE FINAL (FULL WIDTH / 1 COLUMNA): LIBROS CONTROLADOS */}
            <div className={`${islandClass} ${islandHoverClass}`} style={gpuLockStyle}>
                <div className="flex items-center justify-between mb-5">
                    <h4 className="text-body font-black uppercase tracking-widest text-brand-text flex items-center gap-2">
                        <FileWarning size={18} strokeWidth={2.5} /> Libros Controlados
                    </h4>
                    <Switch label="Libros controlados" on={legal.controlledBooks || false} onToggle={() => updateNestedSetting('legal', 'controlledBooks', !legal.controlledBooks)} />
                </div>
                {legal.controlledBooks ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
                        <div>
                            <label className="text-caption font-black uppercase text-content-3 ml-1 mb-2 block">Nº Resolución Autorización</label>
                            <LazyInput
                                placeholder="Ej: RES-LIB-2025"
                                value={legal.controlledBooksRes || ""}
                                onChange={(val) => updateNestedSetting('legal', 'controlledBooksRes', val)}
                                className={`!bg-surface-card shadow-sm h-[42px] text-body border-divider ${inputHoverClass}`}
                            />
                        </div>
                        <div className="pt-2 md:pt-0">
                            <FileUploader
                                label="Resolución de Libros (PDF)"
                                file={legal.controlledBooksFile}
                                url={legal.controlledBooksUrl}
                                onChange={(f) => {
                                    updateNestedSetting('legal', 'controlledBooksFile', f);
                                    if (!f) updateNestedSetting('legal', 'controlledBooksUrl', null);
                                }}
                            />
                        </div>
                    </div>
                ) : (
                    <div data-surface="card" className="py-8 text-center border-2 border-dashed animate-in fade-in duration-300">
                        <p className="text-content-2 font-bold text-caption uppercase tracking-widest flex items-center justify-center gap-1.5">
                            <AlertCircle size={14} /> Módulo Desactivado
                        </p>
                    </div>
                )}
            </div>

        </div>
    );
};

export default React.memo(BranchTabLegal);