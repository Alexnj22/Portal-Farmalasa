import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    Tag, Plus, ChevronDown, ChevronRight, Loader2, Package,
    Calendar, Building2, X, Check, Play, Pause, Lock,
    AlertTriangle, Trash2, Edit3, FlaskConical, DollarSign,
    ShoppingBag, Boxes,
} from 'lucide-react';
import { supabase }    from '../../supabaseClient';
import { useAuth }     from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import LiquidSelect    from '../../components/common/LiquidSelect';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (n) =>
    `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) => {
    if (!d) return '—';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
};

const ESTADO_STYLE = {
    draft:   { bg: 'bg-slate-100 text-slate-600 border-slate-200',    label: 'Borrador' },
    active:  { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Activa'   },
    paused:  { bg: 'bg-amber-50 text-amber-700 border-amber-200',      label: 'Pausada'  },
    closed:  { bg: 'bg-slate-50 text-slate-500 border-slate-200',      label: 'Cerrada'  },
};

const END_COND_OPTIONS = [
    { value: 'date',  label: 'Por fecha' },
    { value: 'stock', label: 'Por agotamiento de stock' },
    { value: 'both',  label: 'Por fecha o stock (lo que ocurra primero)' },
];

// ── Column definitions ────────────────────────────────────────────────────────

const COLS = [
    { key: 'expand',    label: '',            align: 'center', w: 'w-8'    },
    { key: 'nombre',    label: 'Promoción',   align: 'left'               },
    { key: 'estado',    label: 'Estado',      align: 'center', w: 'w-28'  },
    { key: 'fechas',    label: 'Período',     align: 'center', w: 'w-36', hideBelow: 'md' },
    { key: 'productos', label: 'Productos',   align: 'center', w: 'w-24', hideBelow: 'sm' },
    { key: 'vendido',   label: 'Vendido',     align: 'center', w: 'w-28', hideBelow: 'lg' },
    { key: 'acciones',  label: '',            align: 'center', w: 'w-24'  },
];

// ── PromoProductRow — row inside the expanded detail ─────────────────────────

function PromoProductRow({ pp, onDelete, canEdit }) {
    const unitsSold = (pp.promotion_sales_cache || []).reduce((s, r) => s + (r.units_sold || 0), 0);
    const pct = pp.stock_inicial && pp.stock_inicial > 0
        ? Math.min(100, Math.round((unitsSold / pp.stock_inicial) * 100))
        : null;

    return (
        <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
            {/* Product foto */}
            <div className="w-8 h-8 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0 overflow-hidden mt-0.5">
                {pp.products?.foto_url
                    ? <img src={pp.products.foto_url} className="w-full h-full object-cover" alt="" />
                    : <Package size={13} className="text-slate-300" />}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="text-[12px] font-semibold text-slate-700 leading-tight truncate">
                    {pp.products?.nombre || `Producto #${pp.product_id}`}
                </p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {pp.factor_descripcion && (
                        <span className="text-[10px] text-violet-600 font-medium">
                            Factor: {pp.factor_descripcion}
                        </span>
                    )}
                    {pp.precio_promo != null && (
                        <span className="text-[10px] text-slate-500">Precio promo: {fmt$(pp.precio_promo)}</span>
                    )}
                    {pp.stock_inicial != null && (
                        <span className="text-[10px] text-slate-500">Stock: {unitsSold}/{pp.stock_inicial} und</span>
                    )}
                </div>
                {/* Bonos */}
                <div className="flex gap-x-3 mt-1 flex-wrap">
                    {pp.bono_vendedor > 0 && (
                        <span className="text-[10px] text-emerald-600">Vendedor: {fmt$(pp.bono_vendedor)}/trigger</span>
                    )}
                    {pp.bono_admin_pool > 0 && (
                        <span className="text-[10px] text-blue-600">Admin pool: {fmt$(pp.bono_admin_pool)}/trigger</span>
                    )}
                    {pp.bono_bodega_pool > 0 && (
                        <span className="text-[10px] text-amber-600">Bodega pool: {fmt$(pp.bono_bodega_pool)}/trigger</span>
                    )}
                </div>
                {/* Progress bar */}
                {pct !== null && (
                    <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-400' : 'bg-blue-400'}`}
                                style={{ width: `${pct}%` }}
                            />
                        </div>
                        <span className="text-[9px] text-slate-400 w-7 text-right">{pct}%</span>
                    </div>
                )}
            </div>

            {canEdit && (
                <button
                    onClick={() => onDelete(pp.id)}
                    className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-400 transition-colors flex-shrink-0 mt-0.5"
                >
                    <Trash2 size={12} />
                </button>
            )}
        </div>
    );
}

// ── AddProductForm — inline form to add a product to a promo ─────────────────

function AddProductForm({ promotionId, onAdded, onCancel, productOptions }) {
    const { showToast } = useToastStore();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        product_id: null,
        factor_descripcion: '',
        factor_denominador: 1,
        precio_promo: '',
        stock_inicial: '',
        bono_vendedor: '',
        bono_admin_pool: '',
        bono_bodega_pool: '',
    });

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleSave = async () => {
        if (!form.product_id) return showToast('Error', 'Selecciona un producto', 'error');
        setSaving(true);
        const row = {
            promotion_id:       promotionId,
            product_id:         parseInt(form.product_id),
            factor_descripcion: form.factor_descripcion || null,
            factor_denominador: parseInt(form.factor_denominador) || 1,
            precio_promo:       form.precio_promo !== '' ? parseFloat(form.precio_promo) : null,
            stock_inicial:      form.stock_inicial !== '' ? parseInt(form.stock_inicial) : null,
            bono_vendedor:      parseFloat(form.bono_vendedor)    || 0,
            bono_admin_pool:    parseFloat(form.bono_admin_pool)  || 0,
            bono_bodega_pool:   parseFloat(form.bono_bodega_pool) || 0,
        };
        const { error } = await supabase.from('promotion_products').insert(row);
        setSaving(false);
        if (error) return showToast('Error', error.message, 'error');
        showToast('Producto agregado', '', 'success');
        onAdded();
    };

    const inp = 'w-full text-[11px] bg-white/80 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400';
    const lbl = 'text-[10px] font-medium text-slate-500 mb-0.5 block';

    return (
        <div className="bg-blue-50/60 border border-blue-100 rounded-xl p-3 mt-2">
            <p className="text-[11px] font-semibold text-blue-700 mb-2.5">Agregar producto a la promoción</p>
            <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="col-span-2">
                    <label className={lbl}>Producto *</label>
                    <LiquidSelect
                        value={form.product_id}
                        onChange={v => set('product_id', v)}
                        options={productOptions}
                        placeholder="Buscar producto..."
                        compact
                    />
                </div>
                <div>
                    <label className={lbl}>Factor (ej: "1+1")</label>
                    <input className={inp} value={form.factor_descripcion} onChange={e => set('factor_descripcion', e.target.value)} placeholder="1+1, 2+1..." />
                </div>
                <div>
                    <label className={lbl}>Denominador (und/trigger)</label>
                    <input className={inp} type="number" min="1" value={form.factor_denominador} onChange={e => set('factor_denominador', e.target.value)} />
                </div>
                <div>
                    <label className={lbl}>Precio promo ($)</label>
                    <input className={inp} type="number" step="0.01" value={form.precio_promo} onChange={e => set('precio_promo', e.target.value)} placeholder="Opcional" />
                </div>
                <div>
                    <label className={lbl}>Stock inicial (und)</label>
                    <input className={inp} type="number" min="0" value={form.stock_inicial} onChange={e => set('stock_inicial', e.target.value)} placeholder="Opcional" />
                </div>
                <div>
                    <label className={lbl}>Bono vendedor ($/trigger)</label>
                    <input className={inp} type="number" step="0.01" min="0" value={form.bono_vendedor} onChange={e => set('bono_vendedor', e.target.value)} placeholder="0.00" />
                </div>
                <div>
                    <label className={lbl}>Bono admin pool ($/trigger)</label>
                    <input className={inp} type="number" step="0.01" min="0" value={form.bono_admin_pool} onChange={e => set('bono_admin_pool', e.target.value)} placeholder="0.00" />
                </div>
                <div>
                    <label className={lbl}>Bono bodega pool ($/trigger)</label>
                    <input className={inp} type="number" step="0.01" min="0" value={form.bono_bodega_pool} onChange={e => set('bono_bodega_pool', e.target.value)} placeholder="0.00" />
                </div>
            </div>
            <div className="flex gap-2 justify-end">
                <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-slate-500 hover:text-slate-700 transition-colors">Cancelar</button>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 text-[11px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                    {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                    Guardar
                </button>
            </div>
        </div>
    );
}

// ── ExpandedPromoRow ──────────────────────────────────────────────────────────

function ExpandedPromoRow({ promo, onRefresh, canEdit, productOptions }) {
    const { showToast } = useToastStore();
    const [showAddProduct, setShowAddProduct] = useState(false);

    const totalSold = (promo.promotion_products || []).reduce((s, pp) => {
        const ppSold = (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0);
        return s + ppSold;
    }, 0);

    const branches = (promo.promotion_branches || []).map(pb => pb.branches?.name).filter(Boolean);

    const handleDeleteProduct = async (ppId) => {
        const { error } = await supabase.from('promotion_products').delete().eq('id', ppId);
        if (error) return showToast('Error', error.message, 'error');
        onRefresh();
    };

    return (
        <div className="px-4 pb-3 pt-1">
            {/* Meta info */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
                {promo.laboratorios?.nombre && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <FlaskConical size={9} /> {promo.laboratorios.nombre}
                    </span>
                )}
                {branches.length > 0 && (
                    <span className="flex items-center gap-1 text-[10px] text-slate-500">
                        <Building2 size={9} />
                        {branches.join(', ')}
                    </span>
                )}
                <span className="flex items-center gap-1 text-[10px] text-slate-500">
                    Condición de cierre: <strong className="text-slate-600">
                        {END_COND_OPTIONS.find(o => o.value === promo.end_condition)?.label || promo.end_condition}
                    </strong>
                </span>
                {promo.notas && (
                    <span className="text-[10px] text-slate-500 italic">"{promo.notas}"</span>
                )}
            </div>

            {/* Products */}
            <div className="bg-white/60 border border-slate-100 rounded-xl p-3 mb-2">
                <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                        Productos en promoción
                        {(promo.promotion_products || []).length > 0 && (
                            <span className="ml-1 text-slate-400">({promo.promotion_products.length})</span>
                        )}
                    </p>
                    {canEdit && !showAddProduct && (
                        <button
                            onClick={() => setShowAddProduct(true)}
                            className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 font-medium transition-colors"
                        >
                            <Plus size={10} /> Agregar producto
                        </button>
                    )}
                </div>

                {(promo.promotion_products || []).length === 0 && !showAddProduct && (
                    <p className="text-[11px] text-slate-300 italic text-center py-3">
                        Sin productos. Agrega el primero con el botón de arriba.
                    </p>
                )}

                {(promo.promotion_products || []).map(pp => (
                    <PromoProductRow
                        key={pp.id}
                        pp={pp}
                        onDelete={handleDeleteProduct}
                        canEdit={canEdit}
                    />
                ))}

                {showAddProduct && (
                    <AddProductForm
                        promotionId={promo.id}
                        productOptions={productOptions}
                        onAdded={() => { setShowAddProduct(false); onRefresh(); }}
                        onCancel={() => setShowAddProduct(false)}
                    />
                )}
            </div>

            {/* Totals summary */}
            {(promo.promotion_products || []).length > 0 && (
                <div className="flex gap-3 text-[10px] text-slate-400">
                    <span><span className="font-semibold text-slate-600">{totalSold}</span> und vendidas en total</span>
                </div>
            )}
        </div>
    );
}

// ── CreatePromoForm ───────────────────────────────────────────────────────────

function CreatePromoForm({ branches, labs, onCreated, onCancel }) {
    const { user }        = useAuth();
    const { showToast }   = useToastStore();
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        nombre:        '',
        laboratorio_id: null,
        estado:        'draft',
        fecha_inicio:  '',
        fecha_fin:     '',
        end_condition: 'date',
        notas:         '',
        branch_ids:    [],
    });
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const labOptions = labs.map(l => ({ value: String(l.id), label: l.nombre }));
    const branchOptions = branches.map(b => ({ value: String(b.id), label: b.name }));

    const handleSave = async () => {
        if (!form.nombre.trim()) return showToast('Error', 'Nombre es requerido', 'error');
        setSaving(true);
        const { data, error } = await supabase.from('promotions').insert({
            nombre:        form.nombre.trim(),
            laboratorio_id: form.laboratorio_id ? parseInt(form.laboratorio_id) : null,
            estado:        form.estado,
            fecha_inicio:  form.fecha_inicio || null,
            fecha_fin:     form.fecha_fin    || null,
            end_condition: form.end_condition,
            notas:         form.notas        || null,
            created_by:    user?.id          || null,
        }).select().single();
        if (error) { setSaving(false); return showToast('Error', error.message, 'error'); }

        if (form.branch_ids.length > 0) {
            const rows = form.branch_ids.map(bid => ({ promotion_id: data.id, branch_id: parseInt(bid) }));
            await supabase.from('promotion_branches').insert(rows);
        }
        setSaving(false);
        showToast('Promoción creada', form.nombre, 'success');
        onCreated(data.id);
    };

    const inp = 'w-full text-[11px] bg-white/80 border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400';
    const lbl = 'text-[10px] font-medium text-slate-500 mb-0.5 block';

    return (
        <div className="bg-white/80 border border-slate-200 rounded-2xl p-4 mb-3 shadow-sm">
            <p className="text-[12px] font-bold text-slate-700 mb-3 flex items-center gap-1.5">
                <Tag size={12} className="text-blue-500" /> Nueva promoción
            </p>
            <div className="grid grid-cols-2 gap-2.5 mb-3">
                <div className="col-span-2">
                    <label className={lbl}>Nombre *</label>
                    <input className={inp} value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Ej: Tramafen Sachets 1+1" />
                </div>
                <div>
                    <label className={lbl}>Laboratorio</label>
                    <LiquidSelect value={form.laboratorio_id} onChange={v => set('laboratorio_id', v)} options={labOptions} placeholder="Opcional" compact clearable />
                </div>
                <div>
                    <label className={lbl}>Estado inicial</label>
                    <LiquidSelect
                        value={form.estado}
                        onChange={v => set('estado', v)}
                        options={[
                            { value: 'draft',  label: 'Borrador' },
                            { value: 'active', label: 'Activa'   },
                        ]}
                        compact
                    />
                </div>
                <div>
                    <label className={lbl}>Fecha inicio</label>
                    <input className={inp} type="date" value={form.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)} />
                </div>
                <div>
                    <label className={lbl}>Fecha fin</label>
                    <input className={inp} type="date" value={form.fecha_fin} onChange={e => set('fecha_fin', e.target.value)} />
                </div>
                <div className="col-span-2">
                    <label className={lbl}>Condición de cierre</label>
                    <LiquidSelect value={form.end_condition} onChange={v => set('end_condition', v)} options={END_COND_OPTIONS} compact />
                </div>
                <div className="col-span-2">
                    <label className={lbl}>Sucursales participantes</label>
                    <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {branchOptions.map(b => {
                            const active = form.branch_ids.includes(b.value);
                            return (
                                <button
                                    key={b.value}
                                    onClick={() => set('branch_ids', active
                                        ? form.branch_ids.filter(id => id !== b.value)
                                        : [...form.branch_ids, b.value]
                                    )}
                                    className={`px-2.5 py-1 text-[10px] rounded-full border font-medium transition-all ${
                                        active
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300'
                                    }`}
                                >
                                    {b.label}
                                </button>
                            );
                        })}
                        {branchOptions.length === 0 && <span className="text-[10px] text-slate-400">Sin sucursales disponibles</span>}
                    </div>
                </div>
                <div className="col-span-2">
                    <label className={lbl}>Notas</label>
                    <textarea className={`${inp} h-14 resize-none`} value={form.notas} onChange={e => set('notas', e.target.value)} placeholder="Opcional..." />
                </div>
            </div>
            <div className="flex gap-2 justify-end">
                <button onClick={onCancel} className="px-3 py-1.5 text-[11px] text-slate-500 hover:text-slate-700 transition-colors">Cancelar</button>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-1.5 text-[11px] font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                    {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                    Crear
                </button>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TabPromos({ searchTerm, canEdit }) {
    const { showToast } = useToastStore();
    const [promos,      setPromos]      = useState([]);
    const [loading,     setLoading]     = useState(true);
    const [expanded,    setExpanded]    = useState(new Set());
    const [showCreate,  setShowCreate]  = useState(false);
    const [branches,    setBranches]    = useState([]);
    const [labs,        setLabs]        = useState([]);
    const [products,    setProducts]    = useState([]);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('promotions')
            .select(`
                id, nombre, estado, fecha_inicio, fecha_fin, end_condition, notas,
                laboratorio_id,
                laboratorios(nombre),
                promotion_branches(branch_id, branches(name)),
                promotion_products(
                    id, product_id, factor_descripcion, factor_denominador,
                    precio_promo, stock_inicial,
                    bono_vendedor, bono_admin_pool, bono_bodega_pool,
                    products(nombre, foto_url),
                    promotion_sales_cache(units_sold)
                )
            `)
            .in('estado', ['draft', 'active', 'paused'])
            .order('created_at', { ascending: false });

        if (error) showToast('Error cargando promociones', error.message, 'error');
        setPromos(data || []);
        setLoading(false);
    }, [showToast]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        supabase.from('branches').select('id, name').order('name')
            .then(({ data }) => setBranches(data || []));
        supabase.from('laboratorios').select('id, nombre').order('nombre')
            .then(({ data }) => setLabs(data || []));
        supabase.from('products').select('id, nombre').eq('activo', true).order('nombre').limit(2000)
            .then(({ data }) => setProducts(data || []));
    }, []);

    const productOptions = products.map(p => ({ value: String(p.id), label: p.nombre }));

    const toggleExpand = (id) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleStateChange = async (promo, newEstado) => {
        const { error } = await supabase.from('promotions')
            .update({ estado: newEstado })
            .eq('id', promo.id);
        if (error) return showToast('Error', error.message, 'error');
        const labels = { active: 'Activada', paused: 'Pausada', closed: 'Cerrada', draft: 'Borrador' };
        showToast(labels[newEstado] || 'Actualizada', promo.nombre, 'success');
        load();
    };

    const handleDelete = async (promo) => {
        if (!window.confirm(`¿Eliminar la promoción "${promo.nombre}"?`)) return;
        const { error } = await supabase.from('promotions').delete().eq('id', promo.id);
        if (error) return showToast('Error', error.message, 'error');
        showToast('Eliminada', promo.nombre, 'success');
        load();
    };

    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const filtered = searchTerm
        ? promos.filter(p =>
            norm(p.nombre).includes(norm(searchTerm)) ||
            norm(p.laboratorios?.nombre).includes(norm(searchTerm)) ||
            (p.promotion_products || []).some(pp => norm(pp.products?.nombre).includes(norm(searchTerm)))
          )
        : promos;

    // Filter pill style
    const pillCls = 'flex items-center gap-2 bg-white/80 border border-slate-200/70 rounded-2xl px-3 py-2 shadow-sm';

    return (
        <div>
            {/* Top bar */}
            <div className="flex items-center justify-between mb-3">
                <div className={pillCls}>
                    <Tag size={12} className="text-slate-400" />
                    <span className="text-[11px] text-slate-500">
                        {filtered.length} {filtered.length === 1 ? 'promoción' : 'promociones'}
                    </span>
                    <div className="h-4 w-px bg-slate-100" />
                    <span className="text-[11px] text-emerald-600 font-medium">
                        {promos.filter(p => p.estado === 'active').length} activas
                    </span>
                </div>
                {canEdit && (
                    <button
                        onClick={() => setShowCreate(s => !s)}
                        className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                    >
                        <Plus size={12} />
                        Nueva promoción
                    </button>
                )}
            </div>

            {/* Create form */}
            {showCreate && (
                <CreatePromoForm
                    branches={branches}
                    labs={labs}
                    onCreated={(newId) => {
                        setShowCreate(false);
                        load();
                        setExpanded(prev => new Set([...prev, newId]));
                    }}
                    onCancel={() => setShowCreate(false)}
                />
            )}

            {/* Table */}
            <DataTable
                columns={COLS}
                loading={loading}
                empty={!loading && filtered.length === 0}
                emptyText={searchTerm ? 'Sin resultados para esa búsqueda' : 'No hay promociones activas'}
                emptyIcon={Tag}
            >
                {filtered.map((promo, idx) => {
                    const isOpen = expanded.has(promo.id);
                    const es     = ESTADO_STYLE[promo.estado] || ESTADO_STYLE.draft;
                    const totalSold = (promo.promotion_products || []).reduce((s, pp) =>
                        s + (pp.promotion_sales_cache || []).reduce((a, r) => a + (r.units_sold || 0), 0), 0);
                    const totalStock = (promo.promotion_products || []).reduce((s, pp) =>
                        s + (pp.stock_inicial || 0), 0);
                    const pct = totalStock > 0 ? Math.min(100, Math.round(totalSold / totalStock * 100)) : null;

                    return (
                        <React.Fragment key={promo.id}>
                            <DataRow index={idx} onClick={() => toggleExpand(promo.id)}>
                                {/* expand */}
                                <DataCell align="center">
                                    {isOpen
                                        ? <ChevronDown size={13} className="text-slate-400" />
                                        : <ChevronRight size={13} className="text-slate-400" />}
                                </DataCell>

                                {/* nombre */}
                                <DataCell align="left">
                                    <span className="text-[12px] font-semibold text-slate-700 leading-tight">{promo.nombre}</span>
                                    {promo.laboratorios?.nombre && (
                                        <span className="ml-1.5 text-[10px] text-slate-400">{promo.laboratorios.nombre}</span>
                                    )}
                                </DataCell>

                                {/* estado */}
                                <DataCell align="center">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${es.bg}`}>
                                        {es.label}
                                    </span>
                                </DataCell>

                                {/* fechas */}
                                <DataCell align="center" hideBelow="md">
                                    <span className="text-[11px] text-slate-500">
                                        {fmtDate(promo.fecha_inicio)}
                                        {promo.fecha_fin && ` → ${fmtDate(promo.fecha_fin)}`}
                                        {!promo.fecha_inicio && '—'}
                                    </span>
                                </DataCell>

                                {/* productos */}
                                <DataCell align="center" hideBelow="sm">
                                    <span className="text-[12px] font-medium text-slate-600">
                                        {(promo.promotion_products || []).length}
                                    </span>
                                </DataCell>

                                {/* vendido */}
                                <DataCell align="center" hideBelow="lg">
                                    {pct !== null ? (
                                        <div className="flex items-center gap-1.5 justify-center">
                                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
                                            </div>
                                            <span className="text-[10px] text-slate-500">{pct}%</span>
                                        </div>
                                    ) : (
                                        <span className="text-[11px] text-slate-400">{totalSold > 0 ? `${totalSold} und` : '—'}</span>
                                    )}
                                </DataCell>

                                {/* acciones */}
                                <DataCell align="center">
                                    <div className="flex items-center gap-1 justify-center" onClick={e => e.stopPropagation()}>
                                        {promo.estado === 'draft' && canEdit && (
                                            <button
                                                title="Activar"
                                                onClick={() => handleStateChange(promo, 'active')}
                                                className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                                            >
                                                <Play size={12} />
                                            </button>
                                        )}
                                        {promo.estado === 'active' && canEdit && (
                                            <button
                                                title="Pausar"
                                                onClick={() => handleStateChange(promo, 'paused')}
                                                className="p-1.5 rounded-lg hover:bg-amber-50 text-slate-400 hover:text-amber-600 transition-colors"
                                            >
                                                <Pause size={12} />
                                            </button>
                                        )}
                                        {promo.estado === 'paused' && canEdit && (
                                            <button
                                                title="Reactivar"
                                                onClick={() => handleStateChange(promo, 'active')}
                                                className="p-1.5 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                                            >
                                                <Play size={12} />
                                            </button>
                                        )}
                                        {(promo.estado === 'active' || promo.estado === 'paused') && canEdit && (
                                            <button
                                                title="Cerrar"
                                                onClick={() => handleStateChange(promo, 'closed')}
                                                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                            >
                                                <Lock size={12} />
                                            </button>
                                        )}
                                        {promo.estado === 'draft' && canEdit && (
                                            <button
                                                title="Eliminar"
                                                onClick={() => handleDelete(promo)}
                                                className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                </DataCell>
                            </DataRow>

                            {/* Expanded detail */}
                            {isOpen && (
                                <tr key={`exp-${promo.id}`}>
                                    <td colSpan={COLS.length} className="p-0 bg-slate-50/50">
                                        <ExpandedPromoRow
                                            promo={promo}
                                            onRefresh={load}
                                            canEdit={canEdit}
                                            productOptions={productOptions}
                                        />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    );
                })}
            </DataTable>
        </div>
    );
}
