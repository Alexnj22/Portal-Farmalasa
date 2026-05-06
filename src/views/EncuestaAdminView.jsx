import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    PenLine, Plus, Trash2, Users, UserCheck, Save, ChevronDown, ChevronUp,
    Check, X, ArrowLeft, Building2, Loader2, BarChart2, ClipboardList
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

function scoreColor(s) {
    if (s == null) return 'text-slate-300';
    if (s >= 85) return 'text-emerald-600';
    if (s >= 70) return 'text-blue-600';
    if (s >= 55) return 'text-amber-600';
    return 'text-rose-600';
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function EncuestaAdminView() {
    const appendAuditLog = useStaff(state => state.appendAuditLog);
    const { showToast } = useToastStore();

    const [mode, setMode] = useState('lista');

    // Survey data
    const [surveys, setSurveys] = useState([]);
    const [selectedSurveyId, setSelectedSurveyId] = useState(null);
    const [bloques, setBloques] = useState([]);
    const [preguntas, setPreguntas] = useState([]);

    // List
    const [respuestas, setRespuestas] = useState([]);
    const [loadingLista, setLoadingLista] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);

    // Form
    const [employees, setEmployees] = useState([]);
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
    const [isJefe, setIsJefe] = useState(false);
    const [answers, setAnswers] = useState(Array(42).fill(null));
    const [comentario, setComentario] = useState('');
    const [saving, setSaving] = useState(false);
    const [openBloques, setOpenBloques] = useState({});

    // ── Load surveys + employees ──────────────────────────────────────────────
    useEffect(() => {
        supabase.from('surveys').select('*').order('año', { ascending: false })
            .then(({ data }) => {
                if (data?.length) { setSurveys(data); setSelectedSurveyId(data[0].id); }
            });
        supabase.from('employees')
            .select('id, first_names, last_names, photo_url, branch:branches(name)')
            .order('first_names')
            .then(({ data }) => setEmployees(data || []));
    }, []);

    // ── Load bloques + preguntas ──────────────────────────────────────────────
    useEffect(() => {
        if (!selectedSurveyId) return;
        Promise.all([
            supabase.from('survey_bloques').select('*').eq('survey_id', selectedSurveyId).order('numero'),
            supabase.from('survey_preguntas').select('*').eq('survey_id', selectedSurveyId).order('numero'),
        ]).then(([bRes, pRes]) => {
            setBloques(bRes.data || []);
            setPreguntas(pRes.data || []);
            const open = {};
            (bRes.data || []).forEach(b => { open[b.id] = true; });
            setOpenBloques(open);
        });
    }, [selectedSurveyId]);

    // ── Load responses ────────────────────────────────────────────────────────
    const loadRespuestas = useCallback(() => {
        if (!selectedSurveyId) return;
        setLoadingLista(true);
        supabase.from('survey_responses')
            .select('*, employee:employees(first_names, last_names, photo_url, branch:branches(name))')
            .eq('survey_id', selectedSurveyId)
            .order('id')
            .then(({ data }) => { setRespuestas(data || []); setLoadingLista(false); });
    }, [selectedSurveyId]);

    useEffect(() => { loadRespuestas(); }, [loadRespuestas]);

    // ── Save new response ─────────────────────────────────────────────────────
    const handleSave = async () => {
        if (!selectedEmployeeId) return;
        setSaving(true);
        const { error } = await supabase.from('survey_responses').insert({
            survey_id: selectedSurveyId,
            employee_id: selectedEmployeeId,
            is_jefe: isJefe,
            responses: answers,
            comentario: comentario.trim() || null,
        });
        setSaving(false);
        if (error) { showToast('Error', 'No se pudo guardar la respuesta.', 'error'); return; }
        await appendAuditLog('ENCUESTA_RESPUESTA_AGREGADA', selectedEmployeeId, { survey_id: selectedSurveyId, is_jefe: isJefe });
        showToast('Guardado', 'Respuesta registrada correctamente.', 'success');
        setSelectedEmployeeId('');
        setIsJefe(false);
        setAnswers(Array(42).fill(null));
        setComentario('');
        setMode('lista');
        loadRespuestas();
    };

    // ── Delete response ───────────────────────────────────────────────────────
    const handleDelete = async (id, employeeId) => {
        const { error } = await supabase.from('survey_responses').delete().eq('id', id);
        if (error) { showToast('Error', 'No se pudo eliminar.', 'error'); return; }
        await appendAuditLog('ENCUESTA_RESPUESTA_ELIMINADA', employeeId, { survey_id: selectedSurveyId });
        showToast('Eliminado', 'Respuesta eliminada.', 'success');
        setRespuestas(r => r.filter(x => x.id !== id));
        setConfirmDelete(null);
    };

    const setAnswer = (idx, val) =>
        setAnswers(prev => { const a = [...prev]; a[idx] = val; return a; });

    const toggleBloque = (id) =>
        setOpenBloques(prev => ({ ...prev, [id]: !prev[id] }));

    // ── Computed ──────────────────────────────────────────────────────────────
    const employeeOptions = useMemo(() => {
        const existing = new Set(respuestas.map(r => r.employee_id));
        return employees
            .filter(e => !existing.has(e.id))
            .map(e => ({
                value: e.id,
                label: `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`,
                sublabel: e.branch?.name || '',
                avatar: e.photo_url || '',
            }));
    }, [employees, respuestas]);

    const surveyOptions = surveys.map(s => ({ value: String(s.id), label: `${s.nombre} (${s.año})` }));

    const formPreguntas = preguntas.filter(p => p.tipo !== 'sucursal');
    const answeredCount = formPreguntas.filter(p => answers[p.indice] !== null).length;

    const allIndices = bloques.flatMap(b => b.indices || []);

    // ── Header filters ────────────────────────────────────────────────────────
    const filtersContent = (
        <div className="relative flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">
            <div className="flex items-center h-full pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5">
                {[
                    { key: 'lista',  label: 'Respuestas', Icon: ClipboardList },
                    { key: 'nueva',  label: 'Agregar',    Icon: Plus          },
                ].map(({ key, label, Icon }) => (
                    <button key={key} onClick={() => setMode(key)}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                            mode === key
                                ? 'bg-white text-slate-800 border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-slate-500 border-transparent hover:bg-white hover:text-slate-800 hover:-translate-y-0.5 hover:shadow-md hover:border-white/90'
                        }`}>
                        <Icon size={12} strokeWidth={2.5} />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}
                {surveyOptions.length > 1 && (
                    <>
                        <div className="h-6 w-px bg-white/40 mx-1 shrink-0" />
                        <div className="py-1.5 overflow-visible" style={{ width: '210px' }}>
                            <LiquidSelect
                                value={String(selectedSurveyId ?? '')}
                                onChange={v => setSelectedSurveyId(Number(v))}
                                options={surveyOptions}
                                placeholder="Encuesta"
                                icon={BarChart2}
                                compact
                                clearable={false}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <GlassViewLayout
            icon={PenLine}
            title="Gestión de Encuesta"
            subtitle="Registrar y administrar respuestas de clima organizacional"
            filtersContent={filtersContent}>
            <div className="p-5 md:p-6">

                {/* ── LISTA ──────────────────────────────────────────────── */}
                {mode === 'lista' && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] text-slate-500 font-semibold">
                                {respuestas.length} respuestas registradas
                            </span>
                            <button onClick={() => setMode('nueva')}
                                className="flex items-center gap-1.5 px-3 h-8 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-[11px] font-black transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5">
                                <Plus size={13} strokeWidth={3} /> Agregar respuesta
                            </button>
                        </div>

                        {loadingLista ? (
                            <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                                <Loader2 size={18} className="animate-spin" />
                                <span className="text-[12px] font-semibold">Cargando…</span>
                            </div>
                        ) : respuestas.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 gap-2 text-slate-300">
                                <ClipboardList size={36} strokeWidth={1.5} />
                                <span className="text-[12px] font-semibold text-slate-400">Sin respuestas aún</span>
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-x-auto">
                                <table className="w-full min-w-[640px]">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Colaborador</th>
                                            <th className="text-center px-3 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Rol</th>
                                            {bloques.map(b => (
                                                <th key={b.id} className="text-center px-2 py-3 text-[9px] font-black uppercase tracking-wider text-slate-400">
                                                    B{b.numero}
                                                </th>
                                            ))}
                                            <th className="text-center px-3 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Global</th>
                                            <th className="px-3 py-3 w-12" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {respuestas.map(row => {
                                            const fn = (row.employee?.first_names || '').split(' ')[0];
                                            const ln = (row.employee?.last_names  || '').split(' ')[0];
                                            const nombre = `${fn} ${ln}`.trim() || '–';
                                            const branch = row.employee?.branch?.name || '–';
                                            const global = blockScore(row.responses || [], allIndices);
                                            return (
                                                <tr key={row.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                                                    <td className="px-4 py-2.5">
                                                        <div className="flex items-center gap-2.5">
                                                            {row.employee?.photo_url ? (
                                                                <img src={row.employee.photo_url} alt={nombre}
                                                                    className={`w-7 h-7 rounded-full object-cover object-top shrink-0 ${row.is_jefe ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`} />
                                                            ) : (
                                                                <div className={`w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white text-[10px] font-black shrink-0 ${row.is_jefe ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}>
                                                                    {nombre.charAt(0)}
                                                                </div>
                                                            )}
                                                            <div>
                                                                <div className="text-[12px] font-black text-slate-800">{nombre}</div>
                                                                <div className="text-[9px] text-slate-400">{branch}</div>
                                                            </div>
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
                                                            <td key={b.id} className={`px-2 py-2.5 text-center text-[11px] font-bold ${scoreColor(s)}`}>
                                                                {s != null ? s : '–'}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className={`text-[12px] font-black ${scoreColor(global)}`}>
                                                            {global != null ? `${global}%` : '–'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        {confirmDelete === row.id ? (
                                                            <div className="flex items-center gap-1 justify-center">
                                                                <button onClick={() => handleDelete(row.id, row.employee_id)}
                                                                    className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center hover:bg-rose-600 transition-colors">
                                                                    <Check size={10} strokeWidth={3} />
                                                                </button>
                                                                <button onClick={() => setConfirmDelete(null)}
                                                                    className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors">
                                                                    <X size={10} strokeWidth={3} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button onClick={() => setConfirmDelete(row.id)}
                                                                className="w-6 h-6 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center hover:bg-rose-50 hover:text-rose-500 transition-all mx-auto">
                                                                <Trash2 size={10} strokeWidth={2.5} />
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ── AGREGAR ─────────────────────────────────────────────── */}
                {mode === 'nueva' && (
                    <div className="space-y-4 max-w-3xl">

                        {/* Employee + rol */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-end">
                            <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Colaborador</p>
                                <LiquidSelect
                                    value={selectedEmployeeId}
                                    onChange={setSelectedEmployeeId}
                                    options={employeeOptions}
                                    placeholder="Seleccionar empleado..."
                                    icon={Users}
                                    compact
                                />
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

                        {/* Progress bar */}
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
                                    {/* Bloque header */}
                                    <button className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
                                        onClick={() => toggleBloque(bloque.id)}>
                                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black text-white shrink-0 ${barCls}`}>
                                            B{bloque.numero}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <span className="text-[12px] font-black text-slate-800">{bloque.nombre}</span>
                                            <span className="ml-2 text-[10px] text-slate-400 font-semibold">
                                                {answered}/{bqs.length}
                                            </span>
                                        </div>
                                        {answered === bqs.length && (
                                            <Check size={13} className="text-emerald-500 shrink-0" strokeWidth={3} />
                                        )}
                                        {isOpen
                                            ? <ChevronUp size={13} className="text-slate-400 shrink-0" />
                                            : <ChevronDown size={13} className="text-slate-400 shrink-0" />}
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-slate-50">
                                            {bqs.map((p, qi) => {
                                                const val = answers[p.indice];
                                                const opts = ['A', 'B', 'C', 'D'];
                                                return (
                                                    <div key={p.id}
                                                        className={`flex items-start gap-3 px-4 py-3 ${qi < bqs.length - 1 ? 'border-b border-slate-50' : ''}`}>
                                                        <span className="shrink-0 w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center text-[9px] font-black text-slate-400 mt-0.5">
                                                            {p.numero}
                                                        </span>
                                                        <p className="flex-1 text-[11px] text-slate-600 leading-snug pt-0.5 min-w-0">
                                                            {p.texto}
                                                        </p>
                                                        <div className="shrink-0 flex items-center gap-1 mt-0.5">
                                                            {p.tipo === 'numerica' ? (
                                                                <input
                                                                    type="number" min="1" max="10"
                                                                    value={val ?? ''}
                                                                    onChange={e => setAnswer(p.indice, e.target.value || null)}
                                                                    placeholder="1-10"
                                                                    className="w-14 h-8 rounded-xl border border-slate-200 text-center text-[13px] font-black text-slate-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
                                                            ) : (
                                                                opts.map(opt => {
                                                                    const oc = OPT_COLORS[opt];
                                                                    const label = p.opciones?.[opts.indexOf(opt)];
                                                                    return (
                                                                        <button key={opt}
                                                                            title={label || opt}
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
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2">
                                Comentario (opcional)
                            </p>
                            <textarea
                                value={comentario}
                                onChange={e => setComentario(e.target.value)}
                                rows={3}
                                placeholder="¿Qué mejorarías del ambiente de trabajo?"
                                className="w-full resize-none rounded-xl border border-slate-200 text-[12px] text-slate-700 p-3 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-slate-300" />
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-3 pb-2">
                            <button onClick={() => setMode('lista')}
                                className="flex items-center gap-1.5 px-4 h-10 rounded-xl border border-slate-200 bg-white text-[12px] font-black text-slate-500 hover:bg-slate-50 transition-all">
                                <ArrowLeft size={13} strokeWidth={2.5} /> Cancelar
                            </button>
                            <button onClick={handleSave}
                                disabled={!selectedEmployeeId || saving}
                                className="flex items-center gap-1.5 px-5 h-10 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[12px] font-black transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 disabled:hover:translate-y-0">
                                {saving
                                    ? <Loader2 size={13} className="animate-spin" />
                                    : <Save size={13} strokeWidth={2.5} />}
                                {saving ? 'Guardando…' : 'Guardar respuesta'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </GlassViewLayout>
    );
}
