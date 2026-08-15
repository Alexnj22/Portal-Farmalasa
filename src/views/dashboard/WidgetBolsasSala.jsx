import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Banknote, Package, Printer, ShieldCheck } from 'lucide-react';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { fetchBolsas, fetchCortesPorEmbolsar } from '../../data/bolsas';
import { formatMoney } from '../../utils/formatNumber';
import { useAuth } from '../../context/AuthContext';
import useCerrarBolsa from '../../hooks/useCerrarBolsa';
import { useStaffStore as useStaff } from '../../store/staffStore';

/**
 * Las bolsas de efectivo en el Inicio: lo que falta guardar y lo que espera el
 * retiro.
 *
 * ── Guardar la bolsa es un paso aparte de confirmar el corte ────────────────
 * A propósito. Meter el dinero en la bolsa lo hace una persona con las manos; si
 * el portal creara la bolsa solo al confirmar el corte, el registro diría que
 * hay una bolsa donde a lo mejor no la hay — y ese registro es justamente contra
 * lo que administración cuenta después.
 *
 * ── «Por guardar» mira dos días, no siete ──────────────────────────────────
 * El corte se embolsa en el momento, o a la mañana siguiente. Un corte
 * confirmado hace cinco días sin bolsa no es una tarea pendiente: es un
 * descuadre, y ofrecer «Guardar en bolsa $716.92» ahí invitaría a registrar una
 * bolsa por dinero que ya no está. La ventana corta también hace que el arranque
 * se limpie solo, en vez de estrenar la baldosa con la lista entera del
 * histórico.
 *
 * ── La alarma de los 4 días ─────────────────────────────────────────────────
 * El retiro pasa cada ~3 días y los días no son fijos (usuario, 2026-08-15), así
 * que no hay «próximo retiro» que mostrar: lo que sí se sabe es cuánto lleva
 * esperando la bolsa más vieja. Al cuarto día ya se pasó.
 */
const REFRESCO_MS = 60 * 1000;
const POR_EMBOLSAR_DIAS = 2;
const DIAS_DE_ALARMA = 4;

const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};
const diasDesde = (fecha) => Math.max(0, Math.round(
    (Date.parse(`${hoySV()}T12:00:00Z`) - Date.parse(`${fecha}T12:00:00Z`)) / 86_400_000,
));

const hhmm = (hora) => String(hora || '').slice(0, 5);
const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === correrDia(hoy, -1)) return 'Ayer';
    return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        day: 'numeric', month: 'short', timeZone: 'UTC',
    });
};

export default function WidgetBolsasSala({ soloMiSala = true, salaElegida = null }) {
    const { user, hasPermission } = useAuth();
    const puedeGuardar = hasPermission('bolsas', 'can_edit');
    const miSala = user?.branchId ?? user?.branch_id ?? null;

    const branches = useStaff((st) => st.branches);
    const empleados = useStaff((st) => st.employees);
    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches || []) m[b.id] = b.name;
        return m;
    }, [branches]);
    // Quién cerró cada bolsa, para que la etiqueta reimpresa siga nombrando a la
    // persona que guardó el dinero y no a la que aprieta el botón hoy.
    const nombrePersona = useMemo(() => {
        const m = new Map();
        for (const e of empleados || []) m.set(e.id, e.name);
        return m;
    }, [empleados]);

    const [bolsas, setBolsas] = useState([]);
    const [porEmbolsar, setPorEmbolsar] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [imprimiendo, setImprimiendo] = useState(null);

    const { cerrar, imprimir, ocupadoId } = useCerrarBolsa({ nombreSala, origen: 'inicio' });

    const cargar = useCallback(async () => {
        const hasta = hoySV();
        const [abiertas, pendientes] = await Promise.all([
            // Sin filtro de fecha: una bolsa abierta lo sigue estando hasta que
            // se entrega, y justamente las viejas son las que hay que ver.
            fetchBolsas({ estados: ['ABIERTA'] }),
            fetchCortesPorEmbolsar({ desde: correrDia(hasta, -(POR_EMBOLSAR_DIAS - 1)), hasta }),
        ]);
        if (!abiertas) { setError('No se pudieron cargar las bolsas'); setCargando(false); return; }
        setError(null);
        setBolsas(abiertas);
        setPorEmbolsar(pendientes || []);
        setCargando(false);
    }, []);

    useEffect(() => {
        cargar(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco
        const t = setInterval(cargar, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargar]);

    // El alcance se decide UNA vez para las dos listas: si cada una resolviera su
    // propio respaldo podrían quedar en alcances distintos, y la baldosa diría
    // «3 bolsas» arriba con una sola abajo.
    const salaFiltro = useMemo(() => {
        if (salaElegida) return Number(salaElegida);
        if (!soloMiSala || miSala == null) return null;
        const tiene = bolsas.some((b) => b.branch_id === Number(miSala))
            || porEmbolsar.some((c) => c.branch_id === Number(miSala));
        return tiene ? Number(miSala) : null;
    }, [salaElegida, soloMiSala, miSala, bolsas, porEmbolsar]);

    const deLaSala = useCallback(
        (lista) => (salaFiltro == null ? lista : lista.filter((x) => x.branch_id === salaFiltro)),
        [salaFiltro],
    );

    const enSala = useMemo(() => deLaSala(bolsas), [bolsas, deLaSala]);
    const faltan = useMemo(() => deLaSala(porEmbolsar), [porEmbolsar, deLaSala]);
    const variasSalas = useMemo(
        () => new Set([...enSala, ...faltan].map((x) => x.branch_id)).size > 1,
        [enSala, faltan],
    );

    const total = useMemo(
        () => enSala.reduce((a, b) => a + Number(b.monto_inicial || 0), 0),
        [enSala],
    );
    const masVieja = useMemo(
        () => enSala.reduce((max, b) => Math.max(max, diasDesde(b.fecha)), 0),
        [enSala],
    );
    const vencidas = useMemo(
        () => enSala.filter((b) => diasDesde(b.fecha) >= DIAS_DE_ALARMA).length,
        [enSala],
    );

    const guardar = useCallback(async (corte) => {
        if (await cerrar(corte)) cargar();
    }, [cerrar, cargar]);

    const reimprimir = useCallback(async (bolsa) => {
        setImprimiendo(bolsa.id);
        await imprimir(bolsa, { cerradaPor: nombrePersona.get(bolsa.cerrada_por) });
        setImprimiendo(null);
        cargar();
    }, [imprimir, nombrePersona, cargar]);

    if (cargando) return <div className="p-3"><SkeletonText lines={3} /></div>;

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* ── Cuánto efectivo hay en la sala ──────────────────────────────
                DOS tarjetas y no tres. Con tres, la del efectivo quedaba tan
                angosta que `$666.65` salía `$66…` — y acá el número tiene que
                leerse entero: es la plata que hay guardada. Cuántos días lleva
                la más vieja va en el renglón de arriba, que es donde esta misma
                baldosa pone el dato de contexto y donde cabe en palabras. */}
            <div className="shrink-0 px-2 pt-2 pb-1 border-b border-divider">
                <div className="flex items-baseline justify-between gap-2 mb-1 px-0.5">
                    <span className="text-caption font-black uppercase tracking-widest text-content-3">
                        En la sala
                    </span>
                    <span className={`text-caption tabular-nums truncate ${vencidas ? 'text-danger-text font-bold' : 'text-content-3'}`}>
                        {enSala.length
                            ? `la más vieja, ${masVieja} ${masVieja === 1 ? 'día' : 'días'}`
                            : 'nada en espera'}
                    </span>
                </div>
                <CarrilCards ariaLabel="Efectivo guardado en la sala">
                    <StatCard densa icon={Package} iconBg="bg-info/10" iconCls="text-info-text"
                        label="Bolsas" value={enSala.length} />
                    <StatCard densa icon={Banknote} iconBg="bg-success/10" iconCls="text-success-text"
                        label="Efectivo" value={formatMoney(total)} valueCls="text-success-text" />
                </CarrilCards>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-1.5">
                {error && (
                    <EmptyState linea icon={Package} title="No se pudieron cargar" subtitle={error} />
                )}

                {/* La alarma va arriba de todo: es lo único de esta baldosa que
                    cambia lo que hay que HACER hoy. */}
                {!error && vencidas > 0 && (
                    <div data-surface="card" className="flex items-start gap-2 p-2">
                        <AlertTriangle size={16} className="text-danger-text shrink-0 mt-0.5" />
                        <p className="text-caption text-content-2">
                            <span className="font-bold text-danger-text">
                                {vencidas === 1 ? 'Una bolsa lleva' : `${vencidas} bolsas llevan`}
                                {' '}{DIAS_DE_ALARMA} días o más
                            </span>
                            {' '}esperando el retiro. Avisá para que pasen a recogerlas.
                        </p>
                    </div>
                )}

                {/* ── Lo que falta guardar ────────────────────────────────── */}
                {!error && faltan.map((c) => (
                    <div key={c.corte_id} data-surface="card" className="flex flex-col gap-1.5 p-2">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="flex items-baseline gap-2 flex-wrap">
                                    {variasSalas && (
                                        <span className="text-label font-bold text-content truncate">
                                            {nombreSala[c.branch_id]}
                                        </span>
                                    )}
                                    <span className="text-caption text-content-2 font-semibold tabular-nums">
                                        {rotularDia(c.fecha)} · {hhmm(c.hora)}
                                    </span>
                                </div>
                                <div className="text-caption text-content-3 truncate">
                                    {c.caja || 'Sin nombre'}
                                </div>
                            </div>
                            <div className="text-label font-bold tabular-nums text-content text-right shrink-0">
                                {formatMoney(c.sugerida)}
                            </div>
                        </div>
                        <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                            <Badge variant="warning" size="sm" dot>Sin guardar</Badge>
                            {puedeGuardar && (
                                <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
                                    <Button variant="primary" size="sm" icon={Package}
                                        loading={ocupadoId === c.corte_id}
                                        onClick={() => guardar(c)}>
                                        Guardar en bolsa
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}

                {/* ── Las que esperan el retiro ───────────────────────────── */}
                {!error && enSala.map((b) => {
                    const dias = diasDesde(b.fecha);
                    // La etiqueta se vuelve mentira en cuanto sale plata; hoy
                    // todavía no hay salidas, pero una bolsa sin etiqueta impresa
                    // es una bolsa sin nada escrito encima, que es el problema
                    // que esto vino a resolver.
                    const sinEtiqueta = !b.etiqueta_impresa_at;
                    return (
                        <div key={b.id} data-surface="card" className="flex flex-col gap-1.5 p-2">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-baseline gap-2 flex-wrap">
                                        <span className="text-label font-bold text-content truncate">{b.folio}</span>
                                        {variasSalas && (
                                            <span className="text-caption text-content-2 truncate">
                                                {nombreSala[b.branch_id]}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-caption text-content-3 truncate tabular-nums">
                                        Corte del {rotularDia(b.fecha)} · {hhmm(b.hora)}
                                    </div>
                                </div>
                                <div className="text-label font-bold tabular-nums text-success-text text-right shrink-0">
                                    {formatMoney(b.monto_inicial)}
                                </div>
                            </div>
                            <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
                                {dias >= DIAS_DE_ALARMA
                                    ? <Badge variant="danger" size="sm" dot>{dias} días en sala</Badge>
                                    : <Badge variant="neutral" size="sm">{dias === 0 ? 'De hoy' : `${dias} ${dias === 1 ? 'día' : 'días'} en sala`}</Badge>}
                                {sinEtiqueta && <Badge variant="warning" size="sm">Sin etiqueta</Badge>}
                                {puedeGuardar && (
                                    <div className="flex items-center justify-end gap-1.5 shrink-0 ml-auto">
                                        <Button variant="secondary" size="sm" icon={Printer}
                                            loading={imprimiendo === b.id}
                                            onClick={() => reimprimir(b)}>
                                            {sinEtiqueta ? 'Imprimir etiqueta' : 'Reimprimir'}
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}

                {/* Vacío FELIZ: no hay nada acá porque no quedó efectivo sin
                    guardar ni bolsas esperando, y eso es la buena noticia. */}
                {!error && !faltan.length && !enSala.length && (
                    <EmptyState
                        linea
                        icon={ShieldCheck}
                        iconClass="text-success-text"
                        title="Sin efectivo en espera"
                        subtitle="Todo lo cortado está guardado y retirado."
                    />
                )}
            </div>
        </div>
    );
}
