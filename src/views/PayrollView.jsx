import React, { useState, useMemo, useEffect } from 'react';
import Notice from '../components/common/Notice';
import Button from '../components/common/Button';
import { EmptyState } from '../components/common/StateViews';
import Badge from '../components/common/Badge';
import {
    DollarSign, Plus, Printer, CheckCircle2, Banknote,
    Building2, Search, Pencil, RotateCcw, Download, X, ListFilter,
    AlertTriangle, LockKeyhole, ExternalLink, CalendarDays } from 'lucide-react';
import { fetchUnapprovedTimesheetsCount } from '@nucleo/data/payroll';
import { useStaffStore } from '@nucleo/store/staffStore';
import { smartFilter } from '@nucleo/utils/searchUtils';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { useToastStore } from '@nucleo/store/toastStore';
import { useAuth } from '@nucleo/context/AuthContext';
import GlassViewLayout from '../components/GlassViewLayout';
import LiquidSelect from '../components/common/LiquidSelect';
import AvatarConEstado from '../components/common/AvatarConEstado';
import ConfirmModal from '../components/common/ConfirmModal';
import { DataTable, DataRow, DataCell } from '../components/common/DataTable';
import ListRow from '../components/common/ListRow';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';

import { registrarEgreso } from '@nucleo/data/egreso';
import { abrirVentanaDeImpresion, escribirEImprimir } from '../plataforma/ventanaDeImpresion';
import { descargarArchivo } from '../plataforma/descargas';
import { fechaTexto } from '@nucleo/utils/fecha';
import { ESTADO_PLANILLA, csvDelBanco, montoEnLetras, ordenDeCargo, rotuloDePeriodo } from '@nucleo/utils/planilla';
import { PRINT_CSS, buildBoletaHTML } from '@nucleo/utils/boletaDePapel';
// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt    = (n) => formatMoney(n || 0);
const round2 = (n) => parseFloat((n || 0).toFixed(2));

// Role hierarchy by DB id — lower index = more senior
// Orden por cargo, estados, el período y el monto en letras: `planilla` (núcleo, lo mismo de la app).
const roleOrder = ordenDeCargo;
const STATUS_META = ESTADO_PLANILLA;
const amountInWords = montoEnLetras;
const periodLabel = rotuloDePeriodo;

// El papel de la boleta (CSS, escape y HTML): núcleo, `boletaDePapel`.

// Los cinco papeles de planilla salen por acá. Se abre y se escribe en la
// misma pasada porque el HTML ya está armado: no hay `await` en el medio que
// le quite el gesto a la ventana.
function openPrintWindow(html, w = 840, h = 920) {
    const win = abrirVentanaDeImpresion({ ancho: w, alto: h });
    const r = escribirEImprimir(win, html);
    if (!r.ok) useToastStore.getState().showToast('No se pudo imprimir', r.motivo, 'error');
    return r;
}

function printBoleta(entry, period, branches) {
    const body = buildBoletaHTML(entry, period, branches);
    openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PRINT_CSS}</style></head><body><h2>BOLETA DE PAGO</h2><h3>FARMACIA LA SALUD</h3>${body}</body></html>`);
}

function printBoletasBatch(entries, period, branches) {
    const sections = entries.map((e, i) => {
        const isLast = i === entries.length - 1;
        return `<div class="${isLast?'':'pb'}"><h2>BOLETA DE PAGO</h2><h3>FARMACIA LA SALUD</h3>${buildBoletaHTML(e, period, branches)}</div>`;
    }).join('');
    openPrintWindow(`<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PRINT_CSS}</style></head><body>${sections}</body></html>`);
}

const PLANILLA_CSS = `
  body{font-family:Arial,sans-serif;font-size:9px;margin:20px}
  h2,h3,h4{text-align:center;margin:2px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{background:#000;color:#fff;padding:3px 4px;font-size:8px}
  td{border:1px solid #ccc;padding:2px 4px}
  .right{text-align:right}
  .total{font-weight:bold;background:#eee}
  .pb{page-break-after:always}
  @media print{body{margin:8px}}
`;

function planillaTableRows(entries, branches) {
    return entries.map(e => {
        const emp    = e.employee || {};
        const branch = branches.find(b => String(b.id) === String(emp.branchId || emp.branch_id));
        return `<tr>
          <td>${emp.name||'—'}</td><td>${branch?.name||'Otras áreas'}</td>
          <td class="right">${round2(e.days_worked)}</td>
          <td class="right">${formatMoney(round2(e.ordinary_salary))}</td>
          <td class="right">${formatMoney(round2(e.subtotal_b))}</td>
          <td class="right">${formatMoney(round2(e.isss_deduction))}</td>
          <td class="right">${formatMoney(round2(e.afp_deduction))}</td>
          <td class="right">${formatMoney(round2(e.renta_deduction))}</td>
          <td class="right">${formatMoney(round2(e.total_deductions))}</td>
          <td class="right"><b>${formatMoney(round2(e.net_pay))}</b></td>
        </tr>`;
    }).join('');
}

function planillaHeaderRow() {
    return `<tr><th>Empleado</th><th>Sucursal</th><th>Días</th><th>Sal. Ordinario</th><th>Extras/Otros</th><th>ISSS</th><th>AFP</th><th>Renta</th><th>Total Desc.</th><th>Líquido</th></tr>`;
}

function printGlobalPlanilla(entries, period, branches) {
    const totalNet = entries.reduce((s, e) => s + round2(e.net_pay), 0);
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PLANILLA_CSS}</style></head><body>
<h2>PLANILLA DE PAGO — FARMACIA LA SALUD</h2><h3>${periodLabel(period.start_date,period.end_date).toUpperCase()}</h3>
<table><thead>${planillaHeaderRow()}</thead><tbody>${planillaTableRows(entries,branches)}</tbody>
<tfoot><tr class="total"><td colspan="9" class="right">TOTAL A PAGAR:</td><td class="right">${formatMoney(totalNet)}</td></tr></tfoot></table>
<br/><div style="font-size:10px">Total en letras: ${amountInWords(totalNet)}</div>
</body></html>`;
    openPrintWindow(html, 1100, 700);
}

function printBranchPlanilla(branchEntries, branch, period, branches) {
    const totalNet = branchEntries.reduce((s, e) => s + round2(e.net_pay), 0);
    const title    = branch?.name || 'Otras áreas';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>${PLANILLA_CSS}</style></head><body>
<h2>PLANILLA DE PAGO — FARMACIA LA SALUD</h2>
<h3>${periodLabel(period.start_date,period.end_date).toUpperCase()}</h3>
<h4>${title.toUpperCase()}</h4>
<table><thead>${planillaHeaderRow()}</thead><tbody>${planillaTableRows(branchEntries,branches)}</tbody>
<tfoot><tr class="total"><td colspan="9" class="right">TOTAL ${title.toUpperCase()}:</td><td class="right">${formatMoney(totalNet)}</td></tr></tfoot></table>
<br/><div style="font-size:10px">Total en letras: ${amountInWords(totalNet)}</div>
</body></html>`;
    openPrintWindow(html, 1100, 700);
}

// ─── Edit entry form (no ModalShell — rendered inside parent's ModalShell) ───
// ─── Branch-grouped table ─────────────────────────────────────────────────────
// Fuera del componente porque lo usan DOS: la tabla y el esqueleto de carga.
// Cuando vivía adentro, el esqueleto no podía verlo y se había escrito a mano —
// una tabla paralela de diez celdas que había que mantener en sincronía con
// estas diez columnas, sin nada que avisara si se desincronizaban.
const COLS_PLANILLA = [
    { key: 'empleado',   label: 'Empleado' },
    { key: 'dias',       label: 'Días',        align: 'right' },
    { key: 'salord',     label: 'Sal. Ord.',   align: 'right' },
    { key: 'extras',     label: 'Extras',      align: 'right' },
    { key: 'isss',       label: 'ISSS',        align: 'right' },
    { key: 'afp',        label: 'AFP',         align: 'right' },
    { key: 'renta',      label: 'Renta',       align: 'right' },
    { key: 'desc',       label: 'Desc. Total', align: 'right' },
    { key: 'liquido',    label: 'Líquido',     align: 'right' },
    { key: 'acciones',   label: '' },
];

function BranchGroupedTable({ entries, branches, isPaid, period, onPrint, onEdit, canDownload }) {
    const grouped = useMemo(() => {
        const map = new Map();
        for (const e of entries) {
            const emp = e.employee || {};
            const bid = String(emp.branchId || emp.branch_id || '');
            const key = bid || '__none__';
            if (!map.has(key)) map.set(key, { branch: branches.find(b => String(b.id) === bid) || null, entries: [] });
            map.get(key).entries.push(e);
        }
        return [...map.values()]
            .sort((a, b) => {
                if (!a.branch) return 1;
                if (!b.branch) return -1;
                return a.branch.name.localeCompare(b.branch.name);
            })
            .map(g => ({ ...g, entries: [...g.entries].sort((a, b) => roleOrder(a.employee) - roleOrder(b.employee)) }));
    }, [entries, branches]);

    return (
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-[var(--dur-lento)]">
            {grouped.map(({ branch, entries: grp }, gi) => {
                const branchNet = grp.reduce((s, e) => s + round2(e.net_pay), 0);
                const branchName = branch?.name || 'Otras áreas';
                return (
                    <div key={branch?.id || '__none__'}
                        className="overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-[var(--dur-lento)]"
                        style={{ animationDelay: `${gi * 80}ms` }}>

                        {/* Branch header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-border-card bg-surface-card flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-gradient-to-tr from-brand to-brand-purple rounded-xl flex items-center justify-center shadow-[var(--shadow-glow-brand)]">
                                    <Building2 size={14} className="text-white" strokeWidth={2} />
                                </div>
                                <div>
                                    <p className="text-body font-black text-content tracking-tight">{branchName}</p>
                                    <p className="text-micro font-black uppercase tracking-widest text-content-2">{grp.length} empleado{grp.length !== 1 ? 's' : ''}</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 ml-auto">
                                {/* La boleta y la planilla se llevan el salario de cada
                                    empleado al papel — van con `payroll_descargar`, no
                                    con el permiso de ver la nómina en pantalla. */}
                                {canDownload && (
                                    <>
                                        <Button variant="secondary" icon={Printer} title="Imprimir todas las boletas de esta sucursal" onClick={() => printBoletasBatch(grp, period, branches)}>Boletas</Button>
                                        <Button variant="secondary" icon={Printer} title="Imprimir planilla de esta sucursal" onClick={() => printBranchPlanilla(grp, branch, period, branches)}>Planilla</Button>

                                        <div className="w-px h-5 bg-divider mx-1" />
                                    </>
                                )}

                                <div className="text-right">
                                    <p className="text-micro font-black uppercase tracking-widest text-content-2">Total a pagar</p>
                                    <p className="text-subtitle font-black text-success-text">{fmt(branchNet)}</p>
                                </div>
                            </div>
                        </div>

                        {/* Table */}
                        {/* `acciones: 'mantener'`: imprimir la boleta y editar el
                            renglón vivían en una columna que el teléfono no pinta,
                            y encima detrás de un `hover` que en táctil no ocurre —
                            o sea que desde el teléfono la planilla era de sólo
                            lectura sin que nada lo dijera. Ver §32.9. */}
                        <DataTable columns={COLS_PLANILLA} minWidth="720px"
                            movil={{ acciones: 'mantener' }}>
                            {grp.map((e, ei) => {
                                const emp    = e.employee || {};
                                const edited = e.status === 'EDITED';
                                return (
                                    <DataRow key={e.id} index={ei} className={edited ? 'bg-warning/10' : ''}>
                                        <DataCell className="whitespace-nowrap">
                                            <div className="flex items-center gap-3">
                                                <AvatarConEstado emp={emp} px={32} />
                                                <div>
                                                    <p className="font-black text-content text-label leading-tight">{shortEmployeeName(emp)}</p>
                                                    {emp.role && <p className="text-micro text-content-3 font-medium leading-tight">{emp.role}</p>}
                                                    {edited && <Badge variant="warning" size="sm" uppercase={false} className="mt-0.5">editado</Badge>}
                                                </div>
                                            </div>
                                        </DataCell>
                                        <DataCell align="right" className="font-bold">{round2(e.days_worked)}</DataCell>
                                        <DataCell align="right" className="font-bold">{fmt(e.ordinary_salary)}</DataCell>
                                        <DataCell align="right" className="font-bold text-chart-1-text">{fmt(e.subtotal_b)}</DataCell>
                                        <DataCell align="right" className="text-content-3">{fmt(e.isss_deduction)}</DataCell>
                                        <DataCell align="right" className="text-content-3">{fmt(e.afp_deduction)}</DataCell>
                                        <DataCell align="right" className="text-content-3">{fmt(e.renta_deduction)}</DataCell>
                                        <DataCell align="right" className="font-bold text-danger">{fmt(e.total_deductions)}</DataCell>
                                        <DataCell align="right" className="font-black text-success-text whitespace-nowrap">{fmt(e.net_pay)}</DataCell>
                                        <DataCell>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                                {canDownload && (
                                                    <Button variant="secondary" icon={Printer} title="Imprimir boleta individual" iconOnly onClick={() => onPrint(e)} />
                                                )}
                                                {!isPaid && (
                                                    <Button tone="warning" icon={Pencil} title="Editar" iconOnly onClick={() => onEdit(e)} />
                                                )}
                                            </div>
                                        </DataCell>
                                    </DataRow>
                                );
                            })}
                        </DataTable>
                    </div>
                );
            })}
        </div>
    );
}

// ─── Main view ────────────────────────────────────────────────────────────────
const PayrollView = ({ openModal }) => {
    const { user, hasPermission, getScope } = useAuth();
    const canApprove             = hasPermission('payroll', 'can_approve');
    // Imprimir boletas/planilla y bajar el CSV del banco es un permiso aparte de
    // ver la nómina en pantalla (canon 2026-08-03): el papel se lleva el salario
    // de cada empleado fuera del portal.
    const canDownload            = hasPermission('payroll_descargar');
    const branches               = useStaffStore(s => s.branches);
    const payrollPeriods         = useStaffStore(s => s.payrollPeriods);
    const payrollEntries         = useStaffStore(s => s.payrollEntries);
    const isLoadingPayroll       = useStaffStore(s => s.isLoadingPayroll);
    const fetchPayrollPeriods    = useStaffStore(s => s.fetchPayrollPeriods);
    const updatePayrollPeriodStatus = useStaffStore(s => s.updatePayrollPeriodStatus);
    const fetchPayrollEntries    = useStaffStore(s => s.fetchPayrollEntries);
    const generatePayrollEntries = useStaffStore(s => s.generatePayrollEntries);

    const [activePeriod, setActivePeriod] = useState(null);
    const [filterBranch, setFilterBranch] = useState(
        getScope('payroll') !== 'ALL' ? String(user?.branchId || '') : ''
    );
    const [filterStatus, setFilterStatus] = useState('ALL');
    const [searchTerm,   setSearchTerm]   = useState('');
    const [generating,   setGenerating]   = useState(false);
    const [confirming,   setConfirming]   = useState(null);

    // Timesheet approval check for the active period
    const [unapprovedCount, setUnapprovedCount] = useState(null); // null = loading, 0 = all approved

    const { showToast } = useToastStore();

    React.useEffect(() => { fetchPayrollPeriods(); }, [fetchPayrollPeriods]);
    React.useEffect(() => { if (activePeriod) fetchPayrollEntries(activePeriod.id); }, [activePeriod, fetchPayrollEntries]);

    // Check unapproved timesheets whenever the active period changes
    useEffect(() => {
        if (!activePeriod?.start_date || !activePeriod?.end_date) { setUnapprovedCount(null); return; } // eslint-disable-line react-hooks/set-state-in-effect -- reset antes de re-fetch al cambiar de periodo
        setUnapprovedCount(null);
        fetchUnapprovedTimesheetsCount(activePeriod.start_date, activePeriod.end_date)
            .then(({ count }) => setUnapprovedCount(count ?? 0));
    }, [activePeriod?.id, activePeriod?.start_date, activePeriod?.end_date]);

    const branchOptions = useMemo(() => [
        { value: '', label: 'Todas las sucursales' },
        ...branches.map(b => ({ value: String(b.id), label: b.name })),
    ], [branches]);

    const statusOptions = [
        { value: 'ALL', label: 'Todos los estados' }, { value: 'DRAFT', label: 'Borrador' },
        { value: 'APPROVED', label: 'Aprobada' },     { value: 'PAID',  label: 'Pagada'   },
    ];

    const filteredPeriods = useMemo(() =>
        payrollPeriods.filter(p => filterStatus === 'ALL' || (p.status || 'DRAFT') === filterStatus),
    [payrollPeriods, filterStatus]);

    const payrollBranchFiltered = useMemo(() =>
        payrollEntries.filter(e => {
            const emp = e.employee || {};
            if (filterBranch && String(emp.branchId || emp.branch_id) !== filterBranch) return false;
            return true;
        }),
    [payrollEntries, filterBranch]);

    const { results: filteredEntries, isFuzzy: isPayrollSearchFuzzy } = useMemo(() => {
        if (!searchTerm.trim()) return { results: payrollBranchFiltered, isFuzzy: false };
        return smartFilter(searchTerm, payrollBranchFiltered, e => [(e.employee || {}).name]);
    }, [payrollBranchFiltered, searchTerm]);

    const totals = useMemo(() => ({
        grossA:  filteredEntries.reduce((s, e) => s + round2(e.subtotal_a), 0),
        extrasB: filteredEntries.reduce((s, e) => s + round2(e.subtotal_b), 0),
        deducts: filteredEntries.reduce((s, e) => s + round2(e.total_deductions), 0),
        net:     filteredEntries.reduce((s, e) => s + round2(e.net_pay), 0),
    }), [filteredEntries]);

    const handleGenerate = async () => {
        if (!activePeriod) return;
        setGenerating(true);
        try {
            const result = await generatePayrollEntries(activePeriod.id, filterBranch || null);
            if (result?.warnings?.length > 0) {
                const names = result.warnings.slice(0, 2).join(', ') + (result.warnings.length > 2 ? ' y más…' : '');
                showToast('Planilla generada con advertencias', `${result.warnings.length} empleado(s) sin salario base: ${names}`, 'warning');
            } else {
                showToast('Generado', 'Planilla generada correctamente.', 'success');
            }
        } catch(e) { showToast('Error', mensajeAmigable(e, 'No se pudo generar la planilla.'), 'error'); }
        setGenerating(false);
    };

    const handleStatusChange = async (status) => {
        if (!activePeriod) return;
        try {
            await updatePayrollPeriodStatus(activePeriod.id, status);
            setActivePeriod(p => ({ ...p, status }));
            showToast('Listo', `Planilla ${status === 'APPROVED' ? 'aprobada' : 'marcada como pagada'}.`, 'success');
        } catch { showToast('Error', 'No se pudo actualizar el estado.', 'error'); }
        setConfirming(null);
    };

    const downloadCSV = () => {
        // El CSV del banco: núcleo (`csvDelBanco`), el mismo que arma la app.
        const blob = new Blob([csvDelBanco(filteredEntries, { cuentasVisibles: !!canApprove })], { type: 'text/csv' });
        descargarArchivo(blob, `planilla-banco-${activePeriod.name}.csv`);
        // La salida más sensible del portal: nombre, banco y número de cuenta de
        // cada persona. `cuentas_visibles` distingue quién se llevó los números
        // de verdad de quién se llevó `****` — sin eso, las dos descargas se
        // ven iguales en el registro y no lo son.
        registrarEgreso('planilla_banco', {
            formato: 'csv',
            filas: filteredEntries.length,
            detalle: { periodo: activePeriod?.name || null, cuentas_visibles: !!canApprove },
        });
    };

    const isPaid     = activePeriod?.status === 'PAID';
    const isApproved = activePeriod?.status === 'APPROVED';
    const isDraft    = !activePeriod?.status || activePeriod?.status === 'DRAFT';


    const filtersContent = (
        // Sin pestañas: esta vista solo necesita el buscador. `ViewTabBar` lo
        // da con el contrato de §24 (Escape cierra Y limpia; clic afuera cierra
        // solo si está vacío) — la versión anterior lo reimplementaba a mano,
        // con su propio `inert`, sus transiciones y su punto rojo.
        <ViewTabBar
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            placeholder="Buscar empleado…"
        />
    );

    // Los filtros bajan al CUERPO (§17): recortan la planilla, no navegan.
    const filtrosCuerpo = (
        <FilterBar
            onClear={() => { setFilterBranch(''); setFilterStatus('ALL'); }}
            activeCount={[!!filterBranch, filterStatus !== 'ALL'].filter(Boolean).length}
        >
            {getScope('payroll') === 'ALL' && (
                <FilterBar.Section active={!!filterBranch} onClear={() => setFilterBranch('')} label="sucursal">
                    <FilterBar.Sucursal value={filterBranch}
                        onChange={val => setFilterBranch(val || '')} options={branchOptions} />
                </FilterBar.Section>
            )}

            <FilterBar.Section active={filterStatus !== 'ALL'} onClear={() => setFilterStatus('ALL')} label="estado">
                <div className="w-[160px]">
                    <LiquidSelect value={filterStatus} onChange={val => setFilterStatus(val || 'ALL')}
                        options={statusOptions} compact clearable={false} icon={ListFilter} bare />
                </div>
            </FilterBar.Section>
        </FilterBar>
    );

    return (
        <>
            <ConfirmModal
                isOpen={!!confirming}
                onClose={() => setConfirming(null)}
                onConfirm={() => handleStatusChange(confirming?.action)}
                title="¿Confirmar acción?"
                message={`Vas a ${confirming?.label} la planilla "${activePeriod?.name}". Esta acción queda registrada.`}
                confirmText="Confirmar"
                isDestructive={false}
            />

            <GlassViewLayout icon={DollarSign} title="Nómina" filtersContent={filtersContent} transparentBody={true} fixedScrollMode={true}>
                <div className="flex flex-col gap-4 w-full h-full">
                    {/* Barra de filtros: cuerpo, a la derecha (§17) */}
                    <div className="flex justify-end px-2 md:px-0">{filtrosCuerpo}</div>
                    <div className="flex flex-col lg:flex-row items-start gap-6 px-2 md:px-0 w-full h-full lg:h-[calc(100vh-230px)]">

                    {/* ── Sidebar: Períodos ── */}
                    <div className="w-full lg:w-[280px] shrink-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8">
                        <div data-surface="card" className="p-5">
                            <div className="flex items-center justify-between mb-4">
                                <p className="text-caption font-black uppercase tracking-[0.15em] text-content-3">Períodos</p>
                                <Button size="sm" icon={Plus} iconOnly onClick={() => openModal?.('newPayrollPeriod')} />
                            </div>
                            {filteredPeriods.length === 0 ? (
                                <EmptyState compact icon={CalendarDays} title="Sin períodos"
                                    subtitle="Crea el primero con el botón de arriba." />
                            ) : (
                                <div className="space-y-2">
                                    {filteredPeriods.map(p => {
                                        const meta   = STATUS_META[p.status] || STATUS_META.DRAFT;
                                        const active = activePeriod?.id === p.id;
                                        return (
                                            <ListRow
                                                key={p.id}
                                                surface="card"
                                                density="lg"
                                                selected={active}
                                                onClick={() => setActivePeriod(p)}
                                                title={p.name}
                                                subtitle={p.pay_date ? `Pago: ${fechaTexto(p.pay_date)}` : 'Sin fecha de pago'}
                                                trailing={<Badge variant={meta.variante} size="sm">{meta.label}</Badge>}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Main content ── */}
                    <div className="flex-1 min-w-0 lg:h-full lg:overflow-y-auto scrollbar-hide pb-8 space-y-5">
                        {!activePeriod ? (
                            <div data-surface="card" className="p-12 flex flex-col items-center justify-center text-center animate-in fade-in duration-[var(--dur-lento)]">
                                <div className="w-16 h-16 bg-gradient-to-tr from-brand to-brand-purple rounded-2xl flex items-center justify-center shadow-[var(--shadow-glow-brand)] mb-4">
                                    <DollarSign size={28} className="text-white" strokeWidth={1.5} />
                                </div>
                                <p className="text-subtitle font-black text-content-2 uppercase tracking-tight">Selecciona un período</p>
                                <p className="text-body-sm text-content-3 mt-1">O crea una nueva quincena con el botón +</p>
                            </div>
                        ) : (
                            <>
                                {/* Period summary card */}
                                <div data-surface="card" className="p-6 animate-in fade-in slide-in-from-bottom-4 duration-[var(--dur-lento)]">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <h2 className="text-body-xl font-black text-content tracking-tight">{activePeriod.name}</h2>
                                            <p className="text-caption text-content-3 mt-0.5">{activePeriod.start_date} → {activePeriod.end_date}{activePeriod.pay_date && ` · Pago: ${activePeriod.pay_date}`}</p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant={STATUS_META[activePeriod?.status]?.variante || 'neutral'}>{(STATUS_META[activePeriod.status]||STATUS_META.DRAFT).label}</Badge>
                                            {(isDraft||isApproved) && (
                                                <Button variant="secondary" icon={RotateCcw} disabled={generating} onClick={handleGenerate}>{generating ? 'Generando…' : payrollEntries.length > 0 ? 'Regenerar' : 'Generar Planilla'}</Button>
                                            )}
                                            {payrollEntries.length > 0 && canDownload && (
                                                <>
                                                    {/* Print ALL boletas in batch */}
                                                    <Button variant="secondary" icon={Printer} onClick={() => printBoletasBatch(filteredEntries, activePeriod, branches)}>Todas las Boletas</Button>
                                                    {/* Global planilla */}
                                                    <Button variant="secondary" icon={Printer} onClick={() => printGlobalPlanilla(filteredEntries, activePeriod, branches)}>Planilla Global</Button>
                                                    {/* El CSV del banco es el más sensible de los tres:
                                                        sale con el neto de cada empleado y su cuenta. */}
                                                    <Button variant="secondary" icon={Download} onClick={downloadCSV}>CSV Banco</Button>
                                                </>
                                            )}
                                            {isDraft && payrollEntries.length > 0 && (
                                                <Button tone="success" icon={CheckCircle2} onClick={() => setConfirming({ action:'APPROVED', label:'aprobar' })}>Aprobar</Button>
                                            )}
                                            {isApproved && (
                                                <Button icon={Banknote} onClick={() => setConfirming({ action:'PAID', label:'marcar como pagada' })}>Marcar Pagada</Button>
                                            )}
                                        </div>
                                    </div>

                                    {payrollEntries.length > 0 && (
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-border-card">
                                            {[
                                                { label:'Sal. Ordinario', value:totals.grossA,  color:'text-content' },
                                                { label:'Extras / Otros', value:totals.extrasB, color:'text-chart-1-text'  },
                                                { label:'Deducciones',    value:totals.deducts,  color:'text-danger'  },
                                                { label:'Total a pagar',  value:totals.net,      color:'text-success-text' },
                                            ].map(t => (
                                                <div key={t.label} data-surface="card" className="text-center py-3 px-2">
                                                    <p className="text-micro text-content-2 uppercase tracking-widest font-black">{t.label}</p>
                                                    <p className={`text-body-xl font-black ${t.color} mt-0.5`}>{fmt(t.value)}</p>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Unapproved timesheets warning */}
                                    {unapprovedCount > 0 && (
                                        <div className="mt-3 flex items-center gap-3 bg-warning/10 border border-warning/30 rounded-2xl px-4 py-2.5">
                                            <AlertTriangle size={14} className="text-warning flex-shrink-0" strokeWidth={2.5} />
                                            <p className="text-label font-bold text-warning-text flex-1">
                                                {unapprovedCount} timesheet{unapprovedCount !== 1 ? 's' : ''} sin aprobar en este período
                                            </p>
                                            <span className="text-micro font-black text-warning uppercase tracking-widest">
                                                Revisa en Auditoría
                                            </span>
                                        </div>
                                    )}
                                </div>

                                {/* Entries */}
                                {/* El esqueleto sale del MISMO `DataTable` que la tabla
                                    real, con las mismas `COLS_PLANILLA`. Antes era una
                                    tabla escrita a mano con diez celdas propias: había
                                    que mantenerla en sincronía con las diez columnas y
                                    nada avisaba si se desincronizaban. El encabezado de
                                    sucursal se conserva porque en la carga todavía no
                                    hay sucursales que agrupar. */}
                                {isLoadingPayroll ? (
                                    <div className="overflow-hidden">
                                        <div className="px-6 py-4 border-b border-border-card bg-surface-card flex items-center gap-3">
                                            <div className="w-8 h-8 skeleton rounded-xl" />
                                            <div className="space-y-1.5">
                                                <div className="h-3 w-28 skeleton rounded-full" />
                                                <div className="h-2 w-16 skeleton rounded-full" />
                                            </div>
                                        </div>
                                        <DataTable columns={COLS_PLANILLA} minWidth="720px" loading skeletonRows={6} />
                                    </div>
                                ) : filteredEntries.length === 0 ? (
                                    <div data-surface="card" className="p-12 text-center text-content-3 text-body-sm animate-in fade-in duration-[var(--dur-lento)]">
                                        {payrollEntries.length === 0 ? 'Genera la planilla para ver los datos.' : 'Sin resultados para los filtros actuales.'}
                                    </div>
                                ) : (
                                    <>
                                    {isPayrollSearchFuzzy && searchTerm && (
                                        <Notice variant="warning" icon={Search} className="mb-3">
                    Resultados similares para &ldquo;{searchTerm}&rdquo; — no se encontraron coincidencias exactas
                </Notice>
                                    )}
                                    <BranchGroupedTable
                                        entries={filteredEntries}
                                        branches={branches}
                                        isPaid={isPaid}
                                        period={activePeriod}
                                        onPrint={(e) => printBoleta(e, activePeriod, branches)}
                                        onEdit={(e) => openModal?.('editPayrollEntry', e)}
                                        canDownload={canDownload}
                                    />
                                    </>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
            </GlassViewLayout>
        </>
    );
};

export default PayrollView;
