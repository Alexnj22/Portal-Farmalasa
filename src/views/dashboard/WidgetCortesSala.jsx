import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import CorteDetalleModal from '../../components/cortes/CorteDetalleModal';
import TarjetaCorte from '../../components/cortes/TarjetaCorte';
import { mensajeAmigable } from '../../utils/errorMessages';
import { fetchCortes, fetchCortesResumen, fetchPersonas, resolverCorte } from '../../data/cortes';
import { conTramoPorSalaYDia, resumenDeCortes } from '../../utils/cortesDiagnostico';
import { useAuth } from '../../context/AuthContext';
import { useToastStore } from '../../store/toastStore';
import { useStaffStore as useStaff } from '../../store/staffStore';

/**
 * Los cortes de caja en el Inicio: lo que falta confirmar, y cómo va el mes.
 *
 * ── Ya no es «los cortes de hoy» (2026-08-14) ──────────────────────────────
 * Lo era, y por eso la baldosa salía vacía justo cuando había trabajo: el
 * usuario tenía 23 cortes sin confirmar de AYER y el widget no mostraba ninguno,
 * porque sólo miraba la fecha de hoy. Un pendiente no deja de serlo a medianoche.
 * Ahora la ventana son 7 días y la lista son los que siguen sin resolver.
 *
 * ── Y trae el resumen del mes ──────────────────────────────────────────────
 * Cuántos cuadraron al centavo, cuántos tuvieron exceso y cuántos faltante, más
 * cuántos quedan sin confirmar contra cuántos ya se firmaron. Va en esta misma
 * baldosa y no en una aparte: es la misma pregunta —«¿cómo va la caja?»— y
 * partirla en dos widgets obliga a mirar dos sitios para responderla.
 *
 * El resumen se pide con `fetchCortesResumen`, que trae 11 columnas en vez de
 * 40: son ~900 filas al mes y la fila completa incluye el texto del tiquete.
 *
 * La cifra de cada corte es el TRAMO, igual que en el módulo, y sale del mismo
 * `conTramoPorSalaYDia`: dos pantallas que calculan por su cuenta terminan
 * diciendo cosas distintas del mismo corte.
 */
const REFRESCO_MS = 60 * 1000;
const REFRESCO_MES_MS = 10 * 60 * 1000;
const DIAS_PENDIENTES = 7;

const hoySV = () => new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const correrDia = (fecha, dias) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
};

const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === correrDia(hoy, -1)) return 'Ayer';
    return new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-SV', {
        day: 'numeric', month: 'short', timeZone: 'UTC',
    });
};

// Las tres del mes. Son `StatCard` dentro de `CarrilCards` —el canónico de la
// fila de métricas (§17.0)— y no tres cajas escritas a mano: el número, el
// rótulo, el squircle del ícono, el encogido de la cifra y el deslizar cuando
// no entran ya están resueltos ahí. Escritas a mano eran la misma anatomía con
// otras medidas, que es exactamente como se acumula deuda visual.
const METRICAS_MES = [
    { clave: 'cuadrados', icon: ShieldCheck,   label: 'Cuadraron', iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'exceso',    icon: TrendingUp,    label: 'Exceso',    iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'faltante',  icon: TrendingDown,  label: 'Faltante',  iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
];

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
    const [mes, setMes] = useState([]);
    const [personas, setPersonas] = useState(() => new Map());
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [ocupado, setOcupado] = useState(null);           // id en curso
    const [abierto, setAbierto] = useState(null);           // id del corte en el detalle
    const [modoInicial, setModoInicial] = useState(null);

    const cargarLista = useCallback(async () => {
        const hasta = hoySV();
        const data = await fetchCortes({ desde: correrDia(hasta, -(DIAS_PENDIENTES - 1)), hasta });
        if (!data) { setError('No se pudieron cargar los cortes'); setCargando(false); return; }
        setError(null);
        setFilas(data);
        setCargando(false);
        const autores = await fetchPersonas(data.map((c) => c.resuelto_por));
        setPersonas(new Map(autores.map((p) => [p.id, p])));
    }, []);

    const cargarMes = useCallback(async () => {
        const hasta = hoySV();
        const data = await fetchCortesResumen({ desde: `${hasta.slice(0, 7)}-01`, hasta });
        setMes(data || []);
    }, []);

    useEffect(() => {
        cargarLista(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco
        const t = setInterval(cargarLista, REFRESCO_MS);
        return () => clearInterval(t);
    }, [cargarLista]);

    useEffect(() => {
        cargarMes(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + refresco
        const t = setInterval(cargarMes, REFRESCO_MES_MS);
        return () => clearInterval(t);
    }, [cargarMes]);

    // ── El alcance, decidido UNA vez ────────────────────────────────────────
    // La lista y el resumen tienen que hablar de las mismas salas. Si cada uno
    // resolviera su propio respaldo —«si la mía no tiene, mostrá todas»— podrían
    // terminar en alcances distintos y la baldosa diría «3 sin confirmar» arriba
    // con una sola tarjeta abajo.
    const salaFiltro = useMemo(() => {
        if (salaElegida) return Number(salaElegida);
        if (!soloMiSala || miSala == null) return null;
        const tieneCortes = mes.some((c) => c.branch_id === Number(miSala))
            || filas.some((c) => c.branch_id === Number(miSala));
        return tieneCortes ? Number(miSala) : null;
    }, [salaElegida, soloMiSala, miSala, mes, filas]);

    const deLaSala = useCallback(
        (lista) => (salaFiltro == null ? lista : lista.filter((c) => c.branch_id === salaFiltro)),
        [salaFiltro],
    );

    const resumen = useMemo(
        () => resumenDeCortes(conTramoPorSalaYDia(deLaSala(mes))),
        [mes, deLaSala],
    );

    const conTramo = useMemo(
        () => conTramoPorSalaYDia(deLaSala(filas)),
        [filas, deLaSala],
    );

    // Lo que hay que hacer: los cortes de caja que siguen sin resolver, del más
    // reciente al más viejo.
    const pendientes = useMemo(() => conTramo
        .filter((c) => c.tipo === 'C' && c.estado === 'PENDIENTE')
        .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
            || String(b.hora).localeCompare(String(a.hora))),
    [conTramo]);

    const variasSalas = useMemo(
        () => new Set(pendientes.map((c) => c.branch_id)).size > 1,
        [pendientes],
    );

    const corteAbierto = useMemo(
        () => (abierto == null ? null : conTramo.find((c) => c.id === abierto) || null),
        [abierto, conTramo],
    );

    const recargar = useCallback(() => { cargarLista(); cargarMes(); }, [cargarLista, cargarMes]);

    const abrirDetalle = useCallback((corte, modo) => {
        setModoInicial(modo || null);
        setAbierto(corte.id);
    }, []);

    // El camino de un clic: sólo para los que cuadran al centavo. Cuál es cuál
    // lo decide `TarjetaCorte`, para que el Inicio y el módulo no discrepen.
    const confirmarRapido = useCallback(async (corte) => {
        setOcupado(corte.id);
        const { error: err } = await resolverCorte(corte.id, 'CONFIRMADO');
        setOcupado(null);
        if (err) {
            showToast?.('No se pudo guardar', mensajeAmigable(err, 'Vuelve a intentar en un momento.'), 'error');
            return;
        }
        appendAuditLog?.('CORTE_CAJA_CONFIRMADO', user?.id, {
            corte_id: corte.id, sucursal: nombreSala[corte.branch_id],
            fecha: corte.fecha, hora: corte.hora, diferencia: corte.tramo, origen: 'inicio',
        });
        showToast?.('Corte confirmado', `${nombreSala[corte.branch_id] || ''} · ${String(corte.hora).slice(0, 5)}`.trim(), 'success');
        recargar();
    }, [showToast, appendAuditLog, user, nombreSala, recargar]);

    if (cargando) return <div className="p-3"><SkeletonText lines={3} /></div>;

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* ── Cómo va el mes ──────────────────────────────────────────── */}
            <div className="shrink-0 px-2 pt-2 pb-1 border-b border-divider">
                <div className="flex items-baseline justify-between gap-2 mb-1 px-0.5">
                    <span className="text-caption font-black uppercase tracking-widest text-content-3">
                        Este mes
                    </span>
                    <span className="text-caption text-content-3 tabular-nums truncate">
                        {resumen.pendientes} sin confirmar · {resumen.confirmados} {resumen.confirmados === 1 ? 'confirmado' : 'confirmados'}
                    </span>
                </div>
                <CarrilCards ariaLabel="Cortes del mes">
                    {METRICAS_MES.map((m) => (
                        <StatCard key={m.clave} densa icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                            label={m.label} value={resumen[m.clave]} valueCls={m.valueCls} />
                    ))}
                </CarrilCards>
            </div>

            {/* ── Lo que falta confirmar ──────────────────────────────────── */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2 space-y-1.5">
                {error && (
                    <EmptyState linea icon={Wallet} title="No se pudieron cargar" subtitle={error} />
                )}

                {/* Vacío FELIZ (§26.3): acá no hay nada porque no quedó nada
                    pendiente, y eso es la buena noticia. Forzar «Sin cortes
                    pendientes» tiraría al piso justo lo que la sala quiere leer. */}
                {!error && !pendientes.length && (
                    <EmptyState
                        linea
                        icon={ShieldCheck}
                        iconClass="text-success-text"
                        title="Todo confirmado"
                        subtitle={`Sin pendientes en los últimos ${DIAS_PENDIENTES} días.`}
                    />
                )}

                {/* La franja de arriba cuenta el MES y la lista muestra los
                    últimos 7 días. Cuando no coinciden hay que decirlo: una
                    lista más corta que su propio número se lee como «ya está
                    todo», que es justo lo contrario. */}
                {!error && resumen.pendientes > pendientes.length && (
                    <p className="text-caption text-content-3 text-center px-2 pt-1">
                        Hay {resumen.pendientes - pendientes.length} sin confirmar de antes de
                        {' '}{DIAS_PENDIENTES} días. Están en Cortes de caja.
                    </p>
                )}

                {!error && pendientes.map((c) => (
                    <TarjetaCorte
                        key={c.id}
                        corte={c}
                        compacta
                        sala={[
                            variasSalas ? nombreSala[c.branch_id] : null,
                            c.fecha !== hoySV() ? rotularDia(c.fecha) : null,
                        ].filter(Boolean).join(' · ') || null}
                        persona={personas.get(c.resuelto_por) || null}
                        puedeResolver={puedeResolver}
                        ocupado={ocupado === c.id}
                        onAbrir={abrirDetalle}
                        onConfirmar={confirmarRapido}
                    />
                ))}
            </div>

            <CorteDetalleModal
                corte={corteAbierto}
                nombreSala={nombreSala}
                modoInicial={modoInicial}
                onClose={() => { setAbierto(null); setModoInicial(null); }}
                onResuelto={recargar}
                origen="inicio"
            />
        </div>
    );
}
