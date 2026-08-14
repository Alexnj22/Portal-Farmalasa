import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2, Ban, AlertTriangle } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { formatMoney } from '../../utils/formatNumber';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchCortes, resolverCorte } from '../../data/cortes';
import { conTramo, contraste, diferenciaDelCorte, severidad } from '../../utils/cortesDiagnostico';
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

export default function WidgetCortesSala({ soloMiSala = true, salaElegida = null }) {
    const { user, hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const appendAuditLog = useStaff((s) => s.appendAuditLog);
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');

    // La sala de quien mira, sólo si de verdad tiene una con cortes. Quien
    // trabaja desde Administración —o ve todas las salas— no tiene caja propia:
    // filtrar por su `branch_id` le dejaba el widget vacío para siempre, que es
    // como se vio la primera vez.
    const miSala = user?.branchId ?? user?.branch_id ?? null;

    const branches = useStaff((st) => st.branches);
    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches || []) m[b.id] = b.name;
        return m;
    }, [branches]);

    const [filas, setFilas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [descartando, setDescartando] = useState(null);   // id del corte
    const [ocupado, setOcupado] = useState(null);           // id en curso

    const cargar = useCallback(async () => {
        const hoy = hoySV();
        const data = await fetchCortes({ desde: hoy, hasta: hoy });
        if (!data) { setError('No se pudieron cargar los cortes'); setCargando(false); return; }
        setError(null);
        setFilas(data);
        setCargando(false);
    }, []);

    useEffect(() => {
        cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco
        const t = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargar]);

    // Con alcance BRANCH la base ya devuelve sólo la propia; el filtro es para
    // quien ve todas y no debería recibir seis salas en una baldosa.
    // Por sala y por día, porque el tramo se mide dentro del día.
    const cortes = useMemo(() => {
        // Si hay una sala elegida en la cabecera, manda ésa. Si no, la propia.
        if (salaElegida) {
            const deEsa = filas.filter((c) => String(c.branch_id) === String(salaElegida));
            const porUna = new Map([[Number(salaElegida), deEsa]]);
            return [...porUna.values()].flatMap((l) =>
                conTramo([...l].sort((x, y) => String(x.hora).localeCompare(String(y.hora)))))
                .filter((c) => c.tipo === 'C')
                .sort((x, y) => String(y.hora).localeCompare(String(x.hora)));
        }
        const propios = filas.filter((c) => c.branch_id === Number(miSala));
        // Si la sala propia no tiene cortes hoy, se muestra lo que la sesión
        // alcance a ver: para un supervisor eso son todas las salas, y es
        // infinitamente más útil que una baldosa vacía.
        const base = (soloMiSala && propios.length) ? propios : filas;
        const porSala = new Map();
        for (const c of base) {
            if (!porSala.has(c.branch_id)) porSala.set(c.branch_id, []);
            porSala.get(c.branch_id).push(c);
        }
        const out = [];
        for (const lista of porSala.values()) {
            out.push(...conTramo([...lista].sort((a, b) => String(a.hora).localeCompare(String(b.hora)))));
        }
        return out.filter((c) => c.tipo === 'C')
            .sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
    }, [filas, miSala, soloMiSala, salaElegida]);

    const variasSalas = useMemo(
        () => new Set(cortes.map((c) => c.branch_id)).size > 1,
        [cortes],
    );

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
                subtext={salaElegida
                    ? `${nombreSala[salaElegida] || 'Esa sala'} todavía no ha cortado hoy.`
                    : 'Cuando se saque un corte de caja aparece acá para confirmarlo.'}
            />
        );
    }

    return (
        <div className="h-full overflow-y-auto p-2 space-y-1.5">
            {cortes.map((c) => {
                const sev = severidad(c.tramo);
                const disputa = contraste(c)?.enDisputa;
                const resuelto = c.estado !== 'PENDIENTE';
                const enCurso = ocupado === c.id;

                return (
                    <div key={c.id} data-surface="card" className="p-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-caption font-semibold text-content-2 tabular-nums">{hhmm(c.hora)}</span>
                            {variasSalas && (
                                <span className="text-caption text-content-3 truncate">{nombreSala[c.branch_id]}</span>
                            )}
                            {c.estado === 'DESCARTADO' ? (
                                <span className="text-label font-semibold text-content-3 line-through tabular-nums">
                                    {conSigno(diferenciaDelCorte(c).valor)}
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
