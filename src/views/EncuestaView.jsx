import React, { useState, useMemo, useEffect } from 'react';
import {
    BarChart2, Users, Star, MessageSquare, ChevronDown, ChevronUp,
    TrendingUp, TrendingDown, Award, Heart, AlertTriangle, Building2,
    UserCheck, UserX, ThumbsUp, Smile, Meh, Frown, Info, Loader2
} from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import { supabase } from '../supabaseClient';
import { JEFE_POR_SUCURSAL, SUPERVISOR_DE_JEFE } from '../data/encuestaData';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SCORE_MAP = { A: 4, B: 3, C: 2, D: 1 };
const PCT_COLORS = {
    blue:    { bar: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200',    badge: 'bg-blue-100 text-blue-700' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
    amber:   { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   badge: 'bg-amber-100 text-amber-700' },
    indigo:  { bar: 'bg-indigo-500',  text: 'text-indigo-700',  bg: 'bg-indigo-50',  border: 'border-indigo-200',  badge: 'bg-indigo-100 text-indigo-700' },
    purple:  { bar: 'bg-purple-500',  text: 'text-purple-700',  bg: 'bg-purple-50',  border: 'border-purple-200',  badge: 'bg-purple-100 text-purple-700' },
    teal:    { bar: 'bg-teal-500',    text: 'text-teal-700',    bg: 'bg-teal-50',    border: 'border-teal-200',    badge: 'bg-teal-100 text-teal-700' },
    rose:    { bar: 'bg-rose-500',    text: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200',    badge: 'bg-rose-100 text-rose-700' },
    slate:   { bar: 'bg-slate-500',   text: 'text-slate-700',   bg: 'bg-slate-50',   border: 'border-slate-200',   badge: 'bg-slate-100 text-slate-700' },
};

function scoreVal(v) {
    if (!v || v === '-') return null;
    return SCORE_MAP[v.toUpperCase()] ?? null;
}

function blockScore(rows, indices) {
    let total = 0, count = 0;
    for (const row of rows) {
        for (const i of indices) {
            const v = scoreVal(row.r[i]);
            if (v !== null) { total += v; count++; }
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
    if (pct >= 85) return { label: 'Excelente', color: 'text-emerald-600', Icon: Smile };
    if (pct >= 70) return { label: 'Bueno',     color: 'text-blue-600',    Icon: ThumbsUp };
    if (pct >= 55) return { label: 'Regular',   color: 'text-amber-600',   Icon: Meh };
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
    if (!total) return <span className="text-[10px] text-slate-300">Sin datos</span>;
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
            <div className="flex-1 flex h-2.5 rounded-full overflow-hidden gap-px bg-slate-100">
                {bars.map(({ key, n, cls }) => n > 0 && (
                    <div key={key} className={`${cls} transition-all duration-500`}
                        style={{ width: `${(n / total) * 100}%` }}
                        title={`${key}: ${n} (${pct(n)}%)`} />
                ))}
            </div>
            <span className={`text-[10px] font-black w-8 text-right ${positives >= 70 ? 'text-emerald-600' : positives >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>
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
            <button className="w-full text-left px-4 py-3 hover:bg-slate-50/60 transition-colors flex items-start gap-3"
                onClick={onToggle}>
                <span className="shrink-0 w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-black text-slate-500 mt-0.5">
                    P{pregunta.id}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-slate-700 leading-snug mb-1.5">{pregunta.texto}</p>
                    <DistBar dist={dist} invertida={pregunta.invertida} />
                </div>
                <div className="shrink-0 pt-0.5">
                    {showDetail ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
                </div>
            </button>

            {showDetail && (
                <div className="px-4 pb-3 pt-0">
                    <div className="ml-10 grid grid-cols-4 gap-2">
                        {[
                            { k: 'A', label: pregunta.opciones?.[0] || 'Siempre / Totalmente de acuerdo',  cls: 'bg-emerald-50 border-emerald-200 text-emerald-700', chip: 'bg-emerald-100 text-emerald-700' },
                            { k: 'B', label: pregunta.opciones?.[1] || 'Frecuentemente / De acuerdo',       cls: 'bg-blue-50 border-blue-200 text-blue-700',           chip: 'bg-blue-100 text-blue-700' },
                            { k: 'C', label: pregunta.opciones?.[2] || 'A veces / En desacuerdo',           cls: 'bg-amber-50 border-amber-200 text-amber-700',         chip: 'bg-amber-100 text-amber-700' },
                            { k: 'D', label: pregunta.opciones?.[3] || 'Nunca / Totalmente en desacuerdo',  cls: 'bg-rose-50 border-rose-200 text-rose-700',            chip: 'bg-rose-100 text-rose-700' },
                        ].map(({ k, label, cls, chip }) => (
                            <div key={k} className={`border rounded-xl p-2.5 ${cls}`}>
                                <div className="text-[18px] font-black leading-none">{dist[k]}</div>
                                <div className="text-[9px] font-black uppercase tracking-wider opacity-70 mt-0.5">{k} · {pct(dist[k])}%</div>
                                <div className="text-[9px] leading-tight mt-1 mb-2 opacity-80">{label}</div>
                                {namesByOption[k].length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-1 border-t border-current/10 pt-1.5">
                                        {namesByOption[k].map(({ nombre, isJefe, sucursal, photo }) => (
                                            <div key={nombre} className="flex items-center gap-2 pl-1 pr-2.5 py-1 rounded-full bg-white/70 border border-black/10">
                                                <PersonAvatar nombre={nombre} photo={photo} isJefe={isJefe} size={24} />
                                                <div className="flex flex-col leading-tight">
                                                    <span className="text-[10px] font-black leading-none text-slate-800">
                                                        {nombre.split(' ').map((w, i) => i === 0 ? w : w.charAt(0) + '.').join(' ')}
                                                        {isJefe && <span className="ml-1 opacity-60">·J</span>}
                                                    </span>
                                                    <span className="text-[9px] opacity-55 leading-none mt-0.5 text-slate-600">{sucursal}</span>
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
                <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</span>
                <span className={`text-[9px] font-black ${sl.color}`}>{sl.label}</span>
            </div>
            <div className="text-[22px] font-black leading-none" style={{ color: '' }}>
                <span className={c.text}>{pct.toFixed(0)}<span className="text-[13px]">%</span></span>
            </div>
            <div className="h-1.5 rounded-full bg-white/60 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${c.bar}`}
                    style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[9px] text-slate-400 leading-tight mt-0.5">{desc}</p>
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

// ─── Main component ───────────────────────────────────────────────────────────
export default function EncuestaView() {
    const [tab, setTab] = useState('resumen');
    const [expandedQ, setExpandedQ] = useState(null);
    const [expandedBloque, setExpandedBloque] = useState(null);
    const [filterSucursal, setFilterSucursal] = useState('');
    const [filterRol, setFilterRol] = useState('');

    // ── Supabase data ──────────────────────────────────────────────────────────
    const [surveys, setSurveys] = useState([]);
    const [selectedSurveyId, setSelectedSurveyId] = useState(null);
    const [RESPUESTAS, setRespuestas] = useState([]);
    const [BLOQUES, setBloques] = useState([]);
    const [PREGUNTAS, setPreguntas] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.from('surveys').select('*').order('año', { ascending: false })
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
            supabase.from('survey_bloques').select('*').eq('survey_id', selectedSurveyId).order('numero'),
            supabase.from('survey_preguntas').select('*').eq('survey_id', selectedSurveyId).order('numero'),
            supabase.from('survey_responses')
                .select('*, employee:employees(first_names, last_names, photo_url, branch:branches(name))')
                .eq('survey_id', selectedSurveyId),
        ]).then(([bRes, pRes, rRes]) => {
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
                const fn = r.employee?.first_names || '';
                const ln = r.employee?.last_names  || '';
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

    const sucursales = useMemo(() => [...new Set(RESPUESTAS.map(r => r.sucursal))].sort(), [RESPUESTAS]);

    const filteredRows = useMemo(() => {
        let r = RESPUESTAS;
        if (filterSucursal) r = r.filter(x => x.sucursal === filterSucursal);
        if (filterRol === 'jefe') r = r.filter(x => x.isJefe);
        if (filterRol === 'colab') r = r.filter(x => !x.isJefe);
        return r;
    }, [filterSucursal, filterRol, RESPUESTAS]);

    const bloquesScores = useMemo(() =>
        BLOQUES.map(b => ({ ...b, score: blockScore(filteredRows, b.indices) })),
    [filteredRows, BLOQUES]);

    const globalScore = useMemo(() => {
        const allIdx = BLOQUES.flatMap(b => b.indices);
        return blockScore(filteredRows, allIdx);
    }, [filteredRows, BLOQUES]);

    // Distribución P31 (autocalificación numérica)
    const selfRatings = useMemo(() => {
        const vals = filteredRows.map(r => parseInt(r.r[30])).filter(v => !isNaN(v));
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const dist = {};
        for (let i = 6; i <= 10; i++) dist[i] = vals.filter(v => v === i).length;
        return { vals, avg, dist };
    }, [filteredRows]);

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

    const selectedSurvey = surveys.find(s => s.id === selectedSurveyId);

    return (
        <GlassViewLayout
            title={selectedSurvey?.nombre ?? 'Clima Organizacional'}
            subtitle={`Farmacias La Popular y La Salud — ${RESPUESTAS.length} colaboradores`}>
            <div className="p-5 md:p-6 space-y-5">

                {/* Survey selector + Tabs row */}
                <div className="flex flex-wrap items-center gap-3">
                    {surveys.length > 1 && (
                        <select value={selectedSurveyId ?? ''} onChange={e => setSelectedSurveyId(Number(e.target.value))}
                            className="h-9 px-3 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-700 bg-white shadow-sm">
                            {surveys.map(s => <option key={s.id} value={s.id}>{s.nombre} ({s.año})</option>)}
                        </select>
                    )}
                </div>

                {loading ? (
                    <div className="flex items-center justify-center h-48 gap-2 text-slate-400">
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-[12px] font-semibold">Cargando encuesta…</span>
                    </div>
                ) : (<>

                {/* Tabs */}
                <div className="flex items-center gap-1 bg-slate-100/80 rounded-xl p-1 w-fit">
                    {TABS.map(({ key, label, Icon }) => (
                        <button key={key} onClick={() => setTab(key)}
                            className={`flex items-center gap-1.5 px-3 h-8 rounded-[9px] text-[11px] font-black transition-all duration-200 ${
                                tab === key
                                    ? 'bg-white text-slate-800 shadow-sm'
                                    : 'text-slate-400 hover:text-slate-600'
                            }`}>
                            <Icon size={12} strokeWidth={2.5} />
                            {label}
                        </button>
                    ))}
                </div>

                {/* ── RESUMEN ─────────────────────────────────────────────── */}
                {tab === 'resumen' && (
                    <div className="space-y-5">
                        {/* KPIs */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { label: 'Participantes',  value: RESPUESTAS.length, sub: '100% del total', Icon: Users,    grad: 'from-blue-500 to-indigo-500' },
                                { label: 'Jefes',          value: RESPUESTAS.filter(r => r.isJefe).length,  sub: 'de sala / área', Icon: UserCheck, grad: 'from-purple-500 to-violet-500' },
                                { label: 'Colaboradores',  value: RESPUESTAS.filter(r => !r.isJefe).length, sub: 'de sala / área', Icon: UserX,     grad: 'from-slate-500 to-slate-400' },
                                { label: 'Sucursales',     value: sucursales.length, sub: 'representadas',  Icon: Building2, grad: 'from-teal-500 to-emerald-500' },
                            ].map(({ label, value, sub, Icon, grad }) => (
                                <div key={label} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-100 bg-white shadow-sm">
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center shrink-0`}>
                                        <Icon size={14} className="text-white" />
                                    </div>
                                    <div>
                                        <div className="text-[22px] font-black text-slate-800 leading-none">{value}</div>
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                                        <div className="text-[9px] text-slate-400">{sub}</div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Score global + por bloque */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Score global */}
                            <div className="flex flex-col items-center justify-center bg-white rounded-2xl border border-slate-100 shadow-sm p-6 gap-2">
                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Score Global</span>
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
                                        <span className="text-[26px] font-black text-slate-800 leading-none">{globalScore?.toFixed(0)}</span>
                                        <span className="text-[11px] font-bold text-slate-400">/ 100</span>
                                    </div>
                                </div>
                                {(() => { const sl = scoreLabel(globalScore); return (
                                    <span className={`text-[11px] font-black ${sl.color}`}>{sl.label}</span>
                                ); })()}
                                <p className="text-[9px] text-slate-400 text-center">Promedio ponderado de todos los bloques (escala A–D)</p>
                            </div>

                            {/* Scores por bloque */}
                            <div className="md:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3">Puntaje por Bloque</h3>
                                <div className="space-y-2.5">
                                    {bloquesScores.map(b => {
                                        if (!b.score) return null;
                                        const c = PCT_COLORS[b.color];
                                        const sl = scoreLabel(b.score);
                                        return (
                                            <div key={b.id} className="flex items-center gap-3">
                                                <div className={`w-24 text-[9px] font-black uppercase tracking-wider ${c.text} truncate shrink-0`}>{b.nombre}</div>
                                                <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                                                    <div className={`h-full rounded-full ${c.bar} transition-all duration-700`}
                                                        style={{ width: `${b.score}%` }} />
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    <span className="text-[12px] font-black text-slate-700 w-8 text-right">{b.score.toFixed(0)}%</span>
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
                                <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
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
                                            <span className="w-5 h-5 rounded-lg text-white text-[10px] font-black flex items-center justify-center shrink-0 bg-slate-400">{k}</span>
                                            <div className="flex-1">
                                                <div className="flex justify-between mb-0.5">
                                                    <span className="text-[10px] text-slate-600">{label}</span>
                                                    <span className="text-[10px] font-black text-slate-700">{n} ({pct}%)</span>
                                                </div>
                                                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                                    <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Autocalificación */}
                            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                                    <Star size={12} className="text-amber-400" /> Autocalificación como trabajador/a
                                </h3>
                                <p className="text-[10px] text-slate-400 mb-3">Escala 1–10 (solo se registraron valores entre 6 y 9)</p>
                                <div className="flex items-end gap-2 h-20">
                                    {[6, 7, 8, 9, 10].map(v => {
                                        const n = selfRatings.dist[v] || 0;
                                        const maxN = Math.max(...Object.values(selfRatings.dist));
                                        const h = maxN > 0 ? Math.round((n / maxN) * 100) : 0;
                                        return (
                                            <div key={v} className="flex-1 flex flex-col items-center gap-1">
                                                <span className="text-[9px] font-black text-slate-600">{n || ''}</span>
                                                <div className="w-full rounded-t-lg bg-amber-400 transition-all" style={{ height: `${h}%`, minHeight: n > 0 ? 4 : 0 }} />
                                                <span className="text-[10px] font-black text-slate-400">{v}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-3 flex items-center justify-between border-t border-slate-50 pt-2">
                                    <span className="text-[10px] text-slate-400">Promedio</span>
                                    <span className="text-[18px] font-black text-amber-600">{selfRatings.avg.toFixed(1)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Comunicación de inconformidades */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
                                <Info size={12} className="text-blue-400" /> ¿Con quién comunican las inconformidades?
                            </h3>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                {[
                                    { k: 'A', label: 'Jefe inmediato',          icon: '👤', cls: 'bg-blue-50 border-blue-200 text-blue-700'     },
                                    { k: 'B', label: 'Supervisión / Admin',      icon: '🏢', cls: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                                    { k: 'C', label: 'Compañeros',              icon: '👥', cls: 'bg-amber-50 border-amber-200 text-amber-700'   },
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
                            const score = blockScore(RESPUESTAS, bloque.indices);
                            const c     = PCT_COLORS[bloque.color];
                            const sl    = scoreLabel(score);
                            const isOpen = expandedBloque === bloque.id;
                            const pqs   = PREGUNTAS.filter(p => p.bloque === bloque.id && p.tipo !== 'sucursal');

                            // Bloque 2: scoreboard por sucursal (colabs evaluando su jefe)
                            const jefesScoreboard = bloque.id === 2
                                ? Object.entries(JEFE_POR_SUCURSAL).map(([suc, jefeNickname]) => {
                                    const colabRows = RESPUESTAS.filter(r => r.sucursal === suc && !r.isJefe);
                                    const jefe      = RESPUESTAS.find(r => r.sucursal === suc && r.isJefe);
                                    const sColabs   = blockScore(colabRows, bloque.indices);
                                    const sJefe     = jefe ? blockScore([jefe], bloque.indices) : null;
                                    return { suc, jefeNickname, jefe, colabRows, sColabs, sJefe };
                                  }).sort((a, b) => (a.sColabs ?? 0) - (b.sColabs ?? 0))
                                : null;

                            // Score de jefes evaluando a su supervisor (Bloque 2, jefes only)
                            const jefesEvalSupervisor = bloque.id === 2
                                ? blockScore(RESPUESTAS.filter(r => r.isJefe), bloque.indices)
                                : null;

                            return (
                                <div key={bloque.id} className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                                    {/* Header */}
                                    <button className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors"
                                        onClick={() => setExpandedBloque(isOpen ? null : bloque.id)}>
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-black text-white ${c.bar}`}>
                                            B{bloque.id}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="text-[13px] font-black text-slate-800">{bloque.nombre}</span>
                                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${c.badge}`}>{pqs.length} preguntas</span>
                                                {ctx && <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${ctx.badge}`}>→ {ctx.dirigido}</span>}
                                                {score && <span className={`text-[9px] font-black ${sl.color}`}>{sl.label}</span>}
                                            </div>
                                            <p className="text-[10px] text-slate-400 mt-0.5">{bloque.desc}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {score && (
                                                <div className="flex items-center gap-2">
                                                    <div className="w-24 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                                        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${score}%` }} />
                                                    </div>
                                                    <span className={`text-[14px] font-black ${c.text} w-10 text-right`}>{score.toFixed(0)}%</span>
                                                </div>
                                            )}
                                            {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                        </div>
                                    </button>

                                    {isOpen && (
                                        <div className="border-t border-slate-50">
                                            {/* Nota contextual */}
                                            {ctx && (
                                                <div className={`mx-4 mt-3 mb-1 px-3 py-2.5 rounded-xl border text-[10px] text-slate-600 leading-relaxed flex gap-2 items-start ${ctx.badge.replace('text-', 'border-').replace('bg-', 'bg-')} bg-opacity-30`}
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
                                                            Colaboradores evaluando a su Jefe/a de Sala
                                                        </p>
                                                        <div className="space-y-2">
                                                            {jefesScoreboard.map(({ suc, jefeNickname, jefe, colabRows, sColabs }) => {
                                                                if (!sColabs) return null;
                                                                const sl2 = scoreLabel(sColabs);
                                                                const jefeDisplay = jefe
                                                                    ? jefe.nombre.split(' ').slice(0, 2).join(' ')
                                                                    : jefeNickname;
                                                                return (
                                                                    <div key={suc} className="group relative flex items-center gap-3">
                                                                        <div className="w-20 shrink-0">
                                                                            <div className="text-[10px] font-black text-slate-700">{suc}</div>
                                                                            <div className="text-[9px] text-slate-400">{jefeDisplay} · {colabRows.length} eval.</div>
                                                                        </div>
                                                                        <div className="flex-1 h-2 rounded-full bg-white overflow-hidden">
                                                                            <div className={`h-full rounded-full ${sColabs >= 70 ? 'bg-emerald-500' : sColabs >= 55 ? 'bg-amber-400' : 'bg-rose-500'} transition-all`}
                                                                                style={{ width: `${sColabs}%` }} />
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                                            <span className="text-[13px] font-black text-slate-700 w-8 text-right">{sColabs.toFixed(0)}%</span>
                                                                            <span className={`text-[9px] font-black w-14 ${sl2.color}`}>{sl2.label}</span>
                                                                            {sColabs < 55 && <AlertTriangle size={11} className="text-rose-500 shrink-0" />}
                                                                        </div>
                                                                        {/* Tooltip: individual colab scores */}
                                                                        <div className="absolute left-0 bottom-full mb-1.5 z-50 hidden group-hover:block bg-white rounded-xl shadow-xl border border-slate-200 p-2.5 min-w-[190px] pointer-events-none">
                                                                            <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Respuestas individuales</p>
                                                                            {colabRows.map(r => {
                                                                                const s = blockScore([r], bloque.indices);
                                                                                const sc = s == null ? 'text-slate-300'
                                                                                    : s >= 85 ? 'text-emerald-600'
                                                                                    : s >= 70 ? 'text-blue-600'
                                                                                    : s >= 55 ? 'text-amber-600'
                                                                                    : 'text-rose-500';
                                                                                return (
                                                                                    <div key={r.nombre} className="flex items-center justify-between gap-3 py-0.5">
                                                                                        <span className="text-[10px] font-bold text-slate-700 capitalize">{r.nombre.charAt(0).toUpperCase() + r.nombre.slice(1).toLowerCase()}</span>
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
                                                        <p className="text-[9px] text-slate-400 mb-3">
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
                                                                const groupScore = blockScore(jefes, bloque.indices);
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
                                                                                const s = blockScore([jefe], bloque.indices);
                                                                                const sc = s == null ? 'text-slate-300'
                                                                                    : s >= 85 ? 'text-emerald-600'
                                                                                    : s >= 70 ? 'text-blue-600'
                                                                                    : s >= 55 ? 'text-amber-600'
                                                                                    : 'text-rose-500';
                                                                                return (
                                                                                    <div key={jefe.nombre} className="flex items-center gap-3">
                                                                                        <div className="flex items-center gap-2 w-32 shrink-0">
                                                                                            <PersonAvatar nombre={jefe.nombre} photo={jefe.photo} isJefe size={22} />
                                                                                            <div>
                                                                                                <div className="text-[10px] font-black text-slate-700 leading-tight">
                                                                                                    {jefe.nombre.split(' ').slice(0, 2).join(' ')}
                                                                                                </div>
                                                                                                <div className="text-[9px] text-slate-400">{jefe.sucursal}</div>
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
                                                            <span className="text-[9px] text-slate-400">Score global jefes</span>
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
                        {/* Jefes vs Colaboradores */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
                                <Award size={12} className="text-purple-400" /> Jefes vs Colaboradores
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            <th className="text-left px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500">Bloque</th>
                                            <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-wider text-purple-600">Jefes ({RESPUESTAS.filter(r => r.isJefe).length})</th>
                                            <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-600">Colabs. ({RESPUESTAS.filter(r => !r.isJefe).length})</th>
                                            <th className="text-center px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Δ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {BLOQUES.map(b => {
                                            const jefes = RESPUESTAS.filter(r => r.isJefe);
                                            const colabs = RESPUESTAS.filter(r => !r.isJefe);
                                            const sJ = blockScore(jefes, b.indices);
                                            const sC = blockScore(colabs, b.indices);
                                            const delta = sJ && sC ? sJ - sC : null;
                                            const c = PCT_COLORS[b.color];
                                            return (
                                                <tr key={b.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40">
                                                    <td className="px-3 py-2.5">
                                                        <span className={`text-[10px] font-black ${c.text}`}>{b.nombre}</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className="text-[13px] font-black text-purple-700">{sJ?.toFixed(0)}%</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        <span className="text-[13px] font-black text-slate-700">{sC?.toFixed(0)}%</span>
                                                    </td>
                                                    <td className="px-3 py-2.5 text-center">
                                                        {delta !== null && (
                                                            <span className={`text-[11px] font-black flex items-center justify-center gap-0.5 ${delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                {delta >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                                                {Math.abs(delta).toFixed(0)}pp
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
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-1.5">
                                <Building2 size={12} className="text-teal-400" /> Score Global por Sucursal
                            </h3>
                            <div className="space-y-2.5">
                                {sucursales.map(suc => {
                                    const rows = RESPUESTAS.filter(r => r.sucursal === suc);
                                    const allIdx = BLOQUES.flatMap(b => b.indices);
                                    const score = blockScore(rows, allIdx);
                                    if (!score) return null;
                                    const sl = scoreLabel(score);
                                    const jCount = rows.filter(r => r.isJefe).length;
                                    return (
                                        <div key={suc} className="flex items-center gap-3">
                                            <div className="w-20 shrink-0">
                                                <div className="text-[11px] font-black text-slate-700 truncate">{suc}</div>
                                                <div className="text-[9px] text-slate-400">{rows.length} personas · {jCount} jefe{jCount !== 1 ? 's' : ''}</div>
                                            </div>
                                            <div className="flex-1 h-3 rounded-full bg-slate-100 overflow-hidden">
                                                <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700"
                                                    style={{ width: `${score}%` }} />
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-[14px] font-black text-slate-700 w-10 text-right">{score.toFixed(0)}%</span>
                                                <span className={`text-[9px] font-black w-14 ${sl.color}`}>{sl.label}</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Detalle por sucursal y bloque */}
                        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 overflow-x-auto">
                            <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-500 mb-3">Desglose por Sucursal × Bloque</h3>
                            <table className="w-full text-xs min-w-[600px]">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-100">
                                        <th className="text-left px-2 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap">Sucursal</th>
                                        {BLOQUES.map(b => (
                                            <th key={b.id} className="text-center px-2 py-2 text-[9px] font-black uppercase tracking-wider text-slate-400 whitespace-nowrap">
                                                B{b.id}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {sucursales.map(suc => {
                                        const rows = RESPUESTAS.filter(r => r.sucursal === suc);
                                        return (
                                            <tr key={suc} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40">
                                                <td className="px-2 py-2 font-black text-[11px] text-slate-700 whitespace-nowrap">{suc}</td>
                                                {BLOQUES.map(b => {
                                                    const s = blockScore(rows, b.indices);
                                                    const cls = s == null ? 'text-slate-300'
                                                        : s >= 85 ? 'text-emerald-600 font-black'
                                                        : s >= 70 ? 'text-blue-600 font-bold'
                                                        : s >= 55 ? 'text-amber-600 font-bold'
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
                            <div className="mt-2 flex items-center gap-4 text-[9px] text-slate-400 flex-wrap">
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
                        {/* Filtros */}
                        <div className="flex items-center gap-3 flex-wrap">
                            <select value={filterSucursal} onChange={e => setFilterSucursal(e.target.value)}
                                className="h-8 px-3 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 bg-white shadow-sm">
                                <option value="">Todas las sucursales</option>
                                {sucursales.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                            <select value={filterRol} onChange={e => setFilterRol(e.target.value)}
                                className="h-8 px-3 rounded-xl border border-slate-200 text-[11px] font-bold text-slate-600 bg-white shadow-sm">
                                <option value="">Todos los roles</option>
                                <option value="jefe">Solo jefes</option>
                                <option value="colab">Solo colaboradores</option>
                            </select>
                            <span className="text-[11px] text-slate-400">{filteredRows.length} personas</span>
                        </div>

                        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200/60">
                                        <th className="text-left px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Colaborador · Sucursal</th>
                                        <th className="text-center px-3 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Rol</th>
                                        {BLOQUES.map(b => (
                                            <th key={b.id} className="text-center px-2 py-3 text-[9px] font-black uppercase tracking-wider text-slate-400">B{b.id}</th>
                                        ))}
                                        <th className="text-center px-3 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Auto</th>
                                        <th className="text-center px-3 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Global</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRows.map((row, i) => {
                                        const allIdx = BLOQUES.flatMap(b => b.indices);
                                        const global = blockScore([row], allIdx);
                                        const self = parseInt(row.r[30]);
                                        return (
                                            <tr key={i} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40">
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <PersonAvatar nombre={row.nombre} photo={row.photo} isJefe={row.isJefe} size={30} />
                                                        <div>
                                                            <div className="font-black text-[12px] text-slate-800 leading-tight">{row.nombre}</div>
                                                            <div className="text-[9px] text-slate-400 leading-tight">{row.sucursal}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2.5 text-center">
                                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${row.isJefe ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                                                        {row.isJefe ? 'Jefe/a' : 'Colab.'}
                                                    </span>
                                                </td>
                                                {BLOQUES.map(b => {
                                                    const s = blockScore([row], b.indices);
                                                    const cls = s == null ? 'text-slate-300'
                                                        : s >= 85 ? 'text-emerald-600'
                                                        : s >= 70 ? 'text-blue-600'
                                                        : s >= 55 ? 'text-amber-600'
                                                        : 'text-rose-600 font-black';
                                                    return (
                                                        <td key={b.id} className={`px-2 py-2.5 text-center text-[11px] font-bold ${cls}`}>
                                                            {s ? `${s.toFixed(0)}` : '–'}
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-3 py-2.5 text-center text-[13px] font-black text-amber-600">
                                                    {isNaN(self) ? '–' : self}
                                                </td>
                                                <td className="px-3 py-2.5 text-center">
                                                    {global ? (
                                                        <span className={`text-[12px] font-black ${global >= 85 ? 'text-emerald-600' : global >= 70 ? 'text-blue-600' : global >= 55 ? 'text-amber-600' : 'text-rose-600'}`}>
                                                            {global.toFixed(0)}%
                                                        </span>
                                                    ) : '–'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* ── COMENTARIOS ─────────────────────────────────────────── */}
                {tab === 'comentarios' && (
                    <div className="space-y-3">
                        <p className="text-[11px] text-slate-400">
                            {RESPUESTAS.filter(r => r.comentario && r.comentario.trim() && r.comentario !== 'null').length} colaboradores dejaron comentarios sobre mejoras al ambiente laboral.
                        </p>
                        {RESPUESTAS.filter(r => r.comentario && r.comentario.trim()).map((row, i) => (
                            <div key={i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <div className="flex items-center gap-2.5 mb-2">
                                    <PersonAvatar nombre={row.nombre} photo={row.photo} isJefe={row.isJefe} size={34} />
                                    <div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[12px] font-black text-slate-700">{row.nombre}</span>
                                            {row.isJefe && (
                                                <span className="text-[9px] font-black bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                                                    Jefe/a
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-[9px] text-slate-400">{row.sucursal}</span>
                                    </div>
                                </div>
                                <p className="text-[11px] text-slate-600 leading-relaxed whitespace-pre-line pl-[46px]">{row.comentario}</p>
                            </div>
                        ))}
                    </div>
                )}

                </>)}
            </div>
        </GlassViewLayout>
    );
}
