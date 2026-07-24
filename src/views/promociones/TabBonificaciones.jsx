import React, { useState, useEffect, useCallback } from 'react';
import { Gift, Loader2, DollarSign, Check, User, Wallet } from 'lucide-react';
import { useAuth }       from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import {
    fetchPromotionBonifications, insertPromotionPayment, updatePromotionBonificationPaid,
} from '../../data/promotions';

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt$ = (n) =>
    `$${parseFloat(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ROLE_STYLE = {
    vendedor: { bg: 'bg-success/10 text-emerald-700 border-success/30', label: 'Vendedor' },
    admin:    { bg: 'bg-blue-50 text-blue-700 border-blue-200',           label: 'Admin'    },
    bodega:   { bg: 'bg-warning/10 text-amber-700 border-warning/30',        label: 'Bodega'   },
};

const COLS = [
    { key: 'empleado',  label: 'Empleado',     align: 'left'               },
    { key: 'rol',       label: 'Rol',          align: 'center', w: 'w-24'  },
    { key: 'promo',     label: 'Promoción',    align: 'left',   hideBelow: 'md' },
    { key: 'ganado',    label: 'Ganado',       align: 'right',  w: 'w-24'  },
    { key: 'pagado',    label: 'Pagado',       align: 'right',  w: 'w-24'  },
    { key: 'pendiente', label: 'Pendiente',    align: 'right',  w: 'w-24'  },
    { key: 'accion',    label: '',             align: 'center', w: 'w-20'  },
];

// ── PayModal ──────────────────────────────────────────────────────────────────

function PayModal({ bonif, onClose, onPaid }) {
    const { user }        = useAuth();
    const { showToast }   = useToastStore();
    const [amount, setAmount] = useState(String(parseFloat(bonif.amount_earned - bonif.amount_paid).toFixed(2)));
    const [notes,  setNotes]  = useState('');
    const [saving, setSaving] = useState(false);

    const pending = parseFloat(bonif.amount_earned - bonif.amount_paid);

    const handlePay = async () => {
        const amt = parseFloat(amount);
        if (isNaN(amt) || amt <= 0) return showToast('Error', 'Monto inválido', 'error');
        if (amt > pending + 0.001) return showToast('Error', 'El monto supera el pendiente', 'error');

        setSaving(true);
        const { error: payErr } = await insertPromotionPayment({
            promotion_id: bonif.promotion_products?.promotion_id,
            employee_id:  bonif.employee_id,
            amount:       amt,
            notes:        notes || null,
            paid_by:      user?.id || null,
        });
        if (payErr) { setSaving(false); return showToast('Error', payErr.message, 'error'); }

        // Update bonification record
        const { error: updErr } = await updatePromotionBonificationPaid(bonif.id, bonif.amount_paid + amt);
        setSaving(false);
        if (updErr) return showToast('Error', updErr.message, 'error');
        showToast('Pago registrado', `${fmt$(amt)} a ${bonif.employees?.name || 'empleado'}`, 'success');
        onPaid();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="bg-surface-card border border-slate-200 rounded-2xl shadow-xl p-5 w-80 max-w-full">
                <p className="text-[13px] font-bold text-content-2 mb-1">Registrar pago</p>
                <p className="text-[11px] text-content-3 mb-4">
                    {bonif.employees?.name || 'Empleado'} · {ROLE_STYLE[bonif.role]?.label} ·{' '}
                    Pendiente: <strong>{fmt$(pending)}</strong>
                </p>

                <div className="space-y-2.5">
                    <div>
                        <label className="text-[10px] font-medium text-content-3 mb-0.5 block">Monto ($)</label>
                        <input
                            type="number" step="0.01" min="0.01" max={pending}
                            className="w-full text-[16px] bg-surface-card-hover border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="text-[10px] font-medium text-content-3 mb-0.5 block">Notas (opcional)</label>
                        <textarea
                            className="w-full text-[16px] bg-surface-card-hover border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400 h-16 resize-none"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Ej: Pago quincenal, efectivo..."
                        />
                    </div>
                </div>

                <div className="flex gap-2 justify-end mt-4">
                    <button onClick={onClose} className="px-3 py-1.5 text-[11px] text-content-3 hover:text-content-2">Cancelar</button>
                    <button
                        onClick={handlePay}
                        disabled={saving}
                        className="px-4 py-1.5 text-[11px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                        Confirmar pago
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TabBonificaciones({ searchTerm, canEdit }) {
    const { showToast }   = useToastStore();
    const [bonifs,   setBonifs]   = useState([]);
    const [loading,  setLoading]  = useState(true);
    const [payModal, setPayModal] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await fetchPromotionBonifications();

        if (error) showToast('Error', error.message, 'error');
        setBonifs(data || []);
        setLoading(false);
    }, [showToast]);

    useEffect(() => { load(); }, [load]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial de datos

    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const filtered = searchTerm
        ? bonifs.filter(b =>
            norm(b.employees?.name).includes(norm(searchTerm)) ||
            norm(b.promotion_products?.promotions?.nombre).includes(norm(searchTerm))
          )
        : bonifs;

    const totalPending = filtered.reduce((s, b) => s + Math.max(0, b.amount_earned - b.amount_paid), 0);
    const totalEarned  = filtered.reduce((s, b) => s + (b.amount_earned || 0), 0);

    return (
        <div>
            {/* Summary pill — right-aligned, glassmorphic */}
            <div className="flex justify-end mb-4">
                <div className="group flex items-center gap-0 rounded-2xl border border-slate-200/70 bg-surface-card backdrop-blur-sm shadow-[0_2px_10px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-300 hover:shadow-[0_8px_28px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 shrink-0">
                    <div className="flex items-center gap-1.5 px-3 py-2">
                        <Gift size={12} className="text-content-3" />
                        <span className="text-[11px] text-content-3">Total ganado:</span>
                        <span className="text-[11px] font-semibold text-content-2">{fmt$(totalEarned)}</span>
                    </div>
                    <div className="h-5 w-px bg-surface-card-hover shrink-0" />
                    <div className="flex items-center gap-1.5 px-3 py-2">
                        <span className="text-[11px] text-content-3">Pendiente:</span>
                        <span className={`text-[11px] font-semibold ${totalPending > 0 ? 'text-warning' : 'text-content-3'}`}>
                            {fmt$(totalPending)}
                        </span>
                    </div>
                </div>
            </div>

            {bonifs.length === 0 && !loading && (
                <div className="text-center py-12 text-content-3">
                    <Gift size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-[12px]">Sin bonificaciones registradas</p>
                    <p className="text-[11px] mt-1 text-content-3">
                        Las bonificaciones se acumulan automáticamente conforme se procesan las ventas de las promociones activas.
                    </p>
                </div>
            )}

            {(bonifs.length > 0 || loading) && (
                <DataTable
                    columns={COLS}
                    loading={loading}
                    empty={!loading && filtered.length === 0}
                    emptyText="Sin bonificaciones para esa búsqueda"
                    emptyIcon={Gift}
                >
                    {filtered.map((b, idx) => {
                        const pending    = Math.max(0, b.amount_earned - b.amount_paid);
                        const rs         = ROLE_STYLE[b.role] || ROLE_STYLE.vendedor;
                        const promoName  = b.promotion_products?.promotions?.nombre || '—';
                        const prodName   = b.promotion_products?.products?.nombre   || '—';
                        const empName    = b.employees?.name                        || '—';

                        return (
                            <DataRow key={b.id} index={idx}>
                                {/* empleado */}
                                <DataCell align="left">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-surface-card-hover overflow-hidden flex-shrink-0 flex items-center justify-center">
                                            {b.employees?.photo_url
                                                ? <img src={b.employees.photo_url} className="w-full h-full object-cover" alt="" />
                                                : <User size={10} className="text-content-3" />}
                                        </div>
                                        <span className="text-[12px] font-medium text-content-2">{empName}</span>
                                    </div>
                                </DataCell>

                                {/* rol */}
                                <DataCell align="center">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold border ${rs.bg}`}>
                                        {rs.label}
                                    </span>
                                </DataCell>

                                {/* promo */}
                                <DataCell align="left" hideBelow="md">
                                    <span className="text-[11px] text-content-2 font-medium">{promoName}</span>
                                    <span className="ml-1.5 text-[10px] text-content-3">{prodName}</span>
                                </DataCell>

                                {/* ganado */}
                                <DataCell align="right">
                                    <span className="text-[12px] font-semibold text-content-2">{fmt$(b.amount_earned)}</span>
                                </DataCell>

                                {/* pagado */}
                                <DataCell align="right">
                                    <span className="text-[11px] text-content-3">{fmt$(b.amount_paid)}</span>
                                </DataCell>

                                {/* pendiente */}
                                <DataCell align="right">
                                    <span className={`text-[12px] font-semibold ${pending > 0 ? 'text-warning' : 'text-content-3'}`}>
                                        {fmt$(pending)}
                                    </span>
                                </DataCell>

                                {/* accion */}
                                <DataCell align="center">
                                    {canEdit && pending > 0 && (
                                        <button
                                            onClick={() => setPayModal(b)}
                                            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
                                        >
                                            <Wallet size={9} /> Pagar
                                        </button>
                                    )}
                                </DataCell>
                            </DataRow>
                        );
                    })}
                </DataTable>
            )}

            {payModal && (
                <PayModal
                    bonif={payModal}
                    onClose={() => setPayModal(null)}
                    onPaid={load}
                />
            )}
        </div>
    );
}
