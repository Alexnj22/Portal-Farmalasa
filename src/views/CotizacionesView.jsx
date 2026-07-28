import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import {
    FileText, Plus, Printer, Save, Trash2, X,
    ChevronLeft, User, CreditCard, Building2,
    Package, Hash, Receipt, Tag, Percent, CheckCircle2, AlertCircle, ShoppingCart, Calculator,
    Edit2, Info, AlertTriangle, ChevronDown,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import PortalInput from '../components/common/PortalInput';
import LiquidSelect from '../components/common/LiquidSelect';
import LiquidDatePicker from '../components/common/LiquidDatePicker';
import LiquidAvatar from '../components/common/LiquidAvatar';
import ConfirmModal from '../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import {
    fetchAllProductPreciosForCotizaciones, searchProductsActive, searchCustomersByName,
    fetchCotizacionesList, insertCotizacion, updateCotizacion, insertCotizacionItems,
    fetchCotizacionItems, deleteCotizacionItems,
} from '../data/cotizaciones';
import { fetchBranchesBasic } from '../data/system';

// ─── Constantes ───────────────────────────────────────────────────────────────
const IVA_RATE       = 0.13;
const RETENTION_RATE = 0.01;
const RETENTION_THRESHOLD = 100;

const PRICE_COLS = [
    { key: 'vineta',      label: 'Viñeta'     },
    { key: 'descuento_1', label: 'Descuento 1' },
    { key: 'vip',         label: 'VIP'        },
    { key: 'clinica',     label: 'Clínica'    },
    { key: 'mayoreo',     label: 'Mayoreo'    },
    { key: 'premium',     label: 'Premium'    },
    { key: 'precio_7',    label: 'Precio 7'   },
];
// Orden canónico para control de acceso por nivel
const PRICE_LEVEL_ORDER = ['vineta', 'descuento_1', 'vip', 'clinica', 'mayoreo', 'premium', 'precio_7'];

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
// Auditoría 2026-07 Fase 3: escapa texto libre/de negocio antes de interpolarlo
// en el HTML crudo de impresión (document.write) — mismo patrón ya usado en
// FormNovedad.jsx. Sin esto, un customer_name/notes con HTML/script se
// ejecutaba en la ventana de impresión (misma origin que la app).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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
            <td style="padding:7px 5px;font-size:12px;font-weight:600;">${esc(it.product_nombre)}</td>
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
<title>${esc(cot.numero)}</title>
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
      <div class="brand-sub">${esc(branchName || 'La Popular')}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:2px;color:#9ca3af">Cotización</div>
      <div class="cot-num">${esc(cot.numero)}</div>
      <div style="font-size:11px;color:#374151;margin-top:3px">${fmtD(cot.fecha)}</div>
    </div>
  </div>
  <div class="meta">
    <div class="meta-block" style="flex:2">
      <div class="meta-title">Cliente</div>
      <div class="meta-value">${esc(cot.customer_name)}</div>
      ${cot.customer_nit ? `<div style="font-size:10px;color:#64748b">NIT: ${esc(cot.customer_nit)}</div>` : ''}
    </div>
    <div class="meta-block">
      <div class="meta-title">Documento</div>
      <div class="meta-value"><span class="badge ${cot.document_type === 'CCF' ? 'badge-ccf' : 'badge-cof'}">${cot.document_type}</span></div>
    </div>
    <div class="meta-block">
      <div class="meta-title">Forma de Pago</div>
      <div class="meta-value">${{EFECTIVO:'Efectivo',TARJETA:'Tarjeta',TRANSFERENCIA:'Transferencia',CHEQUE:'Cheque'}[cot.payment_type]||cot.payment_type}</div>
    </div>
    ${cot.created_by_name ? `<div class="meta-block"><div class="meta-title">Preparado por</div><div class="meta-value">${esc(cot.created_by_name)}</div></div>` : ''}
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
  ${cot.notes ? `<div class="notes-box"><strong>Notas:</strong> ${esc(cot.notes)}</div>` : ''}
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
const loadAllPrices = async () => (await fetchAllProductPreciosForCotizaciones()) ?? [];

// ─── Fila de totales helper ────────────────────────────────────────────────────
const Row = ({ label, val, className = 'text-content-2' }) => (
    <div className="flex justify-between items-center">
        <span className="text-label font-bold text-content-3">{label}</span>
        <span className={`text-body-sm font-bold ${className}`}>{val}</span>
    </div>
);

// ─── ItemCard (fuera del componente para que React no lo desmonte en re-renders) ──
const ItemCard = React.memo(({ item, idx, isCCF, pricesMap, removeItem, updateItem, allowedPriceCols }) => {
    const presArr     = pricesMap[item.productId] || [];
    const presOptions = presArr.map(p => ({
        value: String(p.presentacion_id),
        label: p.tipoLabel || p.desc,
        ...(p.subdesc ? { sublabel: p.subdesc } : {}),
    }));
    const selPres     = presArr.find(p => String(p.presentacion_id) === String(item.presentacionId));
    const priceOptions = allowedPriceCols
        .filter(pc => selPres && parseFloat(selPres[pc.key] || 0) > 0)
        .map(pc => ({ value: pc.key, label: `${pc.label} — ${fmt(selPres[pc.key])}` }));
    const dsg = desglose(item.precioUnitario, item.cantidad);

    return (
        <div className="bg-surface-card backdrop-blur-sm border border-border-card rounded-2xl p-4 shadow-sm space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Badge size="sm" uppercase={false}>#{idx + 1}</Badge>
                    <p className="text-body-sm font-black text-content leading-tight truncate">{item.productName}</p>
                </div>
                <Button variant="destructive" size="xs" icon={X} iconOnly onClick={() => removeItem(item._id)} />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="col-span-1">
                    <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1 block">Presentación</label>
                    <LiquidSelect value={item.presentacionId} onChange={v => updateItem(item._id, 'presentacionId', v)}
                        options={presOptions} placeholder={presOptions.length === 0 ? 'Sin precios' : 'Seleccionar...'}
                        icon={Tag} compact clearable={false} />
                </div>
                <div className="col-span-1">
                    <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1 block">Tipo Precio</label>
                    <LiquidSelect value={item.priceType} onChange={v => updateItem(item._id, 'priceType', v)}
                        options={priceOptions} placeholder="Precio..." icon={Percent} compact clearable={false} />
                </div>
                {/* La etiqueta era un `<label>` suelto SIN `htmlFor`: no estaba
                    asociada al campo, y por eso hacía falta el `aria-label` de
                    parche. `PortalInput` la asocia de verdad, y desde hoy
                    reenvía `min`/`step`, que antes se habrían perdido. */}
                <PortalInput
                    label="Cantidad"
                    name={`cotiz-cantidad-${item._id}`}
                    type="number" min="0" step="0.001"
                    value={item.cantidad}
                    onChange={e => updateItem(item._id, 'cantidad', e.target.value)}
                    inputClassName="text-center"
                />
                <PortalInput
                    label="P. Unitario (c/IVA)"
                    name={`cotiz-precio-${item._id}`}
                    type="number" min="0" step="0.01" prefix="$"
                    value={item.precioUnitario}
                    onChange={e => updateItem(item._id, 'precioUnitario', e.target.value)}
                    inputClassName="text-right"
                />
            </div>
            <div className={`flex flex-wrap items-center gap-x-5 gap-y-1 pt-2 border-t border-dashed border-divider ${isCCF ? '' : 'justify-end'}`}>
                {isCCF ? (
                    <>
                        <div className="flex items-center gap-1.5">
                            <span className="text-micro font-bold text-content-2 uppercase tracking-wider">P. s/IVA</span>
                            <span className="text-label font-black text-content-2">{fmt(dsg.unitSinIva)}</span>
                        </div>
                        <span className="text-content-3">|</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-micro font-bold text-content-2 uppercase tracking-wider">Subtotal s/IVA</span>
                            <span className="text-label font-black text-content-2">{fmt(dsg.subtotalSinIva)}</span>
                        </div>
                        <span className="text-content-3">|</span>
                        <div className="flex items-center gap-1.5">
                            <span className="text-micro font-bold text-content-2 uppercase tracking-wider">IVA 13%</span>
                            <span className="text-label font-black text-chart-1-text">{fmt(dsg.subtotalIva)}</span>
                        </div>
                        <span className="text-content-3">|</span>
                    </>
                ) : null}
                <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-micro font-bold text-content-2 uppercase tracking-wider">Subtotal</span>
                    <span className="text-body-lg font-black text-brand-text">{fmt(item.subtotal)}</span>
                </div>
            </div>
        </div>
    );
});

// ─── Componente principal ─────────────────────────────────────────────────────
export default function CotizacionesView() {
    const { user, maxPriceLevel, hasPermission, getScope } = useAuth();
    const canEdit   = hasPermission('cotizaciones', 'can_edit');
    const cotScope  = getScope('cotizaciones');

    // Filtrar columnas de precio según el nivel máximo permitido al cargo
    const allowedPriceCols = useMemo(() => {
        if (!maxPriceLevel) return PRICE_COLS;
        const maxIdx = PRICE_LEVEL_ORDER.indexOf(maxPriceLevel);
        if (maxIdx === -1) return PRICE_COLS;
        return PRICE_COLS.filter(c => PRICE_LEVEL_ORDER.indexOf(c.key) <= maxIdx);
    }, [maxPriceLevel]);

    // modo: 'list' | 'new' | 'edit' | 'view'
    const [mode, setMode]       = useState('list');
    const [editingId, setEditingId] = useState(null);

    // Datos maestros
    const [pricesMap, setPricesMap] = useState({});
    const [branches,  setBranches]  = useState([]);

    // Búsqueda de productos (server-side — PostgREST limita a 1000 filas)
    const [productResults,   setProductResults]   = useState([]);
    const [productSearching, setProductSearching] = useState(false);

    // Búsqueda de clientes (server-side — 22 k+ registros)
    const [customerResults,   setCustomerResults]   = useState([]);
    const [customerSearching, setCustomerSearching] = useState(false);
    const [selectedCustomer,  setSelectedCustomer]  = useState(null);

    // Lista
    const [cotizaciones, setCotizaciones] = useState([]);
    const [loadingList,  setLoadingList]  = useState(true);

    // Vista detalle
    const [selectedCot, setSelectedCot] = useState(null);

    // Confirm anular
    const [confirmAnular, setConfirmAnular] = useState(null); // id | null
    const [anulando,      setAnulando]      = useState(false);

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
    // Sucursal seleccionada en el formulario — inicia con la rama del usuario
    const [formBranchId, setFormBranchId] = useState(() =>
        user?.branchId ? String(user.branchId) : ''
    );

    // ── Carga inicial ─────────────────────────────────────────────────────────
    useEffect(() => {
        const load = async () => {
            // Branches: tabla pequeña, carga rápida
            const { data: branchData, error: branchErr } = await fetchBranchesBasic();
            if (branchErr) console.error('CotizacionesView: fetch branches failed:', branchErr.message);
            setBranches(branchData || []);

            // Prices load in background — doesn't block the form
            const pricesData = await loadAllPrices();
            const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
            const map = {};
            pricesData.forEach(p => {
                const pid = String(p.product_id);
                if (!map[pid]) map[pid] = [];
                const tipoLabel = capFirst(p.presentaciones?.tipo || '') || `Pres. ${p.id_presentacion}`;
                const subdesc   = p.descripcion || '';  // per-product, from product_precios
                const desc      = subdesc ? `${tipoLabel} (${subdesc})` : tipoLabel;
                map[pid].push({
                    presentacion_id: p.id_presentacion,
                    tipoLabel,
                    subdesc,
                    desc,
                    vineta:      p.vineta,
                    descuento_1: p.descuento_1,
                    vip:         p.vip,
                    clinica:     p.clinica,
                    mayoreo:     p.mayoreo,
                    premium:     p.premium,
                    precio_7:    p.precio_7,
                });
            });
            // Order comes from the DB query (id_presentacion ASC) — no custom sort
            setPricesMap(map);
        };
        load();
    }, []);

    // ── Búsqueda de productos (server-side) ──────────────────────────────────
    const searchProducts = useCallback(async (term) => {
        if (!term || !term.trim()) { setProductResults([]); return; }
        setProductSearching(true);
        const { data, error } = await searchProductsActive(term.trim());
        if (error) console.error('searchProducts failed:', error.message);
        setProductResults(data || []);
        setProductSearching(false);
    }, []);

    // ── Búsqueda de clientes (server-side) ───────────────────────────────────
    const searchCustomers = useCallback(async (term) => {
        if (!term || !term.trim()) { setCustomerResults([]); return; }
        setCustomerSearching(true);
        const { data, error } = await searchCustomersByName(term.trim());
        if (error) console.error('searchCustomers failed:', error.message);
        setCustomerResults(data || []);
        setCustomerSearching(false);
    }, []);

    const handleCustomerChange = useCallback((v) => {
        setCustomerId(v);
        if (!v) { setSelectedCustomer(null); return; }
        const found = customerResults.find(c => String(c.id) === String(v))
            || (selectedCustomer && String(selectedCustomer.id) === String(v) ? selectedCustomer : null);
        setSelectedCustomer(found || null);
        if (found?.nit) setDocType('CCF');
    }, [customerResults, selectedCustomer]);

    // ── Carga lista ───────────────────────────────────────────────────────────
    const loadList = useCallback(async () => {
        setLoadingList(true);
        const { data } = await fetchCotizacionesList(cotScope === 'BRANCH' && user?.branchId ? user.branchId : null);
        setCotizaciones(data || []);
        setLoadingList(false);
    }, [cotScope, user?.branchId]);

    useEffect(() => { loadList(); }, [loadList]);

    // ── Totales ───────────────────────────────────────────────────────────────
    const totals = useMemo(() => calcTotals(items, appliesRetention), [items, appliesRetention]);
    const suggestRetention = docType === 'CCF' && totals.base > RETENTION_THRESHOLD && !appliesRetention;

    // ── Opciones ──────────────────────────────────────────────────────────────
    const productOptions = useMemo(() =>
        productResults.map(p => ({ value: String(p.id), label: p.nombre })), [productResults]);

    const customerOptions = useMemo(() => {
        const results = customerResults.map(c => ({
            value: String(c.id), label: c.name,
            sublabel: c.nit ? `NIT: ${c.nit}` : undefined,
        }));
        // Keep selected customer visible even when not in current search results
        if (selectedCustomer && !results.find(r => r.value === String(selectedCustomer.id))) {
            results.unshift({
                value: String(selectedCustomer.id),
                label: selectedCustomer.name,
                sublabel: selectedCustomer.nit ? `NIT: ${selectedCustomer.nit}` : undefined,
            });
        }
        return [{ value: '', label: 'Consumidor Final' }, ...results];
    }, [customerResults, selectedCustomer]);

    // ── Helpers de líneas ─────────────────────────────────────────────────────
    const addProduct = useCallback((productId) => {
        if (!productId) return;
        const product = productResults.find(p => String(p.id) === String(productId));
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
    }, [productResults, pricesMap]);

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
        setFormBranchId(user?.branchId ? String(user.branchId) : '');
        setSelectedCustomer(null);
        setCustomerResults([]);
        setProductResults([]);
    };

    // ── Shared payload builder ────────────────────────────────────────────────
    const buildPayload = () => {
        return {
            fecha,
            customer_id:       customerId || null,
            customer_name:     selectedCustomer?.name || 'Consumidor Final',
            customer_nit:      selectedCustomer?.nit  || null,
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
        const { error } = await insertCotizacionItems(buildItemRows(cotId));
        if (error) throw error;
    };

    // ── Guardar nueva ─────────────────────────────────────────────────────────
    const handleSave = async () => {
        if (items.length === 0) { setSaveError('Agrega al menos un producto.'); return; }
        setSaveError(''); setSaving(true);
        try {
            const { data: numData, error: numErr } = await supabase.rpc('next_cotizacion_numero');
            if (numErr) throw numErr;
            const { data: cotData, error: cotErr } = await insertCotizacion({ numero: numData, ...buildPayload() });
            if (cotErr) throw cotErr;
            await insertItems(cotData.id);
            const { data: freshItems, error: freshErr } = await fetchCotizacionItems(cotData.id);
            if (freshErr) console.error('handleSave: fetch fresh items failed:', freshErr.message);
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
            const { data: cotData, error: cotErr } = await updateCotizacion(editingId,
                { ...buildPayload(), updated_at: new Date().toISOString() }, true);
            if (cotErr) throw cotErr;
            await deleteCotizacionItems(editingId);
            await insertItems(editingId);
            const { data: freshItems, error: freshErr } = await fetchCotizacionItems(editingId);
            if (freshErr) console.error('handleUpdate: fetch fresh items failed:', freshErr.message);
            setSelectedCot({ ...cotData, cotizacion_items: freshItems || [] });
            setMode('view'); resetForm(); loadList();
        } catch (e) { setSaveError(e.message || 'Error al guardar.'); }
        setSaving(false);
    };

    // ── Abrir / Editar / Anular ───────────────────────────────────────────────
    const openCot = async (cot) => {
        const { data, error } = await fetchCotizacionItems(cot.id);
        if (error) console.error('openCot: fetch items failed:', error.message);
        setSelectedCot({ ...cot, cotizacion_items: data || [] });
        setMode('view');
    };

    const startEdit = async (cot) => {
        const { data: itemsData, error: itemsErr } = await fetchCotizacionItems(cot.id);
        if (itemsErr) console.error('startEdit: fetch items failed:', itemsErr.message);
        setFecha(cot.fecha);
        setCustomerId(cot.customer_id ? String(cot.customer_id) : '');
        setSelectedCustomer(cot.customer_id ? { id: cot.customer_id, name: cot.customer_name, nit: cot.customer_nit } : null);
        setCustomerResults([]);
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

    const handleAnular = async () => {
        if (!confirmAnular) return;
        setAnulando(true);
        await updateCotizacion(confirmAnular, { status: 'ANULADA' });
        setAnulando(false);
        setConfirmAnular(null);
        loadList();
        if (selectedCot?.id === confirmAnular) setSelectedCot(prev => ({ ...prev, status: 'ANULADA' }));
    };

    const handlePrint = (cot, itemsData) => {
        const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';
        const win = window.open('', '_blank', 'width=820,height=720,noopener');
        if (!win) return;
        win.document.write(buildPrintHTML(cot, itemsData, branchName));
        win.document.close();
    };

    // ─────────────────────────────────────────────────────────────────────────
    // FORMULARIO (new / edit) — JSX devuelto directamente para evitar que React
    // desmonte y remonte el árbol de formulario en cada re-render del padre.
    // ─────────────────────────────────────────────────────────────────────────
    const isEdit    = mode === 'edit';
    const isCCFMode = docType === 'CCF';

    if (mode === 'new' || mode === 'edit') return (
        <GlassViewLayout icon={Receipt} title={isEdit ? 'Editar Cotización' : 'Nueva Cotización'}
            filtersContent={
                <Button variant="secondary" icon={ChevronLeft} onClick={() => { resetForm(); setMode('list'); }}>Lista</Button>
            }
        >
            <div className="p-4 lg:p-6 space-y-4">

                {/* ── Cabecera ─────────────────────────────────────────────── */}
                <div className="bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-5 shadow-sm space-y-4">
                    <div className="flex items-center gap-2.5 pb-3 border-b border-border-card">
                        <div className="w-8 h-8 rounded-xl bg-chart-1/10 text-chart-1-text border border-chart-1/30 flex items-center justify-center">
                            <FileText size={16} strokeWidth={2.5} />
                        </div>
                        <h3 className="text-body-sm font-black uppercase tracking-widest text-content-2">Datos Generales</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5 block">Fecha</label>
                            <div className="w-full bg-surface-card border border-border-card rounded-2xl">
                                <LiquidDatePicker value={fecha} onChange={setFecha} />
                            </div>
                        </div>
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5 block">Cliente</label>
                            <LiquidSelect value={customerId}
                                onChange={handleCustomerChange}
                                onSearchChange={searchCustomers}
                                serverSearch
                                isLoading={customerSearching}
                                options={customerOptions} placeholder="Consumidor Final" icon={User} compact />
                        </div>
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5 block">Tipo Documento</label>
                            <LiquidSelect value={docType}
                                onChange={v => { setDocType(v); if (v === 'COF') setAppliesRetention(false); }}
                                options={DOC_OPTS} placeholder="Tipo..." icon={FileText} compact clearable={false} />
                        </div>
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5 block">Forma de Pago</label>
                            <LiquidSelect value={paymentType} onChange={setPaymentType}
                                options={PAY_OPTS} placeholder="Forma de pago..." icon={CreditCard} compact clearable={false} />
                        </div>
                    </div>

                    {/* Sucursal + Retención + Notas */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                        {/* Sucursal */}
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5 block">Sucursal</label>
                            <div className="flex items-center gap-2 bg-surface-card border border-border-card rounded-2xl px-4 py-3 min-h-[46px]">
                                <Building2 size={13} className="text-content-3 shrink-0" />
                                <span className="text-body-sm font-bold text-content-2 truncate">
                                    {branches.find(b => String(b.id) === String(formBranchId))?.name || '—'}
                                </span>
                            </div>
                        </div>

                        {/* Retención */}
                        <div className="flex flex-col gap-2">
                            <div onClick={() => isCCFMode && setAppliesRetention(p => !p)}
                                className={`flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer select-none transition-all ${!isCCFMode ? 'opacity-40 cursor-not-allowed' : ''} ${appliesRetention ? 'bg-warning/10 border-warning/40' : 'bg-surface-card border-border-card hover:bg-surface-card'}`}>
                                <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center transition-all ${appliesRetention ? 'bg-warning border-warning' : 'border-border-card'}`}>
                                    {appliesRetention && <CheckCircle2 size={12} strokeWidth={3} className="text-white" />}
                                </div>
                                <div>
                                    <p className="text-label font-black text-content-2 leading-none">Retención 1%</p>
                                    <p className="text-micro font-bold text-content-3 mt-0.5">Solo CCF — agente de retención</p>
                                </div>
                                {appliesRetention && <Badge variant="warning" size="sm" uppercase={false} className="ml-auto">ACTIVA</Badge>}
                            </div>
                            {suggestRetention && (
                                <div onClick={() => setAppliesRetention(true)}
                                    className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/30 rounded-xl cursor-pointer hover:bg-warning/10 transition-all">
                                    <AlertTriangle size={12} className="text-warning shrink-0" />
                                    <span className="text-caption font-bold text-warning-text">Base &gt; $100 en CCF. ¿Aplicar retención?</span>
                                </div>
                            )}
                        </div>

                        {/* Notas */}
                        <div>
                            <label className="text-micro font-black text-content-2 uppercase tracking-widest mb-1.5 block">Notas (opcional)</label>
                            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                                placeholder="Observaciones..."
 className="w-full bg-surface-card border border-border-card rounded-2xl px-4 py-3 text-body-xl font-bold text-content-2 placeholder-content-3 focus:border-brand transition-all" />
                        </div>
                    </div>
                </div>

                {/* ── Productos ─────────────────────────────────────────────── */}
                <div className="bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-success/10 text-success border border-success/30 flex items-center justify-center">
                                <ShoppingCart size={16} strokeWidth={2.5} />
                            </div>
                            <h3 className="text-body-sm font-black uppercase tracking-widest text-content-2">
                                Productos
                                {items.length > 0 && <Badge variant="success" uppercase={false}>{items.length}</Badge>}
                            </h3>
                            {isCCFMode && (
                                <Badge variant="chart-1" size="sm" icon={Info} uppercase={false}>Desglose CCF por línea</Badge>
                            )}
                        </div>
                        <div className="w-full sm:w-[320px]">
                            <LiquidSelect value={addProdId} onChange={addProduct}
                                options={productOptions}
                                onSearchChange={searchProducts}
                                serverSearch
                                isLoading={productSearching}
                                placeholder="Buscar y agregar producto..." icon={Package} compact clearable={false} />
                        </div>
                    </div>

                    {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-3 text-content-3">
                            <div className="w-12 h-12 rounded-2xl bg-surface-card-hover flex items-center justify-center border border-divider"><Package size={22} strokeWidth={1.5} /></div>
                            <p className="text-body-sm font-bold">Busca y selecciona productos</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {items.map((item, idx) => (
                                <ItemCard key={item._id} item={item} idx={idx} isCCF={isCCFMode}
                                    pricesMap={pricesMap} removeItem={removeItem} updateItem={updateItem} allowedPriceCols={allowedPriceCols} />
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Totales ───────────────────────────────────────────────── */}
                {items.length > 0 && (
                    <div className="flex justify-end">
                        <div className="bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-5 shadow-sm w-full max-w-[380px] space-y-2">
                            <div className="flex items-center gap-2 pb-3 border-b border-border-card mb-1">
                                <Calculator size={14} className="text-chart-1-text" />
                                <h3 className="text-label font-black uppercase tracking-widest text-content-2">Resumen</h3>
                            </div>
                            <Row label="Subtotal gravado (s/IVA)" val={fmt(totals.base)} />
                            <Row label="IVA 13%" val={fmt(totals.iva)} />
                            {appliesRetention && <Row label="Retención 1%" val={`–${fmt(totals.retention)}`} className="text-warning" />}
                            <div className="flex justify-between items-center pt-3 border-t border-divider">
                                <span className="text-body-lg font-black text-content">TOTAL</span>
                                <span className="text-title-lg font-black text-brand-text">{fmt(totals.total)}</span>
                            </div>
                        </div>
                    </div>
                )}

                {saveError && (
                    <div className="flex items-center gap-3 bg-danger/10 border border-danger/30 text-danger-text text-body-sm font-bold px-4 py-3 rounded-2xl">
                        <AlertCircle size={16} strokeWidth={2.5} />{saveError}
                    </div>
                )}

                <div className="flex items-center justify-end gap-3 pb-4">
                    <Button variant="secondary" onClick={() => { resetForm(); setMode('list'); }}>Cancelar</Button>
                    <Button size="lg" onClick={isEdit ? handleUpdate : handleSave} icon={Save}
                        disabled={saving || items.length === 0} loading={saving}>
                        {saving ? 'Guardando…' : (isEdit ? 'Actualizar Cotización' : 'Guardar Cotización')}
                    </Button>
                </div>
            </div>
        </GlassViewLayout>
    );

    if (mode === 'view' && selectedCot) {
        const cot       = selectedCot;
        const itemsData = cot.cotizacion_items || [];
        const vTotals   = calcTotals(itemsData.map(i => ({ subtotal: i.subtotal })), cot.applies_retention);
        const isCCF     = cot.document_type === 'CCF';
        const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';

        return (<>
            <GlassViewLayout icon={Receipt} title={cot.numero}
                filtersContent={
                    <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="secondary" icon={ChevronLeft} onClick={() => setMode('list')}>Lista</Button>
                        {cot.status === 'ACTIVA' && canEdit && (
                            <>
                                <Button variant="secondary" icon={Edit2} onClick={() => startEdit(cot)}>Editar</Button>
                                <Button variant="destructive" onClick={() => setConfirmAnular(cot.id)}>Anular</Button>
                                <Button icon={Printer} onClick={() => handlePrint(cot, itemsData)}>Imprimir / PDF</Button>
                            </>
                        )}
                    </div>
                }
            >
                <div className="p-4 lg:p-6 space-y-4">
                    {cot.status === 'ANULADA' && (
                        <div className="flex items-center gap-3 bg-danger/10 border border-danger/30 text-danger-text text-body-sm font-bold px-5 py-3.5 rounded-2xl">
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
                            <div key={c.label} className="bg-surface-card backdrop-blur-sm border border-border-card rounded-2xl p-4 shadow-sm">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <c.icon size={11} className="text-content-3" strokeWidth={2} />
                                    <span className="text-micro font-black text-content-2 uppercase tracking-widest">{c.label}</span>
                                </div>
                                <p className="text-body font-black text-content leading-tight">{c.val}</p>
                                {c.sub && <p className="text-caption font-bold text-content-3 mt-0.5">{c.sub}</p>}
                            </div>
                        ))}
                    </div>

                    {/* Creador */}
                    {cot.created_by_name && (
                        <div className="flex items-center gap-3 bg-surface-card border border-border-card rounded-2xl px-4 py-3">
                            <LiquidAvatar src={cot.created_by_photo} fallbackText={cot.created_by_name}
                                className="w-8 h-8 rounded-full shrink-0" />
                            <div>
                                <p className="text-micro font-black text-content-2 uppercase tracking-widest">Preparada por</p>
                                <p className="text-body font-black text-content-2">{cot.created_by_name}</p>
                            </div>
                        </div>
                    )}

                    {/* Items */}
                    <div className="rounded-2xl border border-black/[0.07] overflow-hidden bg-surface-card shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="bg-brand/5 backdrop-blur-xl border-b border-brand/10">
                                        <th className="px-4 py-2.5 text-left text-micro font-black uppercase tracking-widest text-content-2">#</th>
                                        <th className="px-4 py-2.5 text-left text-micro font-black uppercase tracking-widest text-content-2">Producto</th>
                                        <th className="px-4 py-2.5 text-left text-micro font-black uppercase tracking-widest text-content-2">Pres.</th>
                                        <th className="px-4 py-2.5 text-center text-micro font-black uppercase tracking-widest text-content-2">Cant.</th>
                                        {isCCF ? (
                                            <>
                                                <th className="px-4 py-2.5 text-right text-micro font-black uppercase tracking-widest text-content-2">P.Unit s/IVA</th>
                                                <th className="px-4 py-2.5 text-right text-micro font-black uppercase tracking-widest text-content-2">Subtotal s/IVA</th>
                                                <th className="px-4 py-2.5 text-right text-micro font-black uppercase tracking-widest text-content-2">IVA 13%</th>
                                                <th className="px-4 py-2.5 text-right text-micro font-black uppercase tracking-widest text-content-2">Total</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="px-4 py-2.5 text-right text-micro font-black uppercase tracking-widest text-content-2">P.Unit.</th>
                                                <th className="px-4 py-2.5 text-right text-micro font-black uppercase tracking-widest text-content-2">Subtotal</th>
                                            </>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {itemsData.map((it, i) => {
                                        const dsg = desglose(parseFloat(it.precio_unitario || 0), parseFloat(it.cantidad || 1));
                                        return (
                                            <tr key={it.id || i} className="border-t border-black/[0.04]">
                                                <td className="px-4 py-2.5 text-label font-black text-content-3">{i + 1}</td>
                                                <td className="px-4 py-2.5 text-body-sm font-bold text-content max-w-[200px] truncate">{it.product_nombre}</td>
                                                <td className="px-4 py-2.5 text-label text-content-3">{it.presentacion_desc || '—'}</td>
                                                <td className="px-4 py-2.5 text-center text-body-sm font-bold text-content-2">{parseFloat(it.cantidad).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
                                                {isCCF ? (
                                                    <>
                                                        <td className="px-4 py-2.5 text-right text-label text-content-2">{fmt(dsg.unitSinIva)}</td>
                                                        <td className="px-4 py-2.5 text-right text-label text-content-2">{fmt(dsg.subtotalSinIva)}</td>
                                                        <td className="px-4 py-2.5 text-right text-label text-chart-1-text">{fmt(dsg.subtotalIva)}</td>
                                                        <td className="px-4 py-2.5 text-right text-body font-black text-content">{fmt(dsg.total)}</td>
                                                    </>
                                                ) : (
                                                    <>
                                                        <td className="px-4 py-2.5 text-right text-body-sm text-content-2">{fmt(it.precio_unitario)}</td>
                                                        <td className="px-4 py-2.5 text-right text-body font-black text-content">{fmt(it.subtotal)}</td>
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
                        <div className="bg-surface-card backdrop-blur-xl border border-border-card rounded-modal p-5 shadow-sm w-full max-w-[380px] space-y-2">
                            <div className="flex items-center gap-2 pb-3 border-b border-border-card">
                                <Calculator size={14} className="text-chart-1-text" />
                                <h3 className="text-label font-black uppercase tracking-widest text-content-2">Totales</h3>
                            </div>
                            <Row label="Subtotal gravado (s/IVA)" val={fmt(vTotals.base)} />
                            <Row label="IVA 13%" val={fmt(vTotals.iva)} />
                            {cot.applies_retention && <Row label="Retención 1%" val={`–${fmt(vTotals.retention)}`} className="text-warning" />}
                            <div className="flex justify-between items-center pt-3 border-t border-divider">
                                <span className="text-body-lg font-black text-content">TOTAL</span>
                                <span className="text-title-lg font-black text-brand-text">{fmt(vTotals.total)}</span>
                            </div>
                        </div>
                    </div>

                    {cot.notes && (
                        <div className="bg-warning/10 border border-warning/30 rounded-2xl px-5 py-4">
                            <p className="text-micro font-black text-warning uppercase tracking-widest mb-1">Notas</p>
                            <p className="text-body font-bold text-warning-text">{cot.notes}</p>
                        </div>
                    )}

                    {cot.status === 'ACTIVA' && (
                        <div className="flex justify-end pb-4">
                            <Button icon={Printer} onClick={() => handlePrint(cot, itemsData)}>Imprimir / Guardar PDF</Button>
                        </div>
                    )}
                </div>
            </GlassViewLayout>
            <ConfirmModal
                isOpen={!!confirmAnular}
                onClose={() => !anulando && setConfirmAnular(null)}
                onConfirm={handleAnular}
                title="Anular cotización"
                message="Esta acción marcará la cotización como ANULADA y no se podrá reactivar. ¿Deseas continuar?"
                confirmText="Sí, anular"
                cancelText="Cancelar"
                isDestructive
                isProcessing={anulando}
            />
        </>);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // LISTA
    // ─────────────────────────────────────────────────────────────────────────
    return (<>
        <ConfirmModal
            isOpen={!!confirmAnular}
            onClose={() => !anulando && setConfirmAnular(null)}
            onConfirm={handleAnular}
            title="Anular cotización"
            message="Esta acción marcará la cotización como ANULADA y no se podrá reactivar. ¿Deseas continuar?"
            confirmText="Sí, anular"
            cancelText="Cancelar"
            isDestructive
            isProcessing={anulando}
        />
        <GlassViewLayout icon={Receipt} title="Cotizaciones"
            filtersContent={canEdit ? (
                <Button icon={Plus} onClick={() => { resetForm(); setMode('new'); }}>Nueva Cotización</Button>
            ) : undefined}
        >
            {/* Stats */}
            <div className="px-5 pt-5 pb-4 flex flex-wrap gap-3">
                {[
                    { label: 'Total',    val: cotizaciones.length,                                                                                      color: 'text-content-2' },
                    { label: 'Activas',  val: cotizaciones.filter(c => c.status === 'ACTIVA').length,                                                    color: 'text-success' },
                    { label: 'Anuladas', val: cotizaciones.filter(c => c.status === 'ANULADA').length,                                                   color: 'text-danger' },
                    { label: 'Monto',    val: fmt(cotizaciones.filter(c => c.status === 'ACTIVA').reduce((s, c) => s + parseFloat(c.total || 0), 0)),    color: 'text-chart-1-text' },
                ].map(s => (
                    <div key={s.label} className="flex items-center gap-2 bg-surface-card border border-border-card px-4 py-2.5 rounded-2xl shadow-sm">
                        <span className="text-micro font-black uppercase tracking-widest text-content-2">{s.label}</span>
                        <span className={`text-subtitle font-black ${s.color}`}>{s.val}</span>
                    </div>
                ))}
            </div>

            {/* Tabla */}
            <DataTable
                columns={[
                    { key: 'numero',     label: 'Número' },
                    { key: 'fecha',      label: 'Fecha' },
                    { key: 'cliente',    label: 'Cliente' },
                    { key: 'tipo',       label: 'Tipo',       hideBelow: 'sm' },
                    { key: 'sucursal',   label: 'Sucursal',   hideBelow: 'lg' },
                    { key: 'creadopor',  label: 'Creado por', hideBelow: 'md' },
                    { key: 'estado',     label: 'Estado',     hideBelow: 'sm' },
                    { key: 'total',      label: 'Total',      align: 'right' },
                    { key: 'acciones',   label: '' },
                ]}
                loading={loadingList}
                skeletonRows={6}
                empty={{ icon: Receipt, message: 'Aún no hay cotizaciones' }}
                minWidth="600px"
            >
                {cotizaciones.map((cot, i) => {
                    const isAnulada  = cot.status === 'ANULADA';
                    const branchName = branches.find(b => b.id === cot.branch_id)?.name || '';
                    return (
                        <DataRow
                            key={cot.id}
                            index={i}
                            onClick={() => openCot(cot)}
                            className={isAnulada ? 'opacity-50 bg-danger/10' : ''}
                        >
                            <DataCell>
                                <span className={`text-body-sm font-black ${isAnulada ? 'line-through text-content-3' : 'text-brand-text'}`}>{cot.numero}</span>
                            </DataCell>
                            <DataCell>
                                <p className="text-body-sm font-bold text-content-2">{fmtD(cot.fecha)}</p>
                            </DataCell>
                            <DataCell>
                                <p className="text-body-sm text-content-2 truncate max-w-[160px]">{cot.customer_name}</p>
                            </DataCell>
                            <DataCell hideBelow="sm">
                                <Badge variant={cot.document_type === 'CCF' ? 'chart-1' : 'neutral'} size="sm">
                                    {cot.document_type}
                                </Badge>
                            </DataCell>
                            <DataCell hideBelow="lg">
                                <span className="text-label text-content-2">{branchName}</span>
                            </DataCell>
                            <DataCell hideBelow="md">
                                {cot.created_by_name ? (
                                    <div className="flex items-center gap-2">
                                        <LiquidAvatar src={cot.created_by_photo} fallbackText={cot.created_by_name} className="w-6 h-6 rounded-full shrink-0" />
                                        <span className="text-label text-content-2 truncate max-w-[100px]">{cot.created_by_name}</span>
                                    </div>
                                ) : <span className="text-content-3">—</span>}
                            </DataCell>
                            <DataCell hideBelow="sm">
                                <Badge variant={cot.status === 'ACTIVA' ? 'success' : 'neutral'} size="sm">{cot.status}</Badge>
                            </DataCell>
                            <DataCell align="right">
                                <span className={`text-body font-black ${isAnulada ? 'line-through text-content-3' : 'text-content'}`}>{fmt(cot.total)}</span>
                            </DataCell>
                            <DataCell onClick={e => e.stopPropagation()}>
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
                                    {!isAnulada && canEdit && (
                                        <>
                                            <Button variant="secondary" size="xs" icon={Edit2} title="Editar" iconOnly onClick={() => startEdit(cot)} />
                                            <Button tone="chart-1" size="xs" icon={Printer} title="Imprimir / PDF" iconOnly onClick={async () => {
                                                    const { data, error } = await fetchCotizacionItems(cot.id);
                                                    if (error) console.error('print cotizacion: fetch items failed:', error.message);
                                                    handlePrint(cot, data || []);
                                                }} />
                                            <Button variant="destructive" size="xs" icon={Trash2} title="Anular" iconOnly onClick={() => setConfirmAnular(cot.id)} />
                                        </>
                                    )}
                                </div>
                            </DataCell>
                        </DataRow>
                    );
                })}
            </DataTable>
        </GlassViewLayout>
    </>);
}
