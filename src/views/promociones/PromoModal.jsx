import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    Tag, X, Check, Loader2, ChevronRight, ChevronLeft,
    Package, Plus, Trash2, DollarSign, Calendar,
    FlaskConical, Users, Gift,
} from 'lucide-react';
import { supabase }      from '../../supabaseClient';
import { useAuth }       from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import LiquidSelect      from '../../components/common/LiquidSelect';
import LiquidDatePicker  from '../../components/common/LiquidDatePicker';

// IDs de sucursales de ventas (excluye Bodega=30 y Administracion=32)
const SALES_BRANCH_IDS = [2, 4, 25, 27, 28, 29];

const END_COND_OPTIONS = [
    { value: 'date',  label: 'Por fecha' },
    { value: 'stock', label: 'Por agotamiento de stock' },
    { value: 'both',  label: 'Por fecha o stock (lo que ocurra primero)' },
];

const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const inp = 'w-full text-[12px] bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-300 text-slate-700';
const lbl = 'text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block';

// ── Step 1: Datos de la promoción ────────────────────────────────────────────

function StepInfo({ form, set, branches, allBranches }) {
    return (
        <div className="space-y-4">
            <div>
                <label className={lbl}>Nombre de la promoción *</label>
                <input
                    className={inp}
                    value={form.nombre}
                    onChange={e => set('nombre', e.target.value)}
                    placeholder="Ej: Tramafen Sachets 1+1 — Junio 2026"
                    autoFocus
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={lbl}>Fecha inicio</label>
                    <LiquidDatePicker
                        value={form.fecha_inicio}
                        onChange={v => set('fecha_inicio', v)}
                    />
                </div>
                <div>
                    <label className={lbl}>Fecha fin</label>
                    <LiquidDatePicker
                        value={form.fecha_fin}
                        onChange={v => set('fecha_fin', v)}
                        highlightRangeStart={form.fecha_inicio || null}
                    />
                </div>
            </div>

            <div>
                <label className={lbl}>Condición de cierre</label>
                <LiquidSelect
                    value={form.end_condition}
                    onChange={v => set('end_condition', v)}
                    options={END_COND_OPTIONS}
                />
            </div>

            <div>
                <label className={lbl}>Sucursales participantes</label>
                <div className="flex gap-2 flex-wrap mt-1">
                    <button
                        type="button"
                        onClick={() => set('branch_ids', form.branch_ids.length === branches.length
                            ? [] : branches.map(b => b.id))}
                        className={`px-3 py-1.5 text-[11px] font-bold rounded-full border transition-all ${
                            form.branch_ids.length === branches.length
                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-600 text-white shadow-sm shadow-blue-200'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                        }`}
                    >
                        Todas
                    </button>
                    {branches.map(b => {
                        const active = form.branch_ids.includes(b.id);
                        return (
                            <button
                                key={b.id}
                                type="button"
                                onClick={() => set('branch_ids', active
                                    ? form.branch_ids.filter(id => id !== b.id)
                                    : [...form.branch_ids, b.id])}
                                className={`px-3 py-1.5 text-[11px] rounded-full border transition-all ${
                                    active
                                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-600 text-white font-bold shadow-sm shadow-blue-200'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                                }`}
                            >
                                {b.name}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div>
                <label className={lbl}>Notas internas</label>
                <textarea
                    className={`${inp} h-16 resize-none`}
                    value={form.notas}
                    onChange={e => set('notas', e.target.value)}
                    placeholder="Contexto adicional, condiciones del laboratorio, etc."
                />
            </div>
        </div>
    );
}

// ── Step 2: Productos y bonificaciones ───────────────────────────────────────

function ProductRow({ pp, onRemove }) {
    return (
        <div className="bg-white border border-slate-100 rounded-xl p-3 flex gap-3 items-start shadow-sm">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {pp.foto_url
                    ? <img src={pp.foto_url} className="w-full h-full object-cover" alt="" />
                    : <Package size={13} className="text-slate-300" />}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-slate-700 leading-tight truncate">{pp.nombre}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                    {pp.laboratorio && <span className="text-[10px] text-slate-400">{pp.laboratorio}</span>}
                    {pp.presentacion_tipo && (
                        <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md">{pp.presentacion_tipo}</span>
                    )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {pp.factor_descripcion && (
                        <span className="text-[10px] text-violet-600 font-medium">Factor: {pp.factor_descripcion}</span>
                    )}
                    {pp.stock_inicial && (
                        <span className="text-[10px] text-slate-500">Stock: {pp.stock_inicial} und</span>
                    )}
                    {pp.precio_promo && (
                        <span className="text-[10px] text-slate-500">Precio promo: ${parseFloat(pp.precio_promo).toFixed(2)}</span>
                    )}
                </div>
                {/* Bonos */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    {parseFloat(pp.bono_vendedor) > 0 && (
                        <span className="text-[10px] text-emerald-600">Vendedor: ${parseFloat(pp.bono_vendedor).toFixed(2)}/trigger</span>
                    )}
                    {parseFloat(pp.bono_admin_pool) > 0 && (
                        <span className="text-[10px] text-blue-600">Admin pool: ${parseFloat(pp.bono_admin_pool).toFixed(2)}/trigger</span>
                    )}
                    {parseFloat(pp.bono_bodega_pool) > 0 && (
                        <span className="text-[10px] text-amber-600">Bodega pool: ${parseFloat(pp.bono_bodega_pool).toFixed(2)}/trigger</span>
                    )}
                </div>
            </div>
            <button
                type="button"
                onClick={onRemove}
                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"
            >
                <Trash2 size={13} />
            </button>
        </div>
    );
}

function AddProductInline({ onAdd }) {
    const [show,              setShow]              = useState(false);
    const [pid,               setPid]               = useState(null);
    const [selectedProd,      setSelectedProd]      = useState(null);
    const [searchResults,     setSearchResults]     = useState([]);
    const [isSearching,       setIsSearching]       = useState(false);
    const [presentOptions,    setPresentOptions]    = useState([]);
    const [presentacionId,    setPresentacionId]    = useState(null);
    const [loadingPresent,    setLoadingPresent]    = useState(false);
    const [f, setF] = useState({
        factor_descripcion: '', factor_denominador: 1,
        stock_inicial: '', precio_promo: '',
        bono_vendedor: '', bono_admin_pool: '', bono_bodega_pool: '',
    });

    const handleSearch = useCallback(async (q) => {
        if (!q || q.trim().length < 2) { setSearchResults([]); return; }
        setIsSearching(true);
        const { data } = await supabase
            .from('products')
            .select('id, nombre, foto_url, laboratorios(nombre)')
            .eq('activo', true)
            .ilike('nombre', `%${q.trim()}%`)
            .order('nombre')
            .limit(50);
        setSearchResults((data || []).map(p => ({
            value:       String(p.id),
            label:       p.nombre,
            foto_url:    p.foto_url    || null,
            laboratorio: p.laboratorios?.nombre || null,
        })));
        setIsSearching(false);
    }, []);

    const handleSelect = async (val) => {
        setPid(val);
        setSelectedProd(searchResults.find(o => o.value === val) || null);
        setPresentacionId(null);
        setPresentOptions([]);
        if (!val) return;
        setLoadingPresent(true);
        const { data } = await supabase
            .from('product_precios')
            .select('id_presentacion, presentaciones(id, tipo, descripcion)')
            .eq('product_id', parseInt(val));
        const unique = [];
        const seen = new Set();
        for (const row of (data || [])) {
            const p = row.presentaciones;
            if (!p) continue;
            const dedupeKey = `${p.tipo}||${(p.descripcion || '').toUpperCase().replace(/\s/g, '')}`;
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            const factor = (p.descripcion || '').toUpperCase().replace(/\s/g, '');
            const label  = factor && factor !== '1X1' && factor !== '1X01'
                ? `${p.tipo} · ${factor}`
                : p.tipo;
            unique.push({ value: String(p.id), label, tipo: p.tipo, descripcion: p.descripcion });
        }
        setPresentOptions(unique);
        if (unique.length === 1) setPresentacionId(unique[0].value);
        setLoadingPresent(false);
    };

    if (!show) {
        return (
            <button
                type="button"
                onClick={() => setShow(true)}
                className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-blue-200/60 rounded-2xl text-[11px] font-semibold text-blue-400 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
            >
                <Plus size={12} /> Agregar producto a la promoción
            </button>
        );
    }

    const g = (k) => f[k];
    const s = (k, v) => setF(prev => ({ ...prev, [k]: v }));

    const handleAdd = () => {
        if (!pid || !selectedProd) return;
        if (presentOptions.length > 0 && !presentacionId) return;
        const presentLabel = presentOptions.find(o => o.value === presentacionId)?.label || null;
        onAdd({
            product_id:         parseInt(pid),
            presentacion_id:    presentacionId ? parseInt(presentacionId) : null,
            presentacion_tipo:  presentLabel,
            nombre:             selectedProd.label,
            foto_url:           selectedProd.foto_url || null,
            laboratorio:        selectedProd.laboratorio || null,
            factor_descripcion: f.factor_descripcion || null,
            factor_denominador: parseInt(f.factor_denominador) || 1,
            stock_inicial:      f.stock_inicial !== '' ? parseInt(f.stock_inicial) : null,
            precio_promo:       f.precio_promo !== '' ? parseFloat(f.precio_promo) : null,
            bono_vendedor:      parseFloat(f.bono_vendedor)    || 0,
            bono_admin_pool:    parseFloat(f.bono_admin_pool)  || 0,
            bono_bodega_pool:   parseFloat(f.bono_bodega_pool) || 0,
        });
        setPid(null);
        setSelectedProd(null);
        setSearchResults([]);
        setPresentOptions([]);
        setPresentacionId(null);
        setF({ factor_descripcion: '', factor_denominador: 1, stock_inicial: '', precio_promo: '', bono_vendedor: '', bono_admin_pool: '', bono_bodega_pool: '' });
        setShow(false);
    };

    const numInp = `${inp} text-center`;

    return (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50/60 border border-blue-100 rounded-2xl p-4 space-y-3.5 shadow-sm">
            <div>
                <label className={lbl}>Producto *</label>
                <LiquidSelect
                    value={pid}
                    onChange={handleSelect}
                    options={searchResults}
                    placeholder="Escribe para buscar producto..."
                    serverSearch
                    onSearchChange={handleSearch}
                    isLoading={isSearching}
                />
            </div>

            {pid && presentOptions.length > 0 && (
                <div>
                    <label className={lbl}>Presentación *</label>
                    {loadingPresent ? (
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 py-2">
                            <Loader2 size={12} className="animate-spin" /> Cargando presentaciones...
                        </div>
                    ) : (
                        <div className="flex gap-2 flex-wrap">
                            {presentOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setPresentacionId(opt.value)}
                                    className={`px-3 py-1.5 text-[11px] rounded-full border transition-all ${
                                        presentacionId === opt.value
                                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 border-blue-600 text-white font-bold shadow-sm shadow-blue-200'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-600'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {pid && (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className={lbl}>Factor (ej: "1+1")</label>
                            <input className={inp} placeholder="1+1, 2+1…" value={g('factor_descripcion')} onChange={e => s('factor_descripcion', e.target.value)} />
                        </div>
                        <div>
                            <label className={lbl}>Und por trigger</label>
                            <input className={numInp} type="number" min="1" value={g('factor_denominador')} onChange={e => s('factor_denominador', e.target.value)} />
                        </div>
                        <div>
                            <label className={lbl}>Stock inicial (und)</label>
                            <input className={numInp} type="number" min="0" placeholder="—" value={g('stock_inicial')} onChange={e => s('stock_inicial', e.target.value)} />
                        </div>
                        <div>
                            <label className={lbl}>Precio promo ($)</label>
                            <input className={numInp} type="number" step="0.01" min="0" placeholder="—" value={g('precio_promo')} onChange={e => s('precio_promo', e.target.value)} />
                        </div>
                    </div>

                    <div className="bg-gradient-to-br from-emerald-50 to-teal-50/60 border border-emerald-100 rounded-xl p-3 space-y-2.5">
                        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1.5">
                            <Gift size={10} /> Bonificaciones por trigger
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-1.5 block">Vendedor ($)</label>
                                <input className={numInp} type="number" step="0.01" min="0" placeholder="0.00" value={g('bono_vendedor')} onChange={e => s('bono_vendedor', e.target.value)} />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-blue-600 uppercase tracking-widest mb-1.5 block">Admin pool ($)</label>
                                <input className={numInp} type="number" step="0.01" min="0" placeholder="0.00" value={g('bono_admin_pool')} onChange={e => s('bono_admin_pool', e.target.value)} />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-amber-600 uppercase tracking-widest mb-1.5 block">Bodega pool ($)</label>
                                <input className={numInp} type="number" step="0.01" min="0" placeholder="0.00" value={g('bono_bodega_pool')} onChange={e => s('bono_bodega_pool', e.target.value)} />
                            </div>
                        </div>
                        <p className="text-[9px] text-emerald-600/60 font-medium">
                            Pool = repartido entre todos del área. Vendedor = quien hizo la venta.
                        </p>
                    </div>
                </>
            )}

            <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShow(false)} className="px-3 py-1.5 text-[11px] text-slate-400 hover:text-slate-600">Cancelar</button>
                <button
                    type="button"
                    onClick={handleAdd}
                    disabled={!pid}
                    className="px-4 py-1.5 text-[11px] font-bold bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 disabled:opacity-40 transition-all shadow-sm shadow-blue-200 flex items-center gap-1.5"
                >
                    <Plus size={10} /> Agregar
                </button>
            </div>
        </div>
    );
}

function StepProducts({ products, onAdd, onRemove }) {
    return (
        <div className="space-y-3">
            {products.length === 0 && (
                <p className="text-[11px] text-slate-400 italic text-center py-2">Aún no hay productos. Agrega al menos uno.</p>
            )}
            {products.map((pp, idx) => (
                <ProductRow key={idx} pp={pp} onRemove={() => onRemove(idx)} />
            ))}
            <AddProductInline onAdd={onAdd} />
        </div>
    );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

const STEPS = [
    { key: 'info',      label: 'Datos',      icon: Tag      },
    { key: 'productos', label: 'Productos',  icon: Package  },
];

export default function PromoModal({ isOpen, onClose, onCreated }) {
    const { user }      = useAuth();
    const { showToast } = useToastStore();
    const [step,   setStep]   = useState(0);
    const [saving, setSaving] = useState(false);
    const [branches, setBranches] = useState([]);

    const [form, setForm] = useState({
        nombre:        '',
        fecha_inicio:  '',
        fecha_fin:     '',
        end_condition: 'date',
        notas:         '',
        branch_ids:    [],
    });
    const [products, setProducts] = useState([]);

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    useEffect(() => {
        if (!isOpen) return;
        // Sales branches only (no Bodega, no Administracion)
        supabase.from('branches').select('id, name')
            .in('id', SALES_BRANCH_IDS)
            .order('name')
            .then(({ data }) => {
                const b = data || [];
                setBranches(b);
                setForm(f => ({ ...f, branch_ids: b.map(br => br.id) }));
            });
    }, [isOpen]);

    const reset = () => {
        setStep(0);
        setProducts([]);
        setForm({ nombre: '', fecha_inicio: '', fecha_fin: '', end_condition: 'date', notas: '', branch_ids: [] });
    };

    const handleClose = () => { reset(); onClose(); };

    const handleCreate = async () => {
        if (!form.nombre.trim()) return showToast('Error', 'El nombre es requerido', 'error');
        if (products.length === 0) return showToast('Error', 'Agrega al menos un producto', 'error');

        setSaving(true);
        try {
            const { data: promo, error: promoErr } = await supabase
                .from('promotions')
                .insert({
                    nombre:        form.nombre.trim(),
                    estado:        'draft',
                    fecha_inicio:  form.fecha_inicio || null,
                    fecha_fin:     form.fecha_fin    || null,
                    end_condition: form.end_condition,
                    notas:         form.notas        || null,
                    created_by:    user?.id          || null,
                })
                .select()
                .single();
            if (promoErr) throw promoErr;

            // Branches
            if (form.branch_ids.length > 0) {
                await supabase.from('promotion_branches').insert(
                    form.branch_ids.map(bid => ({ promotion_id: promo.id, branch_id: bid }))
                );
            }

            // Products
            if (products.length > 0) {
                await supabase.from('promotion_products').insert(
                    products.map(pp => ({
                        promotion_id:       promo.id,
                        product_id:         pp.product_id,
                        presentacion_id:    pp.presentacion_id || null,
                        factor_descripcion: pp.factor_descripcion,
                        factor_denominador: pp.factor_denominador,
                        stock_inicial:      pp.stock_inicial,
                        precio_promo:       pp.precio_promo,
                        bono_vendedor:      pp.bono_vendedor,
                        bono_admin_pool:    pp.bono_admin_pool,
                        bono_bodega_pool:   pp.bono_bodega_pool,
                    }))
                );
            }

            showToast('Promoción creada', form.nombre.trim(), 'success');
            onCreated(promo.id);
            handleClose();
        } catch (err) {
            showToast('Error', err.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-md">
            <div className="relative w-full max-w-xl flex flex-col rounded-[2rem] overflow-hidden shadow-[0_50px_120px_rgba(0,0,0,0.35),0_20px_40px_rgba(15,23,42,0.2)] animate-in fade-in zoom-in-[0.98] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] max-h-[90vh] bg-white">

                {/* Header — gradient */}
                <div className="flex-none bg-gradient-to-br from-blue-700 via-blue-600 to-violet-600 px-7 pt-7 pb-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3.5">
                            <div className="w-11 h-11 flex items-center justify-center rounded-2xl bg-white/15 border border-white/20 text-white shadow-inner">
                                <Tag size={20} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h3 className="font-black text-white text-[19px] tracking-tight leading-none mb-0.5">
                                    Nueva Promoción
                                </h3>
                                <p className="text-[10px] font-semibold text-blue-200 uppercase tracking-[0.18em]">
                                    {step === 0 ? 'Datos generales' : 'Productos y bonificaciones'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white/70 hover:text-white transition-all"
                        >
                            <X size={16} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Step indicator — white on gradient */}
                    <div className="flex items-center gap-3">
                        {STEPS.map((s, idx) => {
                            const isActive = idx === step;
                            const isDone   = idx < step;
                            const StepIcon = s.icon;
                            return (
                                <React.Fragment key={s.key}>
                                    {idx > 0 && (
                                        <div className={`flex-1 h-[2px] rounded-full transition-all duration-400 ${isDone ? 'bg-white/60' : 'bg-white/20'}`} />
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => idx < step && setStep(idx)}
                                        className="flex items-center gap-2 shrink-0"
                                    >
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-all duration-300 ${
                                            isActive ? 'bg-white border-white text-blue-600 scale-110 shadow-lg shadow-blue-900/30'
                                            : isDone  ? 'bg-emerald-400 border-emerald-300 text-white'
                                            : 'bg-white/10 border-white/25 text-white/50'
                                        }`}>
                                            {isDone ? <Check size={13} /> : <StepIcon size={12} />}
                                        </div>
                                        <span className={`text-[11px] font-bold transition-colors ${isActive ? 'text-white' : isDone ? 'text-white/70' : 'text-white/40'}`}>
                                            {s.label}
                                        </span>
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Body — solid white. Both steps stay mounted to preserve date picker + in-progress form state */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-7 py-6 scrollbar-hide bg-white">
                    <div className={step !== 0 ? 'hidden' : ''}>
                        <StepInfo form={form} set={set} branches={branches} />
                    </div>
                    <div className={step !== 1 ? 'hidden' : ''}>
                        <StepProducts
                            products={products}
                            onAdd={pp => setProducts(prev => [...prev, pp])}
                            onRemove={idx => setProducts(prev => prev.filter((_, i) => i !== idx))}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex-none px-7 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/80">
                    <button
                        type="button"
                        onClick={step === 0 ? handleClose : () => setStep(s => s - 1)}
                        className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        {step > 0 && <ChevronLeft size={13} />}
                        {step === 0 ? 'Cancelar' : 'Atrás'}
                    </button>

                    {step === 0 ? (
                        <button
                            type="button"
                            onClick={() => {
                                if (!form.nombre.trim()) return showToast('Error', 'El nombre es requerido', 'error');
                                setStep(1);
                            }}
                            className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-bold bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all shadow-sm shadow-blue-200"
                        >
                            Siguiente <ChevronRight size={13} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleCreate}
                            disabled={saving || products.length === 0}
                            className="flex items-center gap-1.5 px-5 py-2 text-[12px] font-bold bg-gradient-to-r from-emerald-600 to-emerald-700 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-800 disabled:opacity-40 transition-all shadow-sm shadow-emerald-200"
                        >
                            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            Crear Promoción
                        </button>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
