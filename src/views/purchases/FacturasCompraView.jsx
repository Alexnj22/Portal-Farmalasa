import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    FileText, Calendar, Tag, Users, RefreshCw, Download, FileJson,
    CheckCircle2, XCircle, AlertTriangle, Eye, Archive, Link2,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import LiquidSelect from '../../components/common/LiquidSelect';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { tokenMatch } from '../../utils/searchUtils';
import { dteTypeLabel, DTE_TYPE_OPTIONS } from '../../utils/dteTypes';
import { openStoredFile } from '../../utils/storageFiles';
import { fetchSuppliersBasic } from '../../data/compras';
import {
    fetchPurchaseDteDocuments, fetchPurchaseDteReviewQueue,
    setPurchaseDteSupplier, resolvePurchaseDteReview, syncPurchaseEmailsNow,
    downloadPurchaseDtePackage, downloadPurchaseDteZipBulk,
} from '../../data/facturasCompra';

const TABS = [
    { key: 'documentos', label: 'Documentos' },
    { key: 'revision',   label: 'Revisión' },
];

const DOC_COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left'   },
    { key: 'tipo',      label: 'Tipo',       align: 'left'   },
    { key: 'numero',    label: 'N° Control', align: 'left',  hideBelow: 'lg' },
    { key: 'proveedor', label: 'Proveedor',  align: 'left'   },
    { key: 'monto',     label: 'Monto',      align: 'right'  },
    { key: 'archivos',  label: '',           align: 'center' },
];

const REVIEW_COLS = [
    { key: 'fecha',    label: 'Recibido',   align: 'left' },
    { key: 'tipo',     label: 'Tipo',       align: 'left' },
    { key: 'remitente', label: 'Remitente', align: 'left', hideBelow: 'md' },
    { key: 'archivo',  label: 'Archivo',    align: 'left' },
    { key: 'acciones', label: '',           align: 'center' },
];

const SIN_PROVEEDOR = '__sin_proveedor__';

const fmt$ = (n) => `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const [y, m, day] = s.split('-');
    if (!y || !m || !day) return '—';
    return `${day}/${m}/${y}`;
};
const fmtDateTime = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function defaultRange() {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 60);
    const iso = (d) => d.toISOString().split('T')[0];
    return { start: iso(start), end: iso(end) };
}

// ── SupplierMatchCell ─────────────────────────────────────────────────────────

function SupplierMatchCell({ row, suppliers, onMatched, canEdit }) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving]   = useState(false);
    const [error, setError]     = useState('');

    if (row.supplier_id) {
        return <span className="text-slate-800 font-medium text-[12px]">{row.supplier_nombre}</span>;
    }

    if (!editing) {
        return (
            <div className="flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-amber-500 shrink-0" title="Sin proveedor emparejado" />
                <span className="text-slate-600 text-[12px]">{row.emisor_nombre || '—'}</span>
                {canEdit && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setError(''); setEditing(true); }}
                        className="text-[10px] font-bold text-[#0052CC] underline shrink-0"
                    >
                        Emparejar
                    </button>
                )}
                {error && <span className="text-[10px] text-red-500">{error}</span>}
            </div>
        );
    }

    return (
        <div className="w-[200px]" onClick={(e) => e.stopPropagation()}>
            <LiquidSelect
                value=""
                onChange={async (val) => {
                    if (!val) { setEditing(false); return; }
                    setSaving(true);
                    try {
                        await setPurchaseDteSupplier(row.id, val);
                        useStaff.getState().appendAuditLog('FACTURAS_COMPRA_MATCH_PROVEEDOR', String(row.id), {
                            codigo_generacion: row.codigo_generacion, supplier_id: val,
                        });
                        onMatched();
                        setEditing(false);
                    } catch (e) {
                        setError(e.message || 'No se pudo guardar');
                        setEditing(false);
                    } finally {
                        setSaving(false);
                    }
                }}
                options={suppliers.map(s => ({ value: s.id, label: s.nombre }))}
                placeholder={saving ? 'Guardando…' : 'Buscar proveedor…'}
                compact
                clearable={false}
            />
        </div>
    );
}

// ── MatchDocumentAction — "Emparejar a documento existente" (solo orphan_pdf) ──

function MatchDocumentAction({ row, documents, onOpen, onMatched }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    if (!open) {
        return (
            <div className="flex items-center gap-1.5">
                <button
                    onClick={() => { onOpen(); setError(''); setOpen(true); }}
                    className="flex items-center gap-1 text-[10px] font-bold text-[#0052CC] hover:text-[#003D99] px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                >
                    <Link2 size={12} /> Emparejar a documento
                </button>
                {error && <span className="text-[10px] text-red-500">{error}</span>}
            </div>
        );
    }

    return (
        <div className="w-[240px]" onClick={(e) => e.stopPropagation()}>
            <LiquidSelect
                value=""
                onChange={async (val) => {
                    if (!val) { setOpen(false); return; }
                    setSaving(true);
                    try {
                        await resolvePurchaseDteReview(row.id, 'emparejado', val);
                        useStaff.getState().appendAuditLog('FACTURAS_COMPRA_EMPAREJAR_REVISION', String(row.id), {
                            matched_document_id: val, filename: row.filename,
                        });
                        onMatched();
                        setOpen(false);
                    } catch (e) {
                        setError(e.message || 'No se pudo emparejar');
                        setOpen(false);
                    } finally {
                        setSaving(false);
                    }
                }}
                options={documents.map(d => ({
                    value: d.id,
                    label: `${fmtDate(d.fecha_emision)} · ${d.supplier_nombre || d.emisor_nombre || '—'} · ${fmt$(d.monto_total)}`,
                }))}
                placeholder={saving ? 'Guardando…' : 'Buscar documento…'}
                compact
                clearable={false}
            />
        </div>
    );
}

// ── TabDocumentos ─────────────────────────────────────────────────────────────

function TabDocumentos({ dateStart, dateEnd, tipoDte, supplierId, searchTerm, refreshKey, openModal, suppliers, canEdit }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchPurchaseDteDocuments(dateStart, dateEnd);
            setRows(data);
        } finally {
            setLoading(false);
        }
    }, [dateStart, dateEnd]);

    useEffect(() => { load(); }, [load, refreshKey]); // eslint-disable-line react-hooks/set-state-in-effect

    const filtered = useMemo(() => {
        return rows.filter(r => {
            if (tipoDte && r.tipo_dte !== tipoDte) return false;
            if (supplierId === SIN_PROVEEDOR) { if (r.supplier_id) return false; }
            else if (supplierId) { if (String(r.supplier_id) !== String(supplierId)) return false; }
            if (searchTerm && !tokenMatch(searchTerm, r.supplier_nombre, r.emisor_nombre, r.numero_control, r.codigo_generacion)) return false;
            return true;
        });
    }, [rows, tipoDte, supplierId, searchTerm]);

    const download = (url, label, row) => {
        if (!url) return;
        openStoredFile(url);
        useStaff.getState().appendAuditLog('FACTURAS_COMPRA_DESCARGA', String(row.id), {
            codigo_generacion: row.codigo_generacion, archivo: label,
        });
    };

    const viewDetail = (row) => {
        openModal?.('viewPurchaseDte', { document: row });
        useStaff.getState().appendAuditLog('FACTURAS_COMPRA_VER_DETALLE', String(row.id), {
            codigo_generacion: row.codigo_generacion,
        });
    };

    const [bulkDownloading, setBulkDownloading] = useState(false);
    const [bulkError, setBulkError] = useState('');
    const downloadPackage = async (row) => {
        setBulkError('');
        try {
            await downloadPurchaseDtePackage(row);
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_DESCARGA_PAQUETE', String(row.id), {
                codigo_generacion: row.codigo_generacion,
            });
        } catch (e) {
            setBulkError(e.message);
        }
    };
    const downloadBulk = async () => {
        setBulkDownloading(true);
        setBulkError('');
        try {
            await downloadPurchaseDteZipBulk(filtered.map(r => r.id));
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_DESCARGA_MASIVA', null, {
                cantidad: filtered.length, dateStart, dateEnd,
            });
        } catch (e) {
            setBulkError(e.message);
        } finally {
            setBulkDownloading(false);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between px-1">
                <div className="text-[11px] text-slate-500 font-medium">
                    {loading ? 'Cargando…' : `${filtered.length.toLocaleString()} documento${filtered.length !== 1 ? 's' : ''}`}
                </div>
                {filtered.length > 0 && (
                    <button
                        onClick={downloadBulk}
                        disabled={bulkDownloading || filtered.length > 300}
                        title={filtered.length > 300 ? 'Máximo 300 documentos — acotá el rango de fechas' : 'Descargar todos los filtrados en un ZIP'}
                        className="flex items-center gap-1.5 text-[11px] font-bold text-[#0052CC] hover:bg-blue-50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                    >
                        <Archive size={12} className={bulkDownloading ? 'animate-pulse' : ''} />
                        {bulkDownloading ? 'Armando ZIP…' : 'Descargar filtrados'}
                    </button>
                )}
            </div>
            {bulkError && <div className="text-[10px] text-red-500 px-1">{bulkError}</div>}

            <DataTable columns={DOC_COLS} loading={loading} empty={{ icon: FileText, message: 'Sin facturas de compra en el período.' }}>
                {filtered.map((row, i) => (
                    <DataRow key={row.id} index={i} onClick={() => viewDetail(row)}>
                        <DataCell>
                            <span className="font-semibold text-slate-700 tabular-nums">{fmtDate(row.fecha_emision)}</span>
                        </DataCell>
                        <DataCell>
                            <span className="text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                {dteTypeLabel(row.tipo_dte)}
                            </span>
                        </DataCell>
                        <DataCell hideBelow="lg">
                            <span className="font-mono text-[10px] text-slate-500">{row.numero_control || '—'}</span>
                        </DataCell>
                        <DataCell>
                            <SupplierMatchCell row={row} suppliers={suppliers} onMatched={load} canEdit={canEdit} />
                        </DataCell>
                        <DataCell align="right">
                            <span className="tabular-nums font-bold text-slate-800">{fmt$(row.monto_total)}</span>
                        </DataCell>
                        <DataCell align="center">
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <button
                                    onClick={() => viewDetail(row)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-[#0052CC] hover:bg-blue-50 transition-colors"
                                    title="Ver detalle"
                                >
                                    <Eye size={14} />
                                </button>
                                <button
                                    onClick={() => download(row.json_path, 'json', row)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-[#0052CC] hover:bg-blue-50 transition-colors"
                                    title="Descargar JSON"
                                >
                                    <FileJson size={14} />
                                </button>
                                <button
                                    onClick={() => download(row.pdf_path, 'pdf', row)}
                                    disabled={!row.pdf_path}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-[#0052CC] hover:bg-blue-50 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                    title={row.pdf_path ? 'Descargar PDF' : 'Sin PDF'}
                                >
                                    <Download size={14} />
                                </button>
                                <button
                                    onClick={() => downloadPackage(row)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-[#0052CC] hover:bg-blue-50 transition-colors"
                                    title="Descargar paquete (JSON+PDF)"
                                >
                                    <Archive size={14} />
                                </button>
                            </div>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}

// ── TabRevision ───────────────────────────────────────────────────────────────

function TabRevision({ searchTerm, refreshKey, bumpRefresh, dateStart, dateEnd, canEdit }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [rowError, setRowError] = useState('');

    // Documentos para el selector de "emparejar" — carga perezosa, solo si
    // alguien realmente abre el matcher (evita el fetch si nadie lo usa).
    // Se resetea si cambia el rango de fechas para no ofrecer una lista vieja.
    const [documents, setDocuments] = useState([]);
    const [documentsLoaded, setDocumentsLoaded] = useState(false);
    useEffect(() => { setDocumentsLoaded(false); }, [dateStart, dateEnd]); // eslint-disable-line react-hooks/set-state-in-effect
    const loadDocuments = useCallback(() => {
        if (documentsLoaded) return;
        setDocumentsLoaded(true);
        fetchPurchaseDteDocuments(dateStart, dateEnd).then(setDocuments);
    }, [documentsLoaded, dateStart, dateEnd]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchPurchaseDteReviewQueue('pendiente');
            setRows(data);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]); // eslint-disable-line react-hooks/set-state-in-effect

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        return rows.filter(r => tokenMatch(searchTerm, r.from_email, r.subject, r.filename, r.reason));
    }, [rows, searchTerm]);

    const openFile = (row) => {
        openStoredFile(row.file_path);
        useStaff.getState().appendAuditLog('FACTURAS_COMPRA_DESCARGA', String(row.id), {
            kind: row.kind, filename: row.filename,
        });
    };

    const discard = async (row) => {
        setRowError('');
        try {
            await resolvePurchaseDteReview(row.id, 'descartado');
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_DESCARTAR_REVISION', String(row.id), {
                kind: row.kind, filename: row.filename,
            });
            bumpRefresh();
        } catch (e) {
            setRowError(e.message || 'No se pudo descartar');
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="text-[11px] text-slate-500 font-medium px-1">
                {loading ? 'Cargando…' : `${filtered.length.toLocaleString()} pendiente${filtered.length !== 1 ? 's' : ''} de revisión`}
            </div>
            {rowError && <div className="text-[10px] text-red-500 px-1">{rowError}</div>}

            <DataTable columns={REVIEW_COLS} loading={loading} empty={{ icon: CheckCircle2, message: 'Nada pendiente de revisión.' }}>
                {filtered.map((row, i) => (
                    <DataRow key={row.id} index={i}>
                        <DataCell>
                            <span className="font-semibold text-slate-700 tabular-nums text-[11px]">{fmtDateTime(row.received_at)}</span>
                        </DataCell>
                        <DataCell>
                            {row.kind === 'orphan_pdf' ? (
                                <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">PDF sin JSON</span>
                            ) : (
                                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full" title={row.reason}>
                                    JSON inválido
                                </span>
                            )}
                        </DataCell>
                        <DataCell hideBelow="md">
                            <span className="text-slate-600 text-[11px]">{row.from_email || '—'}</span>
                        </DataCell>
                        <DataCell>
                            <button
                                onClick={() => openFile(row)}
                                className="text-[11px] font-medium text-[#0052CC] hover:underline truncate max-w-[220px] text-left"
                                title={row.filename}
                            >
                                {row.filename}
                            </button>
                        </DataCell>
                        <DataCell align="center">
                            {canEdit && (
                                <div className="flex items-center justify-center gap-1.5">
                                    {row.kind === 'orphan_pdf' && (
                                        <MatchDocumentAction
                                            row={row}
                                            documents={documents}
                                            onOpen={loadDocuments}
                                            onMatched={bumpRefresh}
                                        />
                                    )}
                                    <button
                                        onClick={() => discard(row)}
                                        className="flex items-center gap-1 text-[10px] font-bold text-red-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                                    >
                                        <XCircle size={12} /> Descartar
                                    </button>
                                </div>
                            )}
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
        </div>
    );
}

// ── FacturasCompraView ────────────────────────────────────────────────────────

export default function FacturasCompraView({ openModal }) {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('facturas_compra', 'can_edit');

    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const activeTab = TABS.some(t => t.key === rawTab) ? rawTab : 'documentos';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    const [search, setSearch] = useState('');
    const range = defaultRange();
    const [dateStart, setDateStart] = useState(range.start);
    const [dateEnd, setDateEnd] = useState(range.end);
    const [tipoDte, setTipoDte] = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [suppliers, setSuppliers] = useState([]);

    const [refreshKey, setRefreshKey] = useState(0);
    const bumpRefresh = () => setRefreshKey(k => k + 1);

    const [syncing, setSyncing] = useState(false);
    const [syncMsg, setSyncMsg] = useState('');

    useEffect(() => { fetchSuppliersBasic().then(({ data }) => setSuppliers(data || [])); }, []);

    const runSyncNow = async () => {
        setSyncing(true);
        setSyncMsg('');
        try {
            const result = await syncPurchaseEmailsNow({ dryRun: false });
            const totals = (result.results || []).reduce((acc, r) => ({
                inserted: acc.inserted + (r.documentsInserted || 0),
                more: acc.more || r.hasMore,
            }), { inserted: 0, more: false });
            setSyncMsg(`${totals.inserted} documento${totals.inserted !== 1 ? 's' : ''} nuevo${totals.inserted !== 1 ? 's' : ''}${totals.more ? ' (quedó más por sincronizar, corré de nuevo)' : ''}`);
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_SYNC_MANUAL', null, { inserted: totals.inserted });
            bumpRefresh();
        } catch (e) {
            setSyncMsg(`Error: ${e.message}`);
        } finally {
            setSyncing(false);
        }
    };

    const filtersContent = (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-2xl bg-white/80 border border-slate-200/70 px-4 py-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-400" />
                    <input type="date" value={dateStart} onChange={e => setDateStart(e.target.value)}
                        className="text-[16px] font-semibold text-slate-700 bg-transparent border-none outline-none cursor-pointer" />
                </div>
                <div className="h-5 w-px bg-slate-100" />
                <div className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-400" />
                    <input type="date" value={dateEnd} onChange={e => setDateEnd(e.target.value)}
                        className="text-[16px] font-semibold text-slate-700 bg-transparent border-none outline-none cursor-pointer" />
                </div>

                {activeTab === 'documentos' && (
                    <>
                        <div className="h-5 w-px bg-slate-100" />
                        <div className="flex items-center gap-1.5">
                            <Tag size={12} className="text-slate-400" />
                            <div className="w-[170px]">
                                <LiquidSelect
                                    value={tipoDte}
                                    onChange={setTipoDte}
                                    options={DTE_TYPE_OPTIONS}
                                    placeholder="Todos los tipos"
                                    compact
                                    bare
                                />
                            </div>
                        </div>
                        <div className="h-5 w-px bg-slate-100" />
                        <div className="flex items-center gap-1.5">
                            <Users size={12} className="text-slate-400" />
                            <div className="w-[190px]">
                                <LiquidSelect
                                    value={supplierId}
                                    onChange={setSupplierId}
                                    options={[{ value: SIN_PROVEEDOR, label: '(sin proveedor)' }, ...suppliers.map(s => ({ value: s.id, label: s.nombre }))]}
                                    placeholder="Todos los proveedores"
                                    compact
                                    bare
                                />
                            </div>
                        </div>
                    </>
                )}

                {canEdit && (
                    <>
                        <div className="h-5 w-px bg-slate-100" />
                        <button
                            onClick={runSyncNow}
                            disabled={syncing}
                            className="flex items-center gap-1.5 text-[11px] font-bold text-[#0052CC] hover:bg-blue-50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
                            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
                        </button>
                    </>
                )}
            </div>
            {syncMsg && <div className="text-[10px] text-slate-500 px-1">{syncMsg}</div>}
        </div>
    );

    return (
        <>
            <ViewTabBar
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                searchValue={search}
                onSearchChange={setSearch}
                showSearch
            />

            <GlassViewLayout icon={FileText} title="Facturas de Compra" filtersContent={filtersContent}>
                {activeTab === 'documentos' && (
                    <TabDocumentos
                        dateStart={dateStart}
                        dateEnd={dateEnd}
                        tipoDte={tipoDte}
                        supplierId={supplierId}
                        searchTerm={search}
                        refreshKey={refreshKey}
                        openModal={openModal}
                        suppliers={suppliers}
                        canEdit={canEdit}
                    />
                )}
                {activeTab === 'revision' && (
                    <TabRevision
                        searchTerm={search}
                        refreshKey={refreshKey}
                        bumpRefresh={bumpRefresh}
                        dateStart={dateStart}
                        dateEnd={dateEnd}
                        canEdit={canEdit}
                    />
                )}
            </GlassViewLayout>
        </>
    );
}
