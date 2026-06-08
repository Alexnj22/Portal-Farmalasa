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

const inp = 'w-full text-[12px] bg-white/60 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-400 placeholder:text-slate-300';
const lbl = 'text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1 block';

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
                        className={`px-3 py-1.5 text-[11px] font-semibold rounded-full border transition-all ${
                            form.branch_ids.length === branches.length
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'
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
                                        ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'
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
        <div className="bg-white/70 border border-slate-100 rounded-xl p-3 flex gap-3 items-start">
            <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden">
                {pp.foto_url
                    ? <img src={pp.foto_url} className="w-full h-full object-cover" alt="" />
                    : <Package size={13} className="text-slate-300" />}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-slate-700 leading-tight truncate">{pp.nombre}</p>
                {pp.laboratorio && <p className="text-[10px] text-slate-400">{pp.laboratorio}</p>}
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

function AddProductInline({ productOptions, onAdd }) {
    const [show, setShow] = useState(false);
    const [pid, setPid] = useState(null);
    const [f, setF] = useState({
        factor_descripcion: '', factor_denominador: 1,
        stock_inicial: '', precio_promo: '',
        bono_vendedor: '', bono_admin_pool: '', bono_bodega_pool: '',
    });

    if (!show) {
        return (
            <button
                type="button"
                onClick={() => setShow(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-slate-200 rounded-xl text-[11px] text-slate-400 hover:border-blue-300 hover:text-blue-500 transition-all"
            >
                <Plus size={12} /> Agregar producto a la promoción
            </button>
        );
    }

    const selected = productOptions.find(o => o.value === pid);
    const g = (k) => f[k];
    const s = (k, v) => setF(prev => ({ ...prev, [k]: v }));

    const handleAdd = () => {
        if (!pid || !selected) return;
        onAdd({
            product_id: parseInt(pid),
            nombre:             selected.label,
            foto_url:           selected.foto_url || null,
            laboratorio:        selected.laboratorio || null,
            factor_descripcion: f.factor_descripcion || null,
            factor_denominador: parseInt(f.factor_denominador) || 1,
            stock_inicial:      f.stock_inicial !== '' ? parseInt(f.stock_inicial) : null,
            precio_promo:       f.precio_promo !== '' ? parseFloat(f.precio_promo) : null,
            bono_vendedor:      parseFloat(f.bono_vendedor)    || 0,
            bono_admin_pool:    parseFloat(f.bono_admin_pool)  || 0,
            bono_bodega_pool:   parseFloat(f.bono_bodega_pool) || 0,
        });
        setPid(null);
        setF({ factor_descripcion: '', factor_denominador: 1, stock_inicial: '', precio_promo: '', bono_vendedor: '', bono_admin_pool: '', bono_bodega_pool: '' });
        setShow(false);
    };

    const numInp = `${inp} text-center`;

    return (
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 space-y-3">
            <div>
                <label className={lbl}>Producto *</label>
                <LiquidSelect value={pid} onChange={setPid} options={productOptions} placeholder="Buscar producto..." />
            </div>

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

                    <div className="border-t border-blue-100 pt-3">
                        <p className="text-[10px] font-semibold text-blue-600 uppercase tracking-wide mb-2 flex items-center gap-1">
                            <Gift size={10} /> Bonificaciones por trigger
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <label className={`${lbl} text-emerald-600`}>Vendedor ($)</label>
                                <input className={numInp} type="number" step="0.01" min="0" placeholder="0.00" value={g('bono_vendedor')} onChange={e => s('bono_vendedor', e.target.value)} />
                            </div>
                            <div>
                                <label className={`${lbl} text-blue-600`}>Admin pool ($)</label>
                                <input className={numInp} type="number" step="0.01" min="0" placeholder="0.00" value={g('bono_admin_pool')} onChange={e => s('bono_admin_pool', e.target.value)} />
                            </div>
                            <div>
                                <label className={`${lbl} text-amber-600`}>Bodega pool ($)</label>
                                <input className={numInp} type="number" step="0.01" min="0" placeholder="0.00" value={g('bono_bodega_pool')} onChange={e => s('bono_bodega_pool', e.target.value)} />
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1">
                            "Pool" = monto repartido entre todos los del área activos en la promo. "Vendedor" = por persona que hizo la venta.
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
                    className="px-4 py-1.5 text-[11px] font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
                >
                    <Plus size={10} /> Agregar
                </button>
            </div>
        </div>
    );
}

function StepProducts({ products, onAdd, onRemove, productOptions }) {
    return (
        <div className="space-y-3">
            {products.length === 0 && (
                <p className="text-[11px] text-slate-400 italic text-center py-2">Aún no hay productos. Agrega al menos uno.</p>
            )}
            {products.map((pp, idx) => (
                <ProductRow key={idx} pp={pp} onRemove={() => onRemove(idx)} />
            ))}
            <AddProductInline productOptions={productOptions} onAdd={onAdd} />
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
    const [branches,       setBranches]       = useState([]);
    const [productOptions, setProductOptions] = useState([]);

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
                // Default: all selected
                setForm(f => ({ ...f, branch_ids: b.map(br => br.id) }));
            });

        supabase.from('products')
            .select('id, nombre, foto_url, laboratorio_id, laboratorios(nombre)')
            .eq('activo', true)
            .order('nombre')
            .limit(3000)
            .then(({ data }) => {
                setProductOptions((data || []).map(p => ({
                    value:       String(p.id),
                    label:       p.nombre,
                    foto_url:    p.foto_url || null,
                    laboratorio: p.laboratorios?.nombre || null,
                })));
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
            <div className="relative w-full max-w-xl flex flex-col rounded-[2.5rem] overflow-hidden border border-white/90 shadow-[0_40px_100px_rgba(0,0,0,0.25),inset_0_2px_15px_rgba(255,255,255,0.8)] animate-in fade-in zoom-in-[0.98] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] max-h-[90vh]">
                {/* Glass bg */}
                <div className="absolute inset-0 bg-white/50 backdrop-blur-[15px] backdrop-saturate-[300%] -z-10 pointer-events-none" />

                {/* Header */}
                <div className="flex-none px-8 py-6 border-b border-white/40 flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 flex items-center justify-center rounded-[1.25rem] border border-white/80 shadow-sm bg-white/70 backdrop-blur-md text-blue-600">
                                <Tag size={22} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h3 className="font-black text-slate-800 uppercase tracking-tighter text-lg leading-none mb-1">
                                    Nueva Promoción
                                </h3>
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em]">
                                    {step === 0 ? 'DATOS GENERALES' : 'PRODUCTOS Y BONIFICACIONES'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleClose}
                            className="w-10 h-10 flex items-center justify-center rounded-full bg-white/60 border border-white/90 text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all shadow-sm"
                        >
                            <X size={18} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Step indicator */}
                    <div className="flex items-center justify-center gap-2">
                        {STEPS.map((s, idx) => {
                            const isActive  = idx === step;
                            const isDone    = idx < step;
                            const StepIcon  = s.icon;
                            return (
                                <React.Fragment key={s.key}>
                                    {idx > 0 && (
                                        <div className={`h-[2px] w-12 rounded-full transition-all duration-400 ${isDone ? 'bg-blue-400' : 'bg-slate-200'}`} />
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => idx < step && setStep(idx)}
                                        className="flex flex-col items-center gap-1 group"
                                    >
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 border-2 shadow-sm ${
                                            isActive ? 'bg-blue-600 border-blue-600 text-white scale-110 shadow-blue-200'
                                            : isDone  ? 'bg-emerald-500 border-emerald-400 text-white'
                                            : 'bg-white border-slate-200 text-slate-400'
                                        }`}>
                                            {isDone ? <Check size={14} /> : <StepIcon size={13} />}
                                        </div>
                                        <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${isActive ? 'text-blue-600' : isDone ? 'text-emerald-600' : 'text-slate-400'}`}>
                                            {s.label}
                                        </span>
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto overscroll-contain px-8 py-6 scrollbar-hide">
                    {step === 0 && (
                        <StepInfo form={form} set={set} branches={branches} />
                    )}
                    {step === 1 && (
                        <StepProducts
                            products={products}
                            onAdd={pp => setProducts(prev => [...prev, pp])}
                            onRemove={idx => setProducts(prev => prev.filter((_, i) => i !== idx))}
                            productOptions={productOptions}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="flex-none px-8 py-5 border-t border-white/40 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={step === 0 ? handleClose : () => setStep(s => s - 1)}
                        className="flex items-center gap-1.5 px-4 py-2 text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
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
                            className="flex items-center gap-1.5 px-5 py-2 text-[11px] font-bold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                        >
                            Siguiente <ChevronRight size={13} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleCreate}
                            disabled={saving || products.length === 0}
                            className="flex items-center gap-1.5 px-5 py-2 text-[11px] font-bold bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-sm"
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
