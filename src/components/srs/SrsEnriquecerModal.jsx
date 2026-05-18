import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../supabaseClient';
import {
    X, FlaskConical, Loader2, Check, SkipForward,
    ChevronRight, AlertTriangle, Zap, Search, Package,
} from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const CONCURRENCY      = 5;
const BATCH_SIZE       = 300;   // products per run
const DELAY_MS         = 80;    // ms between launches (polite rate limiting)
const AUTO_MIN         = 0.70;  // >= auto-apply (high confidence)
const REVIEW_MIN       = 0;     // everything with any SRS result goes to review
const TOP_CANDIDATES   = 3;     // SRS candidates shown per review card

// ── Matching helpers ──────────────────────────────────────────────────────────

const SKIP_TOKENS = new Set([
    'MG','ML','MCG','UG','G','UI','IU','GR',
    'X','CX','DE','Y','CON','POR','EL','LA','LOS','LAS',
    'MK','SAIMED','MEGALAB','GENFAR','LAFRANCOL','PFIZER','NOVARTIS',
    'ROCHE','BAYER','MERCK','SYNTOFARMA','ROEMMERS','SIEGFRIED','LIOMONT',
    'DENMARK','PISA','ULTRA','FORTE','PLUS','MAX','MINI',
]);

function normalize(str = '') {
    return str
        .toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getTokens(str) {
    return normalize(str).split(' ').filter(t => t.length >= 2 && !SKIP_TOKENS.has(t));
}

function scoreMatch(dbName, srsName) {
    const a = new Set(getTokens(dbName));
    const b = new Set(getTokens(srsName));
    if (a.size === 0 || b.size === 0) return 0;

    const inter = [...a].filter(t => b.has(t)).length;
    const union = new Set([...a, ...b]).size;
    let s = inter / union;

    // Boost if dosage numbers all match
    const aNums = [...a].filter(t => /^\d+$/.test(t));
    const bNums = new Set([...b].filter(t => /^\d+$/.test(t)));
    if (aNums.length > 0 && aNums.every(n => bNums.has(n))) {
        s = Math.min(1, s * 1.3);
    }
    return s;
}

function parsePrincipios(srs) {
    const paRaw   = (srs.principio_activo || '').trim();
    const concRaw = (srs.concentracion    || '').trim();
    if (!paRaw) return [];

    const nombres = paRaw.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);
    const concs   = concRaw.split(/\s*\+\s*/).map(s => s.trim()).filter(Boolean);

    return nombres.map((nombre, i) => ({
        nombre,
        concentracion: concs[i] || '',
        orden: i,
    }));
}

function buildPaText(principios) {
    return principios.map(p => [p.nombre, p.concentracion].filter(Boolean).join(' ')).join(', ');
}

// ── SRS fetch via edge function ───────────────────────────────────────────────

async function srsFetch(q, page = 1, pageMax = 15) {
    const { data: { session } } = await supabase.auth.getSession();
    const base = import.meta.env.VITE_SUPABASE_URL;
    const url  = `${base}/functions/v1/srs-proxy?q=${encodeURIComponent(q)}&page=${page}&page-max=${pageMax}`;
    const res  = await fetch(url, {
        headers: {
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
    });
    if (!res.ok) throw new Error(`SRS ${res.status}`);
    return res.json();
}

// ── Save to Supabase ──────────────────────────────────────────────────────────

async function applyPrincipios(productId, principios) {
    const text = buildPaText(principios);
    await supabase.from('product_active_principles').delete().eq('product_id', productId);
    if (principios.length > 0) {
        await supabase.from('product_active_principles').insert(
            principios.map(p => ({ product_id: productId, ...p }))
        );
    }
    await supabase.from('products').update({ principio_activo: text || null }).eq('id', productId);
}

// ── Confidence badge ──────────────────────────────────────────────────────────

function ConfBadge({ score }) {
    const pct = Math.round(score * 100);
    const cls = score >= AUTO_MIN
        ? 'bg-emerald-100 text-emerald-700'
        : score >= REVIEW_MIN
            ? 'bg-amber-100 text-amber-700'
            : 'bg-red-100 text-red-600';
    return (
        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full tabular-nums ${cls}`}>
            {pct}%
        </span>
    );
}

// ── SrsEnriquecerModal ────────────────────────────────────────────────────────

const PHASE = { IDLE: 'idle', SCANNING: 'scanning', REVIEWING: 'reviewing', DONE: 'done' };

export default function SrsEnriquecerModal({ onClose }) {
    const [phase, setPhase]           = useState(PHASE.IDLE);
    const [scanned, setScanned]       = useState(0);
    const [total, setTotal]           = useState(0);
    const [autoQueue, setAutoQueue]   = useState([]);   // {product, srs, score, principios}
    const [reviewQueue, setReviewQueue] = useState([]); // same + candidates[]
    const [noMatchList, setNoMatchList]   = useState([]);        // {id, nombre}
    const [markedSinPA, setMarkedSinPA]   = useState(new Set()); // ids marcados como sin PA
    const [applied, setApplied]       = useState(0);
    const [skipped, setSkipped]       = useState(0);
    const [applying, setApplying]     = useState(false);

    // Review state
    const [reviewIdx, setReviewIdx]   = useState(0);
    const [reviewApplying, setRevApplying] = useState(false);

    const cancelRef = useRef(false);

    // ── Start scan ─────────────────────────────────────────────────────────────
    const handleStart = useCallback(async () => {
        cancelRef.current = false;
        setPhase(PHASE.SCANNING);
        setScanned(0); setAutoQueue([]); setReviewQueue([]);
        setNoMatchList([]); setMarkedSinPA(new Set());
        setApplied(0); setSkipped(0); setReviewIdx(0);

        // Fetch products without principio_activo
        const { data: products, error } = await supabase
            .from('products')
            .select('id, nombre')
            .eq('activo', true)
            .eq('sin_principio_activo', false)
            .or('principio_activo.is.null,principio_activo.eq.')
            .not('id', 'in', `(select product_id from product_active_principles)`)
            .limit(BATCH_SIZE)
            .order('nombre');

        if (error || !products?.length) {
            setPhase(PHASE.DONE);
            return;
        }
        setTotal(products.length);

        // Process with concurrency
        const queue = [...products];
        let active  = 0;
        let done    = 0;

        await new Promise(resolve => {
            const next = async () => {
                if (cancelRef.current) { resolve(); return; }
                if (queue.length === 0 && active === 0) { resolve(); return; }
                if (queue.length === 0) return;

                const product = queue.shift();
                active++;
                await new Promise(r => setTimeout(r, DELAY_MS));

                try {
                    const json = await srsFetch(product.nombre, 1, 15);
                    const results = json.data || [];

                    // Score all results, take top candidates
                    const scored = results
                        .map(r => ({ srs: r, score: scoreMatch(product.nombre, r.nombre_comercial || r.nombreComercial || '') }))
                        .filter(r => r.score >= REVIEW_MIN)
                        .sort((a, b) => b.score - a.score)
                        .slice(0, TOP_CANDIDATES);

                    const best = scored[0];
                    if (!best) {
                        setNoMatchList(l => [...l, { id: product.id, nombre: product.nombre }]);
                    } else {
                        const principios = parsePrincipios(best.srs);
                        const entry = { product, srs: best.srs, score: best.score, principios, candidates: scored };

                        if (best.score >= AUTO_MIN) {
                            setAutoQueue(q => [...q, entry]);
                        } else {
                            setReviewQueue(q => [...q, entry]);
                        }
                    }
                } catch { setNoMatchList(l => [...l, { id: product.id, nombre: product.nombre }]); }

                done++;
                active--;
                setScanned(done);
                next();
                if (queue.length === 0 && active === 0) resolve();
            };

            for (let i = 0; i < CONCURRENCY; i++) next();
        });

        setPhase(PHASE.REVIEWING);
    }, []);

    // ── Apply all auto matches ─────────────────────────────────────────────────
    const handleApplyAuto = useCallback(async () => {
        setApplying(true);
        let count = 0;
        for (const entry of autoQueue) {
            if (cancelRef.current) break;
            try {
                await applyPrincipios(entry.product.id, entry.principios);
                count++;
            } catch { /* continue */ }
        }
        setApplied(a => a + count);
        setAutoQueue([]);
        setApplying(false);
    }, [autoQueue]);

    // ── Review actions ─────────────────────────────────────────────────────────
    const handleReviewApply = useCallback(async (entry) => {
        setRevApplying(true);
        try {
            await applyPrincipios(entry.product.id, entry.principios);
            setApplied(a => a + 1);
        } catch { /* continue */ }
        setReviewIdx(i => i + 1);
        setRevApplying(false);
    }, []);

    const handleReviewSkip = useCallback(() => {
        setSkipped(s => s + 1);
        setReviewIdx(i => i + 1);
    }, []);

    // Mark a product as sin_principio_activo (insumos, equipos, cosméticos…)
    const handleMarkSinPA = useCallback(async (productId) => {
        try {
            await supabase.from('products').update({ sin_principio_activo: true }).eq('id', productId);
            setMarkedSinPA(s => new Set([...s, productId]));
        } catch { /* ignore */ }
    }, []);

    const handleUnmarkSinPA = useCallback(async (productId) => {
        try {
            await supabase.from('products').update({ sin_principio_activo: false }).eq('id', productId);
            setMarkedSinPA(s => { const n = new Set(s); n.delete(productId); return n; });
        } catch { /* ignore */ }
    }, []);

    // Mark as sin PA and advance review
    const handleReviewMarkSinPA = useCallback(async (entry) => {
        setRevApplying(true);
        try {
            await supabase.from('products').update({ sin_principio_activo: true }).eq('id', entry.product.id);
            setMarkedSinPA(s => new Set([...s, entry.product.id]));
        } catch { /* ignore */ }
        setSkipped(s => s + 1);
        setReviewIdx(i => i + 1);
        setRevApplying(false);
    }, []);

    // Pick a different candidate
    const handlePickCandidate = useCallback((entry, candidateIdx) => {
        const cand = entry.candidates[candidateIdx];
        if (!cand) return;
        const principios = parsePrincipios(cand.srs);
        const newEntry = { ...entry, srs: cand.srs, score: cand.score, principios };
        setReviewQueue(q => q.map((e, i) => i === reviewIdx ? newEntry : e));
    }, [reviewIdx]);

    const currentReview  = reviewQueue[reviewIdx];
    const reviewDone     = reviewIdx >= reviewQueue.length;
    const allDone        = reviewDone && autoQueue.length === 0;

    // If reviewing phase and queue is empty, go to done
    const isDone = phase === PHASE.REVIEWING && autoQueue.length === 0 && reviewDone;

    // ── Render ─────────────────────────────────────────────────────────────────
    return createPortal(
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[90vh]">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
                            <FlaskConical size={15} className="text-violet-600" />
                        </div>
                        <div>
                            <p className="text-[14px] font-black text-slate-800">Enriquecer desde SRS</p>
                            <p className="text-[11px] text-slate-400">Busca y aplica principios activos del Registro Sanitario</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors">
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </div>

                {/* Body */}
                <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">

                    {/* ── IDLE ── */}
                    {phase === PHASE.IDLE && (
                        <div className="flex flex-col items-center gap-4 py-6 text-center">
                            <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center">
                                <Zap size={28} className="text-violet-500" />
                            </div>
                            <div>
                                <p className="text-[15px] font-black text-slate-800">Matching automático con SRS</p>
                                <p className="text-[12px] text-slate-500 mt-1 max-w-sm">
                                    Busca hasta {BATCH_SIZE} productos en el Registro Sanitario de El Salvador,
                                    aplica los matches seguros automáticamente y te consulta los dudosos.
                                </p>
                            </div>
                            <div className="flex gap-4 text-[11px] font-bold">
                                <span className="flex items-center gap-1.5 text-emerald-600"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block"/> ≥ 70% — auto-aplica</span>
                                <span className="flex items-center gap-1.5 text-amber-600"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block"/> {'< 70%'} — te consulta</span>
                                <span className="flex items-center gap-1.5 text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block"/> Sin resultados SRS — descarta</span>
                            </div>
                            <button onClick={handleStart}
                                className="mt-2 px-8 py-3 rounded-full text-[13px] font-black text-white bg-violet-600 hover:bg-violet-700 transition-colors shadow-lg shadow-violet-200">
                                Iniciar escaneo
                            </button>
                        </div>
                    )}

                    {/* ── SCANNING ── */}
                    {phase === PHASE.SCANNING && (
                        <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-3">
                                <Loader2 size={18} className="text-violet-500 animate-spin shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] font-black text-slate-700">Escaneando productos…</p>
                                    <p className="text-[11px] text-slate-400">{scanned} de {total} procesados</p>
                                </div>
                            </div>

                            {/* Progress bar */}
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-violet-500 rounded-full transition-all duration-300"
                                    style={{ width: total ? `${(scanned / total) * 100}%` : '0%' }} />
                            </div>

                            {/* Live counters */}
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: 'Auto-aplica', count: autoQueue.length, cls: 'text-emerald-600', bg: 'bg-emerald-50' },
                                    { label: 'Para revisar', count: reviewQueue.length, cls: 'text-amber-600', bg: 'bg-amber-50' },
                                    { label: 'Sin coincidencia', count: noMatchList.length, cls: 'text-slate-500', bg: 'bg-slate-50' },
                                ].map(c => (
                                    <div key={c.label} className={`${c.bg} rounded-2xl p-3 text-center`}>
                                        <p className={`text-[22px] font-black tabular-nums ${c.cls}`}>{c.count}</p>
                                        <p className="text-[10px] font-bold text-slate-500">{c.label}</p>
                                    </div>
                                ))}
                            </div>

                            <button onClick={() => { cancelRef.current = true; }}
                                className="self-center px-4 py-2 rounded-full text-[11px] font-bold text-slate-500 hover:bg-slate-100 transition-colors border border-slate-200">
                                Detener
                            </button>
                        </div>
                    )}

                    {/* ── REVIEWING ── */}
                    {phase === PHASE.REVIEWING && (
                        <div className="flex flex-col gap-4">

                            {/* Summary bar */}
                            <div className="grid grid-cols-4 gap-2 text-center">
                                {[
                                    { label: 'Escaneados', v: scanned, cls: 'text-slate-700' },
                                    { label: 'Auto-aplica', v: autoQueue.length, cls: 'text-emerald-600' },
                                    { label: 'Para revisar', v: reviewQueue.length - reviewIdx, cls: 'text-amber-600' },
                                    { label: 'Aplicados', v: applied, cls: 'text-[#007AFF]' },
                                ].map(c => (
                                    <div key={c.label} className="bg-slate-50 rounded-2xl py-2.5 px-1">
                                        <p className={`text-[18px] font-black tabular-nums ${c.cls}`}>{c.v}</p>
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">{c.label}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Auto-apply block */}
                            {autoQueue.length > 0 && (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-[13px] font-black text-emerald-800">
                                            {autoQueue.length} coincidencias con alta confianza
                                        </p>
                                        <p className="text-[11px] text-emerald-600 mt-0.5">Se aplicarán sin confirmación individual.</p>
                                    </div>
                                    <button onClick={handleApplyAuto} disabled={applying}
                                        className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-full text-[12px] font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50">
                                        {applying ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                                        Aplicar {autoQueue.length}
                                    </button>
                                </div>
                            )}

                            {/* Review card */}
                            {!reviewDone && currentReview ? (
                                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                                    <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-100">
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                            Revisar — {reviewIdx + 1} / {reviewQueue.length}
                                        </p>
                                        <ConfBadge score={currentReview.score} />
                                    </div>

                                    <div className="p-4 flex flex-col gap-3">
                                        {/* DB product */}
                                        <div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Tu producto</p>
                                            <p className="text-[13px] font-black text-slate-800">{currentReview.product.nombre}</p>
                                        </div>

                                        {/* Candidates */}
                                        <div>
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Coincidencias SRS</p>
                                            <div className="flex flex-col gap-1.5">
                                                {currentReview.candidates.map((cand, ci) => {
                                                    const isSelected = cand.srs === currentReview.srs;
                                                    const pios = parsePrincipios(cand.srs);
                                                    return (
                                                        <button key={cand.srs.id}
                                                            onClick={() => handlePickCandidate(currentReview, ci)}
                                                            className={`w-full text-left rounded-xl border p-3 transition-all ${
                                                                isSelected
                                                                    ? 'border-violet-300 bg-violet-50'
                                                                    : 'border-slate-100 bg-white hover:border-violet-200 hover:bg-violet-50/40'
                                                            }`}>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <p className="text-[11px] font-bold text-slate-700 leading-snug flex-1">
                                                                    {cand.srs.nombre_comercial || cand.srs.nombreComercial}
                                                                </p>
                                                                <ConfBadge score={cand.score} />
                                                            </div>
                                                            {pios.length > 0 && (
                                                                <p className="text-[10px] text-violet-600 font-medium mt-1">
                                                                    {pios.map(p => [p.nombre, p.concentracion].filter(Boolean).join(' ')).join(' + ')}
                                                                </p>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Selected principios preview */}
                                        {currentReview.principios.length > 0 && (
                                            <div className="bg-violet-50 rounded-xl px-3 py-2 flex items-start gap-2">
                                                <FlaskConical size={11} className="text-violet-400 shrink-0 mt-0.5" />
                                                <p className="text-[11px] text-violet-700 font-medium">
                                                    {currentReview.principios.map(p => [p.nombre, p.concentracion].filter(Boolean).join(' ')).join(' + ')}
                                                </p>
                                            </div>
                                        )}

                                        {/* Actions */}
                                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                                            <button onClick={() => handleReviewApply(currentReview)} disabled={reviewApplying || currentReview.principios.length === 0}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-black text-white bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50">
                                                {reviewApplying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                Aplicar
                                            </button>
                                            <button onClick={() => handleReviewMarkSinPA(currentReview)} disabled={reviewApplying}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-bold text-slate-500 border border-slate-200 hover:border-orange-200 hover:text-orange-600 hover:bg-orange-50 transition-colors">
                                                <Package size={12} /> Insumo/Equipo
                                            </button>
                                            <button onClick={handleReviewSkip} disabled={reviewApplying}
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-bold text-slate-400 border border-slate-200 hover:bg-slate-50 transition-colors">
                                                <SkipForward size={12} /> Saltar
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : reviewDone && (
                                <div className="flex items-center gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                                    <Check size={18} className="text-emerald-500 shrink-0" />
                                    <p className="text-[13px] font-bold text-slate-700">Revisión completada.</p>
                                </div>
                            )}

                            {/* Done / close */}
                            {(isDone || allDone) && (
                                <div className="flex flex-col gap-3 pt-2">
                                    <p className="text-[13px] font-black text-slate-700 text-center">
                                        ✓ {applied} aplicados · {skipped} saltados · {noMatchList.length} sin coincidencia en SRS
                                    </p>

                                    {noMatchList.length > 0 && (
                                        <div className="border border-slate-200 rounded-2xl overflow-hidden">
                                            <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                                                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                                    Sin resultado en SRS ({noMatchList.length})
                                                </p>
                                                <p className="text-[10px] text-slate-400">SRS no devolvió ningún candidato</p>
                                            </div>
                                            <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                                                {noMatchList.map(p => (
                                                    <div key={p.id} className="px-4 py-2.5 flex items-center gap-2">
                                                        <span className="text-[10px] text-slate-300 font-mono shrink-0">#{p.id}</span>
                                                        <span className="text-[12px] text-slate-600 font-medium truncate flex-1">{p.nombre}</span>
                                                        {markedSinPA.has(p.id) ? (
                                                            <button onClick={() => handleUnmarkSinPA(p.id)}
                                                                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                                                                <Check size={9} strokeWidth={3} /> Insumo
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => handleMarkSinPA(p.id)}
                                                                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold text-slate-400 border border-slate-200 hover:border-orange-200 hover:text-orange-600 hover:bg-orange-50 transition-colors">
                                                                <Package size={9} /> Insumo
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <button onClick={onClose}
                                        className="self-center px-6 py-2.5 rounded-full text-[12px] font-black text-white bg-[#007AFF] hover:bg-[#006AEF] transition-colors">
                                        Cerrar
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
