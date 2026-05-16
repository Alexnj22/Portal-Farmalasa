import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    FileText, Plus, Printer, Save, Trash2, X,
    ChevronLeft, User, CreditCard, Building2,
    Package, Hash, Receipt, Tag, Percent, CheckCircle2,
    Loader2, AlertCircle, ShoppingCart, Calculator,
    Edit2, Info, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidAvatar from '../components/common/LiquidAvatar';

// ─── Constantes ───────────────────────────────────────────────────────────────
const IVA_RATE       = 0.13;
const RETENTION_RATE = 0.01;
const RETENTION_THRESHOLD = 100;

const PRICE_COLS = [
    { key: 'vineta',      label: 'Viñeta'     },
    { key: 'descuento_1', label: 'Descuento 1' },
    { key: 'clinica',     label: 'Clínica'    },
    { key: 'vip',         label: 'VIP'        },
    { key: 'mayoreo',     label: 'Mayoreo'    },
    { key: 'premium',     label: 'Premium'    },
    { key: 'precio_7',    label: 'Precio 7'   },
];

const PAY_OPTS = [
    { value: 'EFECTIVO',      label: 'Efectivo'      },
    { value: 'TARJETA',       label: 'Tarjeta'       },
    { value: 'TRANSFERENCIA', label: 'Transferencia' },
    { value: 'CHEQUE',        label: 'Cheque'        },
];

const DOC_OPTS = [
    { value: 'COF', label: 'COF — Consumidor Final' },
    { value: 'CCF', label: 'CCF — Crédito Fiscal'   },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt    = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD   = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const todayStr = () => new Date().toISOString().split('T')[0];

const desglose = (precioConIva, cantidad = 1) => {
    const unitSinIva = precioConIva / (1 + IVA_RATE);
    const unitIva    = precioConIva - unitSinIva;
    return {
        unitSinIva,
        unitIva,
        subtotalSinIva: unitSinIva * cantidad,
        subtotalIva:    unitIva    * cantidad,
        total:          precioConIva * cantidad,
    };
};

const calcTotals = (items, applies) => {
    const gross     = items.reduce((s, i) => s + (parseFloat(i.subtotal) || 0), 0);
    const base      = gross / (1 + IVA_RATE);
    const iva       = gross - base;
    const retention = applies ? base * RETENTION_RATE : 0;
    const total     = gross - retention;
    return { gross, base, iva, retention, total };
};

// ─── Print HTML ───────────────────────────────────────────────────────────────
const buildPrintHTML = (cot, itemsArr, branchName) => {
    const applies = cot.applies_retention;
    const gross   = itemsArr.reduce((s, i) => s + parseFloat(i.subtotal || 0), 0);
    const base    = gross / 1.13;
    const iva     = gross - base;
    const ret     = applies ? base * 0.01 : 0;
    const total   = gross - ret;
    const isCCF   = cot.document_type === 'CCF';

    const lineRows = itemsArr.map((it, i) => {
        const dsg = desglose(parseFloat(it.precio_unitario || 0), parseFloat(it.cantidad || 1));
        return `
        <tr style="border-bottom:1px solid #e5e7eb;">
            <td style="padding:7px 5px;text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
            <td style="padding:7px 5px;font-size:12px;font-weight:600;">${it.product_nombre}</td>
            <td style="padding:7px 5px;text-align:center;font-size:11px;color:#374151;">${it.presentacion_desc || '—'}</td>
            <td style="padding:7px 5px;text-align:center;font-size:12px;">${parseFloat(it.cantidad).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
            ${isCCF ? `
            <td style="padding:7px 5px;text-align:right;font-size:11px;">${fmt(dsg.unitSinIva)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:11px;">${fmt(dsg.subtotalSinIva)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:11px;">${fmt(dsg.subtotalIva)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(dsg.total)}</td>
            ` : `
            <td style="padding:7px 5px;text-align:right;font-size:12px;">${fmt(it.precio_unitario)}</td>
            <td style="padding:7px 5px;text-align:right;font-size:12px;font-weight:700;">${fmt(it.subtotal)}</td>
            `}
        </tr>`;
    }).join('');

    const headers = isCCF
        ? `<th style="text-align:center;width:30px;">#</th><th>Producto</th><th style="text-align:center;">Pres.</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">P.Unit s/IVA</th><th style="text-align:right;">Subtotal s/IVA</th><th style="text-align:right;">IVA 13%</th><th style="text-align:right;">Total</th>`
        : `<th style="text-align:center;width:30px;">#</th><th>Producto</th><th style="text-align:center;">Pres.</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">P.Unitario</th><th style="text-align:right;">Subtotal</th>`;

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>${cot.numero}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;color:#111827;background:#fff;font-size:12px}
  @page{size:letter;margin:14mm 12mm 18mm 12mm}
  .page{width:100%;max-width:740px;margin:0 auto}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:12px;border-bottom:3px solid #1d4ed8;margin-bottom:16px}
  .brand{font-size:20px;font-weight:900;color:#1d4ed8;letter-spacing:-0.5px}
  .brand-sub{font-size:11px;color:#6b7280;margin-top:2px}
  .cot-num{font-size:18px;font-weight:900;color:#1d4ed8}
  .meta{display:flex;gap:16px;margin-bottom:14px;flex-wrap:wrap}
  .meta-block{background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:8px 12px;min-width:130px}
  .meta-title{font-size:8px;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;font-weight:700;margin-bottom:3px}
  .meta-value{font-size:12px;font-weight:700;color:#1e293b}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1d4ed8;color:#fff;padding:8px 5px;font-size:10px;text-transform:uppercase;letter-spacing:0.6px;text-align:left}
  tbody tr:nth-child(even){background:#f8fafc}
  .totals{width:${isCCF ? '380' : '280'}px;margin-left:auto;margin-top:10px;border-top:2px solid #e2e8f0}
  .totals td{padding:4px 6px;font-size:12px}
  .totals .grand td{font-size:14px;font-weight:900;color:#1d4ed8;border-top:2px solid #1d4ed8;padding-top:7px}
  .badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;text-transform:uppercase}
  .badge-ccf{background:#dbeafe;color:#1d4ed8}
  .badge-cof{background:#f0fdf4;color:#15803d}
  .footer{margin-top:20px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end}
  .sign-line{text-align:center;border-top:1px solid #374151;padding-top:4px;font-size:10px;color:#374151;min-width:140px}
  .footer-note{font-size:10px;color:#9ca3af;max-width:300px}
  .notes-box{margin-top:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:5px;padding:8px 12px;font-size:11px;color:#92400e}
</style>
</head>
<body>
<div class="page">
  <div class="hdr">
    <div>
      <div class="brand">FARMACIA LA SALUD</div>
      <div class="brand-sub">${branchName || 'La Popular'}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#9ca3af">Cotización</div>
      <div class="cot-num">${cot.numero}</div>
      <div style="font-size:11px;color:#374151;margin-top:3px">${fmtD(cot.fecha)}</div>
    </div>
  </div>
  <div class="meta">
    <div class="meta-block" style="flex:2">
      <div class="meta-title">Cliente</div>
      <div class="meta-value">${cot.customer_name}</div>
      ${cot.customer_nit ? `<div style="font-size:10px;color:#64748b">NIT: ${cot.customer_nit}</div>` : ''}
    </div>
    <div class="meta-block">
      <div class="meta-title">Documento</div>
      <div class="meta-value"><span class="badge ${cot.document_type === 'CCF' ? 'badge-ccf' : 'badge-cof'}">${cot.document_type}</span></div>
    </div>
    <div class="meta-block">
      <div class="meta-title">Forma de Pago</div>
      <div class="meta-value">${{EFECTIVO:'Efectivo',TARJETA:'Tarjeta',TRANSFERENCIA:'Transferencia',CHEQUE:'Cheque'}[cot.payment_type]||cot.payment_type}</div>
    </div>
    ${cot.created_by_name ? `<div class="meta-block"><div class="meta-title">Preparado por</div><div class="meta-value">${cot.created_by_name}</div></div>` : ''}
  </div>
  <table>
    <thead><tr>${headers}</tr></thead>
    <tbody>${lineRows}</tbody>
  </table>
  <table class="totals">
    <tbody>
      <tr><td style="color:#6b7280">Subtotal s/IVA</td><td style="text-align:right">${fmt(base)}</td></tr>
      <tr><td style="color:#6b7280">IVA 13%</td><td style="text-align:right">${fmt(iva)}</td></tr>
      ${applies ? `<tr><td style="color:#d97706">Retención 1%</td><td style="text-align:right;color:#d97706">-${fmt(ret)}</td></tr>` : ''}
      <tr class="grand"><td>TOTAL A PAGAR</td><td style="text-align:right">${fmt(total)}</td></tr>
    </tbody>
  </table>
  ${cot.notes ? `<div class="notes-box"><strong>Notas:</strong> ${cot.notes}</div>` : ''}
  <div class="footer">
    <div class="footer-note">
      Cotización válida por 15 días. Precios ${isCCF ? 'más' : 'incluyen'} IVA 13%.
      ${applies ? '<br/>Sujeto a retención 1% (Art. 158 Código Tributario).' : ''}
    </div>
    <div class="sign-line">Firma y sello del cliente</div>
  </div>
</div>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};</script>
</body>
</html>`;
};

// ─── Carga paginada de precios ────────────────────────────────────────────────
const loadAllPrices = async () => {
    const all = [];
    let from = 0;
    const size = 1000;
    while (true) {
        const { data, error } = await supabase
            .from('product_precios')
            .select('product_id, id_presentacion, vineta, descuento_1, vip, clinica, mayoreo, premium, precio_7, presentaciones(descripcion)')
            .eq('activo', true)
            .range(from, from + size - 1);
        if (error || !data || data.length === 0) break;
        all.push(...data);
        if (data.length < size) break;
        from += size;
    }
    return all;
};

// ─── Fila de totales helper ────────────────────────────────────────────────────
const Row = ({ label, val, className = 'text-slate-600' }) => (
    <div className="flex justify-between items-center">
        <span className="text-[11px] font-bold text-slate-500">{label}</span>
        <span className={`text-[12px] font-bold ${className}`}>{val}</span>
    </div>
);

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CotizacionesView() {
    const { user, rolePerms } = useAuth();
    // scope ALL → puede elegir cualquier sucursal; BRANCH → bloqueado a la suya
    const canChooseBranch = rolePerms === 'ALL' || rolePerms?.['cotizaciones']?.scope === 'ALL';

    // modo: 'list' | 'new' | 'edit' | 'view'
    const [mode, setMode]       = useState('list');
    const [editingId, setEditingId] = useState(null);

    // Datos maestros
    const [products,    setProducts]    = useState([]);
    const [pricesMap,   setPricesMap]   = useState({});
    const [customers,   setCustomers]   = useState([]);
    const [branches,    setBranches]    = useState([]);
    const [loadingData, setLoadingData] = useState(true);

    // Lista
    const [cotizaciones, setCotizaciones] = useState([]);
    const [loadingList,  setLoadingList]  = useState(true);

    // Vista detalle
    const [selectedCot, setSelectedCot] = useState(null);

    // Formulario
    const [fecha,            setFecha]            = useState(todayStr());
    const [customerId,       setCustomerId]       = useState('');
    const [docType,          setDocType]          = useState('COF');
    const [paymentType,      setPaymentType]      = useState('EFECTIVO');
    const [appliesRetention, setAppliesRetention] = useState(false);
    const [notes,            setNotes]            = useState('');
    const [items,            setItems]            = useState([]);
    const [addProdId,        setAddProdId]        = useState('');
    const [saving,           setSaving]           = useState(false);
    const [saveError,        setSaveError]        = useState('');
    // Sucursal seleccionada en el formulario (admin puede cambiar)
    const [formBranchId,     setFormBranchId]     = useState('');

    // ── Carga inicial ─────────────────────────────────────────────────────────
    useEffect(() => {
        const load = async () => {
            const [prodsRes, pricesData, custRes, branchRes] = await Promise.all([
                supabase.from('products').select('id, nombre').eq('activo', true).order('nombre').limit(8000),
                loadAllPrices(),
                supabase.from('customers').select('id, name, nit').order('name').limit(3000),
                supabase.from('branches').select('id, name').order('name'),
            ]);
            setProducts(prodsRes.data || []);

            const map = {};
            pricesData.forEach(p => {
                const pid = String(p.product_id);
                if (!map[pid]) map[pid] = [];
                map[pid].push({
                    presentacion_id: p.id_presentacion,
                    desc:            p.presentaciones?.descripcion || `Pres. ${p.id_presentacion}`,
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

    // Inicializar sucursal del formulario según el usuario
    useEffect(() => {
        if (!loadingData) {
            setFormBranchId(user?.branchId ? String(user.branchId) : (branches[0] ? String(branches[0].id) : ''));
        }
    }, [loadingData, user?.branchId]);

    // ── Carga lista ───────────────────────────────────────────────────────────
    const loadList = useCallback(async () => {
        setLoadingList(true);
        const { data } = await supabase
            .from('cotizaciones')
            .select('id, numero, fecha, customer_name, document_type, payment_type, total, status, created_by_name, created_by_photo, branch_id')
            .order('created_at', { ascending: false })
            .limit(300);
        setCotizaciones(data || []);
        setLoadingList(false);
    }, []);

    useEffect(() => { loadList(); }, [loadList]);

    // ── Totales ───────────────────────────────────────────────────────────────
    const totals = useMemo(() => calcTotals(items, appliesRetention), [items, appliesRetention]);
    const suggestRetention = docType === 'CCF' && totals.base > RETENTION_THRESHOLD && !appliesRetention;

    // ── Opciones ──────────────────────────────────────────────────────────────
    const productOptions = useMemo(() =>
        products.map(p => ({ value: String(p.id), label: p.nombre })), [products]);

    const customerOptions = useMemo(() => [
        { value: '', label: 'Consumidor Final' },
        ...customers.map(c => ({
            value: String(c.id), label: c.name,
            sublabel: c.nit ? `NIT: ${c.nit}` : undefined,
        })),
    ], [customers]);

    const branchOptions = useMemo(() =>
        branches.map(b => ({ value: String(b.id), label: b.name })), [branches]);

    // ── Helpers de líneas ─────────────────────────────────────────────────────
    const addProduct = useCallback((productId) => {
        if (!productId) return;
        const product = products.find(p => String(p.id) === String(productId));
        if (!product) return;
        const presArr   = pricesMap[String(productId)] || [];
        const firstPres = presArr[0];
        const unitPrice = firstPres ? parseFloat(firstPres['vineta'] || 0) : 0;
        setItems(prev => [...prev, {
            _id:              Date.now() + Math.random(),
            productId:        String(productId),
            productName:      product.nombre,
            presentacionId:   firstPres ? String(firstPres.presentacion_id) : '',
            presentacionDesc: firstPres?.desc || '',
            priceType:        'vineta',
            cantidad:         1,
            precioUnitario:   unitPrice,
            subtotal:         unitPrice,
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
                u.cantidad = Math.max(0, parseFloat(value) || 0);
                u.subtotal = u.cantidad * u.precioUnitario;
            }
            if (field === 'precioUnitario') {
                u.precioUnitario = Math.max(0, parseFloat(value) || 0);
                u.subtotal       = u.precioUnitario * u.cantidad;
            }
            return u;
        }));
    }, [pricesMap]);

    const removeItem = useCallback((id) => setItems(prev => prev.filter(i => i._id !== id)), []);

    // ── Reset formulario ──────────────────────────────────────────────────────
    const resetForm = () => {
        setFecha(todayStr()); setCustomerId(''); setDocType('COF');
        setPaymentType('EFECTIVO'); setAppliesRetention(false);
        setNotes(''); setItems([]); setAddProdId(''); setSaveError('');
        setEditingId(null);
        setFormBranchId(user?.branchId ? String(user.branchId) : (branches[0] ? String(branches[0].id) : ''));
    };

    // ── Shared payload builder ────────────────────────────────────────────────
    const buildPayload = () => {
        const selCustomer = customers.find(c => String(c.id) === String(customerId));
        return {
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
            branch_id:         formBranchId ? parseInt(formBranchId) : (user?.branchId || null),
            created_by:        user?.id    || null,
            created_by_name:   user?.name  || null,
            created_by_photo:  user?.photo || null,
        };
    };

    const buildItemRows = (cotId) => items.map((it, idx) => ({
        cotizacion_id:     cotId,
        product_id:        parseInt(it.productId),
        product_nombre:    it.productName,
        presentacion_id:   it.presentacionId ? parseInt(it.presentacionId) : null,
        presentacion_desc: it.presentacionDesc || null,
        price_type:        it.priceType,
        cantidad:          it.cantidad,
        precio_unitario:   it.precioUnitario,
        subtotal:          it.subtotal,
        sort_order:        idx,
    }));

    const insertItems = async (cotId) => {
        const { error } = await supabase.from('cotizacion_items').insert(buildItemRows(cotId));
        if (error) throw error;
    };

    // ── Guardar nueva ─────────────────────────────────────────────────────────
    const handleSave = async () => {
        if (items.length === 0) { setSaveError('Agrega al menos un producto.'); return; }
        setSaveError(''); setSaving(true);
        try {
            const { data: numData, error: numErr } = await supabase.rpc('next_cotizacion_numero');
            if (numErr) throw numErr;
            const { data: cotData, error: cotErr } = await supabase
                .from('cotizaciones').insert({ numero: numData, ...buildPayload() }).select().single();
            if (cotErr) throw cotErr;
            await insertItems(cotData.id);
            const { data: freshItems } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cotData.id).order('sort_order');
            setSelectedCot({ ...cotData, cotizacion_items: freshItems || [] });
            setMode('view'); resetForm(); loadList();
        } catch (e) { setSaveError(e.message || 'Error al guardar.'); }
        setSaving(false);
    };

    // ── Guardar edición ───────────────────────────────────────────────────────
    const handleUpdate = async () => {
        if (items.length === 0) { setSaveError('Agrega al menos un producto.'); return; }
        setSaveError(''); setSaving(true);
        try {
            const { data: cotData, error: cotErr } = await supabase
                .from('cotizaciones').update({ ...buildPayload(), updated_at: new Date().toISOString() })
                .eq('id', editingId).select().single();
            if (cotErr) throw cotErr;
            await supabase.from('cotizacion_items').delete().eq('cotizacion_id', editingId);
            await insertItems(editingId);
            const { data: freshItems } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', editingId).order('sort_order');
            setSelectedCot({ ...cotData, cotizacion_items: freshItems || [] });
            setMode('view'); resetForm(); loadList();
        } catch (e) { setSaveError(e.message || 'Error al guardar.'); }
        setSaving(false);
    };

    // ── Abrir / Editar / Anular ───────────────────────────────────────────────
    const openCot = async (cot) => {
        const { data } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cot.id).order('sort_order');
        setSelectedCot({ ...cot, cotizacion_items: data || [] });
        setMode('view');
    };

    const startEdit = async (cot) => {
        const { data: itemsData } = await supabase.from('cotizacion_items').select('*').eq('cotizacion_id', cot.id).order('sort_order');
        setFecha(cot.fecha);
        setCustomerId(cot.customer_id ? String(cot.customer_id) : '');
        setDocType(cot.document_type);
        setPaymentType(cot.payment_type);
        setAppliesRetention(cot.applies_retention || false);
        setNotes(cot.notes || '');
        setFormBranchId(cot.branch_id ? String(cot.branch_id) : '');
        setEditingId(cot.id);
        setItems((itemsData || []).map(it => ({
            _id:              Date.now() + Math.random() + it.id,
            productId:        String(it.product_id),
            productName:      it.product_nombre,
            presentacionId:   it.presentacion_id ? String(it.presentacion_id) : '',
            presentacionDesc: it.presentacion_desc || '',
            priceType:        it.price_type || 'vineta',
            cantidad:         parseFloat(it.cantidad),
            precioUnitario:   parseFloat(it.precio_unitario),
            subtotal:         parseFloat(it.subtotal),
        })));
        setMode('edit');
    };

    const handleAnular = async (cotId) => {
        if (!window.confirm('¿Anular esta cotización?')) return;
        await supabase.from('cotizaciones').update({ status: 'ANULADA' }).eq('id', cotId);
        loadList();
        if (selectedCot?.id === cotId) setSelectedCot(prev => ({ ...prev, status: 'ANULADA' }));
    };

    const handlePrint = (cot, itemsData) => {
        const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';
        const win = window.open('', '_blank', 'width=820,height=720');
        if (!win) return;
        win.document.write(buildPrintHTML(cot, itemsData, branchName));
        win.document.close();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // SUB-COMPONENTE: ItemCard
    // ─────────────────────────────────────────────────────────────────────────
    const ItemCard = ({ item, idx, isCCF }) => {
        const presArr     = pricesMap[item.productId] || [];
        const presOptions = presArr.map(p => ({ value: String(p.presentacion_id), label: p.desc }));
        const selPres     = presArr.find(p => String(p.presentacion_id) === String(item.presentacionId));
        const priceOptions = PRICE_COLS
            .filter(pc => selPres && parseFloat(selPres[pc.key] || 0) > 0)
            .map(pc => ({ value: pc.key, label: `${pc.label} — ${fmt(selPres[pc.key])}` }));
        const dsg = desglose(item.precioUnitario, item.cantidad);

        return (
            <div className="bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[9px] font-black text-slate-400 bg-slate-100 rounded-lg px-2 py-1 shrink-0">#{idx + 1}</span>
                        <p className="text-[12px] font-black text-slate-800 leading-tight truncate">{item.productName}</p>
                    </div>
                    <button type="button" onClick={() => removeItem(item._id)}
                        className="w-7 h-7 shrink-0 rounded-xl bg-red-50 text-red-400 border border-red-100 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all flex items-center justify-center">
                        <X size={12} strokeWidth={3} />
                    </button>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="col-span-1">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Presentación</label>
                        <LiquidSelect value={item.presentacionId} onChange={v => updateItem(item._id, 'presentacionId', v)}
                            options={presOptions} placeholder={presOptions.length === 0 ? 'Sin precios' : 'Seleccionar...'}
                            icon={Tag} compact clearable={false} />
                    </div>
                    <div className="col-span-1">
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Tipo Precio</label>
                        <LiquidSelect value={item.priceType} onChange={v => updateItem(item._id, 'priceType', v)}
                            options={priceOptions} placeholder="Precio..." icon={Percent} compact clearable={false} />
                    </div>
                    <div>
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Cantidad</label>
                        <input type="number" min="0" step="0.001" value={item.cantidad}
                            onChange={e => updateItem(item._id, 'cantidad', e.target.value)}
                            className="w-full bg-white/80 border border-white/80 rounded-2xl px-3 py-2.5 text-[12px] font-bold text-slate-800 text-center outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all" />
                    </div>
                    <div>
                        <label className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1 block">P. Unitario (c/IVA)</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">$</span>
                            <input type="number" min="0" step="0.01" value={item.precioUnitario}
                                onChange={e => updateItem(item._id, 'precioUnitario', e.target.value)}
                                className="w-full bg-white/80 border border-white/80 rounded-2xl pl-6 pr-3 py-2.5 text-[12px] font-bold text-slate-800 text-right outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all" />
                        </div>
                    </div>
                </div>
                <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 pt-2 border-t border-dashed border-slate-100 ${isCCF ? '' : 'justify-end'}`}>
                    {isCCF ? (
                        <>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">P. s/IVA</span>
                                <span className="text-[11px] font-black text-slate-600">{fmt(dsg.unitSinIva)}</span>
                            </div>
                            <span className="text-slate-200">|</span>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Subtotal s/IVA</span>
                                <span className="text-[11px] font-black text-slate-600">{fmt(dsg.subtotalSinIva)}</span>
                            </div>
                            <span className="text-slate-200">|</span>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">IVA 13%</span>
                                <span className="text-[11px] font-black text-blue-600">{fmt(dsg.subtotalIva)}</span>
                            </div>
                            <span className="text-slate-200">|</span>
                        </>
                    ) : null}
                    <div className="flex items-center gap-1.5 ml-auto">
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Subtotal</span>
                        <span className="text-[14px] font-black text-[#007AFF]">{fmt(item.subtotal)}</span>
                    </div>
                </div>
            </div>
        );
    };

    // ─────────────────────────────────────────────────────────────────────────
    // FORMULARIO (new / edit)
    // ─────────────────────────────────────────────────────────────────────────
    const isEdit    = mode === 'edit';
    const isCCFMode = docType === 'CCF';

    const FormView = () => (
        <GlassViewLayout icon={Receipt} title={isEdit ? 'Editar Cotización' : 'Nueva Cotización'}
            filtersContent={
                <button onClick={() => { resetForm(); setMode('list'); }}
                    className="flex items-center gap-2 px-4 py-2.5 bg-white/60 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/80 hover:bg-white/80 hover:-translate-y-0.5 active:scale-95 transition-all">
                    <ChevronLeft size={14} strokeWidth={3} /> Lista
                </button>
            }
        >
            <div className="p-4 lg:p-6 space-y-4">

                {/* ── Cabecera ─────────────────────────────────────────────── */}
                <div className="bg-white/50 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-white/60">
                        <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center">
                            <FileText size={16} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-700">Datos Generales</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Fecha</label>
                            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                                className="w-full bg-white/60 border border-white/80 rounded-2xl px-4 py-3 text-[13px] font-bold text-slate-700 outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all" />
                        </div>
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Cliente</label>
                            <LiquidSelect value={customerId}
                                onChange={v => { setCustomerId(v); const c = customers.find(c => String(c.id) === String(v)); if (c?.nit) setDocType('CCF'); }}
                                options={customerOptions} placeholder="Consumidor Final" icon={User} compact />
                        </div>
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Tipo Documento</label>
                            <LiquidSelect value={docType}
                                onChange={v => { setDocType(v); if (v === 'COF') setAppliesRetention(false); }}
                                options={DOC_OPTS} placeholder="Tipo..." icon={FileText} compact clearable={false} />
                        </div>
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Forma de Pago</label>
                            <LiquidSelect value={paymentType} onChange={setPaymentType}
                                options={PAY_OPTS} placeholder="Forma de pago..." icon={CreditCard} compact clearable={false} />
                        </div>
                    </div>

                    {/* Sucursal + Retención + Notas */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        {/* Sucursal */}
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Sucursal</label>
                            {canChooseBranch ? (
                                <LiquidSelect value={formBranchId} onChange={setFormBranchId}
                                    options={branchOptions} placeholder="Seleccionar sucursal..." icon={Building2} compact clearable={false} />
                            ) : (
                                <div className="flex items-center gap-2 bg-white/40 border border-white/60 rounded-2xl px-4 py-3">
                                    <Building2 size={13} className="text-slate-400 shrink-0" />
                                    <span className="text-[12px] font-bold text-slate-600 truncate">
                                        {branches.find(b => String(b.id) === String(formBranchId))?.name || '—'}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Retención */}
                        <div className="flex flex-col gap-2">
                            <div onClick={() => isCCFMode && setAppliesRetention(p => !p)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer select-none transition-all ${!isCCFMode ? 'opacity-40 cursor-not-allowed' : ''} ${appliesRetention ? 'bg-amber-50 border-amber-300' : 'bg-white/40 border-white/60 hover:bg-white/60'}`}>
                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${appliesRetention ? 'bg-amber-500 border-amber-500' : 'border-slate-300'}`}>
                                    {appliesRetention && <CheckCircle2 size={12} strokeWidth={3} className="text-white" />}
                                </div>
                                <div>
                                    <p className="text-[11px] font-black text-slate-700 leading-none">Retención 1%</p>
                                    <p className="text-[9px] font-bold text-slate-400 mt-0.5">Solo CCF — agente de retención</p>
                                </div>
                                {appliesRetention && <span className="ml-auto text-[9px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">ACTIVA</span>}
                            </div>
                            {suggestRetention && (
                                <div onClick={() => setAppliesRetention(true)}
                                    className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-all">
                                    <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                                    <span className="text-[10px] font-bold text-amber-700">Base &gt; $100 en CCF. ¿Aplicar retención?</span>
                                </div>
                            )}
                        </div>

                        {/* Notas */}
                        <div>
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Notas (opcional)</label>
                            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                                placeholder="Observaciones..."
                                className="w-full bg-white/60 border border-white/80 rounded-2xl px-4 py-3 text-[12px] font-bold text-slate-700 placeholder-slate-300 outline-none focus:border-[#007AFF] focus:ring-2 focus:ring-[#007AFF]/10 transition-all" />
                        </div>
                    </div>
                </div>

                {/* ── Productos ─────────────────────────────────────────────── */}
                <div className="bg-white/50 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center">
                                <ShoppingCart size={16} strokeWidth={2.5} />
                            </div>
                            <h3 className="text-[12px] font-black uppercase tracking-widest text-slate-700">
                                Productos
                                {items.length > 0 && <span className="ml-2 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">{items.length}</span>}
                            </h3>
                            {isCCFMode && (
                                <span className="flex items-center gap-1 text-[9px] font-black text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full">
                                    <Info size={10} strokeWidth={3} /> Desglose CCF por línea
                                </span>
                            )}
                        </div>
                        <div className="w-full sm:w-[320px]">
                            {loadingData ? (
                                <div className="flex items-center gap-2 text-[11px] text-slate-400 font-bold"><Loader2 size={13} className="animate-spin" />Cargando catálogo...</div>
                            ) : (
                                <LiquidSelect value={addProdId} onChange={addProduct} options={productOptions}
                                    placeholder="Buscar y agregar producto..." icon={Package} compact clearable={false} />
                            )}
                        </div>
                    </div>

                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
                            <div className="w-12 h-12 rounded-[1rem] bg-slate-50 flex items-center justify-center border border-slate-100"><Package size={22} strokeWidth={1.5} /></div>
                            <p className="text-[12px] font-bold">Busca y selecciona productos</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {items.map((item, idx) => <ItemCard key={item._id} item={item} idx={idx} isCCF={isCCFMode} />)}
                        </div>
                    )}
                </div>

                {/* ── Totales ───────────────────────────────────────────────── */}
                {items.length > 0 && (
                    <div className="flex justify-end">
                        <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm w-full max-w-[380px] space-y-2">
                            <div className="flex items-center gap-2 pb-3 border-b border-white/60 mb-1">
                                <Calculator size={14} className="text-blue-600" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-700">Resumen</h3>
                            </div>
                            <Row label="Subtotal gravado (s/IVA)" val={fmt(totals.base)} />
                            <Row label="IVA 13%" val={fmt(totals.iva)} />
                            {appliesRetention && <Row label="Retención 1%" val={`–${fmt(totals.retention)}`} className="text-amber-600" />}
                            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                                <span className="text-[14px] font-black text-slate-800">TOTAL</span>
                                <span className="text-[22px] font-black text-[#007AFF]">{fmt(totals.total)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {saveError && (
                    <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-[12px] font-bold px-4 py-3 rounded-2xl">
                        <AlertCircle size={16} strokeWidth={2.5} />{saveError}
                    </div>
                )}

                <div className="flex items-center justify-end gap-3 pb-4">
                    <button onClick={() => { resetForm(); setMode('list'); }}
                        className="px-6 py-3 bg-white/60 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/80 hover:bg-white/80 hover:-translate-y-0.5 active:scale-95 transition-all">
                        Cancelar
                    </button>
                    <button onClick={isEdit ? handleUpdate : handleSave} disabled={saving || items.length === 0}
                        className={`flex items-center gap-2 px-7 py-3 text-white text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-lg transition-all ${saving || items.length === 0 ? 'bg-slate-300 cursor-not-allowed' : 'bg-[#007AFF] hover:bg-[#0066DD] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] active:scale-95'}`}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} strokeWidth={2.5} />}
                        {saving ? 'Guardando...' : isEdit ? 'Actualizar Cotización' : 'Guardar Cotización'}
                    </button>
                </div>
            </div>
        </GlassViewLayout>
    );

    // ─────────────────────────────────────────────────────────────────────────
    // VISTA DETALLE
    // ─────────────────────────────────────────────────────────────────────────
    if (mode === 'new' || mode === 'edit') return <FormView />;

    if (mode === 'view' && selectedCot) {
        const cot       = selectedCot;
        const itemsData = cot.cotizacion_items || [];
        const vTotals   = calcTotals(itemsData.map(i => ({ subtotal: i.subtotal })), cot.applies_retention);
        const isCCF     = cot.document_type === 'CCF';
        const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';

        return (
            <GlassViewLayout icon={Receipt} title={cot.numero}
                filtersContent={
                    <div className="flex items-center gap-2 flex-wrap">
                        <button onClick={() => setMode('list')}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white/60 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-white/80 hover:bg-white/80 hover:-translate-y-0.5 active:scale-95 transition-all">
                            <ChevronLeft size={14} strokeWidth={3} /> Lista
                        </button>
                        {cot.status === 'ACTIVA' && (
                            <>
                                <button onClick={() => startEdit(cot)}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-600 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-slate-200 hover:bg-slate-200 hover:-translate-y-0.5 active:scale-95 transition-all">
                                    <Edit2 size={13} strokeWidth={2.5} /> Editar
                                </button>
                                <button onClick={() => handleAnular(cot.id)}
                                    className="px-4 py-2.5 bg-red-50 text-red-500 text-[11px] font-black uppercase tracking-widest rounded-2xl border border-red-100 hover:bg-red-500 hover:text-white hover:-translate-y-0.5 active:scale-95 transition-all">
                                    Anular
                                </button>
                                <button onClick={() => handlePrint(cot, itemsData)}
                                    className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-md hover:bg-[#0066DD] hover:-translate-y-0.5 hover:shadow-[0_6px_20px_rgba(0,122,255,0.4)] active:scale-95 transition-all">
                                    <Printer size={14} strokeWidth={2.5} /> Imprimir / PDF
                                </button>
                            </>
                        )}
                    </div>
                }
            >
                <div className="p-4 lg:p-6 space-y-4">
                    {cot.status === 'ANULADA' && (
                        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 text-[12px] font-bold px-5 py-3.5 rounded-2xl">
                            <X size={16} strokeWidth={3} /> Esta cotización fue anulada.
                        </div>
                    )}

                    {/* Meta info */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {[
                            { icon: User,       label: 'Cliente',       val: cot.customer_name, sub: cot.customer_nit ? `NIT: ${cot.customer_nit}` : '' },
                            { icon: FileText,   label: 'Documento',     val: isCCF ? 'Crédito Fiscal (CCF)' : 'Consumidor Final (COF)' },
                            { icon: CreditCard, label: 'Forma de Pago', val: { EFECTIVO:'Efectivo', TARJETA:'Tarjeta', TRANSFERENCIA:'Transferencia', CHEQUE:'Cheque' }[cot.payment_type] },
                            { icon: Building2,  label: 'Sucursal',      val: branchName || `Suc. ${cot.branch_id}`, sub: fmtD(cot.fecha) },
                        ].map(c => (
                            <div key={c.label} className="bg-white/50 backdrop-blur-sm border border-white/80 rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <c.icon size={11} className="text-slate-400" strokeWidth={2} />
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{c.label}</span>
                                </div>
                                <p className="text-[13px] font-black text-slate-800 leading-tight">{c.val}</p>
                                {c.sub && <p className="text-[10px] font-bold text-slate-400 mt-0.5">{c.sub}</p>}
                            </div>
                        ))}
                    </div>

                    {/* Creador */}
                    {cot.created_by_name && (
                        <div className="flex items-center gap-3 bg-white/40 border border-white/60 rounded-2xl px-4 py-3">
                            <LiquidAvatar src={cot.created_by_photo} fallbackText={cot.created_by_name}
                                className="w-8 h-8 rounded-full shrink-0" />
                            <div>
                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Preparada por</p>
                                <p className="text-[13px] font-black text-slate-700">{cot.created_by_name}</p>
                            </div>
                        </div>
                    )}

                    {/* Items */}
                    <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60">
                                        <th className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">#</th>
                                        <th className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Producto</th>
                                        <th className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-widest text-slate-400">Pres.</th>
                                        <th className="px-4 py-2.5 text-center text-[9px] font-black uppercase tracking-widest text-slate-400">Cant.</th>
                                        {isCCF ? (
                                            <>
                                                <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">P.Unit s/IVA</th>
                                                <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Subtotal s/IVA</th>
                                                <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">IVA 13%</th>
                                                <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Total</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">P.Unit.</th>
                                                <th className="px-4 py-2.5 text-right text-[9px] font-black uppercase tracking-widest text-slate-400">Subtotal</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {itemsData.map((it, i) => {
                                        const dsg = desglose(parseFloat(it.precio_unitario || 0), parseFloat(it.cantidad || 1));
                                        return (
                                            <tr key={it.id || i} className="border-t border-black/[0.04]">
                                                <td className="px-4 py-2.5 text-[11px] font-black text-slate-400">{i + 1}</td>
                                                <td className="px-4 py-2.5 text-[12px] font-bold text-slate-800 max-w-[200px] truncate">{it.product_nombre}</td>
                                                <td className="px-4 py-2.5 text-[11px] text-slate-500">{it.presentacion_desc || '—'}</td>
                                                <td className="px-4 py-2.5 text-center text-[12px] font-bold text-slate-700">{parseFloat(it.cantidad).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
                                                {isCCF ? (
                                                    <>
                                                        <td className="px-4 py-2.5 text-right text-[11px] text-slate-600">{fmt(dsg.unitSinIva)}</td>
                                                        <td className="px-4 py-2.5 text-right text-[11px] text-slate-600">{fmt(dsg.subtotalSinIva)}</td>
                                                        <td className="px-4 py-2.5 text-right text-[11px] text-blue-600">{fmt(dsg.subtotalIva)}</td>
                                                        <td className="px-4 py-2.5 text-right text-[13px] font-black text-slate-800">{fmt(dsg.total)}</td>
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="px-4 py-2.5 text-right text-[12px] text-slate-600">{fmt(it.precio_unitario)}</td>
                                                        <td className="px-4 py-2.5 text-right text-[13px] font-black text-slate-800">{fmt(it.subtotal)}</td>
                                                    </>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Totales */}
                    <div className="flex justify-end">
                        <div className="bg-white/60 backdrop-blur-xl border border-white/80 rounded-[2rem] p-5 shadow-sm w-full max-w-[380px] space-y-2">
                            <div className="flex items-center gap-2 pb-3 border-b border-white/60">
                                <Calculator size={14} className="text-blue-600" />
                                <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-700">Totales</h3>
                            </div>
                            <Row label="Subtotal gravado (s/IVA)" val={fmt(vTotals.base)} />
                            <Row label="IVA 13%" val={fmt(vTotals.iva)} />
                            {cot.applies_retention && <Row label="Retención 1%" val={`–${fmt(vTotals.retention)}`} className="text-amber-600" />}
                            <div className="flex justify-between items-center pt-3 border-t border-slate-100">
                                <span className="text-[14px] font-black text-slate-800">TOTAL</span>
                                <span className="text-[22px] font-black text-[#007AFF]">{fmt(vTotals.total)}</span>
                            </div>
                        </div>
                    </div>

                    {cot.notes && (
                        <div className="bg-amber-50/80 border border-amber-200/60 rounded-2xl px-5 py-4">
                            <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Notas</p>
                            <p className="text-[13px] font-bold text-amber-900">{cot.notes}</p>
                        </div>
                    )}

                    {cot.status === 'ACTIVA' && (
                        <div className="flex justify-end pb-4">
                            <button onClick={() => handlePrint(cot, itemsData)}
                                className="flex items-center gap-2 px-7 py-3.5 bg-[#007AFF] text-white text-[11px] font-black uppercase tracking-widest rounded-2xl shadow-lg hover:bg-[#0066DD] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,122,255,0.4)] active:scale-95 transition-all">
                                <Printer size={16} strokeWidth={2.5} /> Imprimir / Guardar PDF
                            </button>
                        </div>
                    )}
                </div>
            </GlassViewLayout>
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LISTA
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <GlassViewLayout icon={Receipt} title="Cotizaciones"
            filtersContent={
                <button onClick={() => { resetForm(); setMode('new'); }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#007AFF] text-white text-[12px] font-black uppercase tracking-widest rounded-2xl shadow-[0_4px_14px_rgba(0,122,255,0.35)] hover:bg-[#0066DD] hover:-translate-y-0.5 active:scale-95 transition-all">
                    <Plus size={15} strokeWidth={3} /> Nueva Cotización
                </button>
            }
        >
            {/* Stats */}
            <div className="px-5 pt-5 pb-4 flex flex-wrap gap-3">
                {[
                    { label: 'Total',    val: cotizaciones.length,                                                                                      color: 'text-slate-700' },
                    { label: 'Activas',  val: cotizaciones.filter(c => c.status === 'ACTIVA').length,                                                    color: 'text-emerald-600' },
                    { label: 'Anuladas', val: cotizaciones.filter(c => c.status === 'ANULADA').length,                                                   color: 'text-red-500' },
                    { label: 'Monto',    val: fmt(cotizaciones.filter(c => c.status === 'ACTIVA').reduce((s, c) => s + parseFloat(c.total || 0), 0)),    color: 'text-blue-600' },
                ].map(s => (
                    <div key={s.label} className="flex items-center gap-2 bg-white/60 border border-white/80 px-4 py-2.5 rounded-2xl shadow-sm">
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{s.label}</span>
                        <span className={`text-[15px] font-black ${s.color}`}>{s.val}</span>
                    </div>
                ))}
            </div>

            {/* Tabla */}
            {loadingList ? (
                <div className="px-5 pb-5">
                    <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                        <table className="min-w-full text-sm">
                            <tbody>
                                {Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i} className="border-b border-slate-50 last:border-0">
                                        <td className="px-4 py-3"><div className="h-3 w-20 rounded-full bg-slate-100 animate-pulse" /></td>
                                        <td className="px-4 py-3"><div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" /></td>
                                        <td className="px-4 py-3 hidden sm:table-cell"><div className="h-3 w-32 rounded-full bg-slate-100 animate-pulse" /></td>
                                        <td className="px-4 py-3 hidden md:table-cell"><div className="h-3 w-16 rounded-full bg-slate-100 animate-pulse" /></td>
                                        <td className="px-4 py-3 hidden lg:table-cell"><div className="h-3 w-24 rounded-full bg-slate-100 animate-pulse" /></td>
                                        <td className="px-4 py-3 text-right"><div className="h-3 w-16 rounded-full bg-slate-100 animate-pulse ml-auto" /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : cotizaciones.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
                    <div className="w-16 h-16 rounded-[1.5rem] bg-slate-100 flex items-center justify-center"><Receipt size={28} strokeWidth={1.5} /></div>
                    <p className="text-[13px] font-bold">Aún no hay cotizaciones</p>
                </div>
            ) : (
                <div className="px-5 pb-5">
                    <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-white shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="bg-slate-50/95 backdrop-blur-xl border-b border-slate-200/60">
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Número</th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Fecha</th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">Cliente</th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden sm:table-cell">Tipo</th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden lg:table-cell">Sucursal</th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden md:table-cell">Creado por</th>
                                        <th className="px-4 py-2.5 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 hidden sm:table-cell">Estado</th>
                                        <th className="px-4 py-2.5 text-right text-[10px] font-black uppercase tracking-widest text-slate-400">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cotizaciones.map(cot => {
                                        const isAnulada = cot.status === 'ANULADA';
                                        const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';
                                        return (
                                            <tr key={cot.id} onClick={() => openCot(cot)}
                                                className={`border-t border-black/[0.04] cursor-pointer transition-colors ${isAnulada ? 'opacity-50 bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-slate-50/70'}`}>
                                                {/* Número */}
                                                <td className="px-4 py-2.5">
                                                    <span className={`text-[12px] font-black ${isAnulada ? 'line-through text-slate-400' : 'text-[#007AFF]'}`}>{cot.numero}</span>
                                                </td>
                                                {/* Fecha */}
                                                <td className="px-4 py-2.5">
                                                    <p className="text-[12px] font-bold text-slate-700">{fmtD(cot.fecha)}</p>
                                                </td>
                                                {/* Cliente */}
                                                <td className="px-4 py-2.5">
                                                    <p className="text-[12px] text-slate-700 truncate max-w-[160px]">{cot.customer_name}</p>
                                                </td>
                                                {/* Tipo */}
                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md ${cot.document_type === 'CCF' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-700'}`}>
                                                        {cot.document_type}
                                                    </span>
                                                </td>
                                                {/* Sucursal */}
                                                <td className="px-4 py-2.5 hidden lg:table-cell">
                                                    <span className="text-[11px] text-slate-600">{branchName}</span>
                                                </td>
                                                {/* Creado por */}
                                                <td className="px-4 py-2.5 hidden md:table-cell">
                                                    {cot.created_by_name ? (
                                                        <div className="flex items-center gap-2">
                                                            <LiquidAvatar src={cot.created_by_photo} fallbackText={cot.created_by_name}
                                                                className="w-6 h-6 rounded-full shrink-0" />
                                                            <span className="text-[11px] text-slate-600 truncate max-w-[100px]">{cot.created_by_name}</span>
                                                        </div>
                                                    ) : <span className="text-slate-300">—</span>}
                                                </td>
                                                {/* Estado */}
                                                <td className="px-4 py-2.5 hidden sm:table-cell">
                                                    <span className={`text-[9px] font-black px-2 py-1 rounded-full border uppercase tracking-wider ${cot.status === 'ACTIVA' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                                        {cot.status}
                                                    </span>
                                                </td>
                                                {/* Total */}
                                                <td className="px-4 py-2.5 text-right">
                                                    <span className={`text-[13px] font-black ${isAnulada ? 'line-through text-slate-400' : 'text-slate-800'}`}>{fmt(cot.total)}</span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </GlassViewLayout>
    );
}
