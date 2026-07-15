import React, { useState, useRef, useCallback } from 'react';
import LiquidModal from '../common/LiquidModal';
import { supabase } from '../../supabaseClient';
import {
    X, FlaskConical, Loader2, Check, SkipForward,
    ChevronRight, AlertTriangle, Zap, Search, Package, Plus,
} from 'lucide-react';
import SrsBuscadorWidget from './SrsBuscadorWidget';

// ── Constants ─────────────────────────────────────────────────────────────────

const CONCURRENCY      = 5;
const BATCH_SIZE       = 300;   // products per run
const DELAY_MS         = 80;    // ms between launches (polite rate limiting)
const AUTO_MIN         = 0.70;  // >= auto-apply (high confidence)
const REVIEW_MIN       = 0;     // everything with any SRS result goes to review
const TOP_CANDIDATES   = 3;     // SRS candidates shown per review card

// ── Matching helpers ──────────────────────────────────────────────────────────

const SKIP_TOKENS = new Set([
    // Dose units
    'MG','ML','MCG','UG','G','UI','IU','GR','MEQ',
    // Prepositions / articles
    'X','CX','DE','Y','CON','POR','EL','LA','LOS','LAS','AL',
    // Lab / brand names
    'MK','SAIMED','MEGALAB','GENFAR','LAFRANCOL','PFIZER','NOVARTIS',
    'ROCHE','BAYER','MERCK','SYNTOFARMA','ROEMMERS','SIEGFRIED','LIOMONT',
    'DENMARK','PISA',
    // Modifiers
    'ULTRA','FORTE','PLUS','MAX','MINI',
    // Pharma forms & descriptors — add no identity info, inflate union only
    'TAB','TABS','CAP','CAPS','COMP','AMP','INY','SOL','SUS','JAR','GTS','SUSP',
    'TABLETA','TABLETAS','CAPSULA','CAPSULAS','COMPRIMIDO','COMPRIMIDOS',
    'AMPOLLA','AMPOLLAS','INYECTABLE','SOLUCION','SUSPENSION','JARABE',
    'GOTAS','CREMA','UNGUENTO','OVULO','OVULOS','SUPOSITORIO','SUPOSITORIOS',
    'BLANDA','BLANDAS','DURA','DURAS','GELATINA','RECUBIERTA','RECUBIERTO',
    'MASTICABLE','EFERVESCENTE','SUBLINGUAL','RETARD','LIBERACION',
    // Packaging units
    'CAJA','FRASCO','BLISTER','BLIS','VIAL','VIALES','SOBRE','SOBRES',
    'TUBO','TUBOS','SACHET','SACHETS','ENVASE','POMO','UNIDAD','UNIDADES',
]);

function normalize(str = '') {
    return str
        .toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/(\d+)([A-Z]+)/g, '$1 $2')   // split fused "500MG" → "500 MG"
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getTokens(str) {
    // Strip "X NNN" quantity patterns before scoring so "X 30 TAB" doesn't penalise Jaccard
    const clean = normalize(str).replace(/\bX\s*\d+\b/g, ' ');
    return clean.split(' ').filter(t => t.length >= 2 && !SKIP_TOKENS.has(t));
}

// Returns array of clean drug-name tokens (no lab, no form, no quantity)
function buildQueryTokens(nombre) {
    const clean = normalize(nombre).replace(/\bX\s*\d+\b/g, ' ');
    return clean.split(/\s+/).filter(t => t.length >= 2 && !SKIP_TOKENS.has(t));
}

// Extracts the short identifier word from a lab name ("Laboratorios MK S.A." → "MK")
const CORP_WORDS = new Set([
    'LABORATORIO','LABORATORIOS','FARMACEUTICA','FARMACEUTICOS','FARMACEUTICO',
    'INDUSTRIA','INDUSTRIAS','PRODUCTOS','COMERCIAL','INTERNACIONAL',
    'SA','SL','SRL','SAS','CIA','CO','CV','NV','INC','LTD','LLC','CORP',
    'DE','LA','EL','LOS','Y','DEL',
]);
function getLabToken(labNombre = '') {
    if (!labNombre) return '';
    return normalize(labNombre).split(' ')
        .find(w => w.length >= 2 && w.length <= 12 && !CORP_WORDS.has(w) && !/^\d+$/.test(w)) || '';
}

// Try up to 3 search strategies, return first that has SRS results
async function srsFetchMulti(product) {
    const tokens   = buildQueryTokens(product.nombre);
    const labToken = getLabToken(product.laboratorios?.nombre);

    const strategies = [];

    // 1. drug + dosage + lab  →  "ACETAMINOFEN 500 MK"
    if (tokens.length > 0 && labToken) {
        strategies.push([...tokens.slice(0, 4), labToken].join(' '));
    }

    // 2. drug + dosage only  →  "ACETAMINOFEN 500"
    if (tokens.length > 0) {
        strategies.push(tokens.slice(0, 4).join(' '));
    }

    // 3. concatenated non-numeric short tokens  →  "ACI TIP" → "ACITIP" (finds "ACI-TIP")
    const brandParts = tokens.filter(t => !/^\d+$/.test(t)).slice(0, 2);
    if (brandParts.length === 2 && brandParts.every(t => t.length <= 6)) {
        strategies.push(brandParts.join(''));
    }

    // Deduplicate, try each until results are found
    const seen = new Set();
    for (const q of strategies) {
        if (seen.has(q) || !q.trim()) continue;
        seen.add(q);
        const json = await srsFetch(q, 1, 15);
        if ((json.data || []).length > 0) return json;
    }
    return { data: [], total: 0 };
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
    const [autoRejected, setAutoRejected] = useState(new Set()); // product IDs to skip in auto batch
    const [reviewQueue, setReviewQueue] = useState([]); // same + candidates[]
    const [noMatchList, setNoMatchList]   = useState([]);        // {id, nombre}
    const [markedSinPA, setMarkedSinPA]   = useState(new Set()); // ids marcados como sin PA
    const [applied, setApplied]       = useState(0);
    const [skipped, setSkipped]       = useState(0);
    const [applying, setApplying]     = useState(false);

    // Review state
    const [reviewIdx, setReviewIdx]       = useState(0);
    const [reviewApplying, setRevApplying] = useState(false);
    const [reviewPanel, setReviewPanel]   = useState(null); // null | 'srs' | 'manual'
    const [manualItems, setManualItems]   = useState([{ nombre: '', concentracion: '', _key: 0 }]);

    const cancelRef = useRef(false);

    // ── Start scan ─────────────────────────────────────────────────────────────
    const handleStart = useCallback(async () => {
        cancelRef.current = false;
        setPhase(PHASE.SCANNING);
        setScanned(0); setAutoQueue([]); setAutoRejected(new Set()); setReviewQueue([]);
        setNoMatchList([]); setMarkedSinPA(new Set());
        setApplied(0); setSkipped(0); setReviewIdx(0);
        setReviewPanel(null); setManualItems([{ nombre: '', concentracion: '', _key: 0 }]);

        // Fetch products without principio_activo
        const { data: products, error } = await supabase
            .from('products')
            .select('id, nombre, laboratorios(nombre)')
            .eq('activo', true)
            .eq('sin_principio_activo', false)
            .or('principio_activo.is.null,principio_activo.eq.')
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
                    const json    = await srsFetchMulti(product);
                    const results = json.data || [];

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
            if (autoRejected.has(entry.product.id)) continue;
            try {
                await applyPrincipios(entry.product.id, entry.principios);
                count++;
            } catch { /* continue */ }
        }
        setApplied(a => a + count);
        setSkipped(s => s + autoRejected.size);
        setAutoQueue([]);
        setAutoRejected(new Set());
        setApplying(false);
    }, [autoQueue, autoRejected]);

    // ── Review actions ─────────────────────────────────────────────────────────
    const handleReviewApply = useCallback(async (entry) => {
        setRevApplying(true);
        try {
            await applyPrincipios(entry.product.id, entry.principios);
            setApplied(a => a + 1);
        } catch { /* continue */ }
        setReviewIdx(i => i + 1);
        setReviewPanel(null); setManualItems([{ nombre: '', concentracion: '', _key: 0 }]);
        setRevApplying(false);
    }, []);

    const handleReviewSkip = useCallback(() => {
        setSkipped(s => s + 1);
        setReviewIdx(i => i + 1);
        setReviewPanel(null); setManualItems([{ nombre: '', concentracion: '', _key: 0 }]);
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
        setReviewPanel(null); setManualItems([{ nombre: '', concentracion: '', _key: 0 }]);
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
    return (
        <LiquidModal open onClose={onClose} maxWidth="max-w-2xl" zClass="z-[99999]" className="max-h-[90vh]" ariaLabel="Enriquecer desde SRS">

                <LiquidModal.Header>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center">
                                <FlaskConical size={15} className="text-violet-600" />
                            </div>
                            <div>
                                <p className="text-[14px] font-black text-slate-800">Enriquecer desde SRS</p>
                                <p className="text-[11px] text-slate-500">Busca y aplica principios activos del Registro Sanitario</p>
                            </div>
                        </div>
                        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/60 text-slate-500 transition-colors">
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    </div>
                </LiquidModal.Header>

                <LiquidModal.Body className="flex flex-col gap-5">

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
                                <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2.5 h-2.5 rounded-full bg-slate-300 inline-block"/> Sin resultados SRS — descarta</span>
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
                                    <p className="text-[11px] text-slate-500">{scanned} de {total} procesados</p>
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
                                    { label: 'Aplicados', v: applied, cls: 'text-[#0052CC]' },
                                ].map(c => (
                                    <div key={c.label} className="bg-slate-50 rounded-2xl py-2.5 px-1">
                                        <p className={`text-[18px] font-black tabular-nums ${c.cls}`}>{c.v}</p>
                                        <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wide">{c.label}</p>
                                    </div>
                                ))}
                            </div>

                            {/* Auto-apply list — reviewable */}
                            {autoQueue.length > 0 && (
                                <div className="rounded-2xl border border-emerald-200 overflow-hidden">
                                    <div className="bg-emerald-50 px-4 py-2.5 border-b border-emerald-100 flex items-center justify-between gap-3 shrink-0">
                                        <div>
                                            <p className="text-[12px] font-black text-emerald-800">Alta confianza</p>
                                            <p className="text-[10px] text-emerald-600">
                                                {autoQueue.length - autoRejected.size} de {autoQueue.length} seleccionados · toca ✗ para excluir
                                            </p>
                                        </div>
                                        <button onClick={handleApplyAuto}
                                            disabled={applying || autoQueue.length === autoRejected.size}
                                            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-black text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-50">
                                            {applying ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                                            Aplicar {autoQueue.length - autoRejected.size}
                                        </button>
                                    </div>
                                    <div className="max-h-52 overflow-y-auto divide-y divide-slate-50 bg-white">
                                        {autoQueue.map(entry => {
                                            const rejected = autoRejected.has(entry.product.id);
                                            return (
                                                <div key={entry.product.id} className={`px-4 py-2.5 flex items-center gap-2.5 transition-opacity ${rejected ? 'opacity-30' : ''}`}>
                                                    <ConfBadge score={entry.score} />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[11px] font-bold text-slate-700 truncate">{entry.product.nombre}</p>
                                                        {entry.principios.length > 0 && (
                                                            <p className="text-[10px] text-violet-600 truncate">
                                                                {entry.principios.map(p => [p.nombre, p.concentracion].filter(Boolean).join(' ')).join(' + ')}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <button onClick={() => setAutoRejected(s => {
                                                        const n = new Set(s);
                                                        n.has(entry.product.id) ? n.delete(entry.product.id) : n.add(entry.product.id);
                                                        return n;
                                                    })} className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-full border transition-all ${
                                                        rejected
                                                            ? 'border-emerald-200 text-emerald-500 bg-emerald-50 hover:bg-emerald-100'
                                                            : 'border-red-100 text-red-400 hover:bg-red-50 hover:border-red-200'
                                                    }`}>
                                                        {rejected ? <Check size={10} strokeWidth={3}/> : <X size={10} strokeWidth={2.5}/>}
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
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
                                            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1">Tu producto</p>
                                            <p className="text-[13px] font-black text-slate-800">{currentReview.product.nombre}</p>
                                        </div>

                                        {/* Candidates */}
                                        <div>
                                            <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest mb-1.5">Coincidencias SRS</p>
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
                                                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-bold text-slate-500 border border-slate-200 hover:bg-slate-50 transition-colors">
                                                <SkipForward size={12} /> Saltar
                                            </button>
                                        </div>

                                        {/* Toggle panel buttons */}
                                        <div className="flex items-center gap-3 pt-1 border-t border-slate-100">
                                            <button onClick={() => setReviewPanel(p => p === 'srs' ? null : 'srs')}
                                                className={`flex items-center gap-1.5 text-[11px] font-bold transition-colors ${reviewPanel === 'srs' ? 'text-[#0052CC]' : 'text-slate-500 hover:text-[#0052CC]'}`}>
                                                <Search size={12} /> Buscar en SRS
                                            </button>
                                            <span className="text-slate-200">|</span>
                                            <button onClick={() => setReviewPanel(p => p === 'manual' ? null : 'manual')}
                                                className={`flex items-center gap-1.5 text-[11px] font-bold transition-colors ${reviewPanel === 'manual' ? 'text-[#0052CC]' : 'text-slate-500 hover:text-[#0052CC]'}`}>
                                                <FlaskConical size={12} /> Ingresar manualmente
                                            </button>
                                        </div>

                                        {/* SRS search panel */}
                                        {reviewPanel === 'srs' && (
                                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                                <SrsBuscadorWidget
                                                    initialQuery={currentReview.product.nombre}
                                                    onSelectResult={(srsProduct) => {
                                                        const principios = parsePrincipios(srsProduct);
                                                        setReviewQueue(q => q.map((e, i) =>
                                                            i === reviewIdx ? { ...e, srs: srsProduct, score: 1, principios } : e
                                                        ));
                                                        setReviewPanel(null);
                                                    }}
                                                />
                                            </div>
                                        )}

                                        {/* Manual entry panel */}
                                        {reviewPanel === 'manual' && (
                                            <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 flex flex-col gap-2">
                                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                                                    Principio activo manual
                                                </p>
                                                <div className="space-y-1.5">
                                                    {manualItems.map((item, idx) => (
                                                        <div key={item._key} className="flex items-center gap-1.5">
                                                            <span className="text-[9px] text-slate-500 font-bold w-3 text-right shrink-0">{idx + 1}</span>
                                                            <input
                                                                value={item.nombre}
                                                                onChange={e => setManualItems(prev => prev.map(p => p._key === item._key ? { ...p, nombre: e.target.value } : p))}
                                                                placeholder="Nombre del principio"
                                                                spellCheck={false} autoComplete="off"
                                                                className="flex-1 min-w-0 px-2 py-1.5 border border-slate-200 rounded-lg text-[16px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0052CC]/20 bg-white placeholder:text-slate-300"
                                                            />
                                                            <input
                                                                value={item.concentracion}
                                                                onChange={e => setManualItems(prev => prev.map(p => p._key === item._key ? { ...p, concentracion: e.target.value } : p))}
                                                                placeholder="Cant."
                                                                spellCheck={false} autoComplete="off"
                                                                className="w-[58px] shrink-0 px-2 py-1.5 border border-slate-200 rounded-lg text-[16px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#0052CC]/20 bg-white placeholder:text-slate-300 text-center"
                                                            />
                                                            <button onClick={() => setManualItems(prev =>
                                                                prev.length > 1
                                                                    ? prev.filter(p => p._key !== item._key)
                                                                    : [{ nombre: '', concentracion: '', _key: Date.now() }]
                                                            )} className="w-6 h-6 rounded-full flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-50 transition-all shrink-0">
                                                                <X size={10} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <button onClick={() => setManualItems(prev => [...prev, { nombre: '', concentracion: '', _key: Date.now() }])}
                                                        className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-[#0052CC] transition-colors pt-0.5">
                                                        <Plus size={10} /> Agregar principio
                                                    </button>
                                                </div>
                                                <button
                                                    disabled={!manualItems.some(p => p.nombre.trim())}
                                                    onClick={() => {
                                                        const principios = manualItems
                                                            .filter(p => p.nombre.trim())
                                                            .map((p, i) => ({ nombre: p.nombre.trim(), concentracion: p.concentracion.trim(), orden: i }));
                                                        setReviewQueue(q => q.map((e, i) =>
                                                            i === reviewIdx ? { ...e, srs: null, score: 1, principios } : e
                                                        ));
                                                        setReviewPanel(null);
                                                        setManualItems([{ nombre: '', concentracion: '', _key: 0 }]);
                                                    }}
                                                    className="self-end px-4 py-1.5 rounded-full bg-[#0052CC] text-white text-[11px] font-black disabled:opacity-40 hover:bg-[#003D99] transition-colors">
                                                    Usar estos principios
                                                </button>
                                            </div>
                                        )}
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
                                                <p className="text-[10px] text-slate-500">SRS no devolvió ningún candidato</p>
                                            </div>
                                            <div className="max-h-48 overflow-y-auto divide-y divide-slate-50">
                                                {noMatchList.map(p => (
                                                    <div key={p.id} className="px-4 py-2.5 flex items-center gap-2">
                                                        <span className="text-[10px] text-slate-500 font-mono shrink-0">#{p.id}</span>
                                                        <span className="text-[12px] text-slate-600 font-medium truncate flex-1">{p.nombre}</span>
                                                        {markedSinPA.has(p.id) ? (
                                                            <button onClick={() => handleUnmarkSinPA(p.id)}
                                                                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors">
                                                                <Check size={9} strokeWidth={3} /> Insumo
                                                            </button>
                                                        ) : (
                                                            <button onClick={() => handleMarkSinPA(p.id)}
                                                                className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold text-slate-500 border border-slate-200 hover:border-orange-200 hover:text-orange-600 hover:bg-orange-50 transition-colors">
                                                                <Package size={9} /> Insumo
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <button onClick={onClose}
                                        className="self-center px-6 py-2.5 rounded-full text-[12px] font-black text-white bg-[#0052CC] hover:bg-[#003D99] transition-colors">
                                        Cerrar
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </LiquidModal.Body>
        </LiquidModal>
    );
}
