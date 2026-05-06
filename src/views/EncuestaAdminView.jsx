import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    PenLine, Plus, Trash2, Users, UserCheck, Save, ChevronDown, ChevronUp,
    Check, X, ArrowLeft, Building2, Loader2, BarChart2, ClipboardList,
    CalendarRange, Settings2, Eye, EyeOff, Globe, Lock, Edit2, FileText,
    ChevronRight, AlertCircle, LayoutList, User, UserCog
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SCORE_MAP = { A: 4, B: 3, C: 2, D: 1 };

function blockScore(answers, indices) {
    let total = 0, count = 0;
    for (const i of (indices || [])) {
        const v = answers?.[i];
        if (v && SCORE_MAP[v] !== undefined) { total += SCORE_MAP[v]; count++; }
    }
    return count > 0 ? Math.round((total / (count * 4)) * 100) : null;
}

function scoreColor(s) {
    if (s == null) return 'text-slate-300';
    if (s >= 85) return 'text-emerald-600';
    if (s >= 70) return 'text-blue-600';
    if (s >= 55) return 'text-amber-600';
    return 'text-rose-600';
}

function scoreBg(s) {
    if (s == null) return 'bg-slate-50 text-slate-300';
    if (s >= 85) return 'bg-emerald-50 text-emerald-700';
    if (s >= 70) return 'bg-blue-50 text-blue-700';
    if (s >= 55) return 'bg-amber-50 text-amber-700';
    return 'bg-rose-50 text-rose-700';
}

const BAR_COLORS = {
    blue: 'bg-blue-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
    indigo: 'bg-indigo-500', purple: 'bg-purple-500', teal: 'bg-teal-500',
    rose: 'bg-rose-500', slate: 'bg-slate-400',
};

const OPT_COLORS = {
    A: { on: 'bg-emerald-500 text-white shadow-sm shadow-emerald-200', off: 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100' },
    B: { on: 'bg-blue-500 text-white shadow-sm shadow-blue-200',       off: 'bg-blue-50 text-blue-600 hover:bg-blue-100' },
    C: { on: 'bg-amber-500 text-white shadow-sm shadow-amber-200',     off: 'bg-amber-50 text-amber-600 hover:bg-amber-100' },
    D: { on: 'bg-rose-500 text-white shadow-sm shadow-rose-200',       off: 'bg-rose-50 text-rose-600 hover:bg-rose-100' },
};

const TIPO_OPTIONS = [
    { value: 'clima',        label: 'Clima organizacional' },
    { value: 'satisfaccion', label: 'Satisfacción laboral' },
    { value: 'desempeno',    label: 'Evaluación de desempeño' },
    { value: 'adhoc',        label: 'Ad-hoc / Especial' },
];

const ESTADO_OPTIONS = [
    { value: 'borrador', label: 'Borrador' },
    { value: 'activa',   label: 'Activa' },
    { value: 'cerrada',  label: 'Cerrada' },
    { value: 'archivada',label: 'Archivada' },
];

const SCOPE_OPTIONS = [
    { value: 'all',       label: 'Todos los empleados' },
    { value: 'branches',  label: 'Sucursales específicas' },
    { value: 'roles',     label: 'Solo jefaturas' },
    { value: 'employees', label: 'Empleados específicos' },
];

const ESTADO_STYLE = {
    borrador:  'bg-slate-100 text-slate-500',
    activa:    'bg-emerald-100 text-emerald-700',
    cerrada:   'bg-blue-100 text-blue-600',
    archivada: 'bg-slate-200 text-slate-400',
};

const TIPO_STYLE = {
    clima:        'bg-indigo-100 text-indigo-700',
    satisfaccion: 'bg-teal-100 text-teal-700',
    desempeno:    'bg-purple-100 text-purple-700',
    adhoc:        'bg-amber-100 text-amber-700',
};

// ─── Avatar ───────────────────────────────────────────────────────────────────
function PersonAvatar({ src, name, isJefe, size = 28 }) {
    const cls = `rounded-full object-cover object-top shrink-0 ${isJefe ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`;
    if (src) return <img src={src} alt={name} className={cls} style={{ width: size, height: size }} />;
    return (
        <div className={`rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-black shrink-0 ${isJefe ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
            style={{ width: size, height: size, fontSize: size * 0.38 }}>
            {name?.charAt(0) || '?'}
        </div>
    );
}

// ─── Survey Card ──────────────────────────────────────────────────────────────
function SurveyCard({ survey, responseCount, onSelect, onEdit }) {
    return (
        <div
            onClick={() => onSelect(survey)}
            className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 cursor-pointer p-4 flex flex-col gap-3 group">
            <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-black text-slate-800 leading-snug truncate">{survey.nombre}</h3>
                    {survey.descripcion && (
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">{survey.descripcion}</p>
                    )}
                </div>
                <button
                    onClick={e => { e.stopPropagation(); onEdit(survey); }}
                    className="shrink-0 w-7 h-7 rounded-lg bg-slate-50 hover:bg-blue-50 text-slate-400 hover:text-blue-500 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                    <Edit2 size={12} strokeWidth={2.5} />
                </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${ESTADO_STYLE[survey.estado] || 'bg-slate-100 text-slate-500'}`}>
                    {survey.estado}
                </span>
                <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${TIPO_STYLE[survey.tipo] || 'bg-slate-100 text-slate-400'}`}>
                    {TIPO_OPTIONS.find(t => t.value === survey.tipo)?.label || survey.tipo}
                </span>
                {survey.anonima && (
                    <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 flex items-center gap-1">
                        <EyeOff size={8} strokeWidth={3} /> Anónima
                    </span>
                )}
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-50">
                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-semibold">
                    <ClipboardList size={12} strokeWidth={2} />
                    <span>{responseCount} {responseCount === 1 ? 'respuesta' : 'respuestas'}</span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                    {survey.año && <span>{survey.año}</span>}
                    {survey.fecha_inicio && (
                        <span className="flex items-center gap-0.5">
                            <CalendarRange size={10} strokeWidth={2} />
                            {survey.fecha_inicio}
                            {survey.fecha_fin && ` → ${survey.fecha_fin}`}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Survey Form (create / edit) ──────────────────────────────────────────────
function SurveyForm({ initial, branches, employees, onSave, onCancel, saving }) {
    const [nombre, setNombre] = useState(initial?.nombre || '');
    const [año, setAño] = useState(initial?.año || new Date().getFullYear());
    const [tipo, setTipo] = useState(initial?.tipo || 'clima');
    const [estado, setEstado] = useState(initial?.estado || 'activa');
    const [descripcion, setDescripcion] = useState(initial?.descripcion || '');
    const [anonima, setAnonima] = useState(initial?.anonima ?? true);
    const [compartir, setCompartir] = useState(initial?.compartir_resultados ?? false);
    const [scopeTipo, setScopeTipo] = useState(initial?.scope_tipo || 'all');
    const [scopeIds, setScopeIds] = useState(initial?.scope_ids || []);
    const [fechaInicio, setFechaInicio] = useState(initial?.fecha_inicio || '');
    const [fechaFin, setFechaFin] = useState(initial?.fecha_fin || '');

    const branchOptions = branches.map(b => ({ value: b.id, label: b.name }));
    const employeeOptions = employees.map(e => ({
        value: e.id,
        label: `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim(),
        sublabel: e.branch?.name || '',
        avatar: e.photo_url || '',
    }));

    const toggleId = (id) => setScopeIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

    const handleSubmit = () => {
        if (!nombre.trim()) return;
        onSave({ nombre: nombre.trim(), año: Number(año), tipo, estado, descripcion: descripcion.trim() || null,
            anonima, compartir_resultados: compartir, scope_tipo: scopeTipo,
            scope_ids: scopeTipo === 'all' || scopeTipo === 'roles' ? [] : scopeIds,
            fecha_inicio: fechaInicio || null, fecha_fin: fechaFin || null });
    };

    return (
        <div className="space-y-4 max-w-2xl">
            {/* Nombre + año + tipo */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Información básica</p>
                <div>
                    <label className="text-[10px] text-slate-500 font-semibold block mb-1">Título *</label>
                    <input value={nombre} onChange={e => setNombre(e.target.value)}
                        placeholder="Encuesta de clima organizacional..."
                        className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[13px] font-semibold text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-slate-300" />
                </div>
                <div className="flex gap-3">
                    <div className="w-24 shrink-0">
                        <label className="text-[10px] text-slate-500 font-semibold block mb-1">Año</label>
                        <input type="number" value={año} onChange={e => setAño(e.target.value)}
                            className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[13px] font-bold text-slate-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] text-slate-500 font-semibold block mb-1">Tipo</label>
                        <LiquidSelect value={tipo} onChange={setTipo} options={TIPO_OPTIONS}
                            placeholder="Tipo…" icon={FileText} compact />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] text-slate-500 font-semibold block mb-1">Estado</label>
                        <LiquidSelect value={estado} onChange={setEstado} options={ESTADO_OPTIONS}
                            placeholder="Estado…" icon={Settings2} compact />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] text-slate-500 font-semibold block mb-1">Descripción</label>
                    <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)}
                        rows={2} placeholder="Objetivo de esta encuesta..."
                        className="w-full resize-none rounded-xl border border-slate-200 text-[12px] text-slate-700 p-3 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-slate-300" />
                </div>
            </div>

            {/* Fechas */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <CalendarRange size={11} strokeWidth={2.5} /> Período de aplicación
                </p>
                <div className="flex gap-3">
                    <div className="flex-1">
                        <label className="text-[10px] text-slate-500 font-semibold block mb-1">Fecha inicio</label>
                        <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                            className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[12px] text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] text-slate-500 font-semibold block mb-1">Fecha fin</label>
                        <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                            className="w-full h-10 rounded-xl border border-slate-200 px-3 text-[12px] text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
                    </div>
                </div>
            </div>

            {/* Privacidad */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Lock size={11} strokeWidth={2.5} /> Privacidad y visibilidad
                </p>
                <div className="flex gap-3">
                    <button onClick={() => setAnonima(v => !v)}
                        className={`flex-1 flex items-center gap-2 px-4 h-10 rounded-xl border font-black text-[11px] transition-all duration-200 ${
                            anonima
                                ? 'bg-violet-50 border-violet-300 text-violet-700 shadow-sm'
                                : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}>
                        {anonima ? <EyeOff size={13} strokeWidth={2.5} /> : <Eye size={13} strokeWidth={2.5} />}
                        {anonima ? 'Anónima' : 'No anónima'}
                    </button>
                    <button onClick={() => setCompartir(v => !v)}
                        className={`flex-1 flex items-center gap-2 px-4 h-10 rounded-xl border font-black text-[11px] transition-all duration-200 ${
                            compartir
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm'
                                : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}>
                        <Globe size={13} strokeWidth={2.5} />
                        {compartir ? 'Resultados públicos' : 'Resultados privados'}
                    </button>
                </div>
                {anonima && (
                    <p className="text-[10px] text-violet-500 bg-violet-50 rounded-xl px-3 py-2 flex items-start gap-2">
                        <AlertCircle size={12} strokeWidth={2.5} className="shrink-0 mt-0.5" />
                        Aunque sea anónima, el sistema guarda internamente quién respondió. El empleado no ve su propia atribución.
                    </p>
                )}
            </div>

            {/* Audiencia */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                    <Users size={11} strokeWidth={2.5} /> Dirigida a
                </p>
                <LiquidSelect value={scopeTipo} onChange={v => { setScopeTipo(v); setScopeIds([]); }}
                    options={SCOPE_OPTIONS} placeholder="Audiencia…" icon={UserCog} compact />

                {scopeTipo === 'branches' && (
                    <div className="flex flex-wrap gap-2 pt-1">
                        {branches.map(b => (
                            <button key={b.id} onClick={() => toggleId(b.id)}
                                className={`flex items-center gap-1.5 px-3 h-8 rounded-xl border text-[11px] font-black transition-all ${
                                    scopeIds.includes(b.id)
                                        ? 'bg-blue-500 border-blue-500 text-white shadow-sm'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                                }`}>
                                <Building2 size={10} strokeWidth={2.5} />
                                {b.name}
                            </button>
                        ))}
                    </div>
                )}

                {scopeTipo === 'employees' && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 max-h-48 overflow-y-auto">
                        {employees.map(e => {
                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                            const sel = scopeIds.includes(e.id);
                            return (
                                <button key={e.id} onClick={() => toggleId(e.id)}
                                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-left transition-all ${
                                        sel ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-200'
                                    }`}>
                                    <PersonAvatar src={e.photo_url} name={fn} size={22} />
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black truncate">{fn}</div>
                                        <div className="text-[9px] text-slate-400 truncate">{e.branch?.name || ''}</div>
                                    </div>
                                    {sel && <Check size={10} className="ml-auto shrink-0 text-blue-500" strokeWidth={3} />}
                                </button>
                            );
                        })}
                    </div>
                )}

                {scopeTipo === 'roles' && (
                    <p className="text-[11px] text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
                        Solo aplicará a empleados con rol de jefe/a de sala en cada sucursal.
                    </p>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pb-2">
                <button onClick={onCancel}
                    className="flex items-center gap-1.5 px-4 h-10 rounded-xl border border-slate-200 bg-white text-[12px] font-black text-slate-500 hover:bg-slate-50 transition-all">
                    <ArrowLeft size={13} strokeWidth={2.5} /> Cancelar
                </button>
                <button onClick={handleSubmit} disabled={!nombre.trim() || saving}
                    className="flex items-center gap-1.5 px-5 h-10 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-black transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} strokeWidth={2.5} />}
                    {saving ? 'Guardando…' : initial ? 'Actualizar encuesta' : 'Crear encuesta'}
                </button>
            </div>
        </div>
    );
}

// ─── Response Form (add / edit) ───────────────────────────────────────────────
function ResponseForm({ initial, employeeOptions, bloques, preguntas, onSave, onCancel, saving }) {
    const maxIdx = preguntas.reduce((m, p) => Math.max(m, p.indice ?? 0), 0);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState(initial?.employee_id || '');
    const [isJefe, setIsJefe] = useState(initial?.is_jefe ?? false);
    const [answers, setAnswers] = useState(() => {
        const a = Array(maxIdx + 1).fill(null);
        if (initial?.responses) initial.responses.forEach((v, i) => { a[i] = v; });
        return a;
    });
    const [comentario, setComentario] = useState(initial?.comentario || '');
    const [openBloques, setOpenBloques] = useState(() => {
        const o = {}; bloques.forEach(b => { o[b.id] = true; }); return o;
    });

    const setAnswer = (idx, val) =>
        setAnswers(prev => { const a = [...prev]; a[idx] = val; return a; });

    const formPreguntas = preguntas.filter(p => p.tipo !== 'sucursal');
    const answeredCount = formPreguntas.filter(p => answers[p.indice] !== null).length;

    return (
        <div className="space-y-4 max-w-3xl">
            {/* Employee + rol */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Colaborador</p>
                    {initial ? (
                        <div className="flex items-center gap-2 h-10 px-3 rounded-xl bg-slate-50 border border-slate-200">
                            <PersonAvatar src={initial.employee?.photo_url} name={`${(initial.employee?.first_names||'').split(' ')[0]} ${(initial.employee?.last_names||'').split(' ')[0]}`} size={22} />
                            <span className="text-[12px] font-black text-slate-700">
                                {`${(initial.employee?.first_names||'').split(' ')[0]} ${(initial.employee?.last_names||'').split(' ')[0]}`}
                            </span>
                            <span className="text-[10px] text-slate-400 ml-1">{initial.employee?.branch?.name}</span>
                        </div>
                    ) : (
                        <LiquidSelect value={selectedEmployeeId} onChange={setSelectedEmployeeId}
                            options={employeeOptions} placeholder="Seleccionar empleado…"
                            icon={Users} compact />
                    )}
                </div>
                <div className="shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Rol en encuesta</p>
                    <button onClick={() => setIsJefe(v => !v)}
                        className={`flex items-center gap-2 px-4 h-10 rounded-xl border font-black text-[11px] transition-all duration-200 ${
                            isJefe
                                ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm'
                                : 'bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}>
                        <UserCheck size={14} strokeWidth={2.5} />
                        {isJefe ? 'Jefe/a de sala' : 'Colaborador/a'}
                    </button>
                </div>
            </div>

            {/* Progress */}
            {formPreguntas.length > 0 && (
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${(answeredCount / formPreguntas.length) * 100}%` }} />
                    </div>
                    <span className="text-[11px] font-black text-slate-500 shrink-0 tabular-nums">
                        {answeredCount} / {formPreguntas.length}
                    </span>
                </div>
            )}

            {/* Questions by bloque */}
            {bloques.map(bloque => {
                const bqs = preguntas.filter(p => p.bloque_id === bloque.id && p.tipo !== 'sucursal');
                if (!bqs.length) return null;
                const isOpen = openBloques[bloque.id] !== false;
                const answered = bqs.filter(p => answers[p.indice] !== null).length;
                const barCls = BAR_COLORS[bloque.color] || 'bg-slate-400';
                return (
                    <div key={bloque.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                        <button className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
                            onClick={() => setOpenBloques(p => ({ ...p, [bloque.id]: !p[bloque.id] }))}>
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black text-white shrink-0 ${barCls}`}>
                                B{bloque.numero}
                            </div>
                            <div className="flex-1 min-w-0">
                                <span className="text-[12px] font-black text-slate-800">{bloque.nombre}</span>
                                <span className="ml-2 text-[10px] text-slate-400 font-semibold">{answered}/{bqs.length}</span>
                            </div>
                            {answered === bqs.length && <Check size={13} className="text-emerald-500 shrink-0" strokeWidth={3} />}
                            {isOpen ? <ChevronUp size={13} className="text-slate-400 shrink-0" /> : <ChevronDown size={13} className="text-slate-400 shrink-0" />}
                        </button>
                        {isOpen && (
                            <div className="border-t border-slate-50">
                                {bqs.map((p, qi) => {
                                    const val = answers[p.indice];
                                    return (
                                        <div key={p.id}
                                            className={`flex items-start gap-3 px-4 py-3 ${qi < bqs.length - 1 ? 'border-b border-slate-50' : ''}`}>
                                            <span className="shrink-0 w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-400 mt-0.5">
                                                {p.numero}
                                            </span>
                                            <p className="flex-1 text-[11px] text-slate-600 leading-snug pt-0.5 min-w-0">{p.texto}</p>
                                            <div className="shrink-0 flex items-center gap-1 mt-0.5">
                                                {p.tipo === 'numerica' ? (
                                                    <input type="number" min="1" max="10" value={val ?? ''}
                                                        onChange={e => setAnswer(p.indice, e.target.value || null)}
                                                        placeholder="1-10"
                                                        className="w-14 h-8 rounded-xl border border-slate-200 text-center text-[13px] font-black text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
                                                ) : (
                                                    ['A','B','C','D'].map(opt => {
                                                        const oc = OPT_COLORS[opt];
                                                        return (
                                                            <button key={opt} title={p.opciones?.[['A','B','C','D'].indexOf(opt)] || opt}
                                                                onClick={() => setAnswer(p.indice, val === opt ? null : opt)}
                                                                className={`w-7 h-7 rounded-full text-[11px] font-black transition-all duration-150 ${val === opt ? oc.on : oc.off}`}>
                                                                {opt}
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Comment */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">Comentario (opcional)</p>
                <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3}
                    placeholder="¿Qué mejorarías del ambiente de trabajo?"
                    className="w-full resize-none rounded-xl border border-slate-200 text-[12px] text-slate-700 p-3 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-slate-300" />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pb-2">
                <button onClick={onCancel}
                    className="flex items-center gap-1.5 px-4 h-10 rounded-xl border border-slate-200 bg-white text-[12px] font-black text-slate-500 hover:bg-slate-50 transition-all">
                    <ArrowLeft size={13} strokeWidth={2.5} /> Cancelar
                </button>
                <button onClick={() => onSave({ employee_id: initial?.employee_id || selectedEmployeeId, is_jefe: isJefe, responses: answers, comentario: comentario.trim() || null })}
                    disabled={(!initial && !selectedEmployeeId) || saving}
                    className="flex items-center gap-1.5 px-5 h-10 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-black transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} strokeWidth={2.5} />}
                    {saving ? 'Guardando…' : initial ? 'Actualizar respuesta' : 'Guardar respuesta'}
                </button>
            </div>
        </div>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function EncuestaAdminView() {
    const appendAuditLog = useStaff(state => state.appendAuditLog);
    const { showToast } = useToastStore();

    // mode: 'surveys' | 'survey-form' | 'detail' | 'response-form'
    const [mode, setMode] = useState('surveys');

    // Surveys
    const [surveys, setSurveys] = useState([]);
    const [responseCounts, setResponseCounts] = useState({});
    const [loadingSurveys, setLoadingSurveys] = useState(false);
    const [editingSurvey, setEditingSurvey] = useState(null);
    const [savingSurvey, setSavingSurvey] = useState(false);

    // Detail
    const [selectedSurvey, setSelectedSurvey] = useState(null);
    const [bloques, setBloques] = useState([]);
    const [preguntas, setPreguntas] = useState([]);
    const [respuestas, setRespuestas] = useState([]);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);
    const [editingResponse, setEditingResponse] = useState(null);
    const [savingResponse, setSavingResponse] = useState(false);

    // Shared employee list for forms
    const [employees, setEmployees] = useState([]);

    // Branches from store
    const storeBranches = useStaff(state => state.branches);
    const branches = storeBranches || [];

    // ── Load surveys ──────────────────────────────────────────────────────────
    const loadSurveys = useCallback(async () => {
        setLoadingSurveys(true);
        const { data } = await supabase.from('surveys').select('*').order('año', { ascending: false });
        const list = data || [];
        setSurveys(list);
        // counts
        if (list.length) {
            const { data: counts } = await supabase
                .from('survey_responses')
                .select('survey_id')
                .in('survey_id', list.map(s => s.id));
            const map = {};
            list.forEach(s => { map[s.id] = 0; });
            (counts || []).forEach(r => { map[r.survey_id] = (map[r.survey_id] || 0) + 1; });
            setResponseCounts(map);
        }
        setLoadingSurveys(false);
    }, []);

    // ── Load employees ────────────────────────────────────────────────────────
    useEffect(() => {
        supabase.from('employees')
            .select('id, first_names, last_names, photo_url, role_id, branch:branches(name)')
            .order('first_names')
            .then(({ data }) => setEmployees(data || []));
    }, []);

    useEffect(() => { loadSurveys(); }, [loadSurveys]);

    // ── Load detail ───────────────────────────────────────────────────────────
    const loadDetail = useCallback(async (survey) => {
        if (!survey) return;
        setLoadingDetail(true);
        const [bRes, pRes, rRes] = await Promise.all([
            supabase.from('survey_bloques').select('*').eq('survey_id', survey.id).order('numero'),
            supabase.from('survey_preguntas').select('*').eq('survey_id', survey.id).order('numero'),
            supabase.from('survey_responses')
                .select('*, employee:employees(id, first_names, last_names, photo_url, role_id, branch:branches(id, name))')
                .eq('survey_id', survey.id)
                .order('is_jefe', { ascending: false }),
        ]);
        setBloques(bRes.data || []);
        setPreguntas(pRes.data || []);
        // Sort: jefes first, then by branch name
        const sorted = (rRes.data || []).sort((a, b) => {
            if (a.is_jefe !== b.is_jefe) return a.is_jefe ? -1 : 1;
            return (a.employee?.branch?.name || '').localeCompare(b.employee?.branch?.name || '');
        });
        setRespuestas(sorted);
        setLoadingDetail(false);
    }, []);

    const openDetail = (survey) => {
        setSelectedSurvey(survey);
        loadDetail(survey);
        setMode('detail');
    };

    // ── Save survey ───────────────────────────────────────────────────────────
    const handleSaveSurvey = async (data) => {
        setSavingSurvey(true);
        if (editingSurvey?.id) {
            const { error } = await supabase.from('surveys').update(data).eq('id', editingSurvey.id);
            if (error) { showToast('Error', 'No se pudo actualizar la encuesta.', 'error'); setSavingSurvey(false); return; }
            await appendAuditLog('ENCUESTA_ACTUALIZADA', null, { survey_id: editingSurvey.id, cambios: data });
            showToast('Actualizado', 'Encuesta actualizada correctamente.', 'success');
        } else {
            const { error } = await supabase.from('surveys').insert(data);
            if (error) { showToast('Error', 'No se pudo crear la encuesta.', 'error'); setSavingSurvey(false); return; }
            await appendAuditLog('ENCUESTA_CREADA', null, { nombre: data.nombre });
            showToast('Creado', 'Encuesta creada correctamente.', 'success');
        }
        setSavingSurvey(false);
        setEditingSurvey(null);
        setMode('surveys');
        loadSurveys();
    };

    // ── Save response ─────────────────────────────────────────────────────────
    const handleSaveResponse = async (data) => {
        setSavingResponse(true);
        if (editingResponse?.id) {
            const { error } = await supabase.from('survey_responses')
                .update({ is_jefe: data.is_jefe, responses: data.responses, comentario: data.comentario,
                    updated_at: new Date().toISOString() })
                .eq('id', editingResponse.id);
            if (error) { showToast('Error', 'No se pudo actualizar la respuesta.', 'error'); setSavingResponse(false); return; }
            await appendAuditLog('ENCUESTA_RESPUESTA_EDITADA', data.employee_id, { survey_id: selectedSurvey.id, response_id: editingResponse.id });
            showToast('Actualizado', 'Respuesta actualizada.', 'success');
        } else {
            const { error } = await supabase.from('survey_responses').insert({
                survey_id: selectedSurvey.id, ...data,
            });
            if (error) { showToast('Error', 'No se pudo guardar la respuesta.', 'error'); setSavingResponse(false); return; }
            await appendAuditLog('ENCUESTA_RESPUESTA_AGREGADA', data.employee_id, { survey_id: selectedSurvey.id, is_jefe: data.is_jefe });
            showToast('Guardado', 'Respuesta registrada.', 'success');
        }
        setSavingResponse(false);
        setEditingResponse(null);
        setMode('detail');
        loadDetail(selectedSurvey);
        // Update response count
        setResponseCounts(prev => ({
            ...prev,
            [selectedSurvey.id]: editingResponse ? prev[selectedSurvey.id] : (prev[selectedSurvey.id] || 0) + 1,
        }));
    };

    // ── Delete response ───────────────────────────────────────────────────────
    const handleDeleteResponse = async (row) => {
        const { error } = await supabase.from('survey_responses').delete().eq('id', row.id);
        if (error) { showToast('Error', 'No se pudo eliminar.', 'error'); return; }
        await appendAuditLog('ENCUESTA_RESPUESTA_ELIMINADA', row.employee_id, { survey_id: selectedSurvey.id });
        showToast('Eliminado', 'Respuesta eliminada.', 'success');
        setRespuestas(r => r.filter(x => x.id !== row.id));
        setResponseCounts(prev => ({ ...prev, [selectedSurvey.id]: Math.max(0, (prev[selectedSurvey.id] || 1) - 1) }));
        setConfirmDelete(null);
    };

    // ── Computed ──────────────────────────────────────────────────────────────
    const allIndices = bloques.flatMap(b => b.indices || []);

    const respondedIds = new Set(respuestas.map(r => r.employee_id));

    const availableEmployeeOptions = useMemo(() =>
        employees.filter(e => !respondedIds.has(e.id)).map(e => ({
            value: e.id,
            label: `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim(),
            sublabel: e.branch?.name || '',
            avatar: e.photo_url || '',
        })),
    [employees, respuestas]);

    // Group responses by branch
    const responsesByBranch = useMemo(() => {
        const groups = {};
        respuestas.forEach(r => {
            const branchName = r.employee?.branch?.name || 'Sin sucursal';
            if (!groups[branchName]) groups[branchName] = { jefes: [], colabs: [] };
            if (r.is_jefe) groups[branchName].jefes.push(r);
            else groups[branchName].colabs.push(r);
        });
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [respuestas]);

    // ── Pending respondents ───────────────────────────────────────────────────
    const pendingEmployees = useMemo(() => {
        if (!selectedSurvey) return [];
        let pool = employees;
        if (selectedSurvey.scope_tipo === 'roles') pool = pool.filter(e => e.role_id === 3 || e.role_id === 11);
        else if (selectedSurvey.scope_tipo === 'branches' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => {
                const b = branches.find(br => br.id === e.branchId);
                return b && selectedSurvey.scope_ids.includes(b.id);
            });
        else if (selectedSurvey.scope_tipo === 'employees' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => selectedSurvey.scope_ids.includes(e.id));
        return pool.filter(e => !respondedIds.has(e.id));
    }, [selectedSurvey, employees, respuestas, branches]);

    // ─── Header ───────────────────────────────────────────────────────────────
    const filtersContent = (
        <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 w-max max-w-full overflow-hidden">
            <div className="flex items-center h-full pl-2 pr-1 gap-1 md:gap-1.5">
                {[
                    { key: 'surveys', label: 'Encuestas', Icon: LayoutList },
                    { key: 'survey-form', label: 'Nueva encuesta', Icon: Plus },
                ].map(({ key, label, Icon }) => (
                    <button key={key}
                        onClick={() => {
                            if (key === 'survey-form') { setEditingSurvey(null); }
                            setMode(key);
                        }}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                            (mode === key || (mode === 'survey-form' && key === 'survey-form'))
                                ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                        }`}>
                        <Icon size={12} strokeWidth={2.5} />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}
                {(mode === 'detail' || mode === 'response-form') && selectedSurvey && (
                    <>
                        <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                        <div className="flex items-center gap-1 text-[10px] text-white/70 font-semibold px-1">
                            <ChevronRight size={10} strokeWidth={2.5} />
                            <span className="hidden sm:inline truncate max-w-[160px]">{selectedSurvey.nombre}</span>
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <GlassViewLayout
            icon={PenLine}
            title="Gestión de Encuestas"
            subtitle="Crear, configurar y administrar encuestas organizacionales"
            filtersContent={filtersContent}>
            <div className="p-5 md:p-6">

                {/* ── SURVEY LIST ─────────────────────────────────────────── */}
                {mode === 'surveys' && (
                    <div className="space-y-4">
                        {loadingSurveys ? (
                            <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                                <Loader2 size={18} className="animate-spin" />
                                <span className="text-[12px] font-semibold">Cargando…</span>
                            </div>
                        ) : surveys.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-300">
                                <BarChart2 size={40} strokeWidth={1.5} />
                                <div className="text-center">
                                    <p className="text-[13px] font-black text-slate-400">Sin encuestas aún</p>
                                    <p className="text-[11px] text-slate-300 mt-0.5">Crea la primera con el botón "Nueva encuesta"</p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                {surveys.map(s => (
                                    <SurveyCard key={s.id} survey={s}
                                        responseCount={responseCounts[s.id] || 0}
                                        onSelect={openDetail}
                                        onEdit={survey => { setEditingSurvey(survey); setMode('survey-form'); }} />
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ── SURVEY FORM ─────────────────────────────────────────── */}
                {mode === 'survey-form' && (
                    <SurveyForm
                        initial={editingSurvey}
                        branches={branches}
                        employees={employees}
                        onSave={handleSaveSurvey}
                        onCancel={() => { setEditingSurvey(null); setMode('surveys'); }}
                        saving={savingSurvey}
                    />
                )}

                {/* ── SURVEY DETAIL ────────────────────────────────────────── */}
                {mode === 'detail' && selectedSurvey && (
                    <div className="space-y-5">
                        {/* Survey meta */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-[15px] font-black text-slate-800">{selectedSurvey.nombre}</h2>
                                    {selectedSurvey.descripcion && (
                                        <p className="text-[11px] text-slate-400 mt-0.5">{selectedSurvey.descripcion}</p>
                                    )}
                                    <div className="flex flex-wrap gap-2 mt-2">
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${ESTADO_STYLE[selectedSurvey.estado] || 'bg-slate-100 text-slate-500'}`}>
                                            {selectedSurvey.estado}
                                        </span>
                                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${TIPO_STYLE[selectedSurvey.tipo] || 'bg-slate-100 text-slate-400'}`}>
                                            {TIPO_OPTIONS.find(t => t.value === selectedSurvey.tipo)?.label || selectedSurvey.tipo}
                                        </span>
                                        {selectedSurvey.anonima && (
                                            <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 flex items-center gap-1">
                                                <EyeOff size={8} strokeWidth={3} /> Anónima
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <button onClick={() => { setEditingSurvey(selectedSurvey); setMode('survey-form'); }}
                                        className="flex items-center gap-1.5 px-3 h-8 rounded-xl border border-slate-200 bg-white text-[11px] font-black text-slate-500 hover:bg-slate-50 transition-all">
                                        <Edit2 size={12} strokeWidth={2.5} /> Editar
                                    </button>
                                    <button onClick={() => { setEditingResponse(null); setMode('response-form'); }}
                                        className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-[11px] font-black transition-all shadow-sm">
                                        <Plus size={12} strokeWidth={3} /> Agregar respuesta
                                    </button>
                                </div>
                            </div>
                            {/* Stats */}
                            <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-50">
                                <div className="text-center">
                                    <p className="text-[18px] font-black text-slate-800">{respuestas.length}</p>
                                    <p className="text-[9px] text-slate-400 font-semibold uppercase">Respuestas</p>
                                </div>
                                {selectedSurvey.scope_tipo !== 'all' && pendingEmployees.length > 0 && (
                                    <div className="text-center">
                                        <p className="text-[18px] font-black text-amber-600">{pendingEmployees.length}</p>
                                        <p className="text-[9px] text-slate-400 font-semibold uppercase">Pendientes</p>
                                    </div>
                                )}
                                {respuestas.length > 0 && (() => {
                                    const global = blockScore(
                                        respuestas.flatMap(r => r.responses || []),
                                        allIndices
                                    );
                                    return global != null ? (
                                        <div className="text-center">
                                            <p className={`text-[18px] font-black ${scoreColor(global)}`}>{global}%</p>
                                            <p className="text-[9px] text-slate-400 font-semibold uppercase">Promedio global</p>
                                        </div>
                                    ) : null;
                                })()}
                            </div>
                        </div>

                        {/* Pending respondents */}
                        {selectedSurvey.scope_tipo !== 'all' && pendingEmployees.length > 0 && (
                            <div className="bg-amber-50 rounded-2xl border border-amber-100 p-4">
                                <p className="text-[10px] font-black uppercase tracking-wider text-amber-600 mb-2 flex items-center gap-1.5">
                                    <AlertCircle size={11} strokeWidth={2.5} />
                                    Pendientes de responder ({pendingEmployees.length})
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    {pendingEmployees.map(e => {
                                        const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                        return (
                                            <div key={e.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200">
                                                <PersonAvatar src={e.photo_url} name={fn} size={18} />
                                                <span className="text-[10px] font-black text-amber-700">{fn}</span>
                                                <span className="text-[9px] text-amber-500">{e.branch?.name}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Responses grouped by branch */}
                        {loadingDetail ? (
                            <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                                <Loader2 size={18} className="animate-spin" />
                                <span className="text-[12px] font-semibold">Cargando…</span>
                            </div>
                        ) : respuestas.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-300">
                                <ClipboardList size={36} strokeWidth={1.5} />
                                <span className="text-[12px] font-semibold text-slate-400">Sin respuestas registradas</span>
                            </div>
                        ) : (
                            responsesByBranch.map(([branchName, group]) => {
                                const allRows = [...group.jefes, ...group.colabs];
                                return (
                                    <div key={branchName} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                                        {/* Branch header */}
                                        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                                            <Building2 size={12} strokeWidth={2.5} className="text-slate-400" />
                                            <span className="text-[11px] font-black text-slate-600">{branchName}</span>
                                            <span className="text-[10px] text-slate-400">— {allRows.length} {allRows.length === 1 ? 'respuesta' : 'respuestas'}</span>
                                        </div>
                                        {/* Table */}
                                        <div className="overflow-x-auto">
                                            <table className="w-full min-w-[580px]">
                                                <thead>
                                                    <tr className="border-b border-slate-50">
                                                        <th className="text-left px-4 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Colaborador</th>
                                                        <th className="text-center px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Rol</th>
                                                        {bloques.map(b => (
                                                            <th key={b.id} className="text-center px-2 py-2 text-[8px] font-black uppercase tracking-wider text-slate-300">
                                                                B{b.numero}
                                                            </th>
                                                        ))}
                                                        <th className="text-center px-3 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Global</th>
                                                        <th className="px-3 py-2 w-16" />
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {allRows.map(row => {
                                                        const fn = (row.employee?.first_names || '').split(' ')[0];
                                                        const ln = (row.employee?.last_names  || '').split(' ')[0];
                                                        const nombre = `${fn} ${ln}`.trim() || '–';
                                                        const global = blockScore(row.responses || [], allIndices);
                                                        return (
                                                            <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 group">
                                                                <td className="px-4 py-2.5">
                                                                    <div className="flex items-center gap-2.5">
                                                                        <PersonAvatar src={row.employee?.photo_url} name={nombre} isJefe={row.is_jefe} size={26} />
                                                                        <span className="text-[12px] font-black text-slate-800">{nombre}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2.5 text-center">
                                                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${row.is_jefe ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                                        {row.is_jefe ? 'Jefe/a' : 'Colab.'}
                                                                    </span>
                                                                </td>
                                                                {bloques.map(b => {
                                                                    const s = blockScore(row.responses || [], b.indices || []);
                                                                    return (
                                                                        <td key={b.id} className="px-2 py-2.5 text-center">
                                                                            {s != null ? (
                                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${scoreBg(s)}`}>{s}</span>
                                                                            ) : <span className="text-slate-200 text-[10px]">—</span>}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="px-3 py-2.5 text-center">
                                                                    <span className={`text-[12px] font-black ${scoreColor(global)}`}>
                                                                        {global != null ? `${global}%` : '–'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-2 py-2.5">
                                                                    {confirmDelete === row.id ? (
                                                                        <div className="flex items-center gap-1 justify-center">
                                                                            <button onClick={() => handleDeleteResponse(row)}
                                                                                className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-colors">
                                                                                <Check size={10} strokeWidth={3} />
                                                                            </button>
                                                                            <button onClick={() => setConfirmDelete(null)}
                                                                                className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors">
                                                                                <X size={10} strokeWidth={3} />
                                                                            </button>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-center">
                                                                            <button onClick={() => { setEditingResponse(row); setMode('response-form'); }}
                                                                                className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-blue-50 hover:text-blue-500 transition-all">
                                                                                <Edit2 size={9} strokeWidth={2.5} />
                                                                            </button>
                                                                            <button onClick={() => setConfirmDelete(row.id)}
                                                                                className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-rose-50 hover:text-rose-500 transition-all">
                                                                                <Trash2 size={9} strokeWidth={2.5} />
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {/* ── RESPONSE FORM ────────────────────────────────────────── */}
                {mode === 'response-form' && (
                    <ResponseForm
                        initial={editingResponse}
                        employeeOptions={availableEmployeeOptions}
                        bloques={bloques}
                        preguntas={preguntas}
                        onSave={handleSaveResponse}
                        onCancel={() => { setEditingResponse(null); setMode('detail'); }}
                        saving={savingResponse}
                    />
                )}
            </div>
        </GlassViewLayout>
    );
}
