import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    FileText, Plus, Printer, Save, Trash2, X,
    ChevronLeft, User, CreditCard, Banknote, Building2,
    Package, Hash, Receipt, Tag, Percent, CheckCircle2,
    Clock, Loader2, AlertCircle, ShoppingCart, Landmark,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';

// ─── Constantes ───────────────────────────────────────────────────────────────
const IVA_RATE       = 0.13;
const RETENTION_RATE = 0.01;

const PRICE_COLS = [
    { key: 'vineta',      label: 'Viñeta'    },
    { key: 'descuento_1', label: 'Descuento 1' },
    { key: 'clinica',     label: 'Clínica'   },
    { key: 'vip',         label: 'VIP'       },
    { key: 'mayoreo',     label: 'Mayoreo'   },
    { key: 'premium',     label: 'Premium'   },
    { key: 'precio_7',    label: 'Precio 7'  },
];

const PAY_OPTS = [
    { value: 'EFECTIVO',      label: 'Efectivo',      icon: Banknote   },
    { value: 'TARJETA',       label: 'Tarjeta',        icon: CreditCard },
    { value: 'TRANSFERENCIA', label: 'Transferencia',  icon: Building2  },
    { value: 'CHEQUE',        label: 'Cheque',         icon: FileText   },
];

const DOC_OPTS = [
    { value: 'COF', label: 'COF — Consumidor Final' },
    { value: 'CCF', label: 'CCF — Crédito Fiscal'   },
];

const STATUS_STYLE = {
    ACTIVA:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    ANULADA: 'bg-red-50    text-red-700    border-red-200',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD  = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const todayStr = () => new Date().toISOString().split('T')[0];

const calcTotals = (items, applies) => {
    const gross     = items.reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0);
    const base      = gross / (1 + IVA_RATE);
    const iva       = gross - base;
    const retention = applies ? base * RETENTION_RATE : 0;
    const total     = gross - retention;
    return { gross, base, iva, retention, total };
};

// ─── Print HTML generator ─────────────────────────────────────────────────────
const buildPrintHTML = (cot, itemsArr, totals, branchName) => {
    const lineRows = itemsArr.map((it, i) => `
        <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:8px 6px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
            <td style="padding:8px 6px;font-size:13px;font-weight:600;">${it.product_nombre || it.productName}</td>
            <td style="padding:8px 6px;text-align:center;font-size:12px;color:#374151;">${it.presentacion_desc || '—'}</td>
            <td style="padding:8px 6px;text-align:center;font-size:13px;">${parseFloat(it.cantidad).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
            <td style="padding:8px 6px;text-align:right;font-size:13px;">${fmt(it.precio_unitario)}</td>
            <td style="padding:8px 6px;text-align:right;font-size:13px;font-weight:700;">${fmt(it.subtotal)}</td>
        </tr>`).join('');

    const retRow = cot.applies_retention
        ? `<tr><td colspan="2" style="padding:4px 8px;text-align:right;font-size:12px;color:#6b7280;">Retención 1%</td>
               <td style="padding:4px 8px;text-align:right;font-size:12px;color:#dc2626;">-${fmt(totals.retention)}</td></tr>`
        : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>${cot.numero}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family: 'Arial', sans-serif; color:#111827; background:#fff; }
  @page { size:letter; margin:15mm 15mm 20mm 15mm; }
  .page { width:100%; max-width:720px; margin:0 auto; }
  table { width:100%; border-collapse:collapse; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:16px; border-bottom:3px solid #1d4ed8; margin-bottom:20px; }
  .brand { font-size:22px; font-weight:900; color:#1d4ed8; letter-spacing:-0.5px; }
  .brand-sub { font-size:12px; color:#6b7280; margin-top:2px; }
  .cot-badge { text-align:right; }
  .cot-num { font-size:20px; font-weight:900; color:#1d4ed8; }
  .cot-label { font-size:10px; text-transform:uppercase; letter-spacing:2px; color:#9ca3af; }
  .meta-row { display:flex; gap:24px; margin-bottom:16px; }
  .meta-block { flex:1; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px; }
  .meta-title { font-size:9px; text-transform:uppercase; letter-spacing:1.5px; color:#94a3b8; margin-bottom:4px; font-weight:700; }
  .meta-value { font-size:13px; font-weight:700; color:#1e293b; }
  .meta-sub   { font-size:11px; color:#64748b; margin-top:1px; }
  .items-header th { background:#1d4ed8; color:#fff; padding:9px 6px; font-size:11px; text-transform:uppercase; letter-spacing:0.8px; text-align:left; }
  .items-header th:last-child, .items-header th:nth-child(4), .items-header th:nth-child(5) { text-align:right; }
  .items-header th:nth-child(1) { text-align:center; width:36px; }
  .items-header th:nth-child(3) { text-align:center; }
  tbody tr:nth-child(even) { background:#f8fafc; }
  .totals-table { width:300px; margin-left:auto; margin-top:12px; }
  .totals-table td { padding:5px 8px; font-size:13px; }
  .totals-table .divider td { border-top:2px solid #e2e8f0; padding-top:8px; }
  .totals-table .grand td { font-size:15px; font-weight:900; color:#1d4ed8; }
  .footer { margin-top:24px; padding-top:12px; border-top:1px solid #e5e7eb; display:flex; justify-content:space-between; align-items:center; }
  .footer-note { font-size:10px; color:#9ca3af; }
  .sign-line { text-align:center; border-top:1px solid #374151; padding-top:4px; font-size:10px; color:#374151; min-width:160px; }
  .badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:10px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase; }
  .badge-ccf { background:#dbeafe; color:#1d4ed8; }
  .badge-cof { background:#f0fdf4; color:#15803d; }
  .notes-box { margin-top:12px; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:10px 14px; font-size:12px; color:#92400e; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="brand">FARMACIA LA SALUD</div>
      <div class="brand-sub">${branchName || 'La Popular'}</div>
    </div>
    <div class="cot-badge">
      <div class="cot-label">Cotización</div>
      <div class="cot-num">${cot.numero}</div>
      <div style="font-size:12px;color:#374151;margin-top:4px;">Fecha: ${fmtD(cot.fecha)}</div>
    </div>
  </div>

  <div class="meta-row">
    <div class="meta-block">
      <div class="meta-title">Cliente</div>
      <div class="meta-value">${cot.customer_name}</div>
      ${cot.customer_nit ? `<div class="meta-sub">NIT: ${cot.customer_nit}</div>` : ''}
    </div>
    <div class="meta-block">
      <div class="meta-title">Tipo de Documento</div>
      <div class="meta-value">
        <span class="badge ${cot.document_type === 'CCF' ? 'badge-ccf' : 'badge-cof'}">${cot.document_type}</span>
      </div>
    </div>
    <div class="meta-block">
      <div class="meta-title">Forma de Pago</div>
      <div class="meta-value">${{ EFECTIVO:'Efectivo', TARJETA:'Tarjeta', TRANSFERENCIA:'Transferencia', CHEQUE:'Cheque' }[cot.payment_type] || cot.payment_type}</div>
    </div>
    ${cot.created_by_name ? `<div class="meta-block">
      <div class="meta-title">Preparado por</div>
      <div class="meta-value">${cot.created_by_name}</div>
      <div class="meta-sub">${fmtD(cot.fecha)}</div>
    </div>` : ''}
  </div>

  <table>
    <thead class="items-header">
      <tr>
        <th>#</th>
        <th>Producto</th>
        <th>Presentación</th>
        <th style="text-align:center">Cant.</th>
        <th style="text-align:right">P. Unitario</th>
        <th style="text-align:right">Subtotal</th>
      </tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <table class="totals-table">
    <tbody>
      <tr><td style="color:#6b7280;">Subtotal s/IVA</td><td style="text-align:right;">${fmt(totals.base)}</td></tr>
      <tr><td style="color:#6b7280;">IVA (13%)</td><td style="text-align:right;">${fmt(totals.iva)}</td></tr>
      ${retRow}
      <tr class="divider grand">
        <td>TOTAL</td>
        <td style="text-align:right;">${fmt(totals.total)}</td>
      </tr>
    </tbody>
  </table>

  ${cot.notes ? `<div class="notes-box"><strong>Notas:</strong> ${cot.notes}</div>` : ''}

  <div class="footer">
    <div class="footer-note">
      Cotización válida por 15 días a partir de la fecha de emisión.<br/>
      Los precios incluyen IVA del 13%.
    </div>
    <div class="sign-line">Firma del Cliente</div>
  </div>
</div>
<script>window.onload = function(){ window.print(); window.onafterprint = function(){ window.close(); }; };</script>
</body>
</html>`;
};

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CotizacionesView() {
    const { user } = useAuth();

    // modo: 'list' | 'new' | 'view'
    const [mode, setMode]       = useState('list');

    // Datos maestros
    const [products,   setProducts]   = useState([]);
    const [pricesMap,  setPricesMap]  = useState({});   // { productId → [{ presentacion_id, desc, ...prices }] }
    const [customers,  setCustomers]  = useState([]);
    const [branches,   setBranches]   = useState([]);
    const [loadingData, setLoadingData] = useState(true);

    // Lista de cotizaciones guardadas
    const [cotizaciones, setCotizaciones] = useState([]);
    const [loadingList,  setLoadingList]  = useState(true);

    // Cotización seleccionada para ver
    const [selectedCot, setSelectedCot] = useState(null);

    // Formulario — cabecera
    const [fecha,             setFecha]             = useState(todayStr());
    const [customerId,        setCustomerId]        = useState('');
    const [docType,           setDocType]           = useState('COF');
    const [paymentType,       setPaymentType]       = useState('EFECTIVO');
    const [appliesRetention,  setAppliesRetention]  = useState(false);
    const [notes,             setNotes]             = useState('');

    // Líneas de productos
    const [items,        setItems]       = useState([]);
    const [addProdId,    setAddProdId]   = useState('');

    // Estado de guardado
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');

    // ── Carga inicial ─────────────────────────────────────────────────────────
    useEffect(() => {
        const load = async () => {
            const [prodsRes, pricesRes, custRes, branchRes] = await Promise.all([
                supabase.from('products').select('id, nombre').eq('activo', true).order('nombre').limit(6000),
                supabase.from('product_precios').select('product_id, id_presentacion, vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7, presentaciones(descripcion)').eq('activo', true),
                supabase.from('customers').select('id, name, nit').order('name').limit(3000),
                supabase.from('branches').select('id, name').order('name'),
            ]);

            setProducts(prodsRes.data || []);

            // Construir mapa de precios por producto
            const map = {};
            (pricesRes.data || []).forEach(p => {
                const pid = String(p.product_id);
                if (!map[pid]) map[pid] = [];
                map[pid].push({
                    presentacion_id: p.id_presentacion,
                    desc: p.presentaciones?.descripcion || `Pres. ${p.id_presentacion}`,
                    vineta:      p.vineta,
                    descuento_1: p.descuento_1,
                    vip:         p.vip,
                    clinica:     p.clinica,
                    mayoreo:     p.mayoreo,
                    premium:     p.premium,
                    precio_7:    p.precio_7,
                });
            });
            setPricesMap(map);
            setCustomers(custRes.data || []);
            setBranches(branchRes.data || []);
            setLoadingData(false);
        };
        load();
    }, []);

    // ── Carga lista ───────────────────────────────────────────────────────────
    const loadList = useCallback(async () => {
        setLoadingList(true);
        const { data } = await supabase
            .from('cotizaciones')
            .select('id, numero, fecha, customer_name, document_type, payment_type, total, status, created_by_name')
            .order('created_at', { ascending: false })
            .limit(300);
        setCotizaciones(data || []);
        setLoadingList(false);
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

    // ── Totales calculados ────────────────────────────────────────────────────
    const totals = useMemo(() => calcTotals(items, appliesRetention), [items, appliesRetention]);

    // ── Opciones para selects ─────────────────────────────────────────────────
    const productOptions = useMemo(() =>
        products.map(p => ({ value: String(p.id), label: p.nombre })),
        [products]);

    const customerOptions = useMemo(() => [
        { value: '', label: 'Consumidor Final' },
        ...customers.map(c => ({
            value: String(c.id),
            label: c.name,
            sublabel: c.nit ? `NIT: ${c.nit}` : undefined,
        })),
    ], [customers]);

    // ── Helpers de líneas ─────────────────────────────────────────────────────
    const addProduct = useCallback((productId) => {
        if (!productId) return;
        const product = products.find(p => String(p.id) === String(productId));
        if (!product) return;

        const presArr = pricesMap[String(productId)] || [];
        const firstPres = presArr[0];
        const defaultPriceType = 'vineta';
        const unitPrice = firstPres ? parseFloat(firstPres[defaultPriceType] || 0) : 0;

        setItems(prev => [...prev, {
            _id:             Date.now() + Math.random(),
            productId:       String(productId),
            productName:     product.nombre,
            presentacionId:  firstPres ? String(firstPres.presentacion_id) : '',
            presentacionDesc: firstPres?.desc || '',
            priceType:       defaultPriceType,
            cantidad:        1,
            precioUnitario:  unitPrice,
            subtotal:        unitPrice,
        }]);
        setAddProdId('');
    }, [products, pricesMap]);

    const updateItem = useCallback((id, field, value) => {
        setItems(prev => prev.map(item => {
            if (item._id !== id) return item;
            const u = { ...item, [field]: value };

            if (field === 'presentacionId') {
                const pres = (pricesMap[item.productId] || []).find(p => String(p.presentacion_id) === String(value));
                u.presentacionDesc = pres?.desc || '';
                u.precioUnitario   = parseFloat(pres?.[u.priceType] || 0);
                u.subtotal         = u.precioUnitario * u.cantidad;
            }
            if (field === 'priceType') {
                const pres = (pricesMap[item.productId] || []).find(p => String(p.presentacion_id) === String(item.presentacionId));
                u.precioUnitario = parseFloat(pres?.[value] || 0);
                u.subtotal       = u.precioUnitario * u.cantidad;
            }
            if (field === 'cantidad') {
                const qty = Math.max(0, parseFloat(value) || 0);
                u.cantidad = qty;
                u.subtotal = qty * u.precioUnitario;
            }
            if (field === 'precioUnitario') {
                const price = Math.max(0, parseFloat(value) || 0);
                u.precioUnitario = price;
                u.subtotal       = price * u.cantidad;
            }
            return u;
        }));
    }, [pricesMap]);

    const removeItem = useCallback((id) => setItems(prev => prev.filter(i => i._id !== id)), []);

    // ── Guardar ───────────────────────────────────────────────────────────────
    const handleSave = async () => {
        if (items.length === 0) { setSaveError('Agrega al menos un producto.'); return; }
        setSaveError('');
        setSaving(true);
        try {
            const { data: numData, error: numErr } = await supabase.rpc('next_cotizacion_numero');
            if (numErr) throw numErr;

            const selCustomer = customers.find(c => String(c.id) === String(customerId));

            const { data: cotData, error: cotErr } = await supabase.from('cotizaciones').insert({
                numero:            numData,
                fecha,
                customer_id:       customerId || null,
                customer_name:     selCustomer?.name || 'Consumidor Final',
                customer_nit:      selCustomer?.nit  || null,
                document_type:     docType,
                payment_type:      paymentType,
                applies_retention: appliesRetention,
                subtotal_gravado:  totals.base,
                iva_amount:        totals.iva,
                retention_amount:  totals.retention,
                total:             totals.total,
                notes:             notes || null,
                branch_id:         user?.branchId || null,
                created_by:        user?.id       || null,
                created_by_name:   user?.name     || null,
            }).select().single();

            if (cotErr) throw cotErr;

            const itemRows = items.map((it, idx) => ({
                cotizacion_id:    cotData.id,
                product_id:       parseInt(it.productId),
                product_nombre:   it.productName,
                presentacion_id:  it.presentacionId ? parseInt(it.presentacionId) : null,
                presentacion_desc: it.presentacionDesc || null,
                price_type:       it.priceType,
                cantidad:         it.cantidad,
                precio_unitario:  it.precioUnitario,
                subtotal:         it.subtotal,
                sort_order:       idx,
            }));

            const { error: itemsErr } = await supabase.from('cotizacion_items').insert(itemRows);
            if (itemsErr) throw itemsErr;

            // Abrir vista de la cotización guardada
            setSelectedCot({ ...cotData, cotizacion_items: itemRows });
            setMode('view');
            resetForm();
            loadList();
        } catch (e) {
            setSaveError(e.message || 'Error al guardar.');
        }
        setSaving(false);
    };

    const handleAnular = async (cotId) => {
        if (!window.confirm('¿Anular esta cotización?')) return;
        await supabase.from('cotizaciones').update({ status: 'ANULADA' }).eq('id', cotId);
        loadList();
        if (selectedCot?.id === cotId) setSelectedCot(prev => ({ ...prev, status: 'ANULADA' }));
    };

    const resetForm = () => {
        setFecha(todayStr());
        setCustomerId('');
        setDocType('COF');
        setPaymentType('EFECTIVO');
        setAppliesRetention(false);
        setNotes('');
        setItems([]);
        setAddProdId('');
        setSaveError('');
    };

    // ── Imprimir ──────────────────────────────────────────────────────────────
    const handlePrint = (cot, itemsData) => {
        const totalsForPrint = calcTotals(itemsData, cot.applies_retention);
        const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';
        const win = window.open('', '_blank', 'width=800,height=700');
        if (!win) return;
        win.document.write(buildPrintHTML(cot, itemsData, totalsForPrint, branchName));
        win.document.close();
    };

    // ── Cargar items de una cotización al verla ───────────────────────────────
    const openCotizacion = async (cot) => {
        const { data } = await supabase
            .from('cotizacion_items')
            .select('*')
            .eq('cotizacion_id', cot.id)
            .order('sort_order');
        setSelectedCot({ ...cot, cotizacion_items: data || [] });
        setMode('view');
    };

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────

    // ── Vista: Lista ──────────────────────────────────────────────────────────
    if (mode === 'list') {
        return (
            <GlassViewLayout
                icon={Receipt}
                title="Cotizaciones"
                filtersContent={
                    <button
                        onClick={() => { resetForm(); setMode('new'); }}
                        className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white text-[12px] font-black uppercase tracking-widest rounded-2xl shadow-[0_4px_14px_rgba(0,122,255,0.35)] hover:bg-[#0066DD] hover:shadow-[0_6px_20px_rgba(0,122,255,0.45)] hover:-translate-y-0.5 active:scale-95 transition-all duration-200"
                    >
                        <Plus size={15} strokeWidth={3} />
                        Nueva Cotización
                    </button>
                }
            >
                {/* Stats bar */}
                <div className="px-6 pt-6 pb-4 flex flex-wrap gap-3">
                    {[
                        { label: 'Total',   val: cotizaciones.length,                                                   color: 'text-slate-700' },
                        { label: 'Activas', val: cotizaciones.filter(c => c.status === 'ACTIVA').length,                color: 'text-emerald-600' },
                        { label: 'Anuladas',val: cotizaciones.filter(c => c.status === 'ANULADA').length,               color: 'text-red-500' },
                        { label: 'Monto total', val: fmt(cotizaciones.filter(c => c.status === 'ACTIVA').reduce((s, c) => s + parseFloat(c.total || 0), 0)), color: 'text-blue-600' },
                    ].map(s => (
                        <div key={s.label} className="flex items-center gap-2 bg-white/60 backdrop-blur-sm border border-white/80 px-4 py-2.5 rounded-2xl shadow-sm">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.label}</span>
                            <span className={`text-[15px] font-black ${s.color}`}>{s.val}</span>
                        </div>
                    ))}
                </div>

                {/* Table */}
                {loadingList ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={28} className="animate-spin text-[#007AFF]" />
                    </div>
                ) : cotizaciones.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
                        <div className="w-16 h-16 rounded-[1.5rem] bg-slate-100 flex items-center justify-center">
                            <Receipt size={28} strokeWidth={1.5} />
                        </div>
                        <p className="text-[13px] font-bold">Aún no hay cotizaciones</p>
                        <button onClick={() => { resetForm(); setMode('new'); }} className="text-[11px] font-black text-[#007AFF] uppercase tracking-widest hover:underline">
                            Crear la primera
                        </button>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    {['Número','Fecha','Cliente','Tipo','Pago','Total','Estado',''].map(h => (
                                        <th key={h} className="px-5 py-3 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {cotizaciones.map(cot => (
                                    <tr
                                        key={cot.id}
                                        onClick={() => openCotizacion(cot)}
                                        className="border-b border-slate-50 hover:bg-white/70 cursor-pointer transition-colors group"
                                    >
                                        <td className="px-5 py-3.5">
                                            <span className="text-[12px] font-black text-[#007AFF]">{cot.numero}</span>
                                        </td>
                                        <td className="px-5 py-3.5 text-[12px] font-bold text-slate-600">{fmtD(cot.fecha)}</td>
                                        <td className="px-5 py-3.5 text-[12px] font-bold text-slate-700 max-w-[200px] truncate">{cot.customer_name}</td>
                                        <td className="px-5 py-3.5">
                                            <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${cot.document_type === 'CCF' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                                {cot.document_type}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3.5 text-[11px] font-bold text-slate-500 capitalize">{cot.payment_type?.toLowerCase()}</td>
                                        <td className="px-5 py-3.5 text-[13px] font-black text-slate-800">{fmt(cot.total)}</td>
                                        <td className="px-5 py-3.5">
                                            <span className={`text-[9px] font-black px-2 py-1 rounded-full border uppercase tracking-wider ${STATUS_STYLE[cot.status] || ''}`}>
                                                {cot.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <span className="text-[10px] font-black text-[#007AFF] uppercase tracking-wider">Ver →</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </GlassViewLayout>
        );
    }

    // ── Vista: Nueva cotización ───────────────────────────────────────────────
    if (mode === 'new') {
        return (
            <GlassViewLayout
                icon={Receipt}
                title="Nueva Cotización"
                filtersContent={
                    <button
                        onClick={() => { resetForm(); setMode('list'); }}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/60 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/80 hover:bg-white/80 hover:-translate-y-0.5 active:scale-95 transition-all duration-200"
                    >
                        <ChevronLeft size={14} strokeWidth={3} />
                        Lista
                    </button>
                }
            >
                <div className="p-4 lg:p-6 space-y-5">

                    {/* ── Cabecera ─────────────────────────────────────────── */}
                    <div className="bg-white/50 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm space-y-4">
                        <div className="flex items-center gap-2.5 pb-3 border-b border-white/60">
                            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
                                <FileText size={16} strokeWidth={2.5} />
                            </div>
                            <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-700">Datos de la Cotización</h3>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {/* Fecha */}
                            <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Fecha</label>
                                <input
                                    type="date"
                                    value={fecha}
                                    onChange={e => setFecha(e.target.value)}
                                    className="w-full bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl px-4 py-3 text-[13px] font-bold text-slate-700 outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all"
                                />
                            </div>
                            {/* Cliente */}
                            <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Cliente</label>
                                <LiquidSelect
                                    value={customerId}
                                    onChange={v => {
                                        setCustomerId(v);
                                        // Si selecciona cliente con NIT, auto-sugiere CCF
                                        const c = customers.find(c => String(c.id) === String(v));
                                        if (c?.nit) setDocType('CCF');
                                    }}
                                    options={customerOptions}
                                    placeholder="Consumidor Final"
                                    icon={User}
                                    compact
                                />
                            </div>
                            {/* Tipo documento */}
                            <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Tipo Documento</label>
                                <LiquidSelect
                                    value={docType}
                                    onChange={v => {
                                        setDocType(v);
                                        if (v === 'COF') setAppliesRetention(false);
                                    }}
                                    options={DOC_OPTS}
                                    placeholder="Tipo..."
                                    icon={FileText}
                                    compact
                                    clearable={false}
                                />
                            </div>
                            {/* Forma de pago */}
                            <div>
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Forma de Pago</label>
                                <LiquidSelect
                                    value={paymentType}
                                    onChange={setPaymentType}
                                    options={PAY_OPTS}
                                    placeholder="Forma de pago..."
                                    icon={CreditCard}
                                    compact
                                    clearable={false}
                                />
                            </div>
                        </div>

                        {/* Retención + Notas */}
                        <div className="flex flex-col sm:flex-row gap-4 pt-1">
                            <div
                                onClick={() => docType === 'CCF' && setAppliesRetention(p => !p)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer select-none transition-all duration-200 ${docType !== 'CCF' ? 'opacity-40 cursor-not-allowed' : ''} ${appliesRetention ? 'bg-amber-50 border-amber-300 shadow-sm' : 'bg-white/40 border-white/60 hover:bg-white/60'}`}
                            >
                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all duration-200 ${appliesRetention ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                                    {appliesRetention && <CheckCircle2 size={12} strokeWidth={3} className="text-white" />}
                                </div>
                                <div>
                                    <p className="text-[11px] font-black text-slate-700 leading-none">Retención 1%</p>
                                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">Solo para CCF</p>
                                </div>
                                {appliesRetention && (
                                    <span className="ml-auto text-[10px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">ACTIVA</span>
                                )}
                            </div>
                            <div className="flex-1">
                                <input
                                    type="text"
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder="Notas u observaciones (opcional)..."
                                    className="w-full bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl px-4 py-3 text-[12px] font-bold text-slate-700 placeholder-slate-300 outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    {/* ── Productos ─────────────────────────────────────────── */}
                    <div className="bg-white/50 backdrop-blur-xl border border-white/80 rounded-[2rem] overflow-hidden shadow-sm">
                        {/* Header sección */}
                        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-4 border-b border-white/60">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
                                    <ShoppingCart size={16} strokeWidth={2.5} />
                                </div>
                                <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-700">
                                    Productos
                                    {items.length > 0 && (
                                        <span className="ml-2 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">{items.length}</span>
                                    )}
                                </h3>
                            </div>
                            {/* Buscador para agregar */}
                            <div className="flex items-center gap-2 w-full max-w-[360px]">
                                <div className="flex-1">
                                    <LiquidSelect
                                        value={addProdId}
                                        onChange={addProduct}
                                        options={productOptions}
                                        placeholder="Buscar y agregar producto..."
                                        icon={Package}
                                        compact
                                        clearable={false}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Items vacíos */}
                        {items.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                                <div className="w-14 h-14 rounded-[1.2rem] bg-slate-50 flex items-center justify-center border border-slate-100">
                                    <Package size={24} strokeWidth={1.5} />
                                </div>
                                <p className="text-[12px] font-bold">Busca y selecciona productos para agregar</p>
                            </div>
                        ) : (
                            <>
                                {/* Tabla desktop */}
                                <div className="hidden lg:block overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-slate-50/80">
                                                {['#','Producto','Presentación','Tipo Precio','Cantidad','P. Unitario','Subtotal',''].map(h => (
                                                    <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 first:pl-5 last:pr-4">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item, idx) => {
                                                const presArr = pricesMap[item.productId] || [];
                                                const presOptions = presArr.map(p => ({ value: String(p.presentacion_id), label: p.desc }));
                                                const selPres = presArr.find(p => String(p.presentacion_id) === String(item.presentacionId));
                                                const priceOptions = PRICE_COLS
                                                    .filter(pc => selPres && parseFloat(selPres[pc.key] || 0) > 0)
                                                    .map(pc => ({ value: pc.key, label: `${pc.label}: ${fmt(selPres[pc.key])}` }));

                                                return (
                                                    <tr key={item._id} className="border-t border-slate-50 hover:bg-white/60 transition-colors">
                                                        <td className="pl-5 pr-2 py-3 text-[11px] font-black text-slate-400">{idx + 1}</td>
                                                        <td className="px-3 py-3 max-w-[200px]">
                                                            <p className="text-[12px] font-bold text-slate-800 leading-tight truncate">{item.productName}</p>
                                                        </td>
                                                        <td className="px-2 py-2 min-w-[150px]">
                                                            <LiquidSelect
                                                                value={item.presentacionId}
                                                                onChange={v => updateItem(item._id, 'presentacionId', v)}
                                                                options={presOptions}
                                                                placeholder="Presentación"
                                                                icon={Tag}
                                                                compact
                                                                clearable={false}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 min-w-[160px]">
                                                            <LiquidSelect
                                                                value={item.priceType}
                                                                onChange={v => updateItem(item._id, 'priceType', v)}
                                                                options={priceOptions}
                                                                placeholder="Precio"
                                                                icon={Percent}
                                                                compact
                                                                clearable={false}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 w-[90px]">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="0.001"
                                                                value={item.cantidad}
                                                                onChange={e => updateItem(item._id, 'cantidad', e.target.value)}
                                                                className="w-full bg-white/80 border border-white/80 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-800 text-center outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all"
                                                            />
                                                        </td>
                                                        <td className="px-2 py-2 w-[100px]">
                                                            <div className="relative">
                                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">$</span>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.01"
                                                                    value={item.precioUnitario}
                                                                    onChange={e => updateItem(item._id, 'precioUnitario', e.target.value)}
                                                                    className="w-full bg-white/80 border border-white/80 rounded-xl pl-6 pr-3 py-2 text-[12px] font-bold text-slate-800 text-right outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all"
                                                                />
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-3 text-right">
                                                            <span className="text-[13px] font-black text-slate-800">{fmt(item.subtotal)}</span>
                                                        </td>
                                                        <td className="pr-4 py-3">
                                                            <button onClick={() => removeItem(item._id)} className="w-7 h-7 rounded-xl bg-red-50 text-red-400 border border-red-100 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all duration-200 flex items-center justify-center">
                                                                <X size={12} strokeWidth={3} />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Cards mobile */}
                                <div className="lg:hidden space-y-3 p-4">
                                    {items.map((item, idx) => {
                                        const presArr = pricesMap[item.productId] || [];
                                        const presOptions = presArr.map(p => ({ value: String(p.presentacion_id), label: p.desc }));
                                        const selPres = presArr.find(p => String(p.presentacion_id) === String(item.presentacionId));
                                        const priceOptions = PRICE_COLS
                                            .filter(pc => selPres && parseFloat(selPres[pc.key] || 0) > 0)
                                            .map(pc => ({ value: pc.key, label: `${pc.label}: ${fmt(selPres[pc.key])}` }));

                                        return (
                                            <div key={item._id} className="bg-white/60 border border-white/80 rounded-2xl p-4 space-y-3 shadow-sm">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div>
                                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">#{idx + 1}</span>
                                                        <p className="text-[13px] font-black text-slate-800 leading-tight mt-0.5">{item.productName}</p>
                                                    </div>
                                                    <button onClick={() => removeItem(item._id)} className="w-8 h-8 rounded-xl bg-red-50 text-red-400 border border-red-100 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shrink-0">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <LiquidSelect value={item.presentacionId} onChange={v => updateItem(item._id, 'presentacionId', v)} options={presOptions} placeholder="Presentación" icon={Tag} compact clearable={false} />
                                                    <LiquidSelect value={item.priceType} onChange={v => updateItem(item._id, 'priceType', v)} options={priceOptions} placeholder="Precio" icon={Percent} compact clearable={false} />
                                                </div>
                                                <div className="flex gap-2 items-center">
                                                    <div className="flex-1">
                                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cantidad</label>
                                                        <input type="number" min="0" step="0.001" value={item.cantidad} onChange={e => updateItem(item._id, 'cantidad', e.target.value)} className="w-full bg-white/80 border border-white/80 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-800 text-center outline-none focus:border-[#007AFF] transition-all" />
                                                    </div>
                                                    <div className="flex-1">
                                                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">P. Unitario</label>
                                                        <input type="number" min="0" step="0.01" value={item.precioUnitario} onChange={e => updateItem(item._id, 'precioUnitario', e.target.value)} className="w-full bg-white/80 border border-white/80 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-800 text-right outline-none focus:border-[#007AFF] transition-all" />
                                                    </div>
                                                    <div className="text-right pt-5">
                                                        <span className="text-[14px] font-black text-[#007AFF]">{fmt(item.subtotal)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                    </div>

                    {/* ── Totales ───────────────────────────────────────────── */}
                    {items.length > 0 && (
                        <div className="flex justify-end">
                            <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm w-full max-w-[360px] space-y-2">
                                <div className="flex items-center gap-2 pb-3 border-b border-white/60 mb-3">
                                    <div className="w-7 h-7 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
                                        <Calculator size={14} strokeWidth={2.5} />
                                    </div>
                                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-700">Resumen</h3>
                                </div>
                                {[
                                    { label: 'Subtotal gravado (s/IVA)', val: fmt(totals.base),      color: 'text-slate-600' },
                                    { label: 'IVA 13%',                   val: fmt(totals.iva),       color: 'text-slate-600' },
                                    ...(appliesRetention ? [{ label: 'Retención 1%', val: `–${fmt(totals.retention)}`, color: 'text-amber-600' }] : []),
                                ].map(r => (
                                    <div key={r.label} className="flex justify-between items-center">
                                        <span className="text-[11px] font-bold text-slate-500">{r.label}</span>
                                        <span className={`text-[12px] font-bold ${r.color}`}>{r.val}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between items-center pt-3 border-t border-slate-100 mt-2">
                                    <span className="text-[13px] font-black text-slate-800">TOTAL</span>
                                    <span className="text-[20px] font-black text-[#007AFF]">{fmt(totals.total)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Error + Botones ───────────────────────────────────── */}
                    {saveError && (
                        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-[12px] font-bold px-4 py-3 rounded-2xl">
                            <AlertCircle size={16} strokeWidth={2.5} />
                            {saveError}
                        </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pb-4">
                        <button
                            onClick={() => { resetForm(); setMode('list'); }}
                            className="px-6 py-3 bg-white/60 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/80 hover:bg-white/80 hover:-translate-y-0.5 active:scale-95 transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || items.length === 0}
                            className={`flex items-center gap-2 px-7 py-3 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-lg transition-all duration-200 ${saving || items.length === 0 ? 'bg-slate-300 cursor-not-allowed' : 'bg-[#007AFF] hover:bg-[#0066DD] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] active:scale-95'}`}
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={2.5} />}
                            {saving ? 'Guardando...' : 'Guardar Cotización'}
                        </button>
                    </div>

                </div>
            </GlassViewLayout>
        );
    }

    // ── Vista: Ver cotización guardada ────────────────────────────────────────
    if (mode === 'view' && selectedCot) {
        const cot = selectedCot;
        const itemsData = cot.cotizacion_items || [];
        const viewTotals = calcTotals(itemsData.map(i => ({ subtotal: i.subtotal })), cot.applies_retention);

        return (
            <GlassViewLayout
                icon={Receipt}
                title={cot.numero}
                filtersContent={
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setMode('list')}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white/60 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/80 hover:bg-white/80 hover:-translate-y-0.5 active:scale-95 transition-all"
                        >
                            <ChevronLeft size={14} strokeWidth={3} />
                            Lista
                        </button>
                        {cot.status === 'ACTIVA' && (
                            <>
                                <button
                                    onClick={() => handleAnular(cot.id)}
                                    className="px-4 py-2.5 bg-red-50 text-red-500 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-red-100 hover:bg-red-500 hover:text-white hover:-translate-y-0.5 active:scale-95 transition-all"
                                >
                                    Anular
                                </button>
                                <button
                                    onClick={() => handlePrint(cot, itemsData)}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-md hover:bg-[#0066DD] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] active:scale-95 transition-all"
                                >
                                    <Printer size={14} strokeWidth={2.5} />
                                    Imprimir / PDF
                                </button>
                            </>
                        )}
                    </div>
                }
            >
                <div className="p-4 lg:p-6 space-y-5">

                    {/* Status badge */}
                    {cot.status === 'ANULADA' && (
                        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-[12px] font-bold px-5 py-3.5 rounded-2xl">
                            <X size={16} strokeWidth={3} />
                            Esta cotización fue anulada.
                        </div>
                    )}

                    {/* Header info */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            { icon: User,        label: 'Cliente',      val: cot.customer_name,                                sub: cot.customer_nit ? `NIT: ${cot.customer_nit}` : '' },
                            { icon: FileText,    label: 'Documento',    val: cot.document_type === 'CCF' ? 'Crédito Fiscal (CCF)' : 'Consumidor Final (COF)' },
                            { icon: CreditCard,  label: 'Forma de Pago',val: { EFECTIVO:'Efectivo', TARJETA:'Tarjeta', TRANSFERENCIA:'Transferencia', CHEQUE:'Cheque' }[cot.payment_type] },
                            { icon: Hash,        label: 'Fecha',        val: fmtD(cot.fecha),                               sub: cot.created_by_name ? `Por: ${cot.created_by_name}` : '' },
                        ].map(c => (
                            <div key={c.label} className="bg-white/50 backdrop-blur-sm border border-white/80 rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center gap-2 mb-2">
                                    <c.icon size={12} className="text-slate-400" strokeWidth={2} />
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{c.label}</span>
                                </div>
                                <p className="text-[13px] font-black text-slate-800 leading-tight">{c.val}</p>
                                {c.sub && <p className="text-[10px] font-bold text-slate-400 mt-0.5">{c.sub}</p>}
                            </div>
                        ))}
                    </div>

                    {/* Items table */}
                    <div className="bg-white/50 backdrop-blur-xl border border-white/80 rounded-[2rem] overflow-hidden shadow-sm">
                        <div className="px-5 pt-4 pb-3 border-b border-white/60 flex items-center gap-2">
                            <div className="w-7 h-7 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
                                <ShoppingCart size={14} strokeWidth={2.5} />
                            </div>
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-700">Productos ({itemsData.length})</h3>
                        </div>
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50/80">
                                    {['#','Producto','Presentación','Cant.','P. Unit.','Subtotal'].map(h => (
                                        <th key={h} className="px-5 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400 last:text-right">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {itemsData.map((it, i) => (
                                    <tr key={it.id || i} className="border-t border-slate-50">
                                        <td className="px-5 py-3 text-[11px] font-black text-slate-400">{i + 1}</td>
                                        <td className="px-5 py-3 text-[12px] font-bold text-slate-800">{it.product_nombre}</td>
                                        <td className="px-5 py-3 text-[11px] text-slate-500">{it.presentacion_desc || '—'}</td>
                                        <td className="px-5 py-3 text-[12px] font-bold text-slate-700">{parseFloat(it.cantidad).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
                                        <td className="px-5 py-3 text-[12px] font-bold text-slate-700">{fmt(it.precio_unitario)}</td>
                                        <td className="px-5 py-3 text-right text-[13px] font-black text-slate-800">{fmt(it.subtotal)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Totales */}
                    <div className="flex justify-end">
                        <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm w-full max-w-[360px] space-y-2">
                            <div className="flex items-center gap-2 pb-3 border-b border-white/60 mb-3">
                                <Calculator size={14} className="text-blue-600" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-700">Totales</h3>
                            </div>
                            {[
                                { label: 'Subtotal gravado (s/IVA)', val: fmt(viewTotals.base)      },
                                { label: 'IVA 13%',                   val: fmt(viewTotals.iva)       },
                                ...(cot.applies_retention ? [{ label: 'Retención 1%', val: `–${fmt(viewTotals.retention)}`, amber: true }] : []),
                            ].map(r => (
                                <div key={r.label} className="flex justify-between items-center">
                                    <span className="text-[11px] font-bold text-slate-500">{r.label}</span>
                                    <span className={`text-[12px] font-bold ${r.amber ? 'text-amber-600' : 'text-slate-600'}`}>{r.val}</span>
                                </div>
                            ))}
                            <div className="flex justify-between items-center pt-3 border-t border-slate-100 mt-2">
                                <span className="text-[13px] font-black text-slate-800">TOTAL</span>
                                <span className="text-[22px] font-black text-[#007AFF]">{fmt(viewTotals.total)}</span>
                            </div>
                        </div>
                    </div>

                    {cot.notes && (
                        <div className="bg-amber-50/80 border border-amber-200/60 rounded-2xl px-5 py-4">
                            <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Notas</p>
                            <p className="text-[13px] font-bold text-amber-900">{cot.notes}</p>
                        </div>
                    )}

                    {/* Botón imprimir abajo también */}
                    {cot.status === 'ACTIVA' && (
                        <div className="flex justify-end pb-4">
                            <button
                                onClick={() => handlePrint(cot, itemsData)}
                                className="flex items-center gap-2 px-7 py-3.5 bg-[#007AFF] text-white text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-lg hover:bg-[#0066DD] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] active:scale-95 transition-all"
                            >
                                <Printer size={16} strokeWidth={2.5} />
                                Imprimir / Guardar PDF
                            </button>
                        </div>
                    )}
                </div>
            </GlassViewLayout>
        );
    }

    return null;
}
