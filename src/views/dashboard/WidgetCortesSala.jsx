import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2, Ban, AlertTriangle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchCortesDelDia, resolverCorte } from '../../data/cortes';
import { conTramo, contraste, severidad } from '../../utils/cortesDiagnostico';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';

// Los cortes de HOY de la sala, en el Inicio, para confirmarlos sin ir a buscar
// el módulo. Es donde la sala mira apenas corta — el módulo completo es para
// revisar un día entero, comparar salas y leer el detalle.
//
// La cifra es el TRAMO, igual que en el módulo: lo que se movió desde el corte
// anterior. Sale de `conTramo`, el mismo cálculo, para que las dos pantallas no
// puedan decir cosas distintas del mismo corte.
const REFRESCO_MS = 60 * 1000;
const MOTIVOS = ['Conteo de prueba', 'Se contó mal', 'Corte repetido'];

const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const hhmm = (h) => String(h || '').slice(0, 5);
const conSigno = (n) => (n > 0 ? `+${formatMoney(n)}` : formatMoney(n));

const TONO_TEXTO = { ok: 'text-success-text', sobra: 'text-warning-text', falta: 'text-danger-text' };

export default function WidgetCortesSala({ selectedBranchId = null }) {
    const { user, hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');

    const branchId = selectedBranchId ?? user?.branchId ?? user?.branch_id ?? null;

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [descartando, setDescartando] = useState(null);   // id del corte
    const [ocupado, setOcupado] = useState(null);           // id en curso

    const cargar = useCallback(async () => {
        const { data, error: err } = await fetchCortesDelDia(hoySV());
        if (err) { setError(mensajeAmigable(err, 'No se pudieron cargar los cortes')); setCargando(false); return; }
        setError(null);
        setFilas(data || []);
        setCargando(false);
    }, []);

    useEffect(() => {
        cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco
        const t = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargar]);

    // Con alcance BRANCH la base ya devuelve sólo la propia; el filtro es para
    // quien ve todas y no debería recibir seis salas en una baldosa.
    const cortes = useMemo(() => {
        const deLaSala = filas.filter((c) => branchId == null || String(c.branch_id) === String(branchId));
        return conTramo(deLaSala).filter((c) => c.tipo === 'C');
    }, [filas, branchId]);

    const resolver = useCallback(async (corte, estado, motivo) => {
        setOcupado(corte.id);
        const { error: err } = await resolverCorte(corte.id, estado, { motivo: motivo ?? null });
        setOcupado(null);
        if (err) {
            showToast?.('No se pudo guardar', mensajeAmigable(err, 'Vuelve a intentar en un momento.'), 'error');
            return;
        }
        appendAuditLog?.(estado === 'CONFIRMADO' ? 'CORTE_CAJA_CONFIRMADO' : 'CORTE_CAJA_DESCARTADO', user?.id, {
            corte_id: corte.id, hora: corte.hora, diferencia: corte.diferencia_erp, motivo, origen: 'inicio',
        });
        showToast?.(estado === 'CONFIRMADO' ? 'Corte confirmado' : 'Corte descartado', hhmm(corte.hora), 'success');
        setDescartando(null);
        cargar();
    }, [showToast, appendAuditLog, user, cargar]);

    if (cargando) return <div className="p-3"><SkeletonText lines={3} /></div>;

    if (error) {
        return <EmptyState icon={Wallet} message="No se pudieron cargar" subtext={error} />;
    }

    if (!cortes.length) {
        return (
            <EmptyState
                icon={Wallet}
                message="Sin cortes hoy"
                subtext="Cuando se saque un corte de caja aparece acá para confirmarlo."
            />
        );
    }

    return (
        <div className="p-2 space-y-1.5 overflow-y-auto">
            {cortes.map((c) => {
                const sev = severidad(c.tramo);
                const disputa = contraste(c)?.enDisputa;
                const resuelto = c.estado !== 'PENDIENTE';
                const enCurso = ocupado === c.id;

                return (
                    <div key={c.id} data-surface="card" className="p-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-caption font-semibold text-content-2 tabular-nums">{hhmm(c.hora)}</span>
                            {c.estado === 'DESCARTADO' ? (
                                <span className="text-label font-semibold text-content-3 line-through tabular-nums">
                                    {conSigno(Number(c.diferencia_erp) || 0)}
                                </span>
                            ) : (
                                <span className={`text-label font-bold tabular-nums ${TONO_TEXTO[sev]}`}>
                                    {conSigno(c.tramo ?? 0)}
                                </span>
                            )}
                            {disputa && <Badge variant="danger" size="sm" icon={AlertTriangle}>Dos cifras</Badge>}
                            {c.estado === 'CONFIRMADO' && <Badge variant="success" size="sm" icon={CheckCircle2}>Confirmado</Badge>}
                            {c.estado === 'DESCARTADO' && <Badge variant="neutral" size="sm" icon={Ban}>Descartado</Badge>}
                        </div>

                        {!resuelto && puedeResolver && (
                            descartando === c.id ? (
                                <div className="mt-2 space-y-1.5">
                                    <div className="text-micro text-content-3">¿Por qué se descarta?</div>
                                    <div className="flex gap-1.5 flex-wrap">
                                        {MOTIVOS.map((m) => (
                                            <Button
                                                key={m}
                                                variant="danger"
                                                size="sm"
                                                loading={enCurso}
                                                onClick={() => resolver(c, 'DESCARTADO', m)}
                                            >
                                                {m}
                                            </Button>
                                        ))}
                                        <Button variant="ghost" size="sm" onClick={() => setDescartando(null)}>Cancelar</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="mt-2 flex gap-1.5 flex-wrap">
                                    <Button variant="primary" size="sm" icon={CheckCircle2} loading={enCurso}
                                        onClick={() => resolver(c, 'CONFIRMADO')}>
                                        Confirmar
                                    </Button>
                                    <Button variant="secondary" size="sm" icon={Ban}
                                        onClick={() => setDescartando(c.id)}>
                                        Descartar
                                    </Button>
                                </div>
                            )
                        )}
                    </div>
                );
            })}
        </div>
    );
}
