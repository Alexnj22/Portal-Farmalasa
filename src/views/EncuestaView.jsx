import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BarChart2, Users, Star, MessageSquare, ChevronDown, ChevronUp,
    TrendingUp, TrendingDown, Award, Heart, AlertTriangle, Building2,
    UserCheck, UserX, ThumbsUp, Smile, Meh, Frown, Info, Loader2, ArrowLeft, Sparkles, RotateCcw, Zap, Minus
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import { supabase } from '../supabaseClient';
import { signPhotosDeep } from '../utils/storageFiles';
import {
    fetchSurveys, fetchSurveyBloques, fetchSurveyPreguntas, fetchSurveyResponsesForView,
    fetchSurveyAiSummaries, updateSurvey,
} from '../data/encuestas';

// Jefe inmediato de cada sucursal — configuración de org-chart
const SUPERVISOR_DE_JEFE = {
    'La Popular': 'Supervisor/a de Ventas',
    'Salud 1':    'Supervisor/a de Ventas',
    'Salud 2':    'Supervisor/a de Ventas',
    'Salud 3':    'Supervisor/a de Ventas',
    'Salud 4':    'Supervisor/a de Ventas',
    'Salud 5':    'Supervisor/a de Ventas',
    'Bodega':     'Administración / Jefe de Logística',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SCORE_MAP = { A: 4, B: 3, C: 2, D: 1 };
const OPT_COLORS = {
    A: { on: 'bg-emerald-500 text-white', off: 'bg-surface-card-hover text-content-3' },
    B: { on: 'bg-blue-500 text-white',    off: 'bg-surface-card-hover text-content-3' },
    C: { on: 'bg-amber-500 text-white',   off: 'bg-surface-card-hover text-content-3' },
    D: { on: 'bg-rose-500 text-white',    off: 'bg-surface-card-hover text-content-3' },
};
const PCT_COLORS = {
    blue:    { bar: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200',    badge: 'bg-blue-100 text-blue-700' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-success/10', border: 'border-success/30', badge: 'bg-success/10 text-emerald-700' },
    amber:   { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-warning/10',   border: 'border-warning/30',   badge: 'bg-warning/10 text-amber-700' },
    indigo:  { bar: 'bg-indigo-500',  text: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200',  badge: 'bg-indigo-100 text-indigo-700' },
    purple:  { bar: 'bg-purple-500',  text: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200',  badge: 'bg-purple-100 text-purple-700' },
    teal:    { bar: 'bg-teal-500',    text: 'text-teal-700',    bg: 'bg-teal-50',    border: 'border-teal-200',    badge: 'bg-teal-100 text-teal-700' },
    rose:    { bar: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    badge: 'bg-rose-100 text-rose-700' },
    slate:   { bar: 'bg-slate-500',   text: 'text-content-2',   bg: 'bg-surface-card-hover',   border: 'border-slate-200',   badge: 'bg-surface-card-hover text-content-2' },
};

function scoreVal(v) {
    if (!v || v === '-') return null;
    if (SCORE_MAP[v.toUpperCase()] !== undefined) return SCORE_MAP[v.toUpperCase()];
    const n = parseInt(v, 10);
    if (!isNaN(n) && n >= 1 && n <= 10) return n >= 9 ? 4 : n >= 7 ? 3 : n >= 5 ? 2 : 1;
    return null;
}

function blockScore(rows, indices, invertedSet = new Set()) {
    let total = 0, count = 0;
    for (const row of rows) {
        for (const i of indices) {
            const v = scoreVal(row.r[i]);
            if (v !== null) {
                total += invertedSet.has(i) ? (5 - v) : v;
                count++;
            }
        }
    }
    return count > 0 ? (total / (count * 4)) * 100 : null;
}

function questionDist(rows, idx) {
    const d = { A: 0, B: 0, C: 0, D: 0 };
    let total = 0;
    for (const r of rows) {
        const v = r.r[idx];
        if (v && d[v] !== undefined) { d[v]++; total++; }
    }
    return { ...d, total };
}

function scoreLabel(pct) {
    if (pct >= 85) return { label: 'Excelente', color: 'text-success', Icon: Smile };
    if (pct >= 70) return { label: 'Bueno',     color: 'text-blue-600',    Icon: ThumbsUp };
    if (pct >= 55) return { label: 'Regular',   color: 'text-warning',   Icon: Meh };
    return               { label: 'Crítico',    color: 'text-rose-600',    Icon: Frown };
}


// ─── Employee avatar with photo fallback ─────────────────────────────────────
function PersonAvatar({ nombre, photo = null, isJefe = false, size = 32 }) {
    const [failed, setFailed] = useState(false);
    const initials = nombre.charAt(0).toUpperCase();
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            {photo && !failed ? (
                <img
                    src={photo}
                    alt={nombre}
                    onError={() => setFailed(true)}
                    className={`w-full h-full rounded-full object-cover object-top ${isJefe ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                />
            ) : (
                <div className={`w-full h-full rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center text-white font-black ${isJefe ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
                    style={{ fontSize: size * 0.38 }}>
                    {initials}
                </div>
            )}
            {isJefe && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-amber-400 border-[1.5px] border-white" />
            )}
        </div>
    );
}

// ─── Mini bar chart for A/B/C/D distribution ─────────────────────────────────
function DistBar({ dist, invertida = false }) {
    const { A, B, C, D, total } = dist;
    if (!total) return <span className="text-[10px] text-content-3">Sin datos</span>;
    const pct = (n) => Math.round((n / total) * 100);
    const positives = pct(A) + pct(B);
    const bars = [
        { key: 'A', n: A, label: 'A', cls: invertida ? 'bg-rose-500' : 'bg-emerald-500' },
        { key: 'B', n: B, label: 'B', cls: invertida ? 'bg-orange-400' : 'bg-blue-400'  },
        { key: 'C', n: C, label: 'C', cls: 'bg-amber-400' },
        { key: 'D', n: D, label: 'D', cls: invertida ? 'bg-emerald-500' : 'bg-rose-400' },
    ];
    return (
        <div className="flex items-center gap-1.5 w-full">
            <div className="flex-1 flex h-2.5 rounded-full overflow-hidden gap-px bg-surface-card-hover">
                {bars.map(({ key, n, cls }) => n > 0 && (
                    <div key={key} className={`${cls} transition-all duration-500`}
                        style={{ width: `${(n / total) * 100}%` }}
                        title={`${key}: ${n} (${pct(n)}%)`} />
                ))}
            </div>
            <span className={`text-[10px] font-black w-8 text-right ${positives >= 70 ? 'text-success' : positives >= 50 ? 'text-warning' : 'text-rose-600'}`}>
                {positives}%
            </span>
        </div>
    );
}

// ─── Question row ─────────────────────────────────────────────────────────────
function PreguntaRow({ pregunta, rows, showDetail, onToggle }) {
    const dist = questionDist(rows, pregunta.idx);
    const { A, B, C, D, total } = dist;
    if (!total) return null;
    const pct = (n) => Math.round((n / total) * 100);

    // Map each option to the people who chose it
    const namesByOption = { A: [], B: [], C: [], D: [] };
    rows.forEach(r => {
        const v = r.r[pregunta.idx];
        if (v && namesByOption[v] !== undefined) {
            namesByOption[v].push({ nombre: r.nombre, isJefe: r.isJefe, sucursal: r.sucursal, photo: r.photo });
        }
    });

    return (
        <div className="border-b border-slate-50 last:border-0">
            <button className="w-full text-left px-4 py-3 hover:bg-surface-card-hover/60 transition-colors flex items-start gap-3"
                onClick={onToggle}>
                <span className="shrink-0 w-7 h-7 rounded-lg bg-surface-card-hover flex items-center justify-center text-[10px] font-black text-content-3 mt-0.5">
                    P{pregunta.id}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-content-2 leading-snug mb-1.5">{pregunta.texto}</p>
                    <DistBar dist={dist} invertida={pregunta.invertida} />
                </div>
                <div className="shrink-0 pt-0.5">
                    {showDetail ? <ChevronUp size={13} className="text-content-3" /> : <ChevronDown size={13} className="text-content-3" />}
                </div>
            </button>

            {showDetail && (
                <div className="px-4 pb-3 pt-0">
                    <div className="ml-10 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                            { k: 'A', label: pregunta.opciones?.[0] || 'Siempre / Totalmente de acuerdo',  cls: 'bg-success/10 border-success/30 text-emerald-700', chip: 'bg-success/10 text-emerald-700' },
                            { k: 'B', label: pregunta.opciones?.[1] || 'Frecuentemente / De acuerdo',       cls: 'bg-blue-50 border-blue-200 text-blue-700',           chip: 'bg-blue-100 text-blue-700' },
                            { k: 'C', label: pregunta.opciones?.[2] || 'A veces / En desacuerdo',           cls: 'bg-warning/10 border-warning/30 text-amber-700',         chip: 'bg-warning/10 text-amber-700' },
                            { k: 'D', label: pregunta.opciones?.[3] || 'Nunca / Totalmente en desacuerdo',  cls: 'bg-rose-50 border-rose-200 text-rose-700',            chip: 'bg-rose-100 text-rose-700' },
                        ].map(({ k, label, cls }) => (
                            <div key={k} className={`border rounded-xl p-2.5 ${cls}`}>
                                <div className="text-[18px] font-black leading-none">{dist[k]}</div>
                                <div className="text-[9px] font-black uppercase tracking-wider opacity-70 mt-0.5">{k} · {pct(dist[k])}%</div>
                                <div className="text-[9px] leading-tight mt-1 mb-2 opacity-80">{label}</div>
                                {namesByOption[k].length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-1 border-t border-current/10 pt-1.5">
                                        {namesByOption[k].map(({ nombre, isJefe, sucursal, photo }) => (
                                            <div key={nombre} className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-surface-card border border-black/10">
                                                <PersonAvatar nombre={nombre} photo={photo} isJefe={isJefe} size={24} />
                                                <div className="flex flex-col leading-tight">
                                                    <span className="text-[10px] font-black leading-none text-content">
                                                        {nombre.split(' ').map((w, i) => i === 0 ? w : w.charAt(0) + '.').join(' ')}
                                                        {isJefe && <span className="ml-1 opacity-60">·J</span>}
                                                    </span>
                                                    <span className="text-[9px] opacity-55 leading-none mt-0.5 text-content-2">{sucursal}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Score gauge card ─────────────────────────────────────────────────────────
function ScoreCard({ pct, label, color, desc }) {
    const c = PCT_COLORS[color] || PCT_COLORS.slate;
    const sl = scoreLabel(pct);
    return (
        <div className={`flex flex-col gap-1 px-3 py-2.5 rounded-xl border ${c.border} ${c.bg}`}>
            <div className="flex items-center justify-between">
                <span className="text-[9px] font-black uppercase tracking-wider text-content-3">{label}</span>
                <span className={`text-[9px] font-black ${sl.color}`}>{sl.label}</span>
            </div>
            <div className="text-[22px] font-black leading-none" style={{ color: '' }}>
                <span className={c.text}>{pct.toFixed(0)}<span className="text-[13px]">%</span></span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-card overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${c.bar}`}
                    style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[9px] text-content-3 leading-tight mt-0.5">{desc}</p>
        </div>
    );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS = [
    { key: 'resumen',    label: 'Resumen',    Icon: BarChart2     },
    { key: 'bloques',    label: 'Por Bloque', Icon: TrendingUp    },
    { key: 'segmentos',  label: 'Segmentos',  Icon: Users         },
    { key: 'personas',   label: 'Individuos', Icon: UserCheck     },
    { key: 'comentarios',label: 'Comentarios',Icon: MessageSquare },
];

// ─── AI summary helpers ───────────────────────────────────────────────────────

function parseAiSections(rawText) {
    if (!rawText) return [];
    // Normalize **Title**: (colon outside closing asterisks) → **Title:** so both formats parse
    const text = rawText.replace(/\*\*([^*]+?)\*\*:/g, '**$1:**');
    const regex = /\*\*([^*]+?):\*\*/g;
    const rawParts = [];
    let lastEnd = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastEnd) rawParts.push({ type: 'text', content: text.slice(lastEnd, match.index).trim() });
        rawParts.push({ type: 'header', title: match[1] });
        lastEnd = match.index + match[0].length;
    }
    if (lastEnd < text.length) rawParts.push({ type: 'text', content: text.slice(lastEnd).trim() });

    const sections = [];
    let i = 0;
    while (i < rawParts.length) {
        if (rawParts[i].type === 'header') {
            const content = (i + 1 < rawParts.length && rawParts[i + 1].type === 'text') ? rawParts[i + 1].content : '';
            sections.push({ title: rawParts[i].title, content });
            i += content ? 2 : 1;
        } else {
            if (rawParts[i].content) sections.push({ title: null, content: rawParts[i].content });
            i++;
        }
    }
    return sections.length ? sections : [{ title: null, content: text }];
}

function getSectionStyle(title) {
    if (!title) return { Icon: Sparkles, color: 'text-indigo-400', dot: 'bg-indigo-400' };
    const t = title.toLowerCase();
    if (t.includes('recurrente') || t.includes('tema') || t.includes('idea')) return { Icon: TrendingUp, color: 'text-blue-400', dot: 'bg-blue-400' };
    if (t.includes('valor') || t.includes('positiv') || t.includes('aspecto')) return { Icon: ThumbsUp, color: 'text-success', dot: 'bg-emerald-400' };
    if (t.includes('friccion') || t.includes('problema') || t.includes('identif') || t.includes('riesgo')) return { Icon: AlertTriangle, color: 'text-warning', dot: 'bg-amber-400' };
    if (t.includes('accion') || t.includes('acción') || t.includes('recomend')) return { Icon: Zap, color: 'text-purple-400', dot: 'bg-purple-400' };
    return { Icon: Sparkles, color: 'text-indigo-400', dot: 'bg-indigo-400' };
}

function renderInlineBold(text) {
    const parts = text.split(/(\*\*[^*]+?\*\*)/);
    return parts.map((part, i) => {
        const m = part.match(/^\*\*(.+)\*\*$/);
        if (m) return <strong key={i} className="text-content font-black">{m[1]}</strong>;
        return part || null;
    });
}

function renderContentItems(content) {
    const normalized = content
        .replace(/\s{2,}(\d+)\.\s/g, '\n$1. ')
        .replace(/\.\s+(\d+)\.\s/g, '.\n$1. ')
        .replace(/\s{2,}-\s/g, '\n- ')
        .replace(/\.\s+-\s/g, '.\n- ')
        .trim();
    const lines = normalized.split('\n').map(l => l.trim()).filter(Boolean);
    return lines.map((line, i) => {
        const numMatch = line.match(/^(\d+)\.\s+(.+)$/);
        const bulletMatch = line.match(/^-\s+(.+)$/);
        if (numMatch) return (
            <div key={i} className="flex gap-2.5 items-start">
                <span className="shrink-0 w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-black flex items-center justify-center mt-0.5">{numMatch[1]}</span>
                <span className="text-[11px] text-content-2 leading-relaxed">{renderInlineBold(numMatch[2])}</span>
            </div>
        );
        if (bulletMatch) {
            const arrowIdx = bulletMatch[1].indexOf(' → ');
            if (arrowIdx !== -1) {
                const main = bulletMatch[1].slice(0, arrowIdx);
                const meta = bulletMatch[1].slice(arrowIdx + 3);
                return (
                    <div key={i} className="flex gap-2.5 items-start">
                        <span className="shrink-0 text-indigo-500 mt-1 leading-none text-[10px]">›</span>
                        <span className="text-[11px] text-content-2 leading-relaxed">
                            {renderInlineBold(main)}
                            <span className="text-indigo-400/60 text-[10px]"> → {meta}</span>
                        </span>
                    </div>
                );
            }
            return (
                <div key={i} className="flex gap-2.5 items-start">
                    <span className="shrink-0 text-indigo-500 mt-1 leading-none text-[10px]">›</span>
                    <span className="text-[11px] text-content-2 leading-relaxed">{renderInlineBold(bulletMatch[1])}</span>
                </div>
            );
        }
        return <p key={i} className="text-[11px] text-content-2 leading-relaxed">{renderInlineBold(line)}</p>;
    });
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function EncuestaView() {
    const navigate = useNavigate();
    const [expandedPersonIdx, setExpandedPersonIdx] = useState(null);
    const [aiSummaries, setAiSummaries] = useState({});
    const [loadingAi, setLoadingAi] = useState({});
    const [collapsedSummaries, setCollapsedSummaries] = useState({});
    const [savedSummariesLoading, setSavedSummariesLoading] = useState(false);
    const [tab, setTab] = useState('resumen');
    const [expandedQ, setExpandedQ] = useState(null);
    const [expandedBloque, setExpandedBloque] = useState(null);
    const [filterSucursal, setFilterSucursal] = useState('');
    const [filterRol, setFilterRol] = useState('');

    const aiAutoGenDone = useRef({});
    const selectedSurveyIdRef = useRef(null);

    // ── Supabase data ──────────────────────────────────────────────────────────
    const [surveys, setSurveys] = useState([]);
    const [selectedSurveyId, setSelectedSurveyId] = useState(null);
    const [RESPUESTAS, setRespuestas] = useState([]);
    const [BLOQUES, setBloques] = useState([]);
    const [PREGUNTAS, setPreguntas] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSurveys()
            .then(({ data }) => {
                if (data?.length) {
                    setSurveys(data);
                    setSelectedSurveyId(data[0].id);
                }
            });
    }, []);

    useEffect(() => {
        if (!selectedSurveyId) return;
        setLoading(true);
        setExpandedQ(null);
        setExpandedBloque(null);

        Promise.all([
            fetchSurveyBloques(selectedSurveyId),
            fetchSurveyPreguntas(selectedSurveyId),
            fetchSurveyResponsesForView(selectedSurveyId),
        ]).then(async ([bRes, pRes, rRes]) => {
            await signPhotosDeep(rRes.data || []);
            setBloques((bRes.data || []).map(b => ({
                id: b.numero,
                _dbId: b.id,
                nombre: b.nombre,
                color: b.color,
                desc: b.descripcion,
                indices: b.indices,
                ctx: b.ctx_dirigido ? {
                    dirigido: b.ctx_dirigido,
                    tipo: b.ctx_tipo,
                    badge: b.ctx_badge,
                    nota: b.ctx_nota,
                } : null,
            })));
            setPreguntas((pRes.data || []).map(p => ({
                id: p.numero,
                bloque: p.bloque_id ? (bRes.data || []).find(b => b.id === p.bloque_id)?.numero ?? null : null,
                idx: p.indice,
                texto: p.texto,
                opciones: p.opciones,
                tipo: p.tipo,
                invertida: p.invertida,
            })));
            setRespuestas((rRes.data || []).map(r => {
                const fn = (r.employee?.first_names || '').split(' ')[0];
                const ln = (r.employee?.last_names  || '').split(' ')[0];
                return {
                    nombre: `${fn} ${ln}`.trim() || r.display_name || '',
                    isJefe: r.is_jefe,
                    sucursal: r.employee?.branch?.name || '',
                    photo: r.employee?.photo_url || null,
                    r: r.responses,
                    comentario: r.comentario,
                };
            }));
            setLoading(false);
        });
    }, [selectedSurveyId]);

    // Keep ref in sync for async operations in generateAiSummary
    useEffect(() => { selectedSurveyIdRef.current = selectedSurveyId; }, [selectedSurveyId]);

    // Load saved AI summaries from DB when survey changes
    useEffect(() => {
        if (!selectedSurveyId) return;
        setAiSummaries({});
        setLoadingAi({});
        setCollapsedSummaries({});
        aiAutoGenDone.current[selectedSurveyId] = new Set();
        setSavedSummariesLoading(true);
        fetchSurveyAiSummaries(selectedSurveyId)
            .then(({ data }) => {
                const saved = data?.ai_summaries || {};
                setAiSummaries(saved);
                aiAutoGenDone.current[selectedSurveyId] = new Set(Object.keys(saved));
                setSavedSummariesLoading(false);
            });
    }, [selectedSurveyId]);

    // Auto-generate missing summaries only after saved summaries are loaded
    useEffect(() => {
        if (tab !== 'comentarios' || loading || !RESPUESTAS.length || !selectedSurveyId || savedSummariesLoading) return;
        const done = aiAutoGenDone.current[selectedSurveyId] || new Set();
        if (!aiAutoGenDone.current[selectedSurveyId]) aiAutoGenDone.current[selectedSurveyId] = done;
        const withComment = RESPUESTAS.filter(r => r.comentario?.trim() && r.comentario !== 'null');
        const segs = [
            { key: 'General',        comments: withComment.map(r => ({ texto: r.comentario, isJefe: r.isJefe, sucursal: r.sucursal })) },
            { key: 'Jefes',         comments: withComment.filter(r => r.isJefe).map(r => ({ texto: r.comentario, isJefe: true, sucursal: r.sucursal })) },
            { key: 'Empleados', comments: withComment.filter(r => !r.isJefe).map(r => ({ texto: r.comentario, isJefe: false, sucursal: r.sucursal })) },
        ];
        segs.forEach(seg => {
            if (!done.has(seg.key) && seg.comments.length > 0) {
                done.add(seg.key);
                generateAiSummary(seg.comments, seg.key);
            }
        });
    }, [tab, loading, RESPUESTAS, selectedSurveyId, savedSummariesLoading]);

    const sucursales = useMemo(() => [...new Set(RESPUESTAS.map(r => r.sucursal))].sort(), [RESPUESTAS]);

    const invertedIndices = useMemo(
        () => new Set(PREGUNTAS.filter(p => p.invertida).map(p => p.idx)),
        [PREGUNTAS]
    );

    const selfRatingIdx = useMemo(() => {
        const p = PREGUNTAS.find(p => p.tipo === 'numerica');
        return p ? p.idx : 30;
    }, [PREGUNTAS]);

    const filteredRows = useMemo(() => {
        let r = RESPUESTAS;
        if (filterSucursal) r = r.filter(x => x.sucursal === filterSucursal);
        if (filterRol === 'jefe') r = r.filter(x => x.isJefe);
        if (filterRol === 'colab') r = r.filter(x => !x.isJefe);
        return r;
    }, [filterSucursal, filterRol, RESPUESTAS]);

    const personasBySucursal = useMemo(() => {
        const map = {};
        filteredRows.forEach(row => {
            const k = row.sucursal || 'Sin sucursal';
            if (!map[k]) map[k] = [];
            map[k].push(row);
        });
        return Object.entries(map)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([name, rows]) => [name, [...rows].sort((a, b) => (b.isJefe ? 1 : 0) - (a.isJefe ? 1 : 0))]);
    }, [filteredRows]);

    const bloquesScores = useMemo(() =>
        BLOQUES.map(b => ({ ...b, score: blockScore(filteredRows, b.indices, invertedIndices) })),
    [filteredRows, BLOQUES, invertedIndices]);

    const globalScore = useMemo(() => {
        const allIdx = BLOQUES.flatMap(b => b.indices);
        return blockScore(filteredRows, allIdx, invertedIndices);
    }, [filteredRows, BLOQUES, invertedIndices]);

    // Distribución P31 (autocalificación — puede ser A/B/C/D legacy o número 1-10)
    const selfRatings = useMemo(() => {
        const dist = { A: 0, B: 0, C: 0, D: 0 };
        const numericVals = [];
        filteredRows.forEach(r => {
            const v = r.r[selfRatingIdx];
            if (!v) return;
            if (dist[v] !== undefined) {
                dist[v]++;                         // legacy A/B/C/D
                const mid = { A: 9.5, B: 7.5, C: 5.5, D: 2.5 }[v];
                if (mid) numericVals.push(mid);
            } else {
                const n = parseInt(v, 10);
                if (!isNaN(n) && n >= 1 && n <= 10) {
                    if (n >= 9) dist.A++; else if (n >= 7) dist.B++; else if (n >= 5) dist.C++; else dist.D++;
                    numericVals.push(n);
                }
            }
        });
        const numericAvg = numericVals.length ? numericVals.reduce((a, b) => a + b, 0) / numericVals.length : null;
        return { dist, numericAvg };
    }, [filteredRows, selfRatingIdx]);

    // Razones de permanencia (P3 = index 2)
    const razones = useMemo(() => {
        const map = { A: 0, B: 0, C: 0, D: 0 };
        filteredRows.forEach(r => { const v = r.r[2]; if (v && map[v] !== undefined) map[v]++; });
        return map;
    }, [filteredRows]);

    // Comunicación de inconformidades (P34 = index 33)
    const comunicacion = useMemo(() => {
        const map = { A: 0, B: 0, C: 0, D: 0 };
        filteredRows.forEach(r => { const v = r.r[33]; if (v && map[v] !== undefined) map[v]++; });
        return map;
    }, [filteredRows]);

    const toggleQ = (id) => setExpandedQ(prev => prev === id ? null : id);

    const generateAiSummary = async (comments, segment) => {
        if (!comments.length) return;
        const surveyId = selectedSurveyIdRef.current;
        setLoadingAi(p => ({ ...p, [segment]: true }));
        try {
            const { data, error } = await supabase.functions.invoke('saly-ai', {
                body: { action: 'analyze-survey-comments', payload: { comments, segment } },
            });
            if (error) throw error;
            const summary = data.aiSummary || 'Sin respuesta.';
            setAiSummaries(prev => ({ ...prev, [segment]: summary }));
            if (surveyId) {
                // Fetch current saved summaries, merge, and save — avoids losing concurrent segments
                const { data: current } = await fetchSurveyAiSummaries(surveyId);
                const merged = { ...(current?.ai_summaries || {}), [segment]: summary };
                await updateSurvey(surveyId, { ai_summaries: merged });
            }
        } catch {
            setAiSummaries(p => ({ ...p, [segment]: 'Error al generar resumen.' }));
        } finally {
            setLoadingAi(p => ({ ...p, [segment]: false }));
        }
    };

    const selectedSurvey = surveys.find(s => s.id === selectedSurveyId);

    const filtersContent = (
        <div className="relative flex items-center bg-surface-card backdrop-blur-2xl backdrop-saturate-[180%] border border-border-card shadow-[inset_0_2px_10px_rgba(255,255,255,0.3),0_4px_16px_rgba(0,0,0,0.05)] hover:shadow-[inset_0_2px_10px_rgba(255,255,255,0.4),0_8px_24px_rgba(0,0,0,0.08)] rounded-[2.5rem] h-[4rem] md:h-[4.5rem] p-2 md:p-3 transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] hover:-translate-y-[2px] transform-gpu w-max max-w-full overflow-hidden">
            <div className="flex items-center h-full pl-2 pr-1 md:pr-2 gap-1 md:gap-1.5">
                {TABS.map(({ key, label, Icon }) => (
                    <button key={key} onClick={() => setTab(key)}
                        className={`px-3 md:px-4 h-9 md:h-10 rounded-full text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all duration-300 transform-gpu whitespace-nowrap border shrink-0 flex items-center gap-1.5 ${
                            tab === key
                                ? 'bg-white text-content border-white shadow-md scale-[1.02]'
                                : 'bg-transparent text-content-3 border-transparent hover:bg-white hover:text-content hover:-translate-y-0.5 hover:shadow-md hover:border-border-card'
                        }`}>
                        <Icon size={12} strokeWidth={2.5} />
                        <span className="hidden sm:inline">{label}</span>
                    </button>
                ))}
                <div className="h-6 w-px bg-surface-card mx-1 shrink-0" />
                <div className="py-1.5 overflow-visible" style={{ width: filterSucursal ? Math.max(130, 80 + filterSucursal.length * 7) + 'px' : '175px' }}>
                    <LiquidSelect
                        value={filterSucursal}
                        onChange={setFilterSucursal}
                        options={sucursales.map(s => ({ value: s, label: s }))}
                        placeholder="Todas las sucursales"
                        icon={Building2}
                        compact
                        bare
                    />
                </div>
                {surveys.length > 1 && (
                    <>
                        <div className="h-6 w-px bg-surface-card mx-1 shrink-0" />
                        <div className="py-1.5 overflow-visible w-[200px]">
                            <LiquidSelect
                                value={selectedSurveyId ?? ''}
                                onChange={val => setSelectedSurveyId(Number(val))}
                                options={surveys.map(s => ({ value: s.id, label: `${s.nombre} (${s.año})` }))}
                                clearable={false}
                                compact
                                bare
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <GlassViewLayout
            icon={BarChart2}
            title={
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => navigate('/encuesta-admin')}
                        className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 active:scale-[0.97] transition-all duration-300 border border-slate-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.05)] hover:shadow-[0_6px_20px_rgba(0,82,204,0.2)] hover:-translate-y-0.5 bg-white"
                        title="Volver a Gestión de Encuesta">
                        <ArrowLeft size={15} strokeWidth={2.5} className="text-content-3" />
                    </button>
                    <span>{selectedSurvey?.nombre?.replace(/^encuesta\s+de\s+/i, '') ?? 'Clima Organizacional'}</span>
                </div>
            }
            subtitle={`Farmacias La Popular y La Salud — ${RESPUESTAS.length} empleados`}
            filtersContent={filtersContent}>
            <div className="p-5 md:p-6 space-y-5">

                {loading ? (
                    <div className="space-y-5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                                    <div className="w-8 h-8 skeleton rounded-lg shrink-0" />
                                    <div className="space-y-1.5 flex-1">
                                        <div className="h-5 w-10 skeleton rounded-full" />
                                        <div className="h-2.5 w-20 skeleton rounded-full" />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="rounded-[1.5rem] border border-slate-100 bg-white shadow-sm p-5 space-y-3">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                                    <div className="h-3 w-8 skeleton rounded-full" />
                                    <div className="flex-1 h-2.5 skeleton rounded-full" style={{ width: `${60 + i * 8}%` }} />
                                    <div className="h-2.5 w-8 skeleton rounded-full" />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (<>

                {/* ── RESUMEN ─────────────────────────────────────────────── */}
                {tab === 'resumen' && (
                    <div className="space-y-5">
                        {/* KPIs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { label: 'Participantes',  value: RESPUESTAS.length, sub: '100% del total', Icon: Users,    grad: 'from-blue-500 to-indigo-500' },
                                { label: 'Jefes',          value: RESPUESTAS.filter(r => r.isJefe).length,  sub: 'de sala / área', Icon: UserCheck, grad: 'from-purple-500 to-violet-500' },
                                { label: 'Empleados',  value: RESPUESTAS.filter(r => !r.isJefe).length, sub: 'de sala / área', Icon: UserX,     grad: 'from-slate-500 to-slate-400' },
                                { label: 'Sucursales',     value: sucursales.length, sub: 'representadas',  Icon: Building2, grad: 'from-teal-500 to-emerald-500' },
                            ].map(({ label, value, sub, Icon, grad }) => (
                                <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                                        <Icon size={14} className="text-white" />
                                    </div>
                                    <div>
                                        <div className="text-[22px] font-black text-content leading-none">{value}</div>
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-content-2">{label}</div>
                                        <div className="text-[9px] text-content-3">{sub}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Score global + por bloque */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Score global */}
                            <div className="flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-100 shadow-sm p-6 gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-content-2">Score Global</span>
                                <div className="relative w-28 h-28">
                                    <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                                        <circle cx="50" cy="50" r="42" fill="none" stroke="#f1f5f9" strokeWidth="10" />
                                        <circle cx="50" cy="50" r="42" fill="none"
                                            stroke={globalScore >= 70 ? '#10b981' : globalScore >= 55 ? '#f59e0b' : '#f43f5e'}
                                            strokeWidth="10"
                                            strokeDasharray={`${(globalScore / 100) * 263.9} 263.9`}
                                            strokeLinecap="round" />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-[26px] font-black text-content leading-none">{globalScore?.toFixed(0)}</span>
                                        <span className="text-[11px] font-bold text-content-3">/ 100</span>
                                    </div>
                                </div>
                                {(() => { const sl = scoreLabel(globalScore); return (
                                    <span className={`text-[11px] font-black ${sl.color}`}>{sl.label}</span>
                                ); })()}
                                <p className="text-[9px] text-content-3 text-center">Promedio ponderado de todos los bloques (escala A–D)</p>
                            </div>

                            {/* Scores por bloque */}
                            <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 mb-3">Puntaje por Bloque</h3>
                                <div className="space-y-2.5">
                                    {bloquesScores.map(b => {
                                        if (!b.score) return null;
                                        const c = PCT_COLORS[b.color];
                                        const sl = scoreLabel(b.score);
                                        return (
                                            <div key={b.id} className="flex items-center gap-3">
                                                <div className={`w-36 text-[9px] font-black uppercase tracking-wider ${c.text} leading-tight shrink-0`}>{b.nombre}</div>
                                                <div className="flex-1 h-2.5 rounded-full bg-surface-card-hover overflow-hidden">
                                                    <div className={`h-full rounded-full ${c.bar} transition-all duration-700`}
                                                        style={{ width: `${b.score}%` }} />
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <span className="text-[12px] font-black text-content-2 w-8 text-right">{b.score.toFixed(0)}%</span>
                                                    <span className={`text-[9px] font-black ${sl.color} w-14`}>{sl.label}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Razones de permanencia */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 mb-3 flex items-center gap-1.5">
                                    <Heart size={12} className="text-rose-400" /> ¿Por qué siguen en la empresa?
                                </h3>
                                {[
                                    { k: 'A', label: 'Me encanta, quiero jubilarme',  cls: 'bg-emerald-500' },
                                    { k: 'B', label: 'Estabilidad y beneficios',      cls: 'bg-blue-500'    },
                                    { k: 'C', label: 'Sin otra opción por ahora',     cls: 'bg-amber-400'   },
                                    { k: 'D', label: 'Buscando otro trabajo',         cls: 'bg-rose-500'    },
                                ].map(({ k, label, cls }) => {
                                    const n = razones[k];
                                    const pct = Math.round((n / filteredRows.length) * 100);
                                    return (
                                        <div key={k} className="flex items-center gap-3 mb-2">
                                            <span className="w-5 h-5 rounded-lg text-white text-[10px] font-black flex items-center justify-center shrink-0 bg-content-3">{k}</span>
                                            <div className="flex-1">
                                                <div className="flex justify-between mb-0.5">
                                                    <span className="text-[10px] text-content-2">{label}</span>
                                                    <span className="text-[10px] font-black text-content-2">{n} ({pct}%)</span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                                                    <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Autocalificación */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col gap-3">
                                <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 flex items-center gap-1.5">
                                    <Star size={12} className="text-warning" /> Autocalificación como trabajador/a
                                </h3>
                                {Object.values(selfRatings.dist).every(n => n === 0) ? (
                                    <p className="text-[11px] text-content-3 text-center py-6">Sin datos</p>
                                ) : (() => {
                                    const total = Object.values(selfRatings.dist).reduce((a, b) => a + b, 0);
                                    const ranges = [
                                        { k: 'A', label: '9 – 10', from: 9, bar: 'bg-emerald-400', text: 'text-emerald-700', bg: 'bg-success/10' },
                                        { k: 'B', label: '7 – 8',  from: 7, bar: 'bg-blue-400',    text: 'text-blue-700',    bg: 'bg-blue-50'    },
                                        { k: 'C', label: '5 – 6',  from: 5, bar: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-warning/10'   },
                                        { k: 'D', label: '1 – 4',  from: 1, bar: 'bg-rose-400',    text: 'text-rose-700',    bg: 'bg-rose-50'    },
                                    ];
                                    const avg = selfRatings.numericAvg;
                                    const avgPct = avg != null ? ((avg - 1) / 9) * 100 : null;
                                    return (
                                        <>
                                        {/* Average score prominent display */}
                                        <div className="flex items-center gap-4">
                                            <div className="flex flex-col items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 border border-warning/30 shrink-0">
                                                <span className="text-[28px] font-black text-warning leading-none">{avg != null ? avg.toFixed(1) : '–'}</span>
                                                <span className="text-[10px] font-bold text-warning">/ 10</span>
                                            </div>
                                            <div className="flex-1 space-y-2">
                                                {/* Gradient track */}
                                                <div className="relative h-3 rounded-full overflow-hidden bg-gradient-to-r from-rose-300 via-amber-300 via-blue-300 to-emerald-400">
                                                    {avgPct != null && (
                                                        <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-amber-500 shadow-md transition-all duration-700"
                                                            style={{ left: `calc(${avgPct}% - 7px)` }} />
                                                    )}
                                                </div>
                                                <div className="flex justify-between text-[9px] font-bold text-content-3">
                                                    <span>1</span><span>5</span><span>10</span>
                                                </div>
                                                <p className="text-[10px] text-content-3">{total} respuestas · {avg != null ? (avg >= 8 ? 'Muy alta autopercepción' : avg >= 6 ? 'Buena autopercepción' : 'Autopercepción moderada') : ''}</p>
                                            </div>
                                        </div>
                                        {/* Distribution rows */}
                                        <div className="space-y-1.5 pt-1 border-t border-slate-50">
                                            {ranges.map(({ k, label, bar, text }) => {
                                                const n = selfRatings.dist[k] || 0;
                                                const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                                                return (
                                                    <div key={k} className="flex items-center gap-2">
                                                        <span className={`w-10 text-[9px] font-black shrink-0 ${text}`}>{label}</span>
                                                        <div className="flex-1 h-2 rounded-full bg-surface-card-hover overflow-hidden">
                                                            <div className={`h-full rounded-full ${bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
                                                        </div>
                                                        <span className="text-[10px] font-black text-content-3 w-14 text-right shrink-0">{n} <span className="font-normal text-content-3">({pct}%)</span></span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        </>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Comunicación de inconformidades */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 mb-3 flex items-center gap-1.5">
                                <Info size={12} className="text-blue-400" /> ¿Con quién comunican las inconformidades?
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[
                                    { k: 'A', label: 'Jefe inmediato',          icon: '👤', cls: 'bg-blue-50 border-blue-200 text-blue-700'     },
                                    { k: 'B', label: 'Supervisión / Admin',      icon: '🏢', cls: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                                    { k: 'C', label: 'Compañeros',              icon: '👥', cls: 'bg-warning/10 border-warning/30 text-amber-700'   },
                                    { k: 'D', label: 'Nadie (se lo guardan)',   icon: '🔒', cls: 'bg-rose-50 border-rose-200 text-rose-700'     },
                                ].map(({ k, label, icon, cls }) => {
                                    const n = comunicacion[k];
                                    const pct = Math.round((n / filteredRows.length) * 100);
                                    return (
                                        <div key={k} className={`border rounded-xl p-3 ${cls}`}>
                                            <div className="text-[22px] mb-0.5">{icon}</div>
                                            <div className="text-[20px] font-black leading-none">{n}</div>
                                            <div className="text-[10px] font-bold opacity-70 mt-0.5">{pct}%</div>
                                            <div className="text-[9px] leading-tight mt-1 opacity-80">{label}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── BLOQUES ─────────────────────────────────────────────── */}
                {tab === 'bloques' && (
                    <div className="space-y-3">
                        {BLOQUES.map(bloque => {
                            const ctx   = bloque.ctx ?? null;
                            const score = blockScore(RESPUESTAS, bloque.indices, invertedIndices);
                            const c     = PCT_COLORS[bloque.color];
                            const sl    = scoreLabel(score);
                            const isOpen = expandedBloque === bloque.id;
                            const pqs   = PREGUNTAS.filter(p => p.bloque === bloque.id && p.tipo !== 'sucursal');

                            // Bloque 2: scoreboard por sucursal (colabs evaluando su jefe)
                            const jefesScoreboard = bloque.id === 2
                                ? [...new Set(RESPUESTAS.filter(r => r.isJefe).map(r => r.sucursal))].map(suc => {
                                    const colabRows = RESPUESTAS.filter(r => r.sucursal === suc && !r.isJefe);
                                    const jefe      = RESPUESTAS.find(r => r.sucursal === suc && r.isJefe);
                                    const sColabs   = blockScore(colabRows, bloque.indices, invertedIndices);
                                    const sJefe     = jefe ? blockScore([jefe], bloque.indices, invertedIndices) : null;
                                    return { suc, jefe, colabRows, sColabs, sJefe };
                                  }).sort((a, b) => (a.sColabs ?? 0) - (b.sColabs ?? 0))
                                : null;

                            // Score de jefes evaluando a su supervisor (Bloque 2, jefes only)
                            const jefesEvalSupervisor = bloque.id === 2
                                ? blockScore(RESPUESTAS.filter(r => r.isJefe), bloque.indices, invertedIndices)
                                : null;

                            return (
                                <div key={bloque.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                                    {/* Header */}
                                    <button className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-surface-card-hover/50 transition-colors"
                                        onClick={() => setExpandedBloque(isOpen ? null : bloque.id)}>
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black text-white ${c.bar}`}>
                                            B{bloque.id}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[13px] font-black text-content">{bloque.nombre}</span>
                                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${c.badge}`}>{pqs.length} preguntas</span>
                                                {ctx && <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${ctx.badge}`}>→ {ctx.dirigido}</span>}
                                                {score && <span className={`text-[9px] font-black ${sl.color}`}>{sl.label}</span>}
                                            </div>
                                            <p className="text-[10px] text-content-3 mt-0.5">{bloque.desc}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {score && (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-24 h-1.5 rounded-full bg-surface-card-hover overflow-hidden">
                                                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${score}%` }} />
                                                    </div>
                                                    <span className={`text-[14px] font-black ${c.text} w-10 text-right`}>{score.toFixed(0)}%</span>
                                                </div>
                                            )}
                                            {isOpen ? <ChevronUp size={14} className="text-content-3" /> : <ChevronDown size={14} className="text-content-3" />}
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-slate-50">
                                            {/* Nota contextual */}
                                            {ctx && (
                                                <div className={`mx-4 mt-3 mb-1 px-3 py-2.5 rounded-xl border text-[10px] text-content-2 leading-relaxed flex gap-2 items-start ${ctx.badge.replace('text-', 'border-').replace('bg-', 'bg-')} bg-opacity-30`}
                                                    style={{ background: 'none' }}>
                                                    <Info size={12} className="shrink-0 mt-0.5 opacity-60" />
                                                    <span><strong>¿A quién va dirigido?</strong> {ctx.nota}</span>
                                                </div>
                                            )}

                                            {/* Bloque 2: scoreboard de jefes */}
                                            {bloque.id === 2 && jefesScoreboard && (
                                                <div className="mx-4 mt-3 mb-2 space-y-2">
                                                    {/* Colabs evaluando jefes de sala */}
                                                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                                                        <p className="text-[10px] font-black text-blue-700 uppercase tracking-wider mb-2.5">
                                                            Empleados evaluando a su Jefe/a de Sala
                                                        </p>
                                                        <div className="space-y-2">
                                                            {jefesScoreboard.map(({ suc, jefe, colabRows, sColabs }) => {
                                                                if (!sColabs) return null;
                                                                const sl2 = scoreLabel(sColabs);
                                                                const jefeDisplay = jefe
                                                                    ? jefe.nombre.split(' ').slice(0, 2).join(' ')
                                                                    : '–';
                                                                return (
                                                                    <div key={suc} className="group relative flex items-center gap-3">
                                                                        <div className="w-20 shrink-0">
                                                                            <div className="text-[10px] font-black text-content-2">{suc}</div>
                                                                            <div className="text-[9px] text-content-3">{jefeDisplay} · {colabRows.length} eval.</div>
                                                                        </div>
                                                                        <div className="flex-1 h-2 rounded-full bg-white overflow-hidden">
                                                                            <div className={`h-full rounded-full ${sColabs >= 70 ? 'bg-emerald-500' : sColabs >= 55 ? 'bg-amber-400' : 'bg-rose-500'} transition-all`}
                                                                                style={{ width: `${sColabs}%` }} />
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                            <span className="text-[13px] font-black text-content-2 w-8 text-right">{sColabs.toFixed(0)}%</span>
                                                                            <span className={`text-[9px] font-black w-14 ${sl2.color}`}>{sl2.label}</span>
                                                                            {sColabs < 55 && <AlertTriangle size={11} className="text-rose-500 shrink-0" />}
                                                                        </div>
                                                                        {/* Tooltip: individual colab scores */}
                                                                        <div className="absolute left-0 bottom-full mb-1.5 z-50 hidden group-hover:block bg-white rounded-xl shadow-xl border border-slate-200 p-2.5 min-w-[190px] pointer-events-none">
                                                                            <p className="text-[9px] font-black uppercase tracking-wider text-content-2 mb-1.5">Respuestas individuales</p>
                                                                            {colabRows.map(r => {
                                                                                const s = blockScore([r], bloque.indices, invertedIndices);
                                                                                const sc = s == null ? 'text-content-3'
                                                                                    : s >= 85 ? 'text-success'
                                                                                    : s >= 70 ? 'text-blue-600'
                                                                                    : s >= 55 ? 'text-warning'
                                                                                    : 'text-rose-500';
                                                                                return (
                                                                                    <div key={r.nombre} className="flex items-center justify-between gap-3 py-0.5">
                                                                                        <span className="text-[10px] font-bold text-content-2 capitalize">{r.nombre.charAt(0).toUpperCase() + r.nombre.slice(1).toLowerCase()}</span>
                                                                                        <span className={`text-[10px] font-black ${sc}`}>{s ? `${s.toFixed(0)}%` : '–'}</span>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Jefes evaluando a su jefe inmediato (agrupado) */}
                                                    <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-3">
                                                        <p className="text-[10px] font-black text-purple-700 uppercase tracking-wider mb-1">
                                                            Jefes evaluando a su Jefe Inmediato
                                                        </p>
                                                        <p className="text-[9px] text-content-3 mb-3">
                                                            Cada jefe evalúa a quien reporta directamente. Bodega reporta a Administración; las salas al Supervisor/a de Ventas.
                                                        </p>
                                                        {(() => {
                                                            const groups = {};
                                                            RESPUESTAS.filter(r => r.isJefe).forEach(jefe => {
                                                                const sup = SUPERVISOR_DE_JEFE[jefe.sucursal] || 'Sin definir';
                                                                if (!groups[sup]) groups[sup] = [];
                                                                groups[sup].push(jefe);
                                                            });
                                                            return Object.entries(groups).map(([supervisor, jefes], gi, arr) => {
                                                                const groupScore = blockScore(jefes, bloque.indices, invertedIndices);
                                                                const gsl = groupScore ? scoreLabel(groupScore) : null;
                                                                return (
                                                                    <div key={supervisor} className={gi < arr.length - 1 ? 'mb-3 pb-3 border-b border-purple-100/60' : ''}>
                                                                        <div className="flex items-center justify-between mb-2">
                                                                            <span className="text-[9px] font-black text-purple-600 uppercase tracking-wide">
                                                                                → {supervisor}
                                                                            </span>
                                                                            {gsl && (
                                                                                <span className={`text-[11px] font-black ${gsl.color}`}>
                                                                                    {groupScore.toFixed(0)}% · {gsl.label}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="space-y-1.5">
                                                                            {jefes.map(jefe => {
                                                                                const s = blockScore([jefe], bloque.indices, invertedIndices);
                                                                                const sc = s == null ? 'text-content-3'
                                                                                    : s >= 85 ? 'text-success'
                                                                                    : s >= 70 ? 'text-blue-600'
                                                                                    : s >= 55 ? 'text-warning'
                                                                                    : 'text-rose-500';
                                                                                return (
                                                                                    <div key={jefe.nombre} className="flex items-center gap-3">
                                                                                        <div className="flex items-center gap-2 w-32 shrink-0">
                                                                                            <PersonAvatar nombre={jefe.nombre} photo={jefe.photo} isJefe size={22} />
                                                                                            <div>
                                                                                                <div className="text-[10px] font-black text-content-2 leading-tight">
                                                                                                    {jefe.nombre.split(' ').slice(0, 2).join(' ')}
                                                                                                </div>
                                                                                                <div className="text-[9px] text-content-3">{jefe.sucursal}</div>
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="flex-1 h-1.5 rounded-full bg-white overflow-hidden">
                                                                                            <div className={`h-full rounded-full ${s >= 70 ? 'bg-purple-500' : s >= 55 ? 'bg-amber-400' : 'bg-rose-500'} transition-all`}
                                                                                                style={{ width: `${s ?? 0}%` }} />
                                                                                        </div>
                                                                                        <span className={`text-[12px] font-black w-8 text-right ${sc}`}>{s ? `${s.toFixed(0)}%` : '–'}</span>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            });
                                                        })()}
                                                        <div className="mt-2 pt-2 border-t border-purple-200/60 flex items-center justify-between">
                                                            <span className="text-[9px] text-content-3">Score global jefes</span>
                                                            <span className="text-[14px] font-black text-purple-700">{jefesEvalSupervisor?.toFixed(0)}%</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Preguntas */}
                                            {pqs.map(p => (
                                                <PreguntaRow key={p.id} pregunta={p} rows={RESPUESTAS}
                                                    showDetail={expandedQ === p.id}
                                                    onToggle={() => toggleQ(p.id)} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* ── SEGMENTOS ───────────────────────────────────────────── */}
                {tab === 'segmentos' && (
                    <div className="space-y-5">
                        {/* Jefes vs Empleados */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 mb-4 flex items-center gap-1.5">
                                <Award size={12} className="text-purple-400" /> Jefes vs Empleados
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[480px] text-sm">
                                    <thead>
                                        <tr className="bg-brand/5 border-b border-brand/10">
                                            <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-content-3">Bloque</th>
                                            <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-wider text-purple-600">Jefes ({RESPUESTAS.filter(r => r.isJefe).length})</th>
                                            <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-wider text-content-2">Colabs. ({RESPUESTAS.filter(r => !r.isJefe).length})</th>
                                            <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-wider text-content-2" title="Diferencia en puntos porcentuales: Jefes − Empleados. Positivo = jefes puntúan más alto.">Jefes − Colabs</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {BLOQUES.map(b => {
                                            const jefes = RESPUESTAS.filter(r => r.isJefe);
                                            const colabs = RESPUESTAS.filter(r => !r.isJefe);
                                            const sJ = blockScore(jefes, b.indices, invertedIndices);
                                            const sC = blockScore(colabs, b.indices, invertedIndices);
                                            const delta = sJ && sC ? sJ - sC : null;
                                            const c = PCT_COLORS[b.color];
                                            return (
                                                <tr key={b.id} className="border-b border-slate-50 last:border-0 hover:bg-surface-card-hover/40">
                                                    <td className="px-3 py-2.5">
                                                        <span className={`text-[10px] font-black ${c.text}`}>{b.nombre}</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className="text-[13px] font-black text-purple-700">{sJ?.toFixed(0)}%</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className="text-[13px] font-black text-content-2">{sC?.toFixed(0)}%</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center" title={delta !== null ? (delta >= 0 ? `Jefes ${Math.abs(delta).toFixed(0)}pp por encima` : `Jefes ${Math.abs(delta).toFixed(0)}pp por debajo`) : ''}>
                                                        {delta !== null && (
                                                            <span className={`text-[11px] font-black flex items-center justify-center gap-0.5 ${delta > 5 ? 'text-success' : delta < -5 ? 'text-rose-600' : 'text-content-3'}`}>
                                                                {delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                                                {delta >= 0 ? '+' : ''}{delta.toFixed(0)}pp
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Por sucursal */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 mb-4 flex items-center gap-1.5">
                                <Building2 size={12} className="text-teal-400" /> Score Global por Sucursal
                            </h3>
                            <div className="space-y-2.5">
                                {sucursales.map(suc => {
                                    const rows = RESPUESTAS.filter(r => r.sucursal === suc);
                                    const allIdx = BLOQUES.flatMap(b => b.indices);
                                    const score = blockScore(rows, allIdx, invertedIndices);
                                    if (!score) return null;
                                    const sl = scoreLabel(score);
                                    const jCount = rows.filter(r => r.isJefe).length;
                                    return (
                                        <div key={suc} className="flex items-center gap-3">
                                            <div className="w-20 shrink-0">
                                                <div className="text-[11px] font-black text-content-2 truncate">{suc}</div>
                                                <div className="text-[9px] text-content-3">{rows.length} personas · {jCount} jefe{jCount !== 1 ? 's' : ''}</div>
                                            </div>
                                            <div className="flex-1 h-3 rounded-full bg-surface-card-hover overflow-hidden">
                                                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700"
                                                    style={{ width: `${score}%` }} />
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-[14px] font-black text-content-2 w-10 text-right">{score.toFixed(0)}%</span>
                                                <span className={`text-[9px] font-black w-14 ${sl.color}`}>{sl.label}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Detalle por sucursal y bloque */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 overflow-x-auto">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-content-3 mb-3">Desglose por Sucursal × Bloque</h3>
                            <table className="w-full text-xs min-w-[600px]">
                                <thead>
                                    <tr className="bg-brand/5 border-b border-brand/10">
                                        <th className="text-left px-2 py-2 text-[9px] font-black uppercase tracking-wider text-content-2 whitespace-nowrap">Sucursal</th>
                                        {BLOQUES.map(b => (
                                            <th key={b.id} className="text-center px-2 py-2 text-[9px] font-black uppercase tracking-wider text-content-2 whitespace-nowrap">
                                                B{b.id}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sucursales.map(suc => {
                                        const rows = RESPUESTAS.filter(r => r.sucursal === suc);
                                        return (
                                            <tr key={suc} className="border-b border-slate-50 last:border-0 hover:bg-surface-card-hover/40">
                                                <td className="px-2 py-2 font-black text-[11px] text-content-2 whitespace-nowrap">{suc}</td>
                                                {BLOQUES.map(b => {
                                                    const s = blockScore(rows, b.indices, invertedIndices);
                                                    const cls = s == null ? 'text-content-3'
                                                        : s >= 85 ? 'text-success font-black'
                                                        : s >= 70 ? 'text-blue-600 font-bold'
                                                        : s >= 55 ? 'text-warning font-bold'
                                                        : 'text-rose-600 font-black';
                                                    return (
                                                        <td key={b.id} className={`text-center px-2 py-2 text-[11px] ${cls}`}>
                                                            {s ? `${s.toFixed(0)}%` : '–'}
                                                        </td>
                                                    );
                                                })}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <div className="mt-2 flex items-center gap-4 text-[9px] text-content-3 flex-wrap">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> ≥85% Excelente</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> 70–84% Bueno</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> 55–69% Regular</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> &lt;55% Crítico</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── PERSONAS ────────────────────────────────────────────── */}
                {tab === 'personas' && (
                    <div className="space-y-4">
                        {/* Filtro de rol */}
                        <div className="flex items-center gap-3 flex-wrap">
                            <div className="w-[190px]">
                                <LiquidSelect
                                    value={filterRol}
                                    onChange={setFilterRol}
                                    options={[
                                        { value: 'jefe',  label: 'Solo jefes' },
                                        { value: 'colab', label: 'Solo empleados' },
                                    ]}
                                    placeholder="Todos los roles"
                                    icon={Users}
                                    compact={true}
                                    clearable={true}
                                />
                            </div>
                            <span className="text-[11px] text-content-3">{filteredRows.length} personas</span>
                        </div>

                        {personasBySucursal.map(([branchName, branchRows]) => (
                            <div key={branchName} className="rounded-[1.75rem] border border-border-card bg-surface-card backdrop-blur-xl overflow-hidden shadow-sm">
                                <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100/60 bg-surface-card">
                                    <Building2 size={13} strokeWidth={2.5} className="text-content-3" />
                                    <span className="text-[12px] font-black text-content-2">{branchName}</span>
                                    <span className="text-[11px] text-content-3">— {branchRows.length} {branchRows.length === 1 ? 'persona' : 'personas'}</span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[560px] text-sm">
                                        <thead>
                                            <tr className="bg-brand/5 border-b border-brand/10">
                                                <th className="text-left px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-content-3">Empleado</th>
                                                <th className="text-center px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-content-3 w-16">Rol</th>
                                                {BLOQUES.map(b => (
                                                    <th key={b.id} title={b.nombre || `Bloque ${b.id}`} className="text-center px-2 py-2.5 text-[9px] font-black uppercase tracking-wider text-content-2 cursor-help">B{b.id}</th>
                                                ))}
                                                <th className="text-center px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-content-3">Auto</th>
                                                <th className="text-center px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-content-3">Global</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {branchRows.map(row => {
                                                const i = filteredRows.indexOf(row);
                                                const allIdx = BLOQUES.flatMap(b => b.indices);
                                                const global = blockScore([row], allIdx, invertedIndices);
                                                const self = row.r[selfRatingIdx];
                                                const selfLabel = { A: '9-10', B: '7-8', C: '5-6', D: '1-4' };
                                                const selfCls   = { A: 'text-success', B: 'text-blue-600', C: 'text-warning', D: 'text-rose-600' };
                                                const isExpanded = expandedPersonIdx === i;
                                                return (
                                                    <React.Fragment key={i}>
                                                    <tr
                                                        className={`border-b border-slate-50 last:border-0 hover:bg-surface-card-hover/40 cursor-pointer ${isExpanded ? 'bg-blue-50/30' : ''}`}
                                                        onClick={() => setExpandedPersonIdx(isExpanded ? null : i)}>
                                                        <td className="px-4 py-2.5">
                                                            <div className="flex items-center gap-2.5">
                                                                <PersonAvatar nombre={row.nombre} photo={row.photo} isJefe={row.isJefe} size={30} />
                                                                <div className="font-black text-[12px] text-content leading-tight">{row.nombre}</div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center w-16 whitespace-nowrap">
                                                            <span className={`inline-flex items-center justify-center min-w-[44px] text-[9px] font-black px-2 py-0.5 rounded-full ${row.isJefe ? 'bg-warning/10 text-amber-700' : 'bg-surface-card-hover text-content-3'}`}>
                                                                {row.isJefe ? 'Jefe/a' : 'Colab.'}
                                                            </span>
                                                        </td>
                                                        {BLOQUES.map(b => {
                                                            const s = blockScore([row], b.indices, invertedIndices);
                                                            const cls = s == null ? 'text-content-3'
                                                                : s >= 85 ? 'text-success'
                                                                : s >= 70 ? 'text-blue-600'
                                                                : s >= 55 ? 'text-warning'
                                                                : 'text-rose-600 font-black';
                                                            return (
                                                                <td key={b.id} title={b.nombre} className={`px-2 py-2.5 text-center text-[11px] font-bold cursor-help ${cls}`}>
                                                                    {s ? `${s.toFixed(0)}` : '–'}
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="px-3 py-2.5 text-center">
                                                            {self ? (
                                                                <span className={`text-[12px] font-black ${selfCls[self] || 'text-content-3'}`}>
                                                                    {selfLabel[self] || self}
                                                                </span>
                                                            ) : '–'}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <div className="flex items-center justify-center gap-1">
                                                            {global ? (
                                                                <span className={`text-[12px] font-black ${global >= 85 ? 'text-success' : global >= 70 ? 'text-blue-600' : global >= 55 ? 'text-warning' : 'text-rose-600'}`}>
                                                                    {global.toFixed(0)}%
                                                                </span>
                                                            ) : '–'}
                                                            {isExpanded ? <ChevronUp size={10} className="text-content-3" /> : <ChevronDown size={10} className="text-content-3" />}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr className="bg-blue-50/20">
                                                            <td colSpan={BLOQUES.length + 4} className="px-4 pb-4 pt-0">
                                                                <div className="bg-surface-card rounded-2xl border border-slate-100 shadow-sm overflow-hidden mt-1">
                                                                    {BLOQUES.map(bloque => {
                                                                        const bqs = PREGUNTAS.filter(p => p.bloque === bloque.id && p.tipo !== 'sucursal');
                                                                        if (!bqs.length) return null;
                                                                        const c = PCT_COLORS[bloque.color];
                                                                        return (
                                                                            <div key={bloque.id} className="border-b border-slate-50 last:border-0">
                                                                                <div className={`px-4 py-2 flex items-center gap-2 ${c.bg}`}>
                                                                                    <span className={`text-[10px] font-black uppercase tracking-wider ${c.text}`}>{bloque.nombre}</span>
                                                                                </div>
                                                                                <div className="divide-y divide-slate-50">
                                                                                    {bqs.map(p => {
                                                                                        const ans = row.r[p.idx];
                                                                                        const ABCD = ['A','B','C','D'];
                                                                                        const DEFAULT_OPTS = [
                                                                                            'Siempre / Totalmente de acuerdo',
                                                                                            'Frecuentemente / De acuerdo',
                                                                                            'A veces / En desacuerdo',
                                                                                            'Nunca / Totalmente en desacuerdo',
                                                                                        ];
                                                                                        return (
                                                                                            <div key={p.id} className="flex items-start gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0">
                                                                                                <span className="shrink-0 w-5 h-5 rounded bg-surface-card-hover flex items-center justify-center text-[8px] font-black text-content-3 mt-0.5">{p.id}</span>
                                                                                                <div className="flex-1 min-w-0 space-y-1">
                                                                                                    <p className="text-[10px] text-content-3 leading-snug">{p.texto}</p>
                                                                                                    {p.tipo === 'numerica' ? (
                                                                                                        (() => {
                                                                                                            if (!ans) return <span className="text-[10px] text-content-3">Sin respuesta</span>;
                                                                                                            const n = parseInt(ans, 10);
                                                                                                            const oc = !isNaN(n) ? (n >= 9 ? OPT_COLORS.A : n >= 7 ? OPT_COLORS.B : n >= 5 ? OPT_COLORS.C : OPT_COLORS.D) : OPT_COLORS[ans] || OPT_COLORS.D;
                                                                                                            const display = !isNaN(n) ? `${n} / 10` : ({ A: '9–10', B: '7–8', C: '5–6', D: '1–4' }[ans] || ans);
                                                                                                            return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-black ${oc.on}`}>{display}</span>;
                                                                                                        })()
                                                                                                    ) : (
                                                                                                        ans ? (
                                                                                                            <div className="flex items-center gap-1.5">
                                                                                                                <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 ${OPT_COLORS[ans]?.on || 'bg-surface-card-hover text-content-3'}`}>{ans}</span>
                                                                                                                <span className={`text-[11px] font-semibold leading-snug ${{ A:'text-emerald-700', B:'text-blue-700', C:'text-amber-700', D:'text-rose-700' }[ans] || 'text-content-2'}`}>
                                                                                                                    {p.opciones?.[ABCD.indexOf(ans)] || DEFAULT_OPTS[ABCD.indexOf(ans)] || ans}
                                                                                                                </span>
                                                                                                            </div>
                                                                                                        ) : <span className="text-[10px] text-content-3">Sin respuesta</span>
                                                                                                    )}
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {row.comentario && row.comentario.trim() && row.comentario !== 'null' && (
                                                                        <div className="px-4 py-3 bg-warning/40 border-t border-warning/60">
                                                                            <p className="text-[9px] font-black text-warning uppercase tracking-wider mb-1 flex items-center gap-1">
                                                                                <MessageSquare size={10} /> Comentario
                                                                            </p>
                                                                            <p className="text-[11px] text-content-2 leading-relaxed whitespace-pre-line">{row.comentario}</p>
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
                        ))}
                    </div>
                )}

                {/* ── COMENTARIOS ─────────────────────────────────────────── */}
                {tab === 'comentarios' && (() => {
                    const withComment = RESPUESTAS.filter(r => r.comentario && r.comentario.trim() && r.comentario !== 'null');

                    const segments = [
                        { key: 'General', label: 'General', comments: withComment.map(r => ({ texto: r.comentario, isJefe: r.isJefe, sucursal: r.sucursal })) },
                        { key: 'Jefes', label: 'Jefes', comments: withComment.filter(r => r.isJefe).map(r => ({ texto: r.comentario, isJefe: true, sucursal: r.sucursal })) },
                        { key: 'Empleados', label: 'Empleados', comments: withComment.filter(r => !r.isJefe).map(r => ({ texto: r.comentario, isJefe: false, sucursal: r.sucursal })) },
                    ];

                    return (
                    <div className="space-y-4">
                        {/* AI summary segments */}
                        {segments.map(seg => {
                            const isCollapsed = !!collapsedSummaries[seg.key];
                            const summary = aiSummaries[seg.key];
                            const isLoading = loadingAi[seg.key];
                            const sections = summary ? parseAiSections(summary) : [];
                            const canToggle = summary && !isLoading;

                            return (
                            <div
                                key={seg.key}
                                onClick={() => canToggle && setCollapsedSummaries(p => ({ ...p, [seg.key]: !p[seg.key] }))}
                                className={`rounded-2xl overflow-hidden border border-indigo-200/40 shadow-[0_4px_20px_rgba(99,102,241,0.10)] backdrop-blur-2xl bg-gradient-to-br from-white/60 via-indigo-50/40 to-purple-50/30 transition-all duration-200 ${canToggle ? 'cursor-pointer hover:shadow-[0_6px_28px_rgba(99,102,241,0.18)] hover:border-indigo-300/50' : ''}`}
                            >
                                {/* Segment header bar */}
                                <div className="flex items-center justify-between px-4 py-3 border-b border-indigo-100/60 bg-gradient-to-r from-indigo-50/70 to-purple-50/50">
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-5 h-5 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_8px_rgba(139,92,246,0.35)]">
                                            <Sparkles size={10} className="text-white" />
                                        </div>
                                        <span className="text-[12px] font-black text-content-2 tracking-tight">
                                            Resumen IA <span className="text-content-3 font-normal">·</span> <span className="text-indigo-600">{seg.label}</span>
                                        </span>
                                        <span className="text-[10px] text-content-3 font-medium">{seg.comments.length} comentarios</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {summary && !isLoading && (
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    if (!aiAutoGenDone.current[selectedSurveyId]) aiAutoGenDone.current[selectedSurveyId] = new Set();
                                                    aiAutoGenDone.current[selectedSurveyId].delete(seg.key);
                                                    setAiSummaries(p => { const u = { ...p }; delete u[seg.key]; return u; });
                                                    generateAiSummary(seg.comments, seg.key);
                                                }}
                                                title="Regenerar"
                                                className="p-1.5 rounded-lg text-content-3 hover:text-indigo-600 hover:bg-indigo-50/70 transition-all">
                                                <RotateCcw size={11} strokeWidth={2.5} />
                                            </button>
                                        )}
                                        {summary && !isLoading && (
                                            <button
                                                onClick={e => { e.stopPropagation(); setCollapsedSummaries(p => ({ ...p, [seg.key]: !p[seg.key] })); }}
                                                title={isCollapsed ? 'Expandir' : 'Minimizar'}
                                                className="p-1.5 rounded-lg text-content-3 hover:text-indigo-600 hover:bg-indigo-50/70 transition-all">
                                                {isCollapsed ? <ChevronDown size={11} strokeWidth={2.5} /> : <Minus size={11} strokeWidth={2.5} />}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Content area */}
                                {isLoading ? (
                                    <div className="p-5">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Loader2 size={13} className="animate-spin text-indigo-500 shrink-0" />
                                            <span className="text-[12px] text-indigo-500/80 font-medium">Analizando comentarios con IA…</span>
                                        </div>
                                        <div className="space-y-2.5">
                                            {[1, 0.8, 0.6, 0.75, 0.5].map((w, i) => (
                                                <div key={i} className="h-1.5 rounded-full bg-indigo-100/80 animate-pulse" style={{ width: `${w * 100}%`, animationDelay: `${i * 0.1}s` }} />
                                            ))}
                                        </div>
                                    </div>
                                ) : summary && !isCollapsed ? (
                                    <div className="relative overflow-hidden p-5">
                                        <div className="absolute top-0 right-0 w-48 h-48 rounded-full bg-purple-400/8 blur-3xl pointer-events-none" />
                                        <div className="absolute bottom-0 left-0 w-32 h-32 rounded-full bg-indigo-400/8 blur-3xl pointer-events-none" />
                                        <div className="relative space-y-4">
                                            {sections.map((sec, si) => {
                                                const { Icon, color, dot } = getSectionStyle(sec.title);
                                                return (
                                                    <div key={si} className="space-y-2">
                                                        {sec.title && (
                                                            <div className="flex items-center gap-2">
                                                                <div className={`w-1 h-4 rounded-full ${dot}`} />
                                                                <span className={`text-[10px] font-black uppercase tracking-widest ${color}`}>{sec.title}</span>
                                                            </div>
                                                        )}
                                                        <div className="space-y-1.5 pl-3">
                                                            {renderContentItems(sec.content)}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : summary && isCollapsed ? (
                                    <div className="px-5 py-3">
                                        <p className="text-[10px] text-content-3 truncate">
                                            {sections[0]?.title
                                                ? <><span className="text-indigo-500 font-black uppercase text-[9px]">{sections[0].title}</span> — {sections[0].content.replace(/\*\*/g, '').slice(0, 120)}…</>
                                                : summary.replace(/\*\*/g, '').slice(0, 140) + '…'
                                            }
                                        </p>
                                    </div>
                                ) : seg.comments.length === 0 ? (
                                    <div className="px-5 py-4">
                                        <p className="text-[11px] text-content-3 italic">Sin comentarios en este segmento.</p>
                                    </div>
                                ) : (
                                    <div className="px-5 py-4">
                                        <p className="text-[11px] text-content-3 italic">Cargando resumen guardado…</p>
                                    </div>
                                )}
                            </div>
                            );
                        })}

                        {/* Individual comments */}
                        <h3 className="text-[11px] font-black uppercase tracking-wider text-content-2 px-1">{withComment.length} comentarios individuales</h3>
                        {withComment.map((row, i) => (
                            <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <div className="flex items-center gap-2.5 mb-2">
                                    <PersonAvatar nombre={row.nombre} photo={row.photo} isJefe={row.isJefe} size={34} />
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[12px] font-black text-content-2">{row.nombre}</span>
                                            {row.isJefe && (
                                                <span className="text-[9px] font-black bg-warning/10 text-amber-700 px-1.5 py-0.5 rounded-full">Jefe/a</span>
                                            )}
                                        </div>
                                        <span className="text-[9px] text-content-3">{row.sucursal}</span>
                                    </div>
                                </div>
                                <p className="text-[11px] text-content-2 leading-relaxed whitespace-pre-line pl-[46px]">{row.comentario}</p>
                            </div>
                        ))}
                    </div>
                    );
                })()}

                </>)}
            </div>
        </GlassViewLayout>
    );
}
