import React from 'react';
import { ShieldCheck, FileBadge, ShieldAlert, FileWarning, Syringe, AlertCircle } from 'lucide-react';
import { LazyInput, Switch, FileUploader } from './BranchHelpers';

const BranchTabLegal = ({ 
    legal, updateNestedSetting, availableRegents, 
    availablePharmacovigilance, availableNurses, toggleNurse 
}) => {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-200">
                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800 mb-4 flex items-center gap-2">
                    <ShieldCheck size={16} className="text-slate-800"/> Licencia de Funcionamiento (SRS)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-2 block">Número de Resolución</label>
                        <LazyInput placeholder="Ej: SRS-2024-001" value={legal.srsPermit || ""} onChange={(val) => updateNestedSetting('legal', 'srsPermit', val)} className="w-full py-3 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-bold" />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-2 block text-amber-600">🔔 Vencimiento de Licencia</label>
                        <LazyInput type="date" value={legal.srsExpiration || ""} onChange={(val) => updateNestedSetting('legal', 'srsExpiration', val)} className="w-full py-3 rounded-[1rem] bg-white border border-amber-200 outline-none focus:border-[#007AFF] font-bold text-amber-900" />
                    </div>
                    <div className="md:col-span-2">
                        <FileUploader label="Documento Físico Licencia (PDF)" file={legal.srsFile} url={legal.srsUrl} onChange={(f) => updateNestedSetting('legal', 'srsFile', f)} />
                    </div>
                </div>
            </div>

            <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-200">
                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800 mb-4 flex items-center gap-2">
                    <FileBadge size={16} className="text-slate-800"/> Regencia Farmacéutica
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-2 block">Regente Asignado (JVQF)</label>
                        <select 
                            value={legal.regentEmployeeId || ""} 
                            onChange={(e) => updateNestedSetting('legal', 'regentEmployeeId', e.target.value)} 
                            className="w-full px-4 py-3 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-bold text-slate-700 cursor-pointer"
                        >
                            <option value="">-- Sin asignar --</option>
                            {availableRegents.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        {availableRegents.length === 0 && (
                            <p className="text-amber-500 text-[9px] font-bold mt-1.5 flex items-center gap-1">
                                <AlertCircle size={10}/> No hay empleados con cargo "Regente" creados.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-2 block text-amber-600">🔔 Vencimiento Credencial JVQF</label>
                        <LazyInput type="date" value={legal.regentCredentialExp || ""} onChange={(val) => updateNestedSetting('legal', 'regentCredentialExp', val)} className="w-full py-3 rounded-[1rem] bg-white border border-amber-200 outline-none focus:border-[#007AFF] font-bold text-amber-900" />
                    </div>
                    <div className="md:col-span-2">
                        <FileUploader label="Contrato de Regencia (PDF)" file={legal.regentContractFile} url={legal.regentContractUrl} onChange={(f) => updateNestedSetting('legal', 'regentContractFile', f)} />
                    </div>
                </div>
            </div>

            <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-200">
                <h4 className="text-[12px] font-black uppercase tracking-widest text-slate-800 mb-4 flex items-center gap-2">
                    <ShieldAlert size={16} className="text-slate-800"/> Referente de Farmacovigilancia
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-2 block">Referente Asignado (DNM)</label>
                        <select 
                            value={legal.pharmacovigilanceEmployeeId || ""} 
                            onChange={(e) => updateNestedSetting('legal', 'pharmacovigilanceEmployeeId', e.target.value)} 
                            className="w-full px-4 py-3 rounded-[1rem] bg-white border border-slate-200 outline-none focus:border-[#007AFF] font-bold text-slate-700 cursor-pointer"
                        >
                            <option value="">-- Sin asignar --</option>
                            {availablePharmacovigilance.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        {availablePharmacovigilance.length === 0 && (
                            <p className="text-amber-500 text-[9px] font-bold mt-1.5 flex items-center gap-1">
                                <AlertCircle size={10}/> No hay empleados con cargo "Farmacovigilancia" creados.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-slate-500 ml-1 mb-2 block text-amber-600">🔔 Vencimiento Credencial</label>
                        <LazyInput type="date" value={legal.pharmacovigilanceExp || ""} onChange={(val) => updateNestedSetting('legal', 'pharmacovigilanceExp', val)} className="w-full py-3 rounded-[1rem] bg-white border border-amber-200 outline-none focus:border-[#007AFF] font-bold text-amber-900" />
                    </div>
                    <div className="md:col-span-2">
                        <FileUploader label="Contrato / Designación (PDF)" file={legal.pharmacovigilanceFile} url={legal.pharmacovigilanceUrl} onChange={(f) => updateNestedSetting('legal', 'pharmacovigilanceFile', f)} />
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                            <FileWarning size={14} className="text-slate-800"/> Libros Controlados
                        </h4>
                        <Switch on={legal.controlledBooks || false} onToggle={() => updateNestedSetting('legal', 'controlledBooks', !legal.controlledBooks)} />
                    </div>
                    {legal.controlledBooks && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95">
                            <div>
                                <label className="text-[9px] font-black uppercase text-slate-500 ml-1 mb-1.5 block">Nº Resolución Autorización</label>
                                <LazyInput placeholder="RES-..." value={legal.controlledBooksRes || ""} onChange={(val) => updateNestedSetting('legal', 'controlledBooksRes', val)} className="w-full py-2 rounded-xl bg-white border border-slate-200 font-semibold text-sm outline-none focus:border-[#007AFF]" />
                            </div>
                            <FileUploader label="Resolución (PDF)" file={legal.controlledBooksFile} url={legal.controlledBooksUrl} onChange={(f) => updateNestedSetting('legal', 'controlledBooksFile', f)} />
                        </div>
                    )}
                </div>

                <div className="bg-slate-50 p-5 rounded-[1.5rem] border border-slate-200">
                    <div className="flex items-center justify-between mb-4">
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-2">
                            <Syringe size={14} className="text-slate-800"/> Área Inyectables
                        </h4>
                        <Switch on={legal.injections || false} onToggle={() => updateNestedSetting('legal', 'injections', !legal.injections)} />
                    </div>
                    {legal.injections && (
                        <div className="space-y-4 animate-in fade-in zoom-in-95">
                            <div>
                                <label className="text-[9px] font-black uppercase text-slate-500 ml-1 mb-1.5 block">Enfermeros Autorizados</label>
                                {availableNurses.length === 0 ? (
                                    <p className="text-amber-600 text-[10px] font-bold p-2 bg-amber-50 rounded-xl border border-amber-200">No hay personal de enfermería en el sistema.</p>
                                ) : (
                                    <div className="flex flex-wrap gap-2 bg-white p-3 rounded-xl border border-slate-200 max-h-32 overflow-y-auto">
                                        {availableNurses.map(emp => {
                                            const isSelected = (legal.nurses || []).includes(emp.id);
                                            return (
                                                <button key={emp.id} type="button" onClick={() => toggleNurse(emp.id)} className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${isSelected ? 'bg-cyan-100 text-cyan-700 border border-cyan-300' : 'bg-slate-100 text-slate-500 border border-transparent hover:bg-slate-200'}`}>
                                                    {emp.name.split(' ')[0]} {isSelected && '✓'}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <FileUploader label="Permiso de Área (PDF)" file={legal.injectionsFile} url={legal.injectionsUrl} onChange={(f) => updateNestedSetting('legal', 'injectionsFile', f)} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BranchTabLegal;