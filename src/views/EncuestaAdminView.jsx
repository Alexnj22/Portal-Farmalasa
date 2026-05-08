import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    PenLine, Plus, Trash2, Users, UserCheck, Save, ChevronDown, ChevronUp,
    Check, X, Building2, Loader2, BarChart2, ClipboardList,
    CalendarRange, Eye, EyeOff, Globe, Lock, Edit3, Search,
    AlertCircle, TrendingUp
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import { supabase } from '../supabaseClient';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SCORE_MAP = { A: 4, B: 3, C: 2, D: 1 };

function blockScore(answers, indices, invertedSet = new Set()) {
    let total = 0, count = 0;
    for (const i of (indices || [])) {
        const v = answers?.[i];
        if (!v) continue;
        let raw;
        if (SCORE_MAP[v] !== undefined) {
            raw = SCORE_MAP[v];
        } else {
            const n = parseInt(v, 10);
            if (!isNaN(n) && n >= 1 && n <= 10) {
                raw = n >= 9 ? 4 : n >= 7 ? 3 : n >= 5 ? 2 : 1;
            } else {
                continue;
            }
        }
        total += invertedSet.has(i) ? (5 - raw) : raw;
        count++;
    }
    return count > 0 ? Math.round((total / (count * 4)) * 100) : null;
}

function avgBlockScore(respuestas, indices, invertedSet = new Set()) {
    const scores = respuestas.map(r => blockScore(r.responses || [], indices, invertedSet)).filter(s => s != null);
    return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
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

const NUMERIC_OPTS = [
    { k: 'A', label: '9–10' },
    { k: 'B', label: '7–8'  },
    { k: 'C', label: '5–6'  },
    { k: 'D', label: '1–4'  },
];

const TIPO_TABS = [
    { id: 'clima',        label: 'Clima' },
    { id: 'satisfaccion', label: 'Satisfacción' },
    { id: 'desempeno',    label: 'Desempeño' },
    { id: 'adhoc',        label: 'Personalizada' },
];

const TIPO_DESC = {
    clima:        'Mide el ambiente general de trabajo, motivación y relaciones interpersonales.',
    satisfaccion: 'Evalúa qué tan satisfechos están los empleados con su rol y condiciones laborales.',
    desempeno:    'Evalúa el rendimiento individual y competencias de cada colaborador.',
    adhoc:        'Encuesta libre para objetivos específicos que no encajan en los otros tipos.',
};

const ESTADO_TABS = [
    { id: 'borrador',  label: 'Borrador' },
    { id: 'activa',    label: 'Activa' },
    { id: 'cerrada',   label: 'Cerrada' },
    { id: 'archivada', label: 'Archivada' },
];

const SCOPE_TABS = [
    { id: 'all',       label: 'Todos' },
    { id: 'branches',  label: 'Sucursales' },
    { id: 'roles',     label: 'Jefaturas' },
    { id: 'employees', label: 'Personal' },
];

const TIPO_STYLE = {
    clima:        'bg-indigo-100 text-indigo-700',
    satisfaccion: 'bg-teal-100 text-teal-700',
    desempeno:    'bg-purple-100 text-purple-700',
    adhoc:        'bg-amber-100 text-amber-700',
};

const TIPO_LABEL = { clima: 'Clima', satisfaccion: 'Satisfacción', desempeno: 'Desempeño', adhoc: 'Personalizada' };

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

// ─── Segment Control ──────────────────────────────────────────────────────────
function SegmentControl({ options, value, onChange, compact = false }) {
    return (
        <div className={`flex items-center gap-1 bg-black/[0.03] rounded-full border border-black/[0.05] shadow-[inset_0_2px_8px_rgba(0,0,0,0.04)] ${compact ? 'p-1' : 'p-1.5'}`}>
            {options.map(opt => (
                <button key={opt.id} type="button" onClick={() => onChange(opt.id)}
                    className={`flex-1 rounded-full font-black uppercase tracking-widest transition-all duration-300 whitespace-nowrap border ${compact ? 'h-7 text-[8px]' : 'h-8 text-[9px] md:text-[10px]'} ${
                        value === opt.id
                            ? 'bg-white text-[#007AFF] border-white shadow-sm scale-[1.02]'
                            : 'bg-transparent text-slate-500 border-transparent hover:bg-white/70 hover:text-slate-700 hover:-translate-y-0.5 hover:shadow-sm'
                    }`}>
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────
export default function EncuestaAdminView() {
    const navigate = useNavigate();
    const appendAuditLog = useStaff(state => state.appendAuditLog);
    const { showToast } = useToastStore();
    const { hasPermission } = useAuth();
    const canManage = hasPermission('encuesta_admin', 'can_edit');
    const storeBranches = useStaff(state => state.branches) || [];

    // ── Panel state ───────────────────────────────────────────────────────────
    const [leftPanel,          setLeftPanel]          = useState('survey-form');
    const [expandedSurveyId,   setExpandedSurveyId]   = useState(null);
    const [expandedResponseId, setExpandedResponseId] = useState(null);

    // ── Survey form state ─────────────────────────────────────────────────────
    const [editingSurvey, setEditingSurvey] = useState(null);
    const [sfNombre,      setSfNombre]      = useState('');
    const [sfAño,         setSfAño]         = useState(new Date().getFullYear());
    const [sfTipo,        setSfTipo]        = useState('clima');
    const [sfEstado,      setSfEstado]      = useState('activa');
    const [sfDescripcion, setSfDescripcion] = useState('');
    const [sfAnonima,     setSfAnonima]     = useState(true);
    const [sfCompartir,   setSfCompartir]   = useState(false);
    const [sfScope,       setSfScope]       = useState('all');
    const [sfScopeIds,    setSfScopeIds]    = useState([]);
    const [sfFechaInicio, setSfFechaInicio] = useState('');
    const [sfFechaFin,    setSfFechaFin]    = useState('');
    const [sfEmpSearch,   setSfEmpSearch]   = useState('');
    const [sfError,       setSfError]       = useState('');
    const [savingSurvey,  setSavingSurvey]  = useState(false);

    // ── Surveys list ──────────────────────────────────────────────────────────
    const [surveys,        setSurveys]        = useState([]);
    const [responseCounts, setResponseCounts] = useState({});
    const [loadingSurveys, setLoadingSurveys] = useState(false);

    // ── Detail state ──────────────────────────────────────────────────────────
    const [bloques,       setBloques]       = useState([]);
    const [preguntas,     setPreguntas]     = useState([]);
    const [respuestas,    setRespuestas]    = useState([]);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(null);

    // ── Derived ───────────────────────────────────────────────────────────────
    const selectedSurvey = useMemo(
        () => surveys.find(s => s.id === expandedSurveyId) || null,
        [surveys, expandedSurveyId]
    );

    // ── Response form state ───────────────────────────────────────────────────
    const [editingResponse,  setEditingResponse]  = useState(null);
    const [rfEmployeeId,     setRfEmployeeId]     = useState('');
    const [rfIsJefe,         setRfIsJefe]         = useState(false);
    const [rfAnswers,        setRfAnswers]        = useState([]);
    const [rfComentario,     setRfComentario]     = useState('');
    const [rfOpenBloques,    setRfOpenBloques]    = useState({});
    const [savingResponse,   setSavingResponse]   = useState(false);

    // ── Employees list ────────────────────────────────────────────────────────
    const [employees, setEmployees] = useState([]);

    // ── Load ──────────────────────────────────────────────────────────────────
    const loadSurveys = useCallback(async () => {
        setLoadingSurveys(true);
        const { data } = await supabase.from('surveys').select('*').order('año', { ascending: false });
        const list = data || [];
        setSurveys(list);
        if (list.length) {
            const { data: counts } = await supabase
                .from('survey_responses').select('survey_id').in('survey_id', list.map(s => s.id));
            const map = {};
            list.forEach(s => { map[s.id] = 0; });
            (counts || []).forEach(r => { map[r.survey_id] = (map[r.survey_id] || 0) + 1; });
            setResponseCounts(map);
        }
        setLoadingSurveys(false);
    }, []);

    useEffect(() => { loadSurveys(); }, [loadSurveys]);

    useEffect(() => {
        supabase.from('employees')
            .select('id, first_names, last_names, photo_url, role_id, branch:branches(id, name)')
            .order('first_names')
            .then(({ data }) => setEmployees(data || []));
    }, []);

    const loadDetail = useCallback(async (survey) => {
        if (!survey) return;
        setLoadingDetail(true);
        const [bRes, pRes, rRes] = await Promise.all([
            supabase.from('survey_bloques').select('*').eq('survey_id', survey.id).order('numero'),
            supabase.from('survey_preguntas').select('*').eq('survey_id', survey.id).order('numero'),
            supabase.from('survey_responses')
                .select('*, employee:employees!employee_id(id, first_names, last_names, photo_url, role_id, branch:branches(id, name))')
                .eq('survey_id', survey.id),
        ]);
        const bData = bRes.data || [];
        const pData = pRes.data || [];
        setBloques(bData);
        setPreguntas(pData);
        const sorted = (rRes.data || []).sort((a, b) => {
            if (a.is_jefe !== b.is_jefe) return a.is_jefe ? -1 : 1;
            return (a.employee?.branch?.name || '').localeCompare(b.employee?.branch?.name || '');
        });
        setRespuestas(sorted);
        const open = {};
        bData.forEach(b => { open[b.id] = false; });
        if (bData.length) open[bData[0].id] = true;
        setRfOpenBloques(open);
        setLoadingDetail(false);
    }, []);

    // ── Survey form helpers ───────────────────────────────────────────────────
    const resetSurveyForm = () => {
        setEditingSurvey(null);
        setSfNombre(''); setSfAño(new Date().getFullYear()); setSfTipo('clima');
        setSfEstado('activa'); setSfDescripcion(''); setSfAnonima(true);
        setSfCompartir(false); setSfScope('all'); setSfScopeIds([]);
        setSfFechaInicio(''); setSfFechaFin(''); setSfEmpSearch(''); setSfError('');
    };

    const loadSurveyIntoForm = (s) => {
        setEditingSurvey(s);
        setSfNombre(s.nombre || ''); setSfAño(s.año || new Date().getFullYear());
        setSfTipo(s.tipo || 'clima'); setSfEstado(s.estado || 'activa');
        setSfDescripcion(s.descripcion || ''); setSfAnonima(s.anonima ?? true);
        setSfCompartir(s.compartir_resultados ?? false); setSfScope(s.scope_tipo || 'all');
        setSfScopeIds(s.scope_ids || []); setSfFechaInicio(s.fecha_inicio || '');
        setSfFechaFin(s.fecha_fin || ''); setSfError('');
    };

    const handleSaveSurvey = async () => {
        if (!sfNombre.trim()) { setSfError('El título de la encuesta es obligatorio.'); return; }
        setSfError('');
        setSavingSurvey(true);
        const payload = {
            nombre: sfNombre.trim(), año: Number(sfAño), tipo: sfTipo, estado: sfEstado,
            descripcion: sfDescripcion.trim() || null, anonima: sfAnonima,
            compartir_resultados: sfCompartir, scope_tipo: sfScope,
            scope_ids: (sfScope === 'all' || sfScope === 'roles') ? [] : sfScopeIds,
            fecha_inicio: sfFechaInicio || null, fecha_fin: sfFechaFin || null,
        };
        if (editingSurvey?.id) {
            const { error } = await supabase.from('surveys').update(payload).eq('id', editingSurvey.id);
            if (error) { showToast('Error', 'No se pudo actualizar.', 'error'); setSavingSurvey(false); return; }
            await appendAuditLog('ENCUESTA_ACTUALIZADA', null, { survey_id: editingSurvey.id });
            showToast('Actualizado', 'Encuesta actualizada.', 'success');
        } else {
            const { error } = await supabase.from('surveys').insert(payload);
            if (error) { showToast('Error', 'No se pudo crear.', 'error'); setSavingSurvey(false); return; }
            await appendAuditLog('ENCUESTA_CREADA', null, { nombre: payload.nombre });
            showToast('Creado', 'Encuesta creada.', 'success');
        }
        setSavingSurvey(false);
        resetSurveyForm();
        loadSurveys();
    };

    const toggleScopeId = (id) =>
        setSfScopeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

    // ── Response form helpers ─────────────────────────────────────────────────
    const resetResponseForm = () => {
        setEditingResponse(null);
        setRfEmployeeId(''); setRfIsJefe(false);
        const maxIdx = preguntas.reduce((m, p) => Math.max(m, p.indice ?? 0), 0);
        setRfAnswers(Array(maxIdx + 1).fill(null));
        setRfComentario('');
    };

    const openResponseForm = (response = null) => {
        if (response) {
            setEditingResponse(response);
            setRfEmployeeId(response.employee_id);
            setRfIsJefe(response.is_jefe ?? false);
            const maxIdx = preguntas.reduce((m, p) => Math.max(m, p.indice ?? 0), 0);
            const a = Array(maxIdx + 1).fill(null);
            if (response.responses) response.responses.forEach((v, i) => { a[i] = v; });
            setRfAnswers(a);
            setRfComentario(response.comentario || '');
        } else {
            resetResponseForm();
        }
        setLeftPanel('response-form');
    };

    const handleSaveResponse = async () => {
        const empId = editingResponse?.employee_id || rfEmployeeId;
        if (!empId || !selectedSurvey) return;
        setSavingResponse(true);
        if (editingResponse?.id) {
            const { error } = await supabase.from('survey_responses')
                .update({ is_jefe: rfIsJefe, responses: rfAnswers, comentario: rfComentario.trim() || null,
                    updated_at: new Date().toISOString() })
                .eq('id', editingResponse.id);
            if (error) { showToast('Error', 'No se pudo actualizar.', 'error'); setSavingResponse(false); return; }
            await appendAuditLog('ENCUESTA_RESPUESTA_EDITADA', empId, { survey_id: selectedSurvey.id, response_id: editingResponse.id });
            showToast('Actualizado', 'Respuesta actualizada.', 'success');
        } else {
            const { error } = await supabase.from('survey_responses').insert({
                survey_id: selectedSurvey.id, employee_id: empId, is_jefe: rfIsJefe,
                responses: rfAnswers, comentario: rfComentario.trim() || null,
            });
            if (error) { showToast('Error', 'No se pudo guardar.', 'error'); setSavingResponse(false); return; }
            await appendAuditLog('ENCUESTA_RESPUESTA_AGREGADA', empId, { survey_id: selectedSurvey.id });
            showToast('Guardado', 'Respuesta registrada.', 'success');
            setResponseCounts(p => ({ ...p, [selectedSurvey.id]: (p[selectedSurvey.id] || 0) + 1 }));
        }
        setSavingResponse(false);
        setLeftPanel('survey-form');
        resetResponseForm();
        loadDetail(selectedSurvey);
    };

    const handleDeleteResponse = async (row) => {
        if (!selectedSurvey) return;
        const { error } = await supabase.from('survey_responses').delete().eq('id', row.id);
        if (error) { showToast('Error', 'No se pudo eliminar.', 'error'); return; }
        await appendAuditLog('ENCUESTA_RESPUESTA_ELIMINADA', row.employee_id, { survey_id: selectedSurvey.id });
        showToast('Eliminado', 'Respuesta eliminada.', 'success');
        setRespuestas(r => r.filter(x => x.id !== row.id));
        setResponseCounts(p => ({ ...p, [selectedSurvey.id]: Math.max(0, (p[selectedSurvey.id] || 1) - 1) }));
        setConfirmDelete(null);
    };

    const setRfAnswer = (idx, val) =>
        setRfAnswers(prev => { const a = [...prev]; a[idx] = val; return a; });

    // ── Toggle expand survey card ─────────────────────────────────────────────
    const toggleExpand = (survey) => {
        if (expandedSurveyId === survey.id) {
            setExpandedSurveyId(null);
            setExpandedResponseId(null);
            setRespuestas([]);
            setBloques([]);
            setPreguntas([]);
        } else {
            setExpandedSurveyId(survey.id);
            setExpandedResponseId(null);
            loadDetail(survey);
            setLeftPanel('survey-form');
            resetSurveyForm();
        }
    };

    // ── Computed ──────────────────────────────────────────────────────────────
    const allIndices = bloques.flatMap(b => b.indices || []);

    const invertedIndices = useMemo(
        () => new Set(preguntas.filter(p => p.invertida).map(p => p.indice)),
        [preguntas]
    );

    const respondedIds = new Set(respuestas.map(r => r.employee_id));

    const availableEmployeeOptions = useMemo(() =>
        employees.filter(e => !respondedIds.has(e.id)).map(e => ({
            value: e.id,
            label: `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim(),
            sublabel: e.branch?.name || '',
            avatar: e.photo_url || '',
        })),
    [employees, respuestas]);

    const responsesByBranch = useMemo(() => {
        const groups = {};
        respuestas.forEach(r => {
            const b = r.employee?.branch?.name || 'Sin sucursal';
            if (!groups[b]) groups[b] = { jefes: [], colabs: [] };
            if (r.is_jefe) groups[b].jefes.push(r); else groups[b].colabs.push(r);
        });
        return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
    }, [respuestas]);

    const pendingEmployees = useMemo(() => {
        if (!selectedSurvey) return [];
        let pool = employees;
        if (selectedSurvey.scope_tipo === 'roles') pool = pool.filter(e => e.role_id === 3 || e.role_id === 11);
        else if (selectedSurvey.scope_tipo === 'branches' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => selectedSurvey.scope_ids.some(id => e.branch?.id === id));
        else if (selectedSurvey.scope_tipo === 'employees' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => selectedSurvey.scope_ids.includes(e.id));
        else return [];
        return pool.filter(e => !respondedIds.has(e.id));
    }, [selectedSurvey, employees, respuestas]);

    const formPreguntas = preguntas.filter(p => p.tipo !== 'sucursal');
    const rfAnsweredCount = formPreguntas.filter(p => rfAnswers[p.indice] !== null).length;

    // ── Header ────────────────────────────────────────────────────────────────
    const filtersContent = (
        <div className="flex items-center bg-white/10 backdrop-blur-2xl backdrop-saturate-[180%] border border-white/90 shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 w-max">
            <div className="flex items-center h-full pl-2 pr-1 md:pr-2">
                <button className="px-3 md:px-5 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest bg-white text-slate-800 border-white shadow-md scale-[1.02] flex items-center gap-1.5 shrink-0">
                    <ClipboardList size={12} strokeWidth={2.5} />
                    <span className="hidden sm:inline">Encuestas</span>
                </button>
            </div>
        </div>
    );

    return (
        <GlassViewLayout
            icon={PenLine}
            title="Gestión de Encuestas"
            filtersContent={filtersContent}
            transparentBody={true}
            fixedScrollMode={true}>

            <div className="flex flex-col lg:flex-row items-start gap-6 lg:gap-8 px-2 lg:px-0 w-full lg:h-[calc(100vh-230px)]">

                {/* ══ LEFT PANEL ══════════════════════════════════════════════════ */}
                {canManage && <div className="w-full lg:w-[560px] xl:w-[620px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 z-[50] transform-gpu">

                    {/* ── Survey form ─────────────────────────────────────────── */}
                    {leftPanel === 'survey-form' && canManage && (
                        <div className={`bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border p-5 rounded-[2.5rem] transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] relative overflow-visible ${
                            editingSurvey
                                ? 'border-amber-300/80 shadow-[0_12px_40px_rgba(0,0,0,0.08),inset_0_2px_15px_rgba(255,255,255,0.7)]'
                                : 'border-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)] hover:shadow-[0_24px_50px_rgba(0,0,0,0.12),inset_0_2px_15px_rgba(255,255,255,0.7)]'
                        }`}>

                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-[14px]">
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shadow-sm ${editingSurvey ? 'bg-amber-500' : 'bg-[#007AFF]'}`}>
                                        {editingSurvey ? <Edit3 size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
                                    </div>
                                    <span className="font-black uppercase tracking-tight ml-0.5">
                                        {editingSurvey ? 'Editar Encuesta' : 'Nueva Encuesta'}
                                    </span>
                                </h3>
                                {editingSurvey && (
                                    <button onClick={resetSurveyForm}
                                        className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-xl transition-all duration-300 border border-red-200 shadow-sm active:scale-95 group">
                                        <X size={12} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" /> Cancelar
                                    </button>
                                )}
                            </div>

                            {sfError && (
                                <div className="mb-3 bg-amber-50/80 backdrop-blur-sm border border-amber-200/60 text-amber-700 px-3 py-2 rounded-2xl text-[11px] font-bold flex items-start gap-2">
                                    <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                                    <span className="leading-tight">{sfError}</span>
                                </div>
                            )}

                            <div className="space-y-3">
                                {/* Título */}
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1">Título *</label>
                                    <input value={sfNombre} onChange={e => setSfNombre(e.target.value)}
                                        placeholder="Encuesta de clima organizacional…"
                                        className={`w-full py-2.5 px-3.5 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_3px_rgba(0,122,255,0.12)] rounded-2xl text-[13px] outline-none font-bold text-slate-700 transition-all duration-300 placeholder-slate-400 placeholder:font-normal ${sfError && !sfNombre.trim() ? 'border-amber-300' : ''}`} />
                                </div>

                                {/* Año + Estado */}
                                <div className="grid grid-cols-[100px_1fr] gap-3 items-end">
                                    <div>
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1">Año</label>
                                        <input type="number" value={sfAño} onChange={e => setSfAño(e.target.value)}
                                            className="w-full py-2.5 px-3.5 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_3px_rgba(0,122,255,0.12)] rounded-2xl text-[13px] outline-none font-bold text-slate-700 transition-all duration-300" />
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1">Estado</label>
                                        <SegmentControl options={ESTADO_TABS} value={sfEstado} onChange={setSfEstado} compact />
                                    </div>
                                </div>

                                {/* Tipo */}
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1">Tipo de encuesta</label>
                                    <SegmentControl options={TIPO_TABS} value={sfTipo} onChange={setSfTipo} />
                                    <p className="text-[10px] text-slate-400 mt-1.5 ml-1 leading-snug">{TIPO_DESC[sfTipo]}</p>
                                </div>

                                {/* Descripción */}
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1">Descripción <span className="normal-case font-semibold">(opcional)</span></label>
                                    <textarea value={sfDescripcion} onChange={e => setSfDescripcion(e.target.value)}
                                        rows={2} placeholder="Objetivo específico de esta encuesta…"
                                        className="w-full py-2.5 px-3.5 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_3px_rgba(0,122,255,0.12)] rounded-2xl text-[12px] outline-none font-medium text-slate-700 resize-none transition-all duration-300 placeholder-slate-400 placeholder:font-normal leading-relaxed" />
                                </div>

                                {/* Fechas */}
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1 flex items-center gap-1">
                                        <CalendarRange size={10} strokeWidth={2.5} /> Período de aplicación
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.12em] mb-1 ml-1">Inicio</p>
                                            <div className="h-[42px] bg-white/50 border border-white/60 rounded-2xl focus-within:bg-white focus-within:border-[#007AFF]/30 focus-within:shadow-[0_0_0_3px_rgba(0,122,255,0.12)] hover:bg-white/70 hover:border-white hover:shadow-sm transition-all duration-300">
                                                <LiquidDatePicker value={sfFechaInicio} onChange={setSfFechaInicio} placeholder="Seleccionar…" />
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.12em] mb-1 ml-1">Fin</p>
                                            <div className="h-[42px] bg-white/50 border border-white/60 rounded-2xl focus-within:bg-white focus-within:border-[#007AFF]/30 focus-within:shadow-[0_0_0_3px_rgba(0,122,255,0.12)] hover:bg-white/70 hover:border-white hover:shadow-sm transition-all duration-300">
                                                <LiquidDatePicker value={sfFechaFin} onChange={setSfFechaFin} placeholder="Seleccionar…" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Privacidad */}
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1 flex items-center gap-1">
                                        <Lock size={10} strokeWidth={2.5} /> Privacidad
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button type="button" onClick={() => setSfAnonima(v => !v)}
                                            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border font-bold text-[11px] transition-all duration-300 ${
                                                sfAnonima
                                                    ? 'bg-violet-50/80 border-violet-300/60 text-violet-700 shadow-[0_2px_10px_rgba(139,92,246,0.2)]'
                                                    : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white/80 hover:shadow-sm hover:-translate-y-0.5'
                                            }`}>
                                            {sfAnonima ? <EyeOff size={13} strokeWidth={2.5} /> : <Eye size={13} strokeWidth={2.5} />}
                                            {sfAnonima ? 'Anónima' : 'No anónima'}
                                        </button>
                                        <button type="button" onClick={() => setSfCompartir(v => !v)}
                                            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border font-bold text-[11px] transition-all duration-300 ${
                                                sfCompartir
                                                    ? 'bg-emerald-50/80 border-emerald-300/60 text-emerald-700 shadow-[0_2px_10px_rgba(16,185,129,0.2)]'
                                                    : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white/80 hover:shadow-sm hover:-translate-y-0.5'
                                            }`}>
                                            <Globe size={13} strokeWidth={2.5} />
                                            {sfCompartir ? 'Resultados públicos' : 'Privado'}
                                        </button>
                                    </div>
                                    <p className={`text-[10px] mt-1.5 ml-1 flex items-start gap-1.5 leading-snug ${sfAnonima ? 'text-violet-500' : 'text-slate-400'}`}>
                                        <AlertCircle size={11} strokeWidth={2.5} className="shrink-0 mt-0.5" />
                                        {sfAnonima
                                            ? 'Internamente se guarda quién respondió, pero el empleado no verá su propia atribución.'
                                            : 'Cada respuesta es visible con el nombre del colaborador.'}
                                    </p>
                                    <p className={`text-[10px] mt-1 ml-1 flex items-start gap-1.5 leading-snug ${sfCompartir ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        <Globe size={11} strokeWidth={2.5} className="shrink-0 mt-0.5" />
                                        {sfCompartir
                                            ? 'Los resultados generales serán visibles para los colaboradores.'
                                            : 'Los resultados solo son visibles para administradores.'}
                                    </p>
                                </div>

                                {/* Audiencia */}
                                <div>
                                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1 block ml-1 flex items-center gap-1">
                                        <Users size={10} strokeWidth={2.5} /> Dirigida a
                                    </label>
                                    <SegmentControl options={SCOPE_TABS} value={sfScope} onChange={v => { setSfScope(v); setSfScopeIds([]); setSfEmpSearch(''); }} />

                                    {sfScope === 'branches' && (
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {storeBranches.map(b => (
                                                <button key={b.id} type="button" onClick={() => toggleScopeId(b.id)}
                                                    className={`flex items-center gap-1.5 px-3 h-7 rounded-xl border text-[11px] font-black transition-all ${
                                                        sfScopeIds.includes(b.id)
                                                            ? 'bg-[#007AFF] border-[#007AFF] text-white shadow-sm'
                                                            : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white hover:border-[#007AFF]/30'
                                                    }`}>
                                                    <Building2 size={9} strokeWidth={2.5} /> {b.name}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {sfScope === 'employees' && (() => {
                                        const q = sfEmpSearch.trim().toLowerCase();
                                        const empResults = q
                                            ? employees.filter(e => {
                                                const fn = `${e.first_names || ''} ${e.last_names || ''}`.toLowerCase();
                                                return fn.includes(q) && !sfScopeIds.includes(e.id);
                                            }).slice(0, 8)
                                            : [];
                                        const selectedEmps = employees.filter(e => sfScopeIds.includes(e.id));
                                        return (
                                            <div className="mt-2 space-y-2">
                                                {selectedEmps.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 p-2.5 bg-white/60 rounded-2xl border border-white/80">
                                                        {selectedEmps.map(e => {
                                                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                                            return (
                                                                <div key={e.id} className="flex items-center gap-1.5 bg-[#007AFF]/10 text-[#007AFF] px-2.5 py-1 rounded-lg text-[11px] font-bold border border-[#007AFF]/20">
                                                                    <PersonAvatar src={e.photo_url} name={fn} size={16} />
                                                                    <span>{fn}</span>
                                                                    <button type="button" onClick={() => toggleScopeId(e.id)} className="hover:text-red-500 transition-colors ml-0.5">
                                                                        <X size={10} strokeWidth={2.5} />
                                                                    </button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <div className="relative">
                                                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} strokeWidth={2.5} />
                                                    <input type="text" value={sfEmpSearch} onChange={e => setSfEmpSearch(e.target.value)}
                                                        placeholder="Buscar por nombre…"
                                                        className="w-full pl-9 pr-4 py-2.5 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_3px_rgba(0,122,255,0.12)] rounded-2xl text-[12px] outline-none font-bold text-slate-700 transition-all duration-300 placeholder-slate-400 placeholder:font-normal" />
                                                    {sfEmpSearch && <button onClick={() => setSfEmpSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-red-400 transition-colors"><X size={12} strokeWidth={2.5} /></button>}
                                                </div>
                                                {empResults.length > 0 && (
                                                    <div className="bg-white/90 backdrop-blur-xl border border-white/90 rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.12)] overflow-hidden">
                                                        {empResults.map(e => {
                                                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                                            return (
                                                                <button key={e.id} type="button"
                                                                    onClick={() => { toggleScopeId(e.id); setSfEmpSearch(''); }}
                                                                    className="w-full px-4 py-2.5 hover:bg-[#007AFF]/10 text-left flex items-center gap-3 transition-colors border-b border-slate-50 last:border-0">
                                                                    <PersonAvatar src={e.photo_url} name={fn} size={24} />
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-[12px] font-bold text-slate-700">{fn}</p>
                                                                        <p className="text-[10px] text-slate-400">{e.branch?.name}</p>
                                                                    </div>
                                                                    <Plus size={13} className="text-[#007AFF] shrink-0" strokeWidth={2.5} />
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {q && empResults.length === 0 && (
                                                    <p className="text-[11px] text-slate-400 text-center py-2">Sin resultados para "{sfEmpSearch}"</p>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {sfScope === 'roles' && (
                                        <p className="text-[11px] text-slate-400 mt-2 ml-1">
                                            Solo aplicará a jefes/as de sala registrados en el sistema.
                                        </p>
                                    )}
                                </div>

                                {/* Submit */}
                                <button type="button" onClick={handleSaveSurvey} disabled={savingSurvey || !canManage}
                                    className={`w-full py-3 active:scale-[0.98] text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 border-none shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] disabled:opacity-40 disabled:cursor-not-allowed ${
                                        editingSurvey
                                            ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30'
                                            : 'bg-[#007AFF] hover:bg-[#0066CC]'
                                    }`}>
                                    {savingSurvey
                                        ? <><Loader2 size={15} className="animate-spin" /> Procesando…</>
                                        : editingSurvey
                                            ? <><Save size={15} strokeWidth={2.5} /> Guardar Cambios</>
                                            : <><Plus size={15} strokeWidth={2.5} /> Crear Encuesta</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ── Response form ────────────────────────────────────────── */}
                    {leftPanel === 'response-form' && canManage && (
                        <div className="bg-white/40 backdrop-blur-[30px] backdrop-saturate-[180%] border border-white/80 p-6 md:p-8 rounded-[2.5rem] shadow-[0_8px_30px_rgba(0,0,0,0.04),inset_0_2px_15px_rgba(255,255,255,0.7)]">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-[15px]">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingResponse ? 'bg-amber-500' : 'bg-[#007AFF]'}`}>
                                        {editingResponse ? <Edit3 size={16} strokeWidth={2.5} /> : <ClipboardList size={16} strokeWidth={2.5} />}
                                    </div>
                                    <span className="font-black uppercase tracking-tight ml-1">
                                        {editingResponse ? 'Editar Respuesta' : 'Nueva Respuesta'}
                                    </span>
                                </h3>
                                <button onClick={() => { setLeftPanel('survey-form'); resetResponseForm(); }}
                                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-red-500 bg-red-50 hover:bg-red-500 hover:text-white px-4 py-2 rounded-xl transition-all duration-300 border border-red-200 shadow-sm active:scale-95 group">
                                    <X size={14} strokeWidth={3} className="group-hover:rotate-90 transition-transform duration-300" /> Cancelar
                                </button>
                            </div>

                            <div className="space-y-5">
                                {/* Colaborador */}
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">Colaborador</label>
                                    {editingResponse ? (
                                        <div className="flex items-center gap-2.5 py-3 px-4 bg-white/50 border border-white/60 rounded-2xl">
                                            <PersonAvatar
                                                src={editingResponse.employee?.photo_url}
                                                name={`${(editingResponse.employee?.first_names || '').split(' ')[0]} ${(editingResponse.employee?.last_names || '').split(' ')[0]}`}
                                                size={24} />
                                            <div>
                                                <div className="text-[13px] font-bold text-slate-700">
                                                    {`${(editingResponse.employee?.first_names || '').split(' ')[0]} ${(editingResponse.employee?.last_names || '').split(' ')[0]}`}
                                                </div>
                                                <div className="text-[10px] text-slate-400">{editingResponse.employee?.branch?.name}</div>
                                            </div>
                                        </div>
                                    ) : (
                                        <LiquidSelect value={rfEmployeeId} onChange={setRfEmployeeId}
                                            options={availableEmployeeOptions}
                                            placeholder="Seleccionar empleado…"
                                            icon={Users} compact />
                                    )}
                                </div>

                                {/* Rol */}
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-2 block ml-1">Rol en encuesta</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button type="button" onClick={() => setRfIsJefe(false)}
                                            className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-xs transition-all duration-300 ${
                                                !rfIsJefe
                                                    ? 'bg-white/80 border-[#007AFF]/30 text-[#007AFF] shadow-[0_2px_10px_rgba(0,122,255,0.2)]'
                                                    : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white/80 hover:shadow-sm hover:-translate-y-0.5'
                                            }`}>
                                            <Users size={14} strokeWidth={2.5} /> Colaborador/a
                                        </button>
                                        <button type="button" onClick={() => setRfIsJefe(true)}
                                            className={`flex items-center justify-center gap-2 py-3 rounded-xl border font-bold text-xs transition-all duration-300 ${
                                                rfIsJefe
                                                    ? 'bg-amber-50/80 border-amber-300/60 text-amber-700 shadow-[0_2px_10px_rgba(245,158,11,0.2)]'
                                                    : 'bg-white/40 border-white/60 text-slate-500 hover:bg-white/80 hover:shadow-sm hover:-translate-y-0.5'
                                            }`}>
                                            <UserCheck size={14} strokeWidth={2.5} /> Jefe/a de sala
                                        </button>
                                    </div>
                                </div>

                                {/* Progress */}
                                {formPreguntas.length > 0 && (
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                                            <div className="h-full rounded-full bg-[#007AFF] transition-all duration-300"
                                                style={{ width: `${(rfAnsweredCount / formPreguntas.length) * 100}%` }} />
                                        </div>
                                        <span className="text-[11px] font-black text-slate-500 shrink-0 tabular-nums">
                                            {rfAnsweredCount}/{formPreguntas.length}
                                        </span>
                                    </div>
                                )}

                                {/* Questions by bloque */}
                                {bloques.map(bloque => {
                                    const bqs = preguntas.filter(p => p.bloque_id === bloque.id && p.tipo !== 'sucursal');
                                    if (!bqs.length) return null;
                                    const isOpen = rfOpenBloques[bloque.id];
                                    const answered = bqs.filter(p => rfAnswers[p.indice] !== null).length;
                                    const barCls = BAR_COLORS[bloque.color] || 'bg-slate-400';
                                    return (
                                        <div key={bloque.id} className="rounded-2xl border border-white/70 bg-white/30 backdrop-blur-sm overflow-hidden">
                                            <button className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/30 transition-colors"
                                                onClick={() => setRfOpenBloques(p => ({ ...p, [bloque.id]: !p[bloque.id] }))}>
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
                                                <div className="border-t border-white/50">
                                                    {bqs.map((p, qi) => {
                                                        const val = rfAnswers[p.indice];
                                                        return (
                                                            <div key={p.id}
                                                                className={`flex items-start gap-3 px-4 py-3 ${qi < bqs.length - 1 ? 'border-b border-white/40' : ''}`}>
                                                                <span className="shrink-0 w-5 h-5 rounded-md bg-white/60 flex items-center justify-center text-[8px] font-black text-slate-400 mt-0.5">
                                                                    {p.numero}
                                                                </span>
                                                                <p className="flex-1 text-[11px] text-slate-600 leading-snug pt-0.5 min-w-0">{p.texto}</p>
                                                                {p.tipo === 'numerica' ? (
                                                                    <div className="shrink-0 flex items-center gap-0.5 mt-0.5 flex-wrap justify-end">
                                                                        {[1,2,3,4,5,6,7,8,9,10].map(n => {
                                                                            const nStr = String(n);
                                                                            const exactMatch = val === nStr;
                                                                            const legacyMatch = (val === 'A' && n >= 9) || (val === 'B' && (n === 7 || n === 8)) ||
                                                                                               (val === 'C' && (n === 5 || n === 6)) || (val === 'D' && n <= 4);
                                                                            const isActive = exactMatch || legacyMatch;
                                                                            const oc = n >= 9 ? OPT_COLORS.A : n >= 7 ? OPT_COLORS.B : n >= 5 ? OPT_COLORS.C : OPT_COLORS.D;
                                                                            return (
                                                                                <button key={n}
                                                                                    onClick={() => setRfAnswer(p.indice, exactMatch ? null : nStr)}
                                                                                    className={`w-6 h-6 rounded-full text-[10px] font-black transition-all duration-150 ${isActive ? oc.on : oc.off}`}>
                                                                                    {n}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                ) : (
                                                                    <div className="shrink-0 flex items-center gap-1 mt-0.5">
                                                                        {['A','B','C','D'].map(opt => {
                                                                            const oc = OPT_COLORS[opt];
                                                                            return (
                                                                                <button key={opt} title={p.opciones?.[['A','B','C','D'].indexOf(opt)] || opt}
                                                                                    onClick={() => setRfAnswer(p.indice, val === opt ? null : opt)}
                                                                                    className={`w-7 h-7 rounded-full text-[11px] font-black transition-all duration-150 ${val === opt ? oc.on : oc.off}`}>
                                                                                    {opt}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Comentario */}
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] mb-1.5 block ml-1">Comentario (opcional)</label>
                                    <textarea value={rfComentario} onChange={e => setRfComentario(e.target.value)} rows={3}
                                        placeholder="¿Qué mejorarías del ambiente de trabajo?"
                                        className="w-full py-3.5 px-4 bg-white/50 border border-white/60 focus:bg-white focus:border-[#007AFF]/30 focus:shadow-[0_0_0_4px_rgba(0,122,255,0.15)] rounded-2xl text-[13px] outline-none font-medium text-slate-700 resize-none transition-all duration-300 placeholder-slate-400 placeholder:font-normal" />
                                </div>

                                {/* Submit */}
                                <button type="button" onClick={handleSaveResponse}
                                    disabled={(!editingResponse && !rfEmployeeId) || savingResponse || !canManage}
                                    className={`w-full py-4 mt-2 active:scale-[0.98] text-white rounded-[1.25rem] font-black uppercase tracking-widest text-[11px] transition-all flex items-center justify-center gap-2 border-none shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] disabled:opacity-40 disabled:cursor-not-allowed ${
                                        editingResponse ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30' : 'bg-[#007AFF] hover:bg-[#0066CC]'
                                    }`}>
                                    {savingResponse
                                        ? <><Loader2 size={16} className="animate-spin" /> Procesando…</>
                                        : editingResponse
                                            ? <><Save size={16} strokeWidth={2.5} /> Guardar Cambios</>
                                            : <><ClipboardList size={16} strokeWidth={2.5} /> Registrar Respuesta</>}
                                </button>
                            </div>
                        </div>
                    )}
                </div>}

                {/* ══ RIGHT PANEL ═════════════════════════════════════════════════ */}
                <div className="flex-1 flex flex-col min-w-0 w-full overflow-y-auto overscroll-contain pb-32 scrollbar-hide lg:h-full lg:-mt-[180px] lg:pt-[180px] pointer-events-auto">
                    <div className="space-y-5 flex-1 pt-4 px-3 md:px-4">

                        {loadingSurveys ? (
                            <div className="flex items-center justify-center h-40 gap-2 text-slate-400">
                                <Loader2 size={18} className="animate-spin" />
                                <span className="text-[12px] font-semibold">Cargando…</span>
                            </div>
                        ) : surveys.length === 0 ? (
                            <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-700">
                                <div className="relative group flex flex-col items-center text-center">
                                    <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 bg-[#007AFF]" />
                                    <div className="relative z-10 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 bg-white/60 backdrop-blur-xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.08)] text-[#007AFF] group-hover:-translate-y-2 transition-all duration-700">
                                        <BarChart2 size={40} strokeWidth={2} />
                                    </div>
                                    <h3 className="font-bold text-[22px] text-slate-800 tracking-tight mb-2">Sin encuestas aún</h3>
                                    <p className="font-medium text-[14px] text-slate-500 max-w-[280px] leading-relaxed">
                                        Crea la primera encuesta usando el formulario de la izquierda.
                                    </p>
                                </div>
                            </div>
                        ) : surveys.map(s => {
                            const count = responseCounts[s.id] || 0;
                            const isExpanded = expandedSurveyId === s.id;
                            const isEditing = editingSurvey?.id === s.id;
                            const globalAvg = isExpanded ? avgBlockScore(respuestas, allIndices, invertedIndices) : null;

                            return (
                                <div key={s.id} className={`rounded-[2.5rem] border flex flex-col transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] group relative transform-gpu ${
                                    isExpanded
                                        ? 'border-[#007AFF]/20 shadow-[0_12px_50px_rgba(0,0,0,0.10)] bg-white/80 backdrop-blur-2xl z-10'
                                        : isEditing
                                            ? 'bg-white/95 backdrop-blur-xl border-amber-300/60 shadow-[0_8px_30px_rgba(0,0,0,0.06)]'
                                            : 'border-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.03)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 bg-white/60 backdrop-blur-2xl'
                                }`}>

                                    {/* ── Card header ── */}
                                    <div className={`p-6 flex flex-col gap-4 ${!isExpanded ? 'cursor-pointer' : ''}`}
                                        onClick={() => { if (!isExpanded) toggleExpand(s); }}>

                                        {/* Action buttons */}
                                        <div className={`absolute top-5 right-5 flex items-center gap-2 transition-opacity duration-300 ${isEditing || isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                            {isExpanded && (
                                                <button onClick={e => { e.stopPropagation(); toggleExpand(s); }}
                                                    className="flex items-center gap-1.5 px-3 h-8 rounded-full text-[9px] font-black uppercase tracking-widest bg-white/80 border border-white/60 text-slate-500 hover:bg-white hover:text-slate-700 shadow-sm transition-all active:scale-95">
                                                    <ChevronUp size={10} strokeWidth={2.5} /> Colapsar
                                                </button>
                                            )}
                                            {canManage && (
                                            <button onClick={e => { e.stopPropagation(); loadSurveyIntoForm(s); }}
                                                className={`p-2.5 rounded-full transition-all duration-300 active:scale-95 shadow-sm border ${isEditing ? 'bg-amber-100 text-amber-600 border-amber-300 hover:bg-amber-500 hover:text-white' : 'bg-white/80 text-amber-500 border-amber-100 hover:bg-amber-50 hover:text-amber-600 hover:-translate-y-0.5 hover:shadow-md'}`}
                                                title="Editar encuesta">
                                                <Edit3 size={14} strokeWidth={2.5} />
                                            </button>
                                            )}
                                        </div>

                                        {/* Badges */}
                                        <div className="flex flex-wrap items-center gap-2 pr-28">
                                            <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md border tracking-widest ${
                                                s.estado === 'activa'    ? 'text-emerald-600 bg-emerald-50 border-emerald-200/50' :
                                                s.estado === 'cerrada'   ? 'text-blue-600 bg-blue-50 border-blue-200/50' :
                                                s.estado === 'borrador'  ? 'text-slate-500 bg-slate-50 border-slate-200/50' :
                                                                           'text-slate-400 bg-slate-100 border-slate-200/50'
                                            }`}>{s.estado}</span>
                                            <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-md border tracking-widest ${
                                                s.tipo === 'clima'        ? 'text-indigo-600 bg-indigo-50 border-indigo-200/50' :
                                                s.tipo === 'satisfaccion' ? 'text-teal-600 bg-teal-50 border-teal-200/50' :
                                                s.tipo === 'desempeno'    ? 'text-purple-600 bg-purple-50 border-purple-200/50' :
                                                                            'text-amber-600 bg-amber-50 border-amber-200/50'
                                            }`}>{TIPO_LABEL[s.tipo] || s.tipo}</span>
                                            {s.anonima && (
                                                <span className="flex items-center gap-1 text-violet-600 bg-violet-50 px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-widest border border-violet-200/50">
                                                    <EyeOff size={10} strokeWidth={2.5} /> Anónima
                                                </span>
                                            )}
                                            <span className="text-[10px] font-bold text-slate-400 tracking-widest bg-white/50 border border-white/60 px-2 py-1 rounded-md">
                                                {s.año}
                                            </span>
                                        </div>

                                        {/* Title */}
                                        <div>
                                            <h4 className="font-black text-slate-800 text-[18px] leading-tight mb-1 tracking-tight">{s.nombre}</h4>
                                            {s.descripcion && <p className="text-slate-500 text-[13px] leading-relaxed font-medium line-clamp-2">{s.descripcion}</p>}
                                        </div>

                                        {/* Footer */}
                                        <div className="flex items-center justify-between pt-3 border-t border-white/60">
                                            <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                                                <ClipboardList size={14} strokeWidth={2} />
                                                {count} {count === 1 ? 'respuesta' : 'respuestas'}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {(s.fecha_inicio || s.fecha_fin) && (
                                                    <div className="flex items-center gap-1 text-[11px] text-slate-400 font-bold uppercase tracking-widest">
                                                        <CalendarRange size={12} strokeWidth={2} />
                                                        {s.fecha_inicio}{s.fecha_fin ? ` → ${s.fecha_fin}` : ''}
                                                    </div>
                                                )}
                                                {!isExpanded && (
                                                    <button onClick={e => { e.stopPropagation(); toggleExpand(s); }}
                                                        className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#007AFF] px-3 h-7 rounded-full bg-[#007AFF]/10 hover:bg-[#007AFF]/20 transition-colors border border-[#007AFF]/20 active:scale-95">
                                                        Ver detalle <ChevronDown size={10} strokeWidth={2.5} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── Expanded detail ── */}
                                    {isExpanded && (
                                        <div className="border-t border-[#007AFF]/10 px-6 pb-6 pt-5 space-y-5">

                                            {/* Stats + actions row */}
                                            <div className="flex items-center justify-between flex-wrap gap-3">
                                                <div className="flex items-center gap-5">
                                                    <div className="text-center">
                                                        <p className="text-[22px] font-black text-slate-800 leading-none">{respuestas.length}</p>
                                                        <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">Respuestas</p>
                                                    </div>
                                                    {pendingEmployees.length > 0 && (
                                                        <div className="text-center">
                                                            <p className="text-[22px] font-black text-amber-600 leading-none">{pendingEmployees.length}</p>
                                                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">Pendientes</p>
                                                        </div>
                                                    )}
                                                    {globalAvg != null && (
                                                        <div className="text-center">
                                                            <p className={`text-[22px] font-black leading-none ${scoreColor(globalAvg)}`}>{globalAvg}%</p>
                                                            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mt-0.5">Promedio</p>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {s.tipo === 'clima' && (
                                                        <button onClick={() => navigate('/encuesta')}
                                                            className="flex items-center gap-1.5 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all border border-indigo-200/50 hover:-translate-y-0.5 active:scale-95">
                                                            <TrendingUp size={13} strokeWidth={2.5} /> Ver análisis
                                                        </button>
                                                    )}
                                                    {canManage && (
                                                    <button onClick={() => openResponseForm()}
                                                        className="flex items-center gap-2 px-4 py-2.5 bg-[#007AFF] hover:bg-[#0066CC] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-[0_4px_12px_rgba(0,122,255,0.3)] hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] hover:-translate-y-0.5 active:scale-95">
                                                        <Plus size={14} strokeWidth={2.5} /> Agregar
                                                    </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Pending employees */}
                                            {pendingEmployees.length > 0 && (
                                                <div className="p-4 rounded-[1.5rem] border border-amber-200/60 bg-amber-50/60 backdrop-blur-xl flex flex-col gap-2.5">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-1.5">
                                                        <AlertCircle size={12} strokeWidth={2.5} />
                                                        Pendientes ({pendingEmployees.length})
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {pendingEmployees.map(e => {
                                                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                                            return (
                                                                <div key={e.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200/60">
                                                                    <PersonAvatar src={e.photo_url} name={fn} size={16} />
                                                                    <span className="text-[10px] font-black text-amber-700">{fn}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Responses */}
                                            {loadingDetail ? (
                                                <div className="flex items-center justify-center h-32 gap-2 text-slate-400">
                                                    <Loader2 size={16} className="animate-spin" />
                                                    <span className="text-[12px] font-semibold">Cargando…</span>
                                                </div>
                                            ) : respuestas.length === 0 ? (
                                                <div className="flex flex-col items-center justify-center min-h-[180px] text-center">
                                                    <ClipboardList size={32} strokeWidth={1.5} className="text-slate-300 mb-3" />
                                                    <p className="text-[13px] font-bold text-slate-400">Sin respuestas registradas</p>
                                                    <p className="text-[11px] text-slate-300 mt-1">Usa el botón "Agregar" para comenzar.</p>
                                                </div>
                                            ) : (
                                                responsesByBranch.map(([branchName, group]) => {
                                                    const allRows = [...group.jefes, ...group.colabs];
                                                    return (
                                                        <div key={branchName} className="rounded-[1.75rem] border border-white/80 bg-white/40 backdrop-blur-xl overflow-hidden">
                                                            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/50 bg-white/20">
                                                                <Building2 size={13} strokeWidth={2.5} className="text-slate-400" />
                                                                <span className="text-[12px] font-black text-slate-700">{branchName}</span>
                                                                <span className="text-[11px] text-slate-400">— {allRows.length} {allRows.length === 1 ? 'respuesta' : 'respuestas'}</span>
                                                            </div>
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full min-w-[520px]">
                                                                    <thead>
                                                                        <tr className="border-b border-white/50">
                                                                            <th className="text-left py-2.5 pl-5 pr-3 text-[9px] font-black uppercase tracking-wider text-slate-400">Colaborador</th>
                                                                            <th className="text-center py-2.5 px-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Rol</th>
                                                                            {bloques.map(b => (
                                                                                <th key={b.id} title={b.nombre || `Bloque ${b.numero}`} className="text-center py-2.5 px-2 text-[8px] font-black uppercase tracking-wider text-slate-300 cursor-help">B{b.numero}</th>
                                                                            ))}
                                                                            <th className="text-center py-2.5 px-2 text-[9px] font-black uppercase tracking-wider text-slate-400">Global</th>
                                                                            <th className="py-2.5 w-20 pr-3" />
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {allRows.map(row => {
                                                                            const fn = (row.employee?.first_names || '').split(' ')[0];
                                                                            const ln = (row.employee?.last_names  || '').split(' ')[0];
                                                                            const nombre = `${fn} ${ln}`.trim() || '–';
                                                                            const global = blockScore(row.responses || [], allIndices, invertedIndices);
                                                                            const isRowExp = expandedResponseId === row.id;
                                                                            return (
                                                                                <React.Fragment key={row.id}>
                                                                                    <tr className={`border-b border-white/40 last:border-0 transition-colors group/row ${isRowExp ? 'bg-[#007AFF]/5' : 'hover:bg-white/20'}`}>
                                                                                        <td className="py-2.5 pl-5 pr-3">
                                                                                            <button
                                                                                                className="flex items-center gap-2 text-left w-full"
                                                                                                onClick={() => setExpandedResponseId(isRowExp ? null : row.id)}>
                                                                                                <PersonAvatar src={row.employee?.photo_url} name={nombre} isJefe={row.is_jefe} size={26} />
                                                                                                <span className="text-[12px] font-black text-slate-800">{nombre}</span>
                                                                                                {isRowExp
                                                                                                    ? <ChevronUp size={10} className="text-[#007AFF] ml-1 shrink-0" strokeWidth={2.5} />
                                                                                                    : <ChevronDown size={10} className="text-slate-300 ml-1 shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity" strokeWidth={2.5} />}
                                                                                            </button>
                                                                                        </td>
                                                                                        <td className="py-2.5 px-2 text-center">
                                                                                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${row.is_jefe ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                                                                {row.is_jefe ? 'Jefe/a' : 'Colab.'}
                                                                                            </span>
                                                                                        </td>
                                                                                        {bloques.map(b => {
                                                                                            const sc = blockScore(row.responses || [], b.indices || [], invertedIndices);
                                                                                            return (
                                                                                                <td key={b.id} title={b.nombre || `Bloque ${b.numero}`} className="py-2.5 px-2 text-center cursor-help">
                                                                                                    {sc != null
                                                                                                        ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-lg ${scoreBg(sc)}`}>{sc}</span>
                                                                                                        : <span className="text-slate-200 text-[10px]">—</span>}
                                                                                                </td>
                                                                                            );
                                                                                        })}
                                                                                        <td className="py-2.5 px-2 text-center">
                                                                                            <span className={`text-[12px] font-black ${scoreColor(global)}`}>
                                                                                                {global != null ? `${global}%` : '–'}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className="py-2.5 pr-4">
                                                                                            {confirmDelete === row.id ? (
                                                                                                <div className="flex items-center gap-1 justify-center">
                                                                                                    <button onClick={() => handleDeleteResponse(row)}
                                                                                                        className="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors">
                                                                                                        <Check size={10} strokeWidth={3} />
                                                                                                    </button>
                                                                                                    <button onClick={() => setConfirmDelete(null)}
                                                                                                        className="w-6 h-6 rounded-full bg-white/80 text-slate-400 flex items-center justify-center hover:bg-white transition-colors border border-white/60">
                                                                                                        <X size={10} strokeWidth={3} />
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : canManage ? (
                                                                                                <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity justify-center">
                                                                                                    <button onClick={() => openResponseForm(row)}
                                                                                                        className="p-1.5 rounded-full bg-white/80 text-amber-500 border border-amber-100 hover:bg-amber-50 hover:text-amber-600 hover:-translate-y-0.5 hover:shadow-md transition-all active:scale-95">
                                                                                                        <Edit3 size={11} strokeWidth={2.5} />
                                                                                                    </button>
                                                                                                    <button onClick={() => setConfirmDelete(row.id)}
                                                                                                        className="p-1.5 rounded-full bg-white/80 text-red-400 border border-red-50 hover:bg-red-50 hover:text-red-600 hover:-translate-y-0.5 hover:shadow-md transition-all active:scale-95">
                                                                                                        <Trash2 size={11} strokeWidth={2.5} />
                                                                                                    </button>
                                                                                                </div>
                                                                                            ) : null}
                                                                                        </td>
                                                                                    </tr>

                                                                                    {/* Expanded Q&A viewer */}
                                                                                    {isRowExp && (
                                                                                        <tr>
                                                                                            <td colSpan={bloques.length + 4} className="px-5 pb-5 pt-2 bg-[#007AFF]/[0.03]">
                                                                                                <div className="space-y-2.5">
                                                                                                    {bloques.map(bloque => {
                                                                                                        const bqs = preguntas.filter(p => p.bloque_id === bloque.id && p.tipo !== 'sucursal');
                                                                                                        if (!bqs.length) return null;
                                                                                                        const barCls = BAR_COLORS[bloque.color] || 'bg-slate-400';
                                                                                                        const bsc = blockScore(row.responses || [], bloque.indices || [], invertedIndices);
                                                                                                        return (
                                                                                                            <div key={bloque.id} className="rounded-xl border border-white/70 bg-white/60 overflow-hidden">
                                                                                                                <div className={`flex items-center justify-between px-4 py-2 border-b border-white/50 ${barCls} bg-opacity-10`}>
                                                                                                                    <div className="flex items-center gap-2">
                                                                                                                        <div className={`w-5 h-5 rounded flex items-center justify-center text-[8px] font-black text-white shrink-0 ${barCls}`}>
                                                                                                                            B{bloque.numero}
                                                                                                                        </div>
                                                                                                                        <span className="text-[11px] font-black text-slate-700">{bloque.nombre}</span>
                                                                                                                    </div>
                                                                                                                    {bsc != null && (
                                                                                                                        <span className={`text-[11px] font-black px-2 py-0.5 rounded-lg ${scoreBg(bsc)}`}>{bsc}%</span>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                                <div className="divide-y divide-white/40">
                                                                                                                    {bqs.map(p => {
                                                                                                                        const ans = row.responses?.[p.indice];
                                                                                                                        return (
                                                                                                                            <div key={p.id} className="flex items-start gap-3 px-4 py-2">
                                                                                                                                <span className="shrink-0 w-4 h-4 rounded bg-white/60 flex items-center justify-center text-[7px] font-black text-slate-400 mt-0.5">{p.numero}</span>
                                                                                                                                <p className="flex-1 text-[11px] text-slate-600 leading-snug min-w-0">{p.texto}</p>
                                                                                                                                {p.tipo === 'numerica' ? (
                                                                                                                                    <div className="shrink-0 flex items-center gap-0.5 flex-wrap justify-end">
                                                                                                                                        {[1,2,3,4,5,6,7,8,9,10].map(n => {
                                                                                                                                            const nStr = String(n);
                                                                                                                                            const exactMatch = ans === nStr;
                                                                                                                                            const legacyMatch = (ans === 'A' && n >= 9) || (ans === 'B' && (n === 7 || n === 8)) ||
                                                                                                                                                               (ans === 'C' && (n === 5 || n === 6)) || (ans === 'D' && n <= 4);
                                                                                                                                            const isActive = exactMatch || legacyMatch;
                                                                                                                                            const oc = n >= 9 ? OPT_COLORS.A : n >= 7 ? OPT_COLORS.B : n >= 5 ? OPT_COLORS.C : OPT_COLORS.D;
                                                                                                                                            return (
                                                                                                                                                <span key={n}
                                                                                                                                                    className={`w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center transition-all ${isActive ? oc.on : 'bg-slate-50 text-slate-200'}`}>
                                                                                                                                                    {n}
                                                                                                                                                </span>
                                                                                                                                            );
                                                                                                                                        })}
                                                                                                                                    </div>
                                                                                                                                ) : (
                                                                                                                                    <div className="shrink-0 flex items-center gap-0.5">
                                                                                                                                        {['A','B','C','D'].map(opt => {
                                                                                                                                            const oc = OPT_COLORS[opt];
                                                                                                                                            return (
                                                                                                                                                <span key={opt}
                                                                                                                                                    title={p.opciones?.[['A','B','C','D'].indexOf(opt)] || opt}
                                                                                                                                                    className={`w-6 h-6 rounded-full text-[10px] font-black flex items-center justify-center transition-all ${ans === opt ? oc.on : 'bg-slate-50 text-slate-200'}`}>
                                                                                                                                                    {opt}
                                                                                                                                                </span>
                                                                                                                                            );
                                                                                                                                        })}
                                                                                                                                    </div>
                                                                                                                                )}
                                                                                                                            </div>
                                                                                                                        );
                                                                                                                    })}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                    {row.comentario && (
                                                                                                        <div className="rounded-xl border border-white/70 bg-white/60 px-4 py-3">
                                                                                                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1">Comentario</p>
                                                                                                            <p className="text-[12px] text-slate-600 leading-relaxed">{row.comentario}</p>
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            </td>
                                                                                        </tr>
                                                                                    )}
                                                                                </React.Fragment>
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
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </GlassViewLayout>
    );
}
