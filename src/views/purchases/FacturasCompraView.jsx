import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import { useSearchParams } from 'react-router-dom';
import {
    FileText, Tag, RefreshCw, Download, FileJson, ScanSearch,
    CheckCircle2, XCircle, AlertTriangle, Eye, Archive, Link2, X,
    TrendingUp, Receipt, UserX,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import StatCard from '../../components/common/StatCard';
import LiquidSelect from '../../components/common/LiquidSelect';
import PeriodPicker from '../../components/common/PeriodPicker';
import FilterBar from '../../components/common/FilterBar';
import TablePagination from '../../components/common/TablePagination';
import { useAuth } from '../../context/AuthContext';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';
import { tokenMatch, normSearch } from '../../utils/searchUtils';
import { dteTypeLabel, dteAdmiteProveedor } from '../../utils/dteTypes';
import { downloadStoredFile, getSignedFileUrl } from '../../utils/storageFiles';
import { extractCodigoGeneracionFromPdf } from '../../utils/dtePdfCodigo';
import { fetchProveedoresMaestro } from '../../data/proveedores';
import {
    fetchPurchaseDteDocuments, fetchPurchaseDteReviewQueue,
    setPurchaseDteProveedor, resolvePurchaseDteReview, syncPurchaseEmailsNow,
    downloadPurchaseDtePackage, downloadPurchaseDteZipBulk, mergePurchaseDteDocuments,
    findPurchaseDteDocumentByCodigo, classifyPurchaseDteReview,
} from '../../data/facturasCompra';
import { clickable } from '../../utils/clickable';
import LiquidTooltip from '../../components/common/LiquidTooltip';
import { formatMoney } from '../../utils/formatNumber';

const CLASIFICAR_TIPO_OPTIONS = [
    { value: 'anulacion', label: 'Aviso de anulación — marca el DTE como invalidado' },
    { value: 'otro', label: 'Otro documento relacionado — solo vincula' },
];

const TABS = [
    { key: 'documentos', label: 'Documentos' },
    { key: 'revision',   label: 'Revisión' },
];

const DOC_COLS = [
    { key: 'fecha',     label: 'Fecha',      align: 'left',  sortable: true },
    { key: 'proveedor', label: 'Proveedor',  align: 'left',  sortable: true },
    { key: 'tipo',      label: 'Tipo',       align: 'left',  sortable: true },
    { key: 'numero',    label: 'N° Control', align: 'left',  hideBelow: 'lg' },
    { key: 'monto',     label: 'Monto',      align: 'right', sortable: true },
    { key: 'archivos',  label: '',           align: 'center' },
];

const REVIEW_COLS = [
    { key: 'fecha',    label: 'Recibido',   align: 'left' },
    { key: 'tipo',     label: 'Tipo',       align: 'left' },
    { key: 'remitente', label: 'Remitente', align: 'left', hideBelow: 'md' },
    { key: 'archivo',  label: 'Archivo',    align: 'left' },
    { key: 'acciones', label: '',           align: 'center' },
];

const fmt$ = (n) => formatMoney(n || 0);
const fmtMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

// ── ActionButton — ícono arriba + subtítulo chico abajo, mismo patrón para
// todas las acciones de fila en Revisión/Documentos (a pedido del usuario,
// reemplaza los botones de texto+ícono en línea que quedaban apretados). ──

const ACTION_COLORS = {
    slate:   'text-content-3 hover:text-brand-text hover:bg-chart-1/10',
    blue:    'text-brand-text hover:text-brand-hover hover:bg-chart-1/10',
    emerald: 'text-success hover:text-success-text hover:bg-success/10',
    red:     'text-danger hover:text-danger hover:bg-danger/10',
};

function ActionButton({ icon: Icon, label, onClick, title, color = 'slate', disabled = false }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            title={title || label}
            className={`flex flex-col items-center justify-center gap-0.5 w-14 h-12 rounded-xl transition-colors disabled:opacity-40 disabled:pointer-events-none ${ACTION_COLORS[color]}`}
        >
            <Icon size={15} strokeWidth={2.25} />
            <span className="text-micro font-bold uppercase tracking-wide leading-none text-center">{label}</span>
        </button>
    );
}

// Formato "start|end" — mismo contrato que PeriodPicker/monthRange en VentasView.
// Mes actual por defecto (mismo criterio que el preset "Este mes" de
// PeriodPicker: día 1 al último día del mes, no acotado a "hoy").
function defaultDateRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = (n) => String(n).padStart(2, '0');
    const start = `${y}-${pad(m + 1)}-01`;
    const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
    return `${start}|${end}`;
}

// Fase 4 §5 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): si el término buscado
// solo matchea dentro de items_text (no en proveedor/número/código — esos
// campos ya se ven en la fila), devuelve un fragmento corto alrededor del
// primer token encontrado para explicar por qué apareció el documento.
function findItemMatchSnippet(searchTerm, itemsText) {
    if (!searchTerm || !itemsText) return null;
    const tokens = normSearch(searchTerm).split(/\s+/).filter(Boolean);
    const normItems = normSearch(itemsText);
    const hitToken = tokens.find(t => normItems.includes(t));
    if (!hitToken) return null;
    const idx = normItems.indexOf(hitToken);
    const start = Math.max(0, idx - 20);
    const end = Math.min(itemsText.length, idx + hitToken.length + 25);
    return itemsText.slice(start, end).trim();
}

// ── SupplierMatchCell ─────────────────────────────────────────────────────────

function SupplierMatchCell({ row, proveedores, onMatched, canEdit, matchSnippet }) {
    const [editing, setEditing] = useState(false);
    const [saving, setSaving]   = useState(false);
    const [error, setError]     = useState('');

    // Fase 4.4 (PLAN-PROVEEDORES-2026-07.md) + 2.1 (PLAN-MEJORAS-DTE-
    // PROVEEDORES-2026-07.md): el maestro (proveedor_id) es la fuente
    // primaria Y el único destino del match manual — se llena solo desde el
    // DTE, siempre presente para documentos nuevos. El match ERP
    // (supplier_id) queda como dato secundario de solo lectura, solo si
    // difiere del nombre del maestro.
    if (row.proveedor_id) {
        return (
            <div className="min-w-0">
                <span className="text-content font-medium text-body-sm block truncate">{row.proveedor_nombre}</span>
                {row.supplier_id && row.supplier_nombre !== row.proveedor_nombre && (
                    <span className="text-caption text-content-3 truncate block">ERP: {row.supplier_nombre}</span>
                )}
                {/* Fase 4 §5: cuando el match viene del contenido del ítem
                    (ej. "claro" no aparece en proveedor/número pero sí en
                    items_text), mostrar por qué apareció esta fila. */}
                {matchSnippet && (
                    <span className="text-caption text-chart-1-text truncate block" title={matchSnippet}>…{matchSnippet}…</span>
                )}
            </div>
        );
    }

    // H4: en 07/08/09 el emisor es un intermediario financiero (banco,
    // procesador de tarjetas), no un proveedor — el sync los excluye a
    // propósito (_shared/proveedorFromDte.ts). Mostrarlos como "pendiente de
    // emparejar" con un botón que no resuelve nada era una tarea imposible
    // permanente: 143 documentos tipo 09 marcados así, +2/día.
    if (!dteAdmiteProveedor(row.tipo_dte)) {
        return (
            <div className="min-w-0">
                <span className="text-content-2 text-body-sm block truncate">{row.emisor_nombre || '—'}</span>
                <LiquidTooltip content={`${dteTypeLabel(row.tipo_dte)}: el emisor es un intermediario financiero, no un proveedor de compras`}><span className="text-caption text-content-3">No aplica</span></LiquidTooltip>
            </div>
        );
    }

    if (!editing) {
        // Sin proveedor_id — puede o no tener supplier_id (match ERP), pero
        // como el filtro y la fuente primaria ahora son del maestro, en
        // ambos casos hace falta ofrecer "Emparejar" al maestro.
        return (
            <div className="flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-warning shrink-0" title="Sin proveedor emparejado en el maestro" />
                <span className="text-content-2 text-body-sm">{row.supplier_nombre || row.emisor_nombre || '—'}</span>
                {canEdit && (
                    <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setError(''); setEditing(true); }}>Emparejar</Button>
                )}
                {error && <span className="text-caption text-danger-text">{error}</span>}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 w-[228px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 min-w-0">
                <LiquidSelect
                    value=""
                    onChange={async (val) => {
                        if (!val) { setEditing(false); return; }
                        setSaving(true);
                        try {
                            await setPurchaseDteProveedor(row.id, val);
                            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_MATCH_PROVEEDOR', String(row.id), {
                                codigo_generacion: row.codigo_generacion, proveedor_id: val,
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
                    options={proveedores.map(p => ({ value: p.id, label: p.nombre }))}
                    placeholder={saving ? 'Guardando…' : 'Buscar proveedor…'}
                    compact
                    clearable={false}
                />
            </div>
            <Button variant="secondary" icon={X} disabled={saving} title="Cancelar" iconOnly onClick={() => setEditing(false)} />
        </div>
    );
}

// ── DetectCodeAction — Fase 3.2: extrae el Código de Generación (UUID)
// impreso en el PDF (dte_guia_tecnica.pdf pág. 7 — obligatorio en toda
// representación gráfica) y busca si ya existe un documento sincronizado
// con ese código exacto. Genérico: `onFound(matchId)` decide qué hacer con
// el match (emparejar en Revisión, fusionar en Documentos). ──────────────

function DetectCodeAction({ pdfPath, detectedCodigo, serverChecked, onFound, compact = false }) {
    // Fase 3.2: el sync ya detecta el código server-side (unpdf) para todo
    // PDF huérfano nuevo — si ya viene en ai_suggested, no hace falta que el
    // navegador vuelva a bajar/parsear el PDF, solo busca el match. El botón
    // manual (pdfjs-dist client-side) queda como respaldo para filas
    // viejas (nunca revisadas por el sync) o si el servidor no encontró
    // código pero el usuario quiere reintentar.
    const [state, setState] = useState(detectedCodigo ? 'loading' : serverChecked ? 'no_code' : 'idle'); // idle | loading | found | not_found | no_code | error
    const [result, setResult] = useState(null);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        if (!detectedCodigo) return;
        let alive = true;
        (async () => {
            try {
                const match = await findPurchaseDteDocumentByCodigo(detectedCodigo);
                if (!alive) return;
                setResult({ code: detectedCodigo, match });
                setState(match ? 'found' : 'not_found');
            } catch (e) {
                if (alive) { setResult({ error: e.message || 'No se pudo buscar el código' }); setState('error'); }
            }
        })();
        return () => { alive = false; };
    }, [detectedCodigo]);  

    const detect = async () => {
        setState('loading');
        try {
            const signedUrl = await getSignedFileUrl(pdfPath);
            if (!signedUrl) throw new Error('No se pudo obtener el PDF');
            const code = await extractCodigoGeneracionFromPdf(signedUrl);
            if (!code) { setState('no_code'); return; }
            const match = await findPurchaseDteDocumentByCodigo(code);
            setResult({ code, match });
            setState(match ? 'found' : 'not_found');
        } catch (e) {
            setResult({ error: e.message || 'No se pudo detectar el código' });
            setState('error');
        }
    };

    const apply = async () => {
        setApplying(true);
        try {
            await onFound(result.match);
        } catch (e) {
            console.error('FacturasCompraView: aplicar el match fallo:', e);
            useToastStore.getState().showToast('No se pudo aplicar', 'El documento no quedo enlazado. Intenta de nuevo.', 'error');
        } finally {
            setApplying(false);
        }
    };

    if (compact) {
        // Contexto de badge inline (TabDocumentos, fila "Sin JSON") — texto
        // chico subrayado, no la caja ícono+subtítulo (esa es para la
        // columna de acciones dedicada de Revisión).
        if (state === 'idle') {
            return <Button variant="ghost" onClick={(e) => { e.stopPropagation(); detect(); }}>Detectar código</Button>;
        }
        if (state === 'loading') return <span className="text-micro text-content-3 whitespace-nowrap">Analizando…</span>;
        if (state === 'no_code') return <Button variant="ghost" onClick={(e) => { e.stopPropagation(); detect(); }}>Sin código, reintentar</Button>;
        if (state === 'error') return <LiquidTooltip content={result.error}><span className="text-micro text-danger-text whitespace-nowrap">Error al detectar</span></LiquidTooltip>;
        if (state === 'not_found') return <LiquidTooltip content={`Código completo: ${result.code}`}><span className="text-micro text-content-3 whitespace-nowrap">Código sin sincronizar</span></LiquidTooltip>;
        return (
            <Button variant="ghost" disabled={applying} title={`${fmtDate(result.match.fecha_emision)} · ${fmt$(result.match.monto_total)}`} onClick={(e) => { e.stopPropagation(); apply(); }}>{applying ? 'Aplicando…' : `Encontrado: ${result.match.proveedor_nombre || 'match'}`}</Button>
        );
    }

    if (state === 'idle') {
        return (
            <ActionButton
                icon={ScanSearch}
                label="Detectar"
                title="Buscar el código de generación dentro del PDF"
                onClick={(e) => { e.stopPropagation(); detect(); }}
            />
        );
    }
    if (state === 'loading') {
        return (
            <div className="flex flex-col items-center justify-center w-14 h-12 text-content-3">
                <ScanSearch size={15} className="animate-pulse" />
                <span className="text-micro font-bold uppercase tracking-wide leading-none mt-0.5">Analizando</span>
            </div>
        );
    }
    if (state === 'no_code') {
        return (
            <ActionButton
                icon={ScanSearch}
                label="Reintentar"
                title="El PDF no tiene capa de texto legible o no se encontró el patrón de código — reintentar"
                onClick={(e) => { e.stopPropagation(); detect(); }}
            />
        );
    }
    if (state === 'error') {
        return (
            <div className="flex flex-col items-center justify-center w-14 h-12 text-danger" role="img" title={result.error}>
                <AlertTriangle size={15} />
                <span className="text-micro font-bold uppercase tracking-wide leading-none mt-0.5">Error</span>
            </div>
        );
    }
    if (state === 'not_found') {
        return (
            <div className="flex flex-col items-center justify-center w-14 h-12 text-content-3" role="img" title={`Código completo: ${result.code} — sin sincronizar aún`}>
                <ScanSearch size={15} />
                <span className="text-micro font-bold uppercase tracking-wide leading-none mt-0.5">Sin match</span>
            </div>
        );
    }
    return (
        <ActionButton
            icon={CheckCircle2}
            label={applying ? 'Aplicando' : 'Emparejar'}
            color="emerald"
            disabled={applying}
            title={`Encontrado: ${result.match.proveedor_nombre || 'match'} — ${fmtDate(result.match.fecha_emision)} · ${fmt$(result.match.monto_total)}`}
            onClick={(e) => { e.stopPropagation(); apply(); }}
        />
    );
}

// ── MatchDocumentAction — "Emparejar a documento existente" (solo orphan_pdf) ──

function MatchDocumentAction({ row, documents, open, onOpen, onClose, onMatched }) {
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    if (!open) {
        return (
            <div className="flex items-center gap-1.5">
                <ActionButton
                    icon={Link2}
                    label="Emparejar"
                    title="Emparejar a un documento existente"
                    color="blue"
                    onClick={() => { onOpen(); setError(''); }}
                />
                {error && <span className="text-caption text-danger-text">{error}</span>}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 w-[268px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 min-w-0">
                <LiquidSelect
                    value=""
                    onChange={async (val) => {
                        if (!val) { onClose(); return; }
                        setSaving(true);
                        try {
                            await resolvePurchaseDteReview(row.id, 'emparejado', val);
                            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_EMPAREJAR_REVISION', String(row.id), {
                                matched_document_id: val, filename: row.filename,
                            });
                            onMatched();
                        } catch (e) {
                            setError(e.message || 'No se pudo emparejar');
                            onClose();
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
            <Button variant="secondary" icon={X} disabled={saving} title="Cancelar" iconOnly onClick={onClose} />
        </div>
    );
}

// ── ClassifyReviewAction — "Clasificar" (solo orphan_pdf): el usuario elige
// el tipo del PDF (aviso de anulación vs. otro documento relacionado) y el
// DTE al que se enlaza. Reemplaza el botón suelto "Marcar invalidado" que
// vivía en el detalle del documento — sin contexto de qué PDF lo justificaba.
// El efecto (invalidar) es consecuencia de la clasificación, resuelto por
// classify_purchase_dte_review (ver migración 20260722170000). ────────────

function ClassifyReviewAction({ row, documents, open, onOpen, onClose, onClassified }) {
    const [tipo, setTipo] = useState('anulacion');
    const [documentId, setDocumentId] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    if (!open) {
        return (
            <div className="flex items-center gap-1.5">
                <ActionButton
                    icon={Tag}
                    label="Clasificar"
                    title="Clasificar este PDF (ej. aviso de anulación) y vincularlo al DTE que afecta"
                    color="slate"
                    onClick={() => { onOpen(); setError(''); setTipo('anulacion'); setDocumentId(''); }}
                />
                {error && <span className="text-caption text-danger-text">{error}</span>}
            </div>
        );
    }

    const confirm = async () => {
        if (!documentId) return;
        setSaving(true);
        setError('');
        try {
            await classifyPurchaseDteReview(row.id, documentId, tipo);
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_CLASIFICAR_REVISION', String(row.id), {
                matched_document_id: documentId, tipo, filename: row.filename,
            });
            onClassified();
        } catch (e) {
            setError(e.message || 'No se pudo clasificar');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex items-center gap-1.5 w-[360px]" onClick={(e) => e.stopPropagation()}>
            <div className="w-[168px] shrink-0">
                <LiquidSelect
                    value={tipo}
                    onChange={setTipo}
                    options={CLASIFICAR_TIPO_OPTIONS}
                    compact
                    clearable={false}
                />
            </div>
            <div className="flex-1 min-w-0">
                <LiquidSelect
                    value={documentId}
                    onChange={setDocumentId}
                    options={documents.map(d => ({
                        value: d.id,
                        label: `${fmtDate(d.fecha_emision)} · ${d.supplier_nombre || d.emisor_nombre || '—'} · ${fmt$(d.monto_total)}`,
                    }))}
                    placeholder="Documento DTE…"
                    compact
                    clearable={false}
                />
            </div>
            {error && <span className="text-caption text-danger-text shrink-0">{error}</span>}
            <Button tone="success" icon={CheckCircle2} disabled={saving || !documentId} title="Confirmar clasificación" iconOnly onClick={confirm} />
            <Button variant="secondary" icon={X} disabled={saving} title="Cancelar" iconOnly onClick={onClose} />
        </div>
    );
}

// ── AttachJsonAction — Fase 3.2: fusionar un doc "Sin JSON" con su duplicado
// (llegó por correo aparte con el JSON completo). Sin match automático (las
// filas sin JSON no guardan numero_control/monto/fecha/NIT) — el usuario
// busca y elige el duplicado a mano. ───────────────────────────────────────

function AttachJsonAction({ row, candidates, onMerged }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Lista amplia a propósito (cualquier doc con JSON del período, tenga o
    // no su propio PDF) — un reenvío que trae PDF+JSON juntos crea una fila
    // YA completa (con su propio pdf_path), y esa fila sigue siendo un
    // candidato válido de fusión aunque no sea un "JSON huérfano". Filtrar
    // por "sin PDF propio" excluiría justo ese caso. Para reducir el ruido
    // sin ese riesgo, se ordena por cercanía de fecha al correo original
    // (received_at) — el más probable aparece primero, el buscador del
    // select sigue disponible para el resto.
    const sortedCandidates = useMemo(() => {
        const anchor = row.received_at ? new Date(row.received_at).getTime() : null;
        if (anchor === null) return candidates;
        return [...candidates].sort((a, b) => {
            const da = a.received_at ? Math.abs(new Date(a.received_at).getTime() - anchor) : Infinity;
            const db = b.received_at ? Math.abs(new Date(b.received_at).getTime() - anchor) : Infinity;
            return da - db;
        });
    }, [candidates, row.received_at]);

    if (!open) {
        return (
            <div className="flex items-center gap-1.5">
                <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setError(''); setOpen(true); }}>Adjuntar JSON</Button>
                {error && <span className="text-caption text-danger-text">{error}</span>}
            </div>
        );
    }

    return (
        <div className="flex items-center gap-1.5 w-[268px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex-1 min-w-0">
                <LiquidSelect
                    value=""
                    onChange={async (val) => {
                        if (!val) { setOpen(false); return; }
                        setSaving(true);
                        try {
                            await mergePurchaseDteDocuments(row.id, val);
                            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_ADJUNTAR_JSON', String(row.id), {
                                source_document_id: val,
                            });
                            onMerged();
                            setOpen(false);
                        } catch (e) {
                            setError(e.message || 'No se pudo fusionar');
                            setOpen(false);
                        } finally {
                            setSaving(false);
                        }
                    }}
                    options={sortedCandidates.map(d => ({
                        value: d.id,
                        label: `${fmtDate(d.fecha_emision)} · ${d.proveedor_nombre || d.supplier_nombre || d.emisor_nombre || '—'} · ${fmt$(d.monto_total)}`,
                    }))}
                    placeholder={saving ? 'Guardando…' : 'Buscar documento duplicado…'}
                    compact
                    clearable={false}
                />
            </div>
            <Button variant="secondary" icon={X} disabled={saving} title="Cancelar" iconOnly onClick={() => setOpen(false)} />
        </div>
    );
}

// ── TabDocumentos ─────────────────────────────────────────────────────────────

function TabDocumentos({
    dateRange, setDateRange,
    searchTerm, refreshKey, openModal, proveedores, canEdit, showCards,
    syncing, syncProgress, runSyncNow,
}) {
    const [dateStart, dateEnd] = dateRange.split('|');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [sortCol, setSortCol] = useState('fecha');
    const [sortDir, setSortDir] = useState('desc');
    // Reemplazan los selects de Tipo/Proveedor (pedido del usuario
    // 2026-07-22: "ya en el buscador los filtra" — Tipo vía dteTypeLabel,
    // Proveedor vía proveedor_nombre/supplier_nombre, ambos ya en
    // tokenMatch abajo). Sin embargo "sin proveedor" (documentos que
    // necesitan emparejarse a mano, ver SupplierMatchCell) no tiene
    // equivalente de texto libre — se conserva como quick-filter clickeable
    // en la card de abajo en vez de un select dedicado.
    const [filterInvalidados, setFilterInvalidados] = useState(false);
    const [filterSinProveedor, setFilterSinProveedor] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchPurchaseDteDocuments(dateStart, dateEnd);
            setRows(data);
        } catch (e) {
            console.error('FacturasCompraView.jsx: ', e);
            useToastStore.getState().showToast('No se pudieron cargar los documentos', 'Revisa la conexión e intenta de nuevo.', 'error');
        } finally {
            setLoading(false);
        }
    }, [dateStart, dateEnd]);

    useEffect(() => { load(); }, [load, refreshKey]);  

    // Cards contables — ver StatCard más abajo. Se calculan sobre TODO el
    // período (rows), no sobre `filtered`, para que no cambien solo porque
    // el usuario tipeó algo en el buscador (mismo criterio que VentasView).
    // Los invalidados se EXCLUYEN de los totales monetarios (Art. 119-E CT:
    // no amparan crédito fiscal) y se muestran aparte, no restados en
    // silencio. Las Notas de Crédito (tipo 05) entran en negativo — es la
    // única corrección con signo que trae el propio documento; Notas de
    // Débito y el resto de tipos sí suman en positivo.
    const cardStats = useMemo(() => {
        let totalCompras = 0, creditoFiscal = 0, comprasNetas = 0;
        let invalidadosCount = 0, invalidadosMonto = 0, sinProveedorCount = 0;
        for (const r of rows) {
            const monto = parseFloat(r.monto_total) || 0;
            const iva = parseFloat(r.total_iva) || 0;
            if (r.invalidado) {
                invalidadosCount++;
                invalidadosMonto += monto;
            } else {
                const sign = r.tipo_dte === '05' ? -1 : 1;
                totalCompras += monto;
                creditoFiscal += sign * iva;
                comprasNetas += sign * monto;
            }
            // H4: solo cuenta como pendiente lo que el sync PUEDE emparejar.
            if (!r.proveedor_id && dteAdmiteProveedor(r.tipo_dte)) sinProveedorCount++;
        }
        return { totalCompras, creditoFiscal, comprasNetas, invalidadosCount, invalidadosMonto, sinProveedorCount };
    }, [rows]);

    const filtered = useMemo(() => {
        return rows.filter(r => {
            if (filterInvalidados && !r.invalidado) return false;
            // H4: mismo criterio que la card — los tipos sin proveedor posible
            // no son "pendientes", así que tampoco entran a este filtro.
            if (filterSinProveedor && (r.proveedor_id || !dteAdmiteProveedor(r.tipo_dte))) return false;
            // "nota de credito"/"anulado" no matcheaban — el buscador solo
            // conocía el tipo_dte crudo ("05") y la palabra "invalidado",
            // nunca la etiqueta legible ni el sinónimo que usa el resto del
            // módulo (pedido del usuario 2026-07-22).
            if (searchTerm && !tokenMatch(searchTerm, r.proveedor_nombre, r.proveedor_alias, r.supplier_nombre, r.emisor_nombre, r.emisor_nit, r.numero_control, r.codigo_generacion, r.items_text, dteTypeLabel(r.tipo_dte), r.invalidado ? 'invalidado anulado' : null)) return false;
            return true;
        });
    }, [rows, filterInvalidados, filterSinProveedor, searchTerm]);

    useEffect(() => { setPage(1); }, [dateStart, dateEnd, filterInvalidados, filterSinProveedor, searchTerm]);  

    // Fase 3.2: candidatos para "Adjuntar JSON" — documentos con JSON completo
    // dentro del mismo rango de fechas ya cargado (no dispara un fetch aparte).
    const jsonDocs = useMemo(() => rows.filter(r => r.json_path), [rows]);

    const sorted = useMemo(() => {
        const dir = sortDir === 'asc' ? 1 : -1;
        const val = (r) => {
            switch (sortCol) {
                case 'fecha':     return r.fecha_emision || '';
                case 'proveedor': return (r.proveedor_nombre || r.supplier_nombre || r.emisor_nombre || '').toLowerCase();
                case 'tipo':      return (dteTypeLabel(r.tipo_dte) || '').toLowerCase();
                case 'monto':     return parseFloat(r.monto_total || 0);
                default:          return '';
            }
        };
        return [...filtered].sort((a, b) => {
            const av = val(a), bv = val(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        });
    }, [filtered, sortCol, sortDir]);

    const handleSort = (col) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir(col === 'monto' || col === 'fecha' ? 'desc' : 'asc'); }
        setPage(1);
    };

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const pageRows = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

    const download = (url, label, row) => {
        if (!url) return;
        downloadStoredFile(url, `${row.codigo_generacion || `doc-${row.id}`}.${label}`);
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

    // Fase 3.2: código detectado en el PDF de un doc "Sin JSON" ya tiene un
    // documento sincronizado con ese codigo_generacion — fusiona directo.
    // Reusa bulkError (arriba de la tabla) para el mensaje — no amerita un
    // slot de error propio para un caso de borde.
    const mergePorCodigo = async (row, match) => {
        setBulkError('');
        try {
            await mergePurchaseDteDocuments(row.id, match.id);
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_ADJUNTAR_JSON', String(row.id), {
                source_document_id: match.id, via: 'detect_code',
            });
            load();
        } catch (e) {
            setBulkError(e.message || 'No se pudo fusionar');
        }
    };

    const [bulkDownloading, setBulkDownloading] = useState(false);
    const [bulkProgress, setBulkProgress] = useState(null); // {received, total} en bytes
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
        setBulkProgress(null);
        try {
            await downloadPurchaseDteZipBulk(
                filtered.map(r => r.id),
                ({ received, total }) => setBulkProgress(total > 0 ? { received, total } : null),
            );
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_DESCARGA_MASIVA', null, {
                cantidad: filtered.length, dateStart, dateEnd,
            });
            useToastStore.getState().showToast('Descarga completa', `${filtered.length.toLocaleString()} documento${filtered.length !== 1 ? 's' : ''} en el ZIP.`, 'success');
        } catch (e) {
            setBulkError(e.message);
        } finally {
            setBulkDownloading(false);
            setBulkProgress(null);
        }
    };

    const dateDirty = dateRange !== defaultDateRange();

    return (
        <div className="p-5 md:p-6 space-y-5">
            {/* Cards contables (izquierda, se reparten el ancho) + pill de
                fecha/descarga/sync (derecha, ancho fijo) — mismo patrón que
                VentasView/StaffManagementView. */}
            <div className={`flex items-stretch gap-3 flex-wrap ${showCards ? '' : 'justify-end'}`}>
                {showCards && (
                <div className="flex items-stretch gap-3 flex-wrap">
                    <StatCard
                        icon={FileText} label="Total Compras" value={fmt$(cardStats.totalCompras)}
                        sub={`${rows.length.toLocaleString()} documento${rows.length !== 1 ? 's' : ''}`}
                        iconBg="bg-chart-1/10" iconCls="text-chart-1-text" valueCls="text-chart-1-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={Receipt} label="Crédito Fiscal IVA" value={fmt$(cardStats.creditoFiscal)}
                        sub="excluye invalidados"
                        iconBg="bg-success/10" iconCls="text-success" valueCls="text-success-text"
                        loading={loading}
                    />
                    <StatCard
                        icon={TrendingUp} label="Compras Netas" value={fmt$(cardStats.comprasNetas)}
                        sub="tras Notas de Crédito"
                        iconBg="bg-surface-card-hover" iconCls="text-content-3" valueCls="text-content-2"
                        loading={loading}
                    />
                    <StatCard
                        icon={XCircle} label="Invalidados" value={cardStats.invalidadosCount}
                        sub={cardStats.invalidadosCount > 0 ? fmt$(cardStats.invalidadosMonto) : 'sin invalidados'}
                        iconBg="bg-danger/10" iconCls="text-danger" valueCls="text-danger-text"
                        activeBg="bg-danger/10 border-danger/40 shadow-md"
                        onClick={cardStats.invalidadosCount > 0 ? () => setFilterInvalidados(v => !v) : undefined}
                        active={filterInvalidados}
                        loading={loading}
                    />
                    <StatCard
                        icon={UserX} label="Sin Proveedor" value={cardStats.sinProveedorCount}
                        sub="pendiente de emparejar"
                        iconBg="bg-warning/10" iconCls="text-warning" valueCls="text-warning-text"
                        activeBg="bg-warning/10 border-warning/40 shadow-md"
                        onClick={cardStats.sinProveedorCount > 0 ? () => setFilterSinProveedor(v => !v) : undefined}
                        active={filterSinProveedor}
                        loading={loading}
                    />
                </div>
                )}

            {/* §17 — la barra FILTRA; las acciones van fuera de ella.
                Acá estaban las dos adentro ("Descargar" y "Sincronizar"), así
                que leían como un filtro más: en la misma píldora, separadas por
                el mismo divisor, con la misma forma. Es el hallazgo que ya se
                corrigió en Staff en v2.97.0 y que a esta vista no llegó. */}
            <div className="flex items-center justify-end gap-2 flex-wrap shrink-0">
                {filtered.length > 0 && (
                    <Button variant="secondary" size="sm" icon={Download} disabled={bulkDownloading}
                        title="Descargar todos los filtrados en un ZIP" onClick={downloadBulk}>
                        {bulkProgress?.total > 0
                            ? `Descargando… ${fmtMB(bulkProgress.received)} / ${fmtMB(bulkProgress.total)}`
                            : bulkDownloading ? 'Armando ZIP…' : 'Descargar'}
                    </Button>
                )}
                {canEdit && (
                    <Button variant="secondary" size="sm" icon={RefreshCw} loading={syncing}
                        disabled={syncing} onClick={runSyncNow}>
                        {syncing ? (syncProgress ? `Sincronizando (tanda ${syncProgress.batch})` : 'Sincronizando') : 'Sincronizar'}
                    </Button>
                )}

                {/* H14: los quick-filters de las cards (Invalidados / Sin
                    Proveedor) SON filtros — deben contar en el badge y
                    apagarse con "Limpiar". Faltaba filterInvalidados en ambos:
                    con la card activa la barra decía que no había filtros y
                    "Limpiar" no la apagaba, así que la tabla quedaba recortada
                    sin ninguna señal de por qué. */}
                <FilterBar
                    onClear={() => { setDateRange(defaultDateRange()); setFilterSinProveedor(false); setFilterInvalidados(false); }}
                    activeCount={[dateDirty, filterSinProveedor, filterInvalidados].filter(Boolean).length}
                >
                    <FilterBar.Section active={dateDirty} onClear={() => setDateRange(defaultDateRange())} label="período">
                        <PeriodPicker value={dateRange} onChange={setDateRange} placeholder="Período" />
                    </FilterBar.Section>
                </FilterBar>
            </div>
            </div>

            {bulkError && <div className="text-caption text-danger-text px-1">{bulkError}</div>}

            <DataTable columns={DOC_COLS} sortKey={sortCol} sortDir={sortDir} onSort={handleSort} loading={loading} empty={{ icon: FileText, message: 'Sin facturas de compra en el período' }}>
                {pageRows.map((row, i) => (
                    <DataRow key={row.id} index={i} onClick={() => viewDetail(row)}>
                        <DataCell>
                            <span className="font-semibold text-content-2 tabular-nums">{fmtDate(row.fecha_emision)}</span>
                        </DataCell>
                        <DataCell>
                            <SupplierMatchCell
                                row={row}
                                proveedores={proveedores}
                                onMatched={load}
                                canEdit={canEdit}
                                matchSnippet={
                                    searchTerm && !tokenMatch(searchTerm, row.proveedor_nombre, row.proveedor_alias, row.supplier_nombre, row.emisor_nombre, row.emisor_nit, row.numero_control, row.codigo_generacion, dteTypeLabel(row.tipo_dte), row.invalidado ? 'invalidado anulado' : null)
                                        ? findItemMatchSnippet(searchTerm, row.items_text)
                                        : null
                                }
                            />
                        </DataCell>
                        <DataCell>
                            <div className="flex items-center gap-1.5 flex-wrap">
                                <Badge size="sm" uppercase={false}>{dteTypeLabel(row.tipo_dte)}</Badge>
                                {row.invalidado && (
                                    <Badge title={`Invalidado por el proveedor${row.invalidado_motivo ? `: ${row.invalidado_motivo}` : ''}${row.invalidado_at ? ` (${fmtDate(row.invalidado_at)})` : ''} — no ampara deducciones (Art. 119-E CT)`} variant="danger" size="sm" icon={XCircle} uppercase={false}>Invalidado</Badge>
                                )}
                                {/* Mismo patrón que "Ver original" (NC/ND) — a pedido del usuario,
                                    caso Jamilu: poder ver el PDF que justificó la anulación sin
                                    tener que abrir el detalle primero (invalidacion_source viene de
                                    classify_purchase_dte_review vía review_queue.matched_document_id). */}
                                {row.invalidado && row.invalidacion_source?.file_path && (
                                    <Button variant="destructive" icon={Link2} title="Ver el PDF que justificó la anulación" onClick={(e) => { e.stopPropagation(); openModal?.('viewDocument', { url: row.invalidacion_source.file_path, title: row.invalidacion_source.filename }); }}>Ver documento</Button>
                                )}
                                {row.notas_credito?.length > 0 && (
                                    <Button tone="warning" icon={Link2} title={`Con Nota de Crédito ${row.notas_credito.map(nc => nc.codigo_generacion).join(', ')}`} onClick={(e) => { e.stopPropagation(); viewDetail(row.notas_credito[0]); }}>NC{row.notas_credito.length > 1 ? ` ×${row.notas_credito.length}` : ''}</Button>
                                )}
                                {/* Inverso del badge NC — desde la NC/ND se puede ver el CCF/Factura
                                    que corrige (a pedido del usuario, misma mecánica que el badge de arriba). */}
                                {row.documento_relacionado && (
                                    <Button tone="chart-1" icon={Link2} title={`Corrige ${dteTypeLabel(row.documento_relacionado.tipo_dte)} ${row.documento_relacionado.codigo_generacion}`} onClick={(e) => { e.stopPropagation(); viewDetail(row.documento_relacionado); }}>Ver original</Button>
                                )}
                                {/* Confirmado desde Revisión sin que su JSON llegara nunca — ver
                                    TabRevision "Confirmar sin JSON" y resolve_purchase_dte_review. */}
                                {!row.json_path && (
                                    <>
                                        <Badge size="sm" title="Este documento se confirmó manualmente desde Revisión sin JSON asociado — no cumple conservación del DTE (Art. 147 CT)">Sin JSON</Badge>
                                        {canEdit && (
                                            <>
                                                <DetectCodeAction
                                                    pdfPath={row.pdf_path}
                                                    onFound={(match) => mergePorCodigo(row, match)}
                                                    compact
                                                />
                                                <AttachJsonAction
                                                    row={row}
                                                    candidates={jsonDocs}
                                                    onMerged={load}
                                                />
                                            </>
                                        )}
                                    </>
                                )}
                            </div>
                        </DataCell>
                        <DataCell hideBelow="lg">
                            <span className="font-mono text-caption text-content-3">{row.numero_control || '—'}</span>
                        </DataCell>
                        <DataCell align="right">
                            <span className="tabular-nums font-bold text-content">{fmt$(row.monto_total)}</span>
                        </DataCell>
                        <DataCell align="center">
                            <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                                <Button tone="chart-1" icon={Eye} title="Ver detalle" iconOnly onClick={() => viewDetail(row)} />
                                <Button tone="chart-1" icon={FileJson} disabled={!row.json_path} title={row.json_path ? 'Descargar JSON' : 'Sin JSON'} iconOnly onClick={() => download(row.json_path, 'json', row)} />
                                <Button tone="chart-1" icon={Download} disabled={!row.pdf_path} title={row.pdf_path ? 'Descargar PDF' : 'Sin PDF'} iconOnly onClick={() => download(row.pdf_path, 'pdf', row)} />
                                <Button tone="chart-1" icon={Archive} title="Descargar paquete (JSON+PDF)" iconOnly onClick={() => downloadPackage(row)} />
                            </div>
                        </DataCell>
                    </DataRow>
                ))}
            </DataTable>
            {!loading && filtered.length > 0 && (
                <TablePagination
                    pageSize={pageSize}
                    onPageSizeChange={setPageSize}
                    page={page}
                    totalPages={totalPages}
                    onPageChange={setPage}
                    total={filtered.length}
                    unit="documentos"
                />
            )}
        </div>
    );
}

// ── TabRevision ───────────────────────────────────────────────────────────────

function TabRevision({ searchTerm, refreshKey, bumpRefresh, dateStart, dateEnd, canEdit, openModal }) {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [rowError, setRowError] = useState('');

    // Documentos para el selector de "emparejar" — carga perezosa, solo si
    // alguien realmente abre el matcher (evita el fetch si nadie lo usa).
    // Se resetea si cambia el rango de fechas para no ofrecer una lista vieja.
    const [documents, setDocuments] = useState([]);
    const [documentsLoaded, setDocumentsLoaded] = useState(false);
    useEffect(() => { setDocumentsLoaded(false); }, [dateStart, dateEnd]);  

    // Solo una acción expandida (Emparejar o Clasificar) a la vez por fila —
    // ambos formularios inline necesitan más ancho del que cabe junto al
    // resto de botones de la columna; al expandir una se ocultan las demás.
    const [expandedAction, setExpandedAction] = useState(null); // { rowId, kind: 'match' | 'classify' }
    // H17: marcaba documentsLoaded ANTES de que el fetch resolviera y no tenía
    // catch — si fallaba, el selector de Emparejar/Clasificar quedaba vacío el
    // resto de la sesión, sin aviso, sin reintento y con una promesa rechazada
    // sin manejar. Ahora el flag se libera ante el error para permitir otro
    // intento al reabrir la acción.
    const loadDocuments = useCallback(() => {
        if (documentsLoaded) return;
        setDocumentsLoaded(true);
        fetchPurchaseDteDocuments(dateStart, dateEnd)
            .then(setDocuments)
            .catch((e) => {
                console.error('FacturasCompraView.jsx: loadDocuments', e);
                setDocumentsLoaded(false);
                useToastStore.getState().showToast('No se pudieron cargar los documentos', 'No se puede emparejar por ahora — reintentá en un momento.', 'error');
            });
    }, [documentsLoaded, dateStart, dateEnd]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchPurchaseDteReviewQueue('pendiente');
            setRows(data);
        } catch (e) {
            console.error('FacturasCompraView.jsx: ', e);
            useToastStore.getState().showToast('No se pudo cargar la cola de revisión', 'Revisa la conexión e intenta de nuevo.', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);  

    const filtered = useMemo(() => {
        if (!searchTerm) return rows;
        return rows.filter(r => tokenMatch(searchTerm, r.from_email, r.subject, r.filename, r.reason));
    }, [rows, searchTerm]);

    // Abre el PDF/JSON en el modal del portal (viewDocument, mismo visor que
    // Expediente/RRHH) en vez de una pestaña nueva del navegador — pedido
    // del usuario, coherente con "Ver detalle" de Documentos.
    const openFile = (row) => {
        openModal?.('viewDocument', { url: row.file_path, title: row.filename });
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

    // Confirmar un PDF huérfano AUNQUE nunca llegue su JSON — crea el
    // documento igual, sin codigo_generacion/tipo_dte (badge "Sin JSON" en
    // Documentos, ver DOC_COLS).
    const confirmSinJson = async (row) => {
        setRowError('');
        try {
            await resolvePurchaseDteReview(row.id, 'confirmado');
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_CONFIRMAR_SIN_JSON', String(row.id), {
                kind: row.kind, filename: row.filename,
            });
            bumpRefresh();
        } catch (e) {
            setRowError(e.message || 'No se pudo confirmar');
        }
    };

    // Fase 3.2: código detectado en el PDF ya tiene un documento
    // sincronizado con ese codigo_generacion exacto — empareja directo, sin
    // pasar por "confirmado sin JSON" en absoluto.
    const emparejarPorCodigo = async (row, match) => {
        setRowError('');
        try {
            await resolvePurchaseDteReview(row.id, 'emparejado', match.id);
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_EMPAREJAR_REVISION', String(row.id), {
                matched_document_id: match.id, filename: row.filename, via: 'detect_code',
            });
            bumpRefresh();
        } catch (e) {
            setRowError(e.message || 'No se pudo emparejar');
        }
    };

    return (
        <div className="p-5 md:p-6 space-y-5">
            <div className="text-label text-content-3 font-medium px-1">
                {loading ? 'Cargando…' : `${filtered.length.toLocaleString()} pendiente${filtered.length !== 1 ? 's' : ''} de revisión`}
            </div>
            {rowError && <div className="text-caption text-danger-text px-1">{rowError}</div>}

            <DataTable columns={REVIEW_COLS} loading={loading} empty={{ icon: CheckCircle2, message: 'Sin pendientes de revisión' }}>
                {filtered.map((row, i) => (
                    <DataRow key={row.id} index={i} onClick={() => openFile(row)}>
                        <DataCell>
                            <span className="font-semibold text-content-2 tabular-nums text-label">{fmtDateTime(row.received_at)}</span>
                        </DataCell>
                        <DataCell>
                            {row.kind === 'orphan_pdf' ? (
                                <Badge variant="chart-1" uppercase={false}>PDF sin JSON</Badge>
                            ) : row.kind === 'invalidacion_pendiente' ? (
                                <Badge title={row.reason} variant="chart-4" uppercase={false}>Invalidación pendiente</Badge>
                            ) : row.kind === 'orphan_zip' ? (
                                <Badge title={row.reason} variant="chart-3" uppercase={false}>ZIP sin abrir</Badge>
                            ) : (
                                <Badge title={row.reason} variant="warning" uppercase={false}>JSON inválido</Badge>
                            )}
                        </DataCell>
                        <DataCell hideBelow="md">
                            <span className="text-content-2 text-label">{row.from_email || '—'}</span>
                        </DataCell>
                        <DataCell>
                            <Button variant="ghost" title={row.filename} onClick={() => openFile(row)}>{row.filename}</Button>
                        </DataCell>
                        <DataCell align="center">
                            {canEdit && (() => {
                                const isMatchOpen = expandedAction?.rowId === row.id && expandedAction.kind === 'match';
                                const isClassifyOpen = expandedAction?.rowId === row.id && expandedAction.kind === 'classify';
                                const anyOpen = isMatchOpen || isClassifyOpen;
                                return (
                                    <div className="flex items-center justify-center gap-1.5" {...clickable((e) => e.stopPropagation())}>
                                        {row.kind === 'orphan_pdf' && (
                                            <>
                                                {!anyOpen && (
                                                    <DetectCodeAction
                                                        pdfPath={row.file_path}
                                                        detectedCodigo={row.ai_suggested?.detected_codigo_generacion}
                                                        serverChecked={row.ai_suggested !== null && row.ai_suggested !== undefined}
                                                        onFound={(match) => emparejarPorCodigo(row, match)}
                                                    />
                                                )}
                                                {!isClassifyOpen && (
                                                    <MatchDocumentAction
                                                        row={row}
                                                        documents={documents}
                                                        open={isMatchOpen}
                                                        onOpen={() => { loadDocuments(); setExpandedAction({ rowId: row.id, kind: 'match' }); }}
                                                        onClose={() => setExpandedAction(null)}
                                                        onMatched={() => { bumpRefresh(); setExpandedAction(null); }}
                                                    />
                                                )}
                                                {!isMatchOpen && (
                                                    <ClassifyReviewAction
                                                        row={row}
                                                        documents={documents}
                                                        open={isClassifyOpen}
                                                        onOpen={() => { loadDocuments(); setExpandedAction({ rowId: row.id, kind: 'classify' }); }}
                                                        onClose={() => setExpandedAction(null)}
                                                        onClassified={() => { bumpRefresh(); setExpandedAction(null); }}
                                                    />
                                                )}
                                                {!anyOpen && (
                                                    <ActionButton
                                                        icon={CheckCircle2}
                                                        label="Sin JSON"
                                                        color="emerald"
                                                        title="Guarda este PDF como documento aunque nunca llegue su JSON"
                                                        onClick={() => confirmSinJson(row)}
                                                    />
                                                )}
                                            </>
                                        )}
                                        {!anyOpen && (
                                            <ActionButton
                                                icon={XCircle}
                                                label="Descartar"
                                                color="red"
                                                onClick={() => discard(row)}
                                            />
                                        )}
                                    </div>
                                );
                            })()}
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
    // Pedido del usuario 2026-07-22: permiso granular tipo "tab" (mismo
    // patrón que minmax_ver_costos) — algunos roles con acceso al módulo no
    // deben ver montos ($) de compras, solo los documentos.
    const canViewCards = hasPermission('facturas_compra_ver_montos');

    const [searchParams, setSearchParams] = useSearchParams();
    const rawTab = searchParams.get('tab');
    const activeTab = TABS.some(t => t.key === rawTab) ? rawTab : 'documentos';
    const setActiveTab = (tab) => setSearchParams(p => { p.set('tab', tab); return p; });

    // ?q= — cross-link desde el detalle de Proveedores ("Ver documentos").
    const [search, setSearch] = useState(() => searchParams.get('q') || '');
    // H6: el cross-link traía solo ?q= y la vista abría en el mes actual, así
    // que cualquier proveedor cuya última compra no fuera de este mes caía en
    // "Sin facturas en el período" — justo después de mostrarle al usuario la
    // fecha de esa última compra. Ahora el origen puede fijar el rango.
    const [dateRange, setDateRange] = useState(() => {
        const desde = searchParams.get('desde');
        const hasta = searchParams.get('hasta');
        return desde && hasta ? `${desde}|${hasta}` : defaultDateRange();
    });
    const [dateStart, dateEnd] = dateRange.split('|');
    const [proveedores, setProveedores] = useState([]);

    const [refreshKey, setRefreshKey] = useState(0);
    const bumpRefresh = () => setRefreshKey(k => k + 1);

    const [syncing, setSyncing] = useState(false);
    const [syncProgress, setSyncProgress] = useState(null); // {batch} — solo aparece si hay >1 tanda

    useEffect(() => {
        fetchProveedoresMaestro().then(setProveedores).catch((e) => console.error('fetchProveedoresMaestro:', e.message));
    }, []);

    // Fase 5 E5 (PLAN-MEJORAS-DTE-PROVEEDORES-2026-07.md): antes hasMore
    // obligaba al usuario a re-clickear "Sincronizar" manualmente por cada
    // tanda. Ahora se re-invoca sola mientras hasMore, con tope de
    // seguridad de 10 tandas (backfills grandes no deben trabar el botón
    // para siempre ni exceder el presupuesto de la sesión del usuario).
    const MAX_SYNC_BATCHES = 10;
    const runSyncNow = async () => {
        setSyncing(true);
        setSyncProgress(null);
        let totalInserted = 0;
        let batch = 0;
        let hasMore = true;
        try {
            while (hasMore && batch < MAX_SYNC_BATCHES) {
                batch++;
                if (batch > 1) setSyncProgress({ batch });
                const result = await syncPurchaseEmailsNow({ dryRun: false });
                totalInserted += (result.results || []).reduce((sum, r) => sum + (r.documentsInserted || 0), 0);
                hasMore = result.hasMore === true;
            }
            useStaff.getState().appendAuditLog('FACTURAS_COMPRA_SYNC_MANUAL', null, { inserted: totalInserted, batches: batch });
            useToastStore.getState().showToast(
                'Sincronización completa',
                `${totalInserted} documento${totalInserted !== 1 ? 's' : ''} nuevo${totalInserted !== 1 ? 's' : ''}${hasMore ? ` (tope de ${MAX_SYNC_BATCHES} tandas alcanzado, quedó más — corré de nuevo)` : ''}`,
                'success',
            );
            bumpRefresh();
        } catch (e) {
            useToastStore.getState().showToast('Error al sincronizar', e.message, 'error');
        } finally {
            setSyncing(false);
            setSyncProgress(null);
        }
    };

    // filtersContent es SOLO tabs+búsqueda — una sola fila de header, igual que
    // LaboratoriosView/PedidosView/PromocionesView. El pill de fecha/tipo/
    // proveedor y "Sincronizar ahora" viven en el body (regla §17 DESIGN.md,
    // ver TabDocumentos).
    const filtersContent = (
        <ViewTabBar
            tabs={TABS}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            searchValue={search}
            onSearchChange={setSearch}
            showSearch
        />
    );

    return (
        <GlassViewLayout icon={FileText} title="Facturas de Compra" filtersContent={filtersContent}>
            {activeTab === 'documentos' && (
                <TabDocumentos
                    dateRange={dateRange}
                    setDateRange={setDateRange}
                    searchTerm={search}
                    refreshKey={refreshKey}
                    openModal={openModal}
                    proveedores={proveedores}
                    canEdit={canEdit}
                    showCards={canViewCards}
                    syncing={syncing}
                    syncProgress={syncProgress}
                    runSyncNow={runSyncNow}
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
                    openModal={openModal}
                />
            )}
        </GlassViewLayout>
    );
}
