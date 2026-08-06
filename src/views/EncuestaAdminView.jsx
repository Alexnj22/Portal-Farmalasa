import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Badge from '../components/common/Badge';
import Button from '../components/common/Button';
import { SkeletonText, EmptyState} from '../components/common/StateViews';
import { useNavigate } from 'react-router-dom';
import { tokenMatch } from '../utils/searchUtils';
import {
    PenLine, Plus, Trash2, Users, UserCheck, Save, ChevronDown, ChevronUp,
    Check, X, Building2, BarChart2, ClipboardList,
    CalendarRange, Eye, EyeOff, Globe, Lock, Pencil, Search,
    AlertCircle, TrendingUp
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import { signPhotosDeep } from '../utils/storageFiles';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useToastStore } from '../store/toastStore';
import { useAuth } from '../context/AuthContext';
import PortalTextarea from '../components/common/PortalTextarea';
import SegmentedControl from '../components/common/SegmentedControl';
import ListRow from '../components/common/ListRow';
import FilterBar from '../components/common/FilterBar';
import PortalInput from '../components/common/PortalInput';
import {
    fetchSurveys, fetchSurveyResponseCounts, fetchEmployeesForSurvey, fetchSurveyBloques,
    fetchSurveyPreguntas, fetchSurveyResponses, updateSurvey, insertSurvey,
    updateSurveyResponse, insertSurveyResponse, deleteSurveyResponse,
} from '../data/encuestas';
import SearchInput from '../components/common/SearchInput';
import LiquidTooltip from '../components/common/LiquidTooltip';

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
    if (s == null) return 'text-content-3';
    if (s >= 85) return 'text-success';
    if (s >= 70) return 'text-chart-1-text';
    if (s >= 55) return 'text-warning';
    return 'text-danger-text';
}

// Tokenizado T7 — mismo criterio de EncuestaView.jsx (excelente/bueno/
// regular/crítico → success/chart-1/warning/danger).
// Devuelve el NOMBRE de la variante de `Badge`, no dos clases de Tailwind.
function scoreVariante(s) {
    if (s == null) return 'neutral';
    if (s >= 85) return 'success';
    if (s >= 70) return 'chart-1';
    if (s >= 55) return 'warning';
    return 'danger';
}

const BAR_COLORS = {
    blue: 'bg-chart-1', emerald: 'bg-success', amber: 'bg-warning',
    indigo: 'bg-chart-3', purple: 'bg-chart-3', teal: 'bg-chart-9',
    rose: 'bg-danger', slate: 'bg-content-3',
};

const OPT_COLORS = {
    A: { on: 'bg-success-solid text-white shadow-sm shadow-success/30', off: 'bg-success/10 text-success hover:bg-success/10' },
    B: { on: 'bg-chart-1-solid text-white shadow-sm shadow-chart-1/30',       off: 'bg-chart-1/10 text-chart-1-text hover:bg-chart-1/20' },
    C: { on: 'bg-warning-solid text-white shadow-sm shadow-warning/30',     off: 'bg-warning/10 text-warning hover:bg-warning/10' },
    D: { on: 'bg-danger-solid text-white shadow-sm shadow-danger/30',       off: 'bg-danger/10 text-danger-text hover:bg-danger/20' },
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
    desempeno:    'Evalúa el rendimiento individual y competencias de cada empleado.',
    adhoc:        'Encuesta libre para objetivos específicos que no encajan en los otros tipos.',
};

// El color de cada estado y cada tipo, como NOMBRE de variante de `Badge` —
// antes vivía en dos cascadas de ternarios dentro del JSX (2026-07-28, D3.5).
const VARIANTE_ESTADO = { activa: 'success', cerrada: 'chart-1', borrador: 'neutral', archivada: 'neutral' };
const VARIANTE_TIPO   = { clima: 'chart-3', satisfaccion: 'chart-9', desempeno: 'chart-6', adhoc: 'warning' };

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
    clima:        'bg-chart-3/10 text-chart-3-text',
    satisfaccion: 'bg-chart-9/10 text-chart-9-text',
    desempeno:    'bg-chart-6/10 text-chart-6-text',
    adhoc:        'bg-warning/10 text-warning-text',
};

const TIPO_LABEL = { clima: 'Clima', satisfaccion: 'Satisfacción', desempeno: 'Desempeño', adhoc: 'Personalizada' };

// ─── Avatar ───────────────────────────────────────────────────────────────────
function PersonAvatar({ src, name, isJefe, size = 28 }) {
    const cls = `rounded-full object-cover object-top shrink-0 ${isJefe ? 'ring-2 ring-warning/45 ring-offset-1' : ''}`;
    if (src) return <img src={src} alt={name} className={cls} style={{ width: size, height: size }} />;
    return (
        <div className={`rounded-full bg-gradient-to-br from-chart-1 to-brand flex items-center justify-center text-white font-black shrink-0 ${isJefe ? 'ring-2 ring-warning/45 ring-offset-1' : ''}`}
            style={{ width: size, height: size, fontSize: size * 0.38 }}>
            {name?.charAt(0) || '?'}
        </div>
    );
}

// `SegmentControl` vivía acá: el canónico `SegmentedControl` reescrito a mano
// **en un archivo que ya importaba el canónico y lo usaba cinco veces**. Es el
// caso más claro de por qué D3.3 existe: no es que faltara el componente, es
// que nadie lo buscó antes de escribir otro. (2026-07-28)

function computeTenureCategory(hireDateStr) {
    if (!hireDateStr) return null;
    const months = (Date.now() - new Date(hireDateStr).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
    if (months < 12) return 'A';
    if (months < 36) return 'B';
    if (months < 60) return 'C';
    return 'D';
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
        const { data, error } = await fetchSurveys();
        if (error) console.error('loadSurveys: fetch surveys failed:', error.message);
        const list = data || [];
        setSurveys(list);
        if (list.length) {
            const { data: counts, error: countsErr } = await fetchSurveyResponseCounts(list.map(s => s.id));
            if (countsErr) console.error('loadSurveys: fetch survey_responses failed:', countsErr.message);
            const map = {};
            list.forEach(s => { map[s.id] = 0; });
            (counts || []).forEach(r => { map[r.survey_id] = (map[r.survey_id] || 0) + 1; });
            setResponseCounts(map);
        }
        setLoadingSurveys(false);
    }, []);

    useEffect(() => { loadSurveys(); }, [loadSurveys]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    useEffect(() => {
        fetchEmployeesForSurvey()
            .then(async ({ data, error }) => {
                if (error) console.error('EncuestaAdminView: fetch employees failed:', error.message);
                setEmployees(await signPhotosDeep(data || []));
            });
    }, []);

    const loadDetail = useCallback(async (survey) => {
        if (!survey) return;
        setLoadingDetail(true);
        const [bRes, pRes, rRes] = await Promise.all([
            fetchSurveyBloques(survey.id),
            fetchSurveyPreguntas(survey.id),
            fetchSurveyResponses(survey.id),
        ]);
        const bData = bRes.data || [];
        const pData = pRes.data || [];
        setBloques(bData);
        setPreguntas(pData);
        const sorted = (await signPhotosDeep(rRes.data || [])).sort((a, b) => {
            if (a.is_jefe !== b.is_jefe) return a.is_jefe ? -1 : 1;
            return (a.employee?.branch?.name || '').localeCompare(b.employee?.branch?.name || '');
        });
        setRespuestas(sorted);
        const open = { general: true };
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
            const { error } = await updateSurvey(editingSurvey.id, payload);
            if (error) { showToast('Error', 'No se pudo actualizar.', 'error'); setSavingSurvey(false); return; }
            await appendAuditLog('ENCUESTA_ACTUALIZADA', null, { survey_id: editingSurvey.id });
            showToast('Actualizado', 'Encuesta actualizada.', 'success');
        } else {
            const { error } = await insertSurvey(payload);
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
            const { error } = await updateSurveyResponse(editingResponse.id,
                { is_jefe: rfIsJefe, responses: rfAnswers, comentario: rfComentario.trim() || null,
                    updated_at: new Date().toISOString() });
            if (error) { showToast('Error', 'No se pudo actualizar.', 'error'); setSavingResponse(false); return; }
            await appendAuditLog('ENCUESTA_RESPUESTA_EDITADA', empId, { survey_id: selectedSurvey.id, response_id: editingResponse.id });
            showToast('Actualizado', 'Respuesta actualizada.', 'success');
        } else {
            const { error } = await insertSurveyResponse({
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
        const { error } = await deleteSurveyResponse(row.id);
        if (error) { showToast('Error', 'No se pudo eliminar.', 'error'); return; }
        await appendAuditLog('ENCUESTA_RESPUESTA_ELIMINADA', row.employee_id, { survey_id: selectedSurvey.id });
        showToast('Eliminado', 'Respuesta eliminada.', 'success');
        setRespuestas(r => r.filter(x => x.id !== row.id));
        setResponseCounts(p => ({ ...p, [selectedSurvey.id]: Math.max(0, (p[selectedSurvey.id] || 1) - 1) }));
        setConfirmDelete(null);
    };

    const setRfAnswer = (idx, val) =>
        setRfAnswers(prev => { const a = [...prev]; a[idx] = val; return a; });

    // Auto-fill P1 (tiempo) and P2 (sucursal) from employee data for new responses
    useEffect(() => {
        if (!rfEmployeeId || editingResponse) return;
        const emp = employees.find(e => e.id === rfEmployeeId);
        if (!emp) return;
        const p1q = preguntas.find(p => p.numero === 1);
        const p2q = preguntas.find(p => p.numero === 2);
        const tenure   = computeTenureCategory(emp.hire_date);
        const branch   = emp.branch?.name || '';
        setRfAnswers(prev => { // eslint-disable-line react-hooks/set-state-in-effect -- autocompleta respuestas P1/P2 desde datos del empleado seleccionado
            const a = [...prev];
            if (p1q != null && tenure)  a[p1q.indice] = tenure;
            if (p2q != null && branch)  a[p2q.indice] = branch;
            return a;
        });
    }, [rfEmployeeId, preguntas, employees, editingResponse]);

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

    const respondedIds = useMemo(() => new Set(respuestas.map(r => r.employee_id)), [respuestas]);

    const availableEmployeeOptions = useMemo(() =>
        employees.filter(e => !respondedIds.has(e.id)).map(e => ({
            value: e.id,
            label: `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim(),
            sublabel: e.branch?.name || '',
            avatar: e.photo_url || '',
        })),
    [employees, respondedIds]);

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
        if (selectedSurvey.scope_tipo === 'roles' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => selectedSurvey.scope_ids.includes(e.role_id));
        else if (selectedSurvey.scope_tipo === 'branches' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => selectedSurvey.scope_ids.some(id => e.branch?.id === id));
        else if (selectedSurvey.scope_tipo === 'employees' && selectedSurvey.scope_ids?.length)
            pool = pool.filter(e => selectedSurvey.scope_ids.includes(e.id));
        else return [];
        return pool.filter(e => !respondedIds.has(e.id));
    }, [selectedSurvey, employees, respondedIds]);

    const formPreguntas = preguntas.filter(p => p.tipo !== 'sucursal');
    const rfAnsweredCount = formPreguntas.filter(p => rfAnswers[p.indice] !== null).length;

    // ── Header ────────────────────────────────────────────────────────────────
    const filtersContent = (
        // El contenedor de píldora envolvía UN botón: no es una barra de
        // pestañas ni de filtros, así que no necesita contenedor (§16.9).
        <Button variant="secondary" size="sm" icon={ClipboardList}>
            <span className="hidden sm:inline">Encuestas</span>
        </Button>
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
                {canManage && <div className="w-full lg:w-[560px] xl:w-[620px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 z-sidebar transform-gpu">

                    {/* ── Survey form ─────────────────────────────────────────── */}
                    {leftPanel === 'survey-form' && canManage && (
                        <div data-surface="card" className={`p-5 transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] relative overflow-visible ${ editingSurvey ? 'border-warning/40 shadow-[var(--shadow-glass-4)]' : 'border-border-card shadow-[var(--shadow-glass-3)] hover:shadow-[var(--shadow-glass-5)]' }`}>

                            <div className="flex justify-between items-center mb-4">
                                <h3 className="font-bold text-content flex items-center gap-2 text-body-lg">
                                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-white shadow-sm ${editingSurvey ? 'bg-warning-solid' : 'bg-brand'}`}>
                                        {editingSurvey ? <Pencil size={14} strokeWidth={2.5} /> : <Plus size={14} strokeWidth={2.5} />}
                                    </div>
                                    <span className="font-black uppercase tracking-tight ml-0.5">
                                        {editingSurvey ? 'Editar Encuesta' : 'Nueva Encuesta'}
                                    </span>
                                </h3>
                                {editingSurvey && (
                                    <Button variant="secondary" icon={X} onClick={resetSurveyForm}>Cancelar</Button>
                                )}
                            </div>

                            {sfError && (
                                <div className="mb-3 bg-warning/10 border border-warning/30 text-warning-text px-3 py-2 rounded-2xl text-label font-bold flex items-start gap-2">
                                    <AlertCircle size={14} className="text-warning shrink-0 mt-0.5" strokeWidth={2.5} />
                                    <span className="leading-tight">{sfError}</span>
                                </div>
                            )}

                            <div className="space-y-3">
                                {/* Título */}
                                <PortalInput
                                    name="sf-nombre"
                                    label="Título"
                                    required
                                    placeholder="Encuesta de clima organizacional…"
                                    value={sfNombre}
                                    onChange={e => setSfNombre(e.target.value)}
                                />

                                {/* Año + Estado */}
                                <div className="grid grid-cols-[100px_1fr] gap-3 items-end">
                                    <PortalInput
                                            name="sf-anio"
                                            label="Año"
                                            type="number"
                                            value={sfAño}
                                            onChange={e => setSfAño(e.target.value)}
                                        />
                                    <div>
                                        <label className="text-micro font-black text-content-3 uppercase tracking-[0.15em] mb-1 block ml-1">Estado</label>
                                        <SegmentedControl size="sm" tone="neutro" label="Estado de la encuesta"
                                            options={ESTADO_TABS.map(t => ({ value: t.id, label: t.label }))}
                                            value={sfEstado} onChange={setSfEstado} />
                                    </div>
                                </div>

                                {/* Tipo */}
                                <div>
                                    <label className="text-micro font-black text-content-3 uppercase tracking-[0.15em] mb-1 block ml-1">Tipo de encuesta</label>
                                    <SegmentedControl tone="neutro" label="Tipo de encuesta"
                                        options={TIPO_TABS.map(t => ({ value: t.id, label: t.label }))}
                                        value={sfTipo} onChange={setSfTipo} />
                                    <p className="text-caption text-content-3 mt-1.5 ml-1 leading-snug">{TIPO_DESC[sfTipo]}</p>
                                </div>

                                {/* Descripción */}
                                <div>
                                    <label className="text-micro font-black text-content-3 uppercase tracking-[0.15em] mb-1 block ml-1">Descripción <span className="normal-case font-semibold">(opcional)</span></label>
                                    <PortalTextarea
                                        value={sfDescripcion}
                                        onChange={e => setSfDescripcion(e.target.value)}
                                        rows={2}
                                        placeholder="Objetivo específico de esta encuesta…"
                                    />
                                </div>

                                {/* Fechas */}
                                <div>
                                    <label className="text-micro font-black text-content-3 uppercase tracking-[0.15em] mb-1 block ml-1 flex items-center gap-1">
                                        <CalendarRange size={10} strokeWidth={2.5} /> Período de aplicación
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <p className="text-micro font-black text-content-3 uppercase tracking-[0.12em] mb-1 ml-1">Inicio</p>
                                            <div className="h-[42px] bg-surface-card border border-border-card rounded-2xl focus-within:bg-surface-card focus-within:border-brand/30 focus-within:shadow-[var(--shadow-ring-brand)] hover:bg-surface-card hover:border-border-card hover:shadow-sm transition-all duration-[var(--dur-slow)]">
                                                <LiquidDatePicker value={sfFechaInicio} onChange={setSfFechaInicio} placeholder="Seleccionar…" />
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-micro font-black text-content-3 uppercase tracking-[0.12em] mb-1 ml-1">Fin</p>
                                            <div className="h-[42px] bg-surface-card border border-border-card rounded-2xl focus-within:bg-surface-card focus-within:border-brand/30 focus-within:shadow-[var(--shadow-ring-brand)] hover:bg-surface-card hover:border-border-card hover:shadow-sm transition-all duration-[var(--dur-slow)]">
                                                <LiquidDatePicker value={sfFechaFin} onChange={setSfFechaFin} placeholder="Seleccionar…" />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Privacidad */}
                                <div>
                                    <label className="text-micro font-black text-content-3 uppercase tracking-[0.15em] mb-1 block ml-1 flex items-center gap-1">
                                        <Lock size={10} strokeWidth={2.5} /> Privacidad
                                    </label>
                                    {/* Cada uno alterna entre DOS estados con nombre
                                        propio ("Anónima"/"No anónima"), así que es un
                                        uno-de-N de dos opciones y no un interruptor:
                                        con `Switch` la opción apagada se quedaría sin
                                        nombre. */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <SegmentedControl
                                            size="sm" tone="chart-3" label="Privacidad de las respuestas"
                                            value={sfAnonima ? 'si' : 'no'}
                                            onChange={v => setSfAnonima(v === 'si')}
                                            options={[
                                                { value: 'no', label: 'No anónima', icon: Eye },
                                                { value: 'si', label: 'Anónima',    icon: EyeOff },
                                            ]}
                                        />
                                        <SegmentedControl
                                            size="sm" tone="success" label="Visibilidad de los resultados"
                                            value={sfCompartir ? 'si' : 'no'}
                                            onChange={v => setSfCompartir(v === 'si')}
                                            options={[
                                                { value: 'no', label: 'Privado',  icon: Lock },
                                                { value: 'si', label: 'Públicos', icon: Globe },
                                            ]}
                                        />
                                    </div>
                                    <p className={`text-caption mt-1.5 ml-1 flex items-start gap-1.5 leading-snug ${sfAnonima ? 'text-chart-3-text' : 'text-content-3'}`}>
                                        <AlertCircle size={11} strokeWidth={2.5} className="shrink-0 mt-0.5" />
                                        {sfAnonima
                                            ? 'Internamente se guarda quién respondió, pero el empleado no verá su propia atribución.'
                                            : 'Cada respuesta es visible con el nombre del empleado.'}
                                    </p>
                                    <p className={`text-caption mt-1 ml-1 flex items-start gap-1.5 leading-snug ${sfCompartir ? 'text-success' : 'text-content-3'}`}>
                                        <Globe size={11} strokeWidth={2.5} className="shrink-0 mt-0.5" />
                                        {sfCompartir
                                            ? 'Los resultados generales serán visibles para los empleados.'
                                            : 'Los resultados solo son visibles para administradores.'}
                                    </p>
                                </div>

                                {/* Audiencia */}
                                <div>
                                    <label className="text-micro font-black text-content-3 uppercase tracking-[0.15em] mb-1 block ml-1 flex items-center gap-1">
                                        <Users size={10} strokeWidth={2.5} /> Dirigida a
                                    </label>
                                    <SegmentedControl tone="neutro" label="A quién va dirigida"
                                        options={SCOPE_TABS.map(t => ({ value: t.id, label: t.label }))}
                                        value={sfScope} onChange={v => { setSfScope(v); setSfScopeIds([]); setSfEmpSearch(''); }} />

                                    {/* Los chips de sucursal son selección MÚLTIPLE, no uno-de-N:
                                        por eso `FilterBar.Chip` y no `SegmentedControl`. Un
                                        `radiogroup` diría "1 de 6" para algo donde pueden estar
                                        las seis a la vez. */}
                                    {sfScope === 'branches' && (
                                        <div className="flex flex-wrap gap-2 mt-2">
                                            {storeBranches.map(b => (
                                                <FilterBar.Chip key={b.id} tone="brand"
                                                    active={sfScopeIds.includes(b.id)}
                                                    onToggle={() => toggleScopeId(b.id)}>
                                                    <Building2 size={9} strokeWidth={2.5} /> {b.name}
                                                </FilterBar.Chip>
                                            ))}
                                        </div>
                                    )}

                                    {sfScope === 'employees' && (() => {
                                        const q = sfEmpSearch.trim();
                                        const empResults = q
                                            ? employees.filter(e => {
                                                const fn = `${e.first_names || ''} ${e.last_names || ''}`;
                                                return tokenMatch(q, fn) && !sfScopeIds.includes(e.id);
                                            }).slice(0, 8)
                                            : [];
                                        const selectedEmps = employees.filter(e => sfScopeIds.includes(e.id));
                                        return (
                                            <div className="mt-2 space-y-2">
                                                {selectedEmps.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5 p-2.5 bg-surface-card rounded-2xl border border-border-card">
                                                        {selectedEmps.map(e => {
                                                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                                            return (
                                                                <div key={e.id} className="flex items-center gap-1.5 bg-brand/10 text-brand-text px-2.5 py-1 rounded-lg text-label font-bold border border-brand/20">
                                                                    <PersonAvatar src={e.photo_url} name={fn} size={16} />
                                                                    <span>{fn}</span>
                                                                    <Button variant="ghost" icon={X} iconOnly onClick={() => toggleScopeId(e.id)} />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                <SearchInput
                                                    size="sm"
                                                    placeholder="Buscar por nombre…"
                                                    ariaLabel="Buscar un empleado por su nombre"
                                                    value={sfEmpSearch}
                                                    onChange={setSfEmpSearch}
                                                />
                                                {empResults.length > 0 && (
                                                    <div data-surface="card" className="overflow-hidden">
                                                        {empResults.map(e => {
                                                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                                            return (
                                                                <button key={e.id} type="button"
                                                                    aria-pressed={sfScopeIds.includes(e.id)}
                                                                    onClick={() => { toggleScopeId(e.id); setSfEmpSearch(''); }}
                                                                    className="w-full px-4 py-2.5 hover:bg-brand/10 text-left flex items-center gap-3 transition-colors border-b border-divider last:border-0">
                                                                    <PersonAvatar src={e.photo_url} name={fn} size={24} />
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-body-sm font-bold text-content-2">{fn}</p>
                                                                        <p className="text-caption text-content-3">{e.branch?.name}</p>
                                                                    </div>
                                                                    <Plus size={13} className="text-brand-text shrink-0" strokeWidth={2.5} />
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {q && empResults.length === 0 && (
                                                    <p className="text-label text-content-3 text-center py-2">Sin resultados para "{sfEmpSearch}"</p>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {sfScope === 'roles' && (
                                        <p className="text-label text-content-3 mt-2 ml-1">
                                            Solo aplicará a jefes/as de sala registrados en el sistema.
                                        </p>
                                    )}
                                </div>

                                {/* Submit */}
                                <Button
                                    onClick={handleSaveSurvey}
                                    loading={savingSurvey}
                                    disabled={!canManage}
                                    size="lg"
                                    className="w-full"
                                    tone={editingSurvey ? 'warning' : null}
                                    icon={editingSurvey ? Save : Plus}
                                >
                                    {savingSurvey
                                        ? 'Procesando…'
                                        : editingSurvey
                                            ? 'Guardar Cambios'
                                            : 'Crear Encuesta'}
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* ── Response form ────────────────────────────────────────── */}
                    {leftPanel === 'response-form' && canManage && (
                        <div data-surface="card" className="p-6 md:p-8">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="font-bold text-content flex items-center gap-2 text-subtitle">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${editingResponse ? 'bg-warning-solid' : 'bg-brand'}`}>
                                        {editingResponse ? <Pencil size={16} strokeWidth={2.5} /> : <ClipboardList size={16} strokeWidth={2.5} />}
                                    </div>
                                    <span className="font-black uppercase tracking-tight ml-1">
                                        {editingResponse ? 'Editar Respuesta' : 'Nueva Respuesta'}
                                    </span>
                                </h3>
                                <Button variant="secondary" icon={X} onClick={() => { setLeftPanel('survey-form'); resetResponseForm(); }}>Cancelar</Button>
                            </div>

                            <div className="space-y-5">
                                {/* Empleado */}
                                <div>
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Empleado</label>
                                    {editingResponse ? (
                                        <div data-surface="card" className="flex items-center gap-2.5 py-3 px-4">
                                            <PersonAvatar
                                                src={editingResponse.employee?.photo_url}
                                                name={`${(editingResponse.employee?.first_names || '').split(' ')[0]} ${(editingResponse.employee?.last_names || '').split(' ')[0]}`}
                                                size={24} />
                                            <div>
                                                <div className="text-body font-bold text-content-2">
                                                    {`${(editingResponse.employee?.first_names || '').split(' ')[0]} ${(editingResponse.employee?.last_names || '').split(' ')[0]}`}
                                                </div>
                                                <div className="text-caption text-content-3">{editingResponse.employee?.branch?.name}</div>
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
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-2 block ml-1">Rol en encuesta</label>
                                    {/* Dos opciones excluyentes: es un uno-de-N, no dos
                                        botones. Con `SegmentedControl` gana el
                                        `role="radiogroup"` que un lector de pantalla
                                        necesita para anunciar "1 de 2". */}
                                    <SegmentedControl
                                        label="Rol en encuesta"
                                        value={rfIsJefe ? 'jefe' : 'empleado'}
                                        onChange={v => setRfIsJefe(v === 'jefe')}
                                        options={[
                                            { value: 'empleado', label: 'Empleado/a',     icon: Users },
                                            { value: 'jefe',     label: 'Jefe/a de sala', icon: UserCheck },
                                        ]}
                                    />
                                </div>

                                {/* Progress */}
                                {formPreguntas.length > 0 && (
                                    <div className="flex items-center gap-3">
                                        <div className="flex-1 h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                                            <div className="h-full rounded-full bg-brand transition-all duration-[var(--dur-slow)]"
                                                style={{ width: `${(rfAnsweredCount / formPreguntas.length) * 100}%` }} />
                                        </div>
                                        <span className="text-label font-black text-content-3 shrink-0 tabular-nums">
                                            {rfAnsweredCount}/{formPreguntas.length}
                                        </span>
                                    </div>
                                )}

                                {/* Preguntas generales (sin bloque) */}
                                {(() => {
                                    const gqs = preguntas.filter(p => p.bloque_id === null && p.tipo !== 'sucursal' && p.numero !== 1);
                                    if (!gqs.length) return null;
                                    const isOpen = rfOpenBloques['general'];
                                    const answered = gqs.filter(p => rfAnswers[p.indice] !== null).length;
                                    return (
                                        <div data-surface="card" className="overflow-hidden">
                                            {/* La ranura `leading` de `ListRow` acepta una LETRA,
                                                no solo un ícono — se agregó precisamente por estos
                                                bloques de encuesta ("G", "B3"). */}
                                            <ListRow density="sm"
                                                leading={<span className="text-label font-black text-white">G</span>}
                                                iconBoxClass="bg-content-3 border-transparent"
                                                title={<>Datos Generales<span className="ml-2 text-caption text-content-3 font-semibold">{answered}/{gqs.length}</span></>}
                                                onClick={() => setRfOpenBloques(p => ({ ...p, general: !p.general }))}
                                                aria-expanded={isOpen}
                                                className="rounded-none border-x-0 border-t-0 px-4"
                                                trailing={<>
                                                    {answered === gqs.length && <Check size={13} className="text-success" strokeWidth={3} />}
                                                    {isOpen ? <ChevronUp size={13} className="text-content-3" /> : <ChevronDown size={13} className="text-content-3" />}
                                                </>} />
                                            {isOpen && (
                                                <div className="border-t border-border-card">
                                                    {gqs.map((p, qi) => {
                                                        const val = rfAnswers[p.indice];
                                                        return (
                                                            <div key={p.id}
                                                                className={`flex items-start gap-3 px-4 py-3 ${qi < gqs.length - 1 ? 'border-b border-border-card' : ''}`}>
                                                                <span className="shrink-0 w-5 h-5 rounded-md bg-surface-card flex items-center justify-center text-micro font-black text-content-3 mt-0.5">
                                                                    {p.numero}
                                                                </span>
                                                                <p className="flex-1 text-label text-content-2 leading-snug pt-0.5 min-w-0">{p.texto}</p>
                                                                <div className="shrink-0 flex items-center gap-1 mt-0.5">
                                                                    <SegmentedControl
                                                                        size="sm" tone="chart-1"
                                                                        options={['A','B','C','D'].map(opt => ({ value: opt, label: opt }))}
                                                                        value={val} onChange={v => setRfAnswer(p.indice, val === v ? null : v)}
                                                                        label="Respuesta" />
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Questions by bloque */}
                                {bloques.map(bloque => {
                                    const bqs = preguntas.filter(p => p.bloque_id === bloque.id && p.tipo !== 'sucursal');
                                    if (!bqs.length) return null;
                                    const isOpen = rfOpenBloques[bloque.id];
                                    const answered = bqs.filter(p => rfAnswers[p.indice] !== null).length;
                                    const barCls = BAR_COLORS[bloque.color] || 'bg-content-3';
                                    return (
                                        <div key={bloque.id} data-surface="card" className="overflow-hidden">
                                            <ListRow density="sm"
                                                leading={<span className="text-label font-black text-white">B{bloque.numero}</span>}
                                                iconBoxClass={`${barCls} border-transparent`}
                                                title={<>{bloque.nombre}<span className="ml-2 text-caption text-content-3 font-semibold">{answered}/{bqs.length}</span></>}
                                                onClick={() => setRfOpenBloques(p => ({ ...p, [bloque.id]: !p[bloque.id] }))}
                                                aria-expanded={isOpen}
                                                className="rounded-none border-x-0 border-t-0 px-4"
                                                trailing={<>
                                                    {answered === bqs.length && <Check size={13} className="text-success" strokeWidth={3} />}
                                                    {isOpen ? <ChevronUp size={13} className="text-content-3" /> : <ChevronDown size={13} className="text-content-3" />}
                                                </>} />
                                            {isOpen && (
                                                <div className="border-t border-border-card">
                                                    {bqs.map((p, qi) => {
                                                        const val = rfAnswers[p.indice];
                                                        return (
                                                            <div key={p.id}
                                                                className={`flex items-start gap-3 px-4 py-3 ${qi < bqs.length - 1 ? 'border-b border-border-card' : ''}`}>
                                                                <span className="shrink-0 w-5 h-5 rounded-md bg-surface-card flex items-center justify-center text-micro font-black text-content-3 mt-0.5">
                                                                    {p.numero}
                                                                </span>
                                                                <p className="flex-1 text-label text-content-2 leading-snug pt-0.5 min-w-0">{p.texto}</p>
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
                                                                                    aria-pressed={isActive}
                                                                                    aria-label={`Calificación ${n} de 10`}
                                                                                    onClick={() => setRfAnswer(p.indice, exactMatch ? null : nStr)}
                                                                                    className={`w-6 h-6 rounded-full text-caption font-black transition-all duration-[var(--dur-fast)] ${isActive ? oc.on : oc.off}`}>
                                                                                    {n}
                                                                                </button>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                ) : (
                                                                    <div className="shrink-0 flex items-center gap-1 mt-0.5">
                                                                        <SegmentedControl
                                                                            size="sm" tone="chart-1"
                                                                            options={['A','B','C','D'].map(opt => ({ value: opt, label: opt }))}
                                                                            value={val} onChange={v => setRfAnswer(p.indice, val === v ? null : v)}
                                                                            label="Respuesta" />
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
                                    <label className="text-caption font-black text-content-3 uppercase tracking-[0.15em] mb-1.5 block ml-1">Comentario (opcional)</label>
                                    <PortalTextarea
                                        value={rfComentario}
                                        onChange={e => setRfComentario(e.target.value)}
                                        rows={3}
                                        placeholder="¿Qué mejorarías del ambiente de trabajo?"
                                    />
                                </div>

                                {/* Submit */}
                                <Button
                                    onClick={handleSaveResponse}
                                    loading={savingResponse}
                                    disabled={(!editingResponse && !rfEmployeeId) || !canManage}
                                    size="lg"
                                    className="w-full mt-2"
                                    tone={editingResponse ? 'warning' : null}
                                    icon={editingResponse ? Save : ClipboardList}
                                >
                                    {savingResponse
                                        ? 'Procesando…'
                                        : editingResponse ? 'Guardar Cambios' : 'Registrar Respuesta'}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>}

                {/* ══ RIGHT PANEL ═════════════════════════════════════════════════ */}
                <div className="flex-1 flex flex-col min-w-0 w-full overflow-y-auto overscroll-contain pb-32 scrollbar-hide lg:h-[100dvh] lg:-mt-[180px] xl:-mt-[200px] lg:pt-[180px] xl:pt-[200px] pointer-events-auto">
                    <div className="space-y-5 pt-4 px-3 md:px-4">

                        {loadingSurveys ? (
                            <div className="h-40 py-4"><SkeletonText lines={5} /></div>
                        ) : surveys.length === 0 ? (
                            <div className="flex flex-col items-center justify-center min-h-[400px] animate-in fade-in zoom-in-95 duration-[var(--dur-lento)]">
                                <div className="relative group flex flex-col items-center text-center">
                                    <div className="absolute top-2 w-28 h-28 rounded-full blur-[40px] opacity-30 bg-brand" />
                                    <div className="relative z-base w-24 h-24 rounded-modal flex items-center justify-center mb-6 bg-surface-card border border-border-card shadow-[var(--shadow-elevation-md)] text-brand-text group-hover:-translate-y-2 transition-all duration-[var(--dur-lento)]">
                                        <BarChart2 size={40} strokeWidth={2} />
                                    </div>
                                    <h3 className="font-bold text-title-lg text-content tracking-tight mb-2">Sin encuestas aún</h3>
                                    <p className="font-medium text-body-lg text-content-3 max-w-[280px] leading-relaxed">
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
                                <div key={s.id} className={`rounded-header border flex flex-col transition-all duration-[var(--dur-lento)] ease-[var(--ease-spring)] group relative transform-gpu ${
                                    isExpanded
                                        ? 'border-brand/20 shadow-[var(--shadow-elevation-md)] bg-surface-card z-base'
                                        : isEditing
                                            ? 'bg-surface-card backdrop-blur-xl border-warning/40 shadow-[var(--shadow-elevation-sm)]'
                                            : 'border-border-card shadow-[var(--shadow-elevation-xs)] hover:shadow-[var(--shadow-elevation-md)] hover:translate-y-[var(--lift-card)] bg-surface-card backdrop-blur-2xl'
                                }`}>

                                    {/* ── Card header ── */}
                                    <div className={`p-6 flex flex-col gap-4 ${!isExpanded ? 'cursor-pointer' : ''}`}
                                        onClick={() => { if (!isExpanded) toggleExpand(s); }}>

                                        {/* Action buttons */}
                                        <div className={`absolute top-5 right-5 flex items-center gap-2 transition-opacity duration-[var(--dur-slow)] ${isEditing || isExpanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                                            {isExpanded && (
                                                <Button variant="secondary" size="sm" icon={ChevronUp} onClick={e => { e.stopPropagation(); toggleExpand(s); }}>Colapsar</Button>
                                            )}
                                            {canManage && (
                                            <Button
                                                icon={Pencil}
                                                iconOnly
                                                size="sm"
                                                tone="warning"
                                                soft
                                                onClick={e => { e.stopPropagation(); loadSurveyIntoForm(s); }}
                                                title="Editar encuesta"
                                            />
                                            )}
                                        </div>

                                        {/* Badges */}
                                        <div className="flex flex-wrap items-center gap-2 pr-28">
                                            {/* Eran dos cascadas de ternarios escribiendo
                                                `text-X bg-X/10 border-X/30` por rama. El color de
                                                cada estado y cada tipo vive ahora en una tabla,
                                                junto a sus etiquetas. */}
                                            <Badge variant={VARIANTE_ESTADO[s.estado] || 'neutral'}>{s.estado}</Badge>
                                            <Badge variant={VARIANTE_TIPO[s.tipo] || 'warning'}>{TIPO_LABEL[s.tipo] || s.tipo}</Badge>
                                            {s.anonima && (
                                                <Badge variant="chart-3" icon={EyeOff}>Anónima</Badge>
                                            )}
                                            <Badge uppercase={false}>{s.año}</Badge>
                                        </div>

                                        {/* Title */}
                                        <div>
                                            <h4 className="font-black text-content text-title-sm leading-tight mb-1 tracking-tight">{s.nombre}</h4>
                                            {s.descripcion && <p className="text-content-3 text-body leading-relaxed font-medium line-clamp-2">{s.descripcion}</p>}
                                        </div>

                                        {/* Footer */}
                                        <div className="flex items-center justify-between pt-3 border-t border-border-card">
                                            <div className="flex items-center gap-2 text-label font-bold text-content-3">
                                                <ClipboardList size={14} strokeWidth={2} />
                                                {count} {count === 1 ? 'respuesta' : 'respuestas'}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {(s.fecha_inicio || s.fecha_fin) && (
                                                    <div className="flex items-center gap-1 text-label text-content-2 font-bold uppercase tracking-widest">
                                                        <CalendarRange size={12} strokeWidth={2} />
                                                        {s.fecha_inicio}{s.fecha_fin ? ` → ${s.fecha_fin}` : ''}
                                                    </div>
                                                )}
                                                {s.tipo === 'clima' && (
                                                    <Button tone="chart-3" size="xs" icon={TrendingUp} onClick={e => { e.stopPropagation(); navigate('/encuesta'); }}>Ver análisis</Button>
                                                )}
                                                {!isExpanded && (
                                                    <Button size="xs" onClick={e => { e.stopPropagation(); toggleExpand(s); }}>Ver detalle <ChevronDown size={10} strokeWidth={2.5} /></Button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── Expanded detail ── */}
                                    {isExpanded && (
                                        <div className="border-t border-brand/10 px-6 pb-6 pt-5 space-y-5">

                                            {/* Stats + actions row */}
                                            <div className="flex items-center justify-between flex-wrap gap-3">
                                                <div className="flex items-center gap-5">
                                                    <div className="text-center">
                                                        <p className="text-title-lg font-black text-content leading-none">{respuestas.length}</p>
                                                        <p className="text-micro text-content-2 font-black uppercase tracking-widest mt-0.5">Respuestas</p>
                                                    </div>
                                                    {pendingEmployees.length > 0 && (
                                                        <div className="text-center">
                                                            <p className="text-title-lg font-black text-warning leading-none">{pendingEmployees.length}</p>
                                                            <p className="text-micro text-content-2 font-black uppercase tracking-widest mt-0.5">Pendientes</p>
                                                        </div>
                                                    )}
                                                    {globalAvg != null && (
                                                        <div className="text-center">
                                                            <p className={`text-title-lg font-black leading-none ${scoreColor(globalAvg)}`}>{globalAvg}%</p>
                                                            <p className="text-micro text-content-2 font-black uppercase tracking-widest mt-0.5">Promedio</p>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {canManage && (
                                                    <Button icon={Plus} onClick={() => openResponseForm()}>Agregar</Button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Pending employees */}
                                            {pendingEmployees.length > 0 && (
                                                <div className="p-4 rounded-3xl border border-warning/30 bg-warning/10 flex flex-col gap-2.5">
                                                    <p className="text-caption font-black uppercase tracking-widest text-warning flex items-center gap-1.5">
                                                        <AlertCircle size={12} strokeWidth={2.5} />
                                                        Pendientes ({pendingEmployees.length})
                                                    </p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {pendingEmployees.map(e => {
                                                            const fn = `${(e.first_names || '').split(' ')[0]} ${(e.last_names || '').split(' ')[0]}`.trim();
                                                            return (
                                                                <div key={e.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning/10 border border-warning/30">
                                                                    <PersonAvatar src={e.photo_url} name={fn} size={16} />
                                                                    <span className="text-caption font-black text-warning-text">{fn}</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Responses */}
                                            {loadingDetail ? (
                                                <div className="h-32 py-3"><SkeletonText lines={4} /></div>
                                            ) : respuestas.length === 0 ? (
                                                <EmptyState compact icon={ClipboardList} title="Sin respuestas" subtitle="Usa el botón Agregar para comenzar." />
                                            ) : (
                                                responsesByBranch.map(([branchName, group]) => {
                                                    const allRows = [...group.jefes, ...group.colabs];
                                                    return (
                                                        <div key={branchName} data-surface="card" className="overflow-hidden">
                                                            <div className="flex items-center gap-2 px-5 py-3 border-b border-border-card bg-surface-card">
                                                                <Building2 size={13} strokeWidth={2.5} className="text-content-3" />
                                                                <span className="text-body-sm font-black text-content-2">{branchName}</span>
                                                                <span className="text-label text-content-3">— {allRows.length} {allRows.length === 1 ? 'respuesta' : 'respuestas'}</span>
                                                            </div>
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full min-w-[520px]">
                                                                    <thead>
                                                                        <tr className="border-b border-border-card">
                                                                            <th className="text-left py-2.5 pl-5 pr-3 text-micro font-black uppercase tracking-wider text-content-2">Empleado</th>
                                                                            <th className="text-center py-2.5 px-2 text-micro font-black uppercase tracking-wider text-content-2">Rol</th>
                                                                            {bloques.map(b => (
                                                                                <th key={b.id} className="text-center py-2.5 px-2 text-micro font-black uppercase tracking-wider text-content-2 cursor-help"><LiquidTooltip content={b.nombre || `Bloque ${b.numero}`}>B{b.numero}</LiquidTooltip></th>
                                                                            ))}
                                                                            <th className="text-center py-2.5 px-2 text-micro font-black uppercase tracking-wider text-content-2">Global</th>
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
                                                                                    <tr className={`border-b border-border-card last:border-0 transition-colors group/row ${isRowExp ? 'bg-brand/5' : 'hover:bg-surface-card'}`}>
                                                                                        <td className="py-2.5 pl-5 pr-3">
                                                                                            <Button variant="ghost" onClick={() => setExpandedResponseId(isRowExp ? null : row.id)}><PersonAvatar src={row.employee?.photo_url} name={nombre} isJefe={row.is_jefe} size={26} />
                                                                                                <span className="text-body-sm font-black text-content">{nombre}</span>
                                                                                                {isRowExp
                                                                                                    ? <ChevronUp size={10} className="text-brand-text ml-1 shrink-0" strokeWidth={2.5} />
                                                                                                    : <ChevronDown size={10} className="text-content-3 ml-1 shrink-0 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity" strokeWidth={2.5} />}</Button>
                                                                                        </td>
                                                                                        <td className="py-2.5 px-2 text-center">
                                                                                            <Badge variant={row.is_jefe ? 'warning' : 'neutral'} size="sm" uppercase={false}>
                                                                                                {row.is_jefe ? 'Jefe/a' : 'Colab.'}
                                                                                            </Badge>
                                                                                        </td>
                                                                                        {bloques.map(b => {
                                                                                            const sc = blockScore(row.responses || [], b.indices || [], invertedIndices);
                                                                                            return (
                                                                                                <td key={b.id} className="py-2.5 px-2 text-center cursor-help"><LiquidTooltip content={b.nombre || `Bloque ${b.numero}`}>
                                                                                                    {sc != null
                                                                                                        ? <Badge variant={scoreVariante(sc)} size="sm" uppercase={false}>{sc}</Badge>
                                                                                                        : <span className="text-content-3 text-caption">—</span>}
                                                                                                </LiquidTooltip></td>
                                                                                            );
                                                                                        })}
                                                                                        <td className="py-2.5 px-2 text-center">
                                                                                            <span className={`text-body-sm font-black ${scoreColor(global)}`}>
                                                                                                {global != null ? `${global}%` : '–'}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className="py-2.5 pr-4">
                                                                                            {confirmDelete === row.id ? (
                                                                                                <div className="flex items-center gap-1 justify-center">
                                                                                                    <Button variant="destructive" size="xs" icon={Check} iconOnly onClick={() => handleDeleteResponse(row)} />
                                                                                                    <Button variant="ghost" size="xs" icon={X} iconOnly onClick={() => setConfirmDelete(null)} />
                                                                                                </div>
                                                                                            ) : canManage ? (
                                                                                                <div className="flex items-center gap-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity justify-center">
                                                                                                    <Button tone="warning" icon={Pencil} iconOnly onClick={() => openResponseForm(row)} />
                                                                                                    <Button variant="destructive" icon={Trash2} iconOnly onClick={() => setConfirmDelete(row.id)} />
                                                                                                </div>
                                                                                            ) : null}
                                                                                        </td>
                                                                                    </tr>

                                                                                    {/* Expanded Q&A viewer */}
                                                                                    {isRowExp && (
                                                                                        <tr>
                                                                                            <td colSpan={bloques.length + 4} className="px-5 pb-5 pt-2 bg-brand/[0.03]">
                                                                                                <div className="space-y-2.5">
                                                                                                    {/* Datos generales (P1 tiempo + P3 razón) */}
                                                                                                    {(() => {
                                                                                                        const gqs = preguntas.filter(p => p.bloque_id === null && p.tipo !== 'sucursal');
                                                                                                        if (!gqs.length) return null;
                                                                                                        return (
                                                                                                            <div className="rounded-xl border border-border-card bg-surface-card overflow-hidden">
                                                                                                                <div className="flex items-center gap-2 px-4 py-2 border-b border-border-card bg-surface-card-hover/40">
                                                                                                                    <div className="w-5 h-5 rounded flex items-center justify-center text-micro font-black text-white shrink-0 bg-content-3">G</div>
                                                                                                                    <span className="text-label font-black text-content-2">Datos Generales</span>
                                                                                                                </div>
                                                                                                                <div className="divide-y divide-divider">
                                                                                                                    {gqs.map(p => {
                                                                                                                        const ans = row.responses?.[p.indice];
                                                                                                                        const optLabel = ans && p.opciones
                                                                                                                            ? (p.opciones[['A','B','C','D'].indexOf(ans)] || ans)
                                                                                                                            : ans;
                                                                                                                        return (
                                                                                                                            <div key={p.id} className="flex items-center gap-3 px-4 py-2">
                                                                                                                                <span className="shrink-0 w-4 h-4 rounded bg-surface-card flex items-center justify-center text-micro font-black text-content-3">{p.numero}</span>
                                                                                                                                <p className="flex-1 text-label text-content-2 leading-snug min-w-0">{p.texto}</p>
                                                                                                                                {ans
                                                                                                                                    ? <Badge uppercase={false}>{optLabel || ans}</Badge>
                                                                                                                                    : <span className="shrink-0 text-caption text-content-3">—</span>}
                                                                                                                            </div>
                                                                                                                        );
                                                                                                                    })}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    })()}
                                                                                                    {bloques.map(bloque => {
                                                                                                        const bqs = preguntas.filter(p => p.bloque_id === bloque.id && p.tipo !== 'sucursal');
                                                                                                        if (!bqs.length) return null;
                                                                                                        const barCls = BAR_COLORS[bloque.color] || 'bg-content-3';
                                                                                                        const bsc = blockScore(row.responses || [], bloque.indices || [], invertedIndices);
                                                                                                        return (
                                                                                                            <div key={bloque.id} className="rounded-xl border border-border-card bg-surface-card overflow-hidden">
                                                                                                                <div className={`flex items-center justify-between px-4 py-2 border-b border-border-card ${barCls} bg-opacity-10`}>
                                                                                                                    <div className="flex items-center gap-2">
                                                                                                                        <div className={`w-5 h-5 rounded flex items-center justify-center text-micro font-black text-white shrink-0 ${barCls}`}>
                                                                                                                            B{bloque.numero}
                                                                                                                        </div>
                                                                                                                        <span className="text-label font-black text-content-2">{bloque.nombre}</span>
                                                                                                                    </div>
                                                                                                                    {bsc != null && (
                                                                                                                        <Badge variant={scoreVariante(bsc)} uppercase={false}>{bsc}%</Badge>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                                <div className="divide-y divide-divider">
                                                                                                                    {bqs.map(p => {
                                                                                                                        const ans = row.responses?.[p.indice];
                                                                                                                        return (
                                                                                                                            <div key={p.id} className="flex items-start gap-3 px-4 py-2">
                                                                                                                                <span className="shrink-0 w-4 h-4 rounded bg-surface-card flex items-center justify-center text-micro font-black text-content-3 mt-0.5">{p.numero}</span>
                                                                                                                                <p className="flex-1 text-label text-content-2 leading-snug min-w-0">{p.texto}</p>
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
                                                                                                                                                    className={`w-6 h-6 rounded-full text-caption font-black flex items-center justify-center transition-all ${isActive ? oc.on : 'bg-surface-card-hover text-content-3'}`}>
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
                                                                                                <LiquidTooltip content={p.opciones?.[['A','B','C','D'].indexOf(opt)] || opt}>
                                                                                                                                                    <span key={opt}
                                                                                                                                                        className={`w-6 h-6 rounded-full text-caption font-black flex items-center justify-center transition-all ${ans === opt ? oc.on : 'bg-surface-card-hover text-content-3'}`}>
                                                                                                                                                        {opt}
                                                                                                                                                    </span>
                                                                                                </LiquidTooltip>
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
                                                                                                        <div className="rounded-xl border border-border-card bg-surface-card px-4 py-3">
                                                                                                            <p className="text-micro font-black uppercase tracking-wider text-content-2 mb-1">Comentario</p>
                                                                                                            <p className="text-body-sm text-content-2 leading-relaxed">{row.comentario}</p>
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
