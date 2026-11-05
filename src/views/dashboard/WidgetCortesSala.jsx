import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ShieldCheck, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import Button from '../../components/common/Button';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import { EmptyState, SkeletonText } from '../../components/common/StateViews';
import { useResumenWidget } from './tamanoWidget';
import TarjetaCorte from '../../components/cortes/TarjetaCorte';
import { fetchCortes, fetchCortesResumen, fetchPersonas } from '@nucleo/data/cortes';
import { conTramoPorSalaYDia, resumenDeCortes } from '@nucleo/utils/cortesDiagnostico';
import { useAuth } from '@nucleo/context/AuthContext';
import useResolverCorte from '../../components/cortes/useResolverCorte';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fechaTexto, hoySV, sumarDias } from '@nucleo/utils/fecha';
import useRefrescoEnVivo from '@nucleo/hooks/useRefrescoEnVivo';

/* El detalle del corte se baja al abrir uno, no al entrar al Inicio.
 *
 * Es 13 kB gzip con lo que arrastra —la impresión en ticketera y el asiento de
 * diferencias— y es lo más pesado que traía esta baldosa a lo que se descarga
 * al entrar. La campana ya lo cargaba así desde que decide en el sitio; acá
 * seguía estático.
 *
 * `TarjetaCorte` NO: es lo que la baldosa dibuja, se ve sin tocar nada. */
const CorteDetalleModal = lazy(() => import('../../components/cortes/CorteDetalleModal'));

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


const rotularDia = (fecha) => {
    const hoy = hoySV();
    if (fecha === hoy) return 'Hoy';
    if (fecha === sumarDias(hoy, -1)) return 'Ayer';
    return fechaTexto(fecha, {
        day: 'numeric', month: 'short' });
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
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');
    // El enlace a la lista completa sólo si la pantalla se puede abrir: un
    // enlace que termina en «sin permiso» enseña a no apretarlo.
    const puedeVerCortes = hasPermission('cortes_caja', 'can_view');
    const navigate = useNavigate();

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

    // La misma escritura que el módulo y el detalle — ver `useResolverCorte`.
    const { resolver, ocupadoId, dialogoDeEntrega } = useResolverCorte({ nombreSala, origen: 'inicio' });

    const [filas, setFilas] = useState([]);
    const [mes, setMes] = useState([]);
    // El resumen del mes se pide aparte y puede fallar solo: un fallo NO es
    // «0 cuadraron, 0 faltantes», es que no se pudo leer.
    const [errorMes, setErrorMes] = useState(false);
    const [personas, setPersonas] = useState(() => new Map());
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [abierto, setAbierto] = useState(null);           // id del corte en el detalle
    const [modoInicial, setModoInicial] = useState(null);
    /* Se enciende al abrir el primero y ya no se apaga: el diálogo tiene que
     * quedar montado con `corte` en nulo para hacer su salida en vez de
     * desaparecer de golpe, así que la condición es «ya se abrió alguno», no
     * «hay uno abierto». Mismo patrón que la campana. */
    const [montarDetalle, setMontarDetalle] = useState(false);

    const cargarLista = useCallback(async () => {
        const hasta = hoySV();
        const data = await fetchCortes({ desde: sumarDias(hasta, -(DIAS_PENDIENTES - 1)), hasta });
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
        // Si falla se conserva lo último que se leyó para el alcance, pero la
        // franja dice que no se pudo leer en vez de pintar ceros.
        if (!data) { setErrorMes(true); return; }
        setErrorMes(false);
        setMes(data);
    }, []);

    // La carga inicial acá; el refresco, con `useRefrescoEnVivo`: con la
    // pestaña oculta no consulta y, al volver, lee una vez si ya venció.
    useEffect(() => {
        cargarLista(); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial
        cargarMes();
    }, [cargarLista, cargarMes]);
    useRefrescoEnVivo(cargarLista, { ms: REFRESCO_MS });
    useRefrescoEnVivo(cargarMes, { ms: REFRESCO_MES_MS });

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

    // Los sin confirmar del MES que ya quedaron fuera de la ventana de la lista.
    // Se cuentan con la misma regla que la lista —corte C en PENDIENTE— y por
    // fecha, no restando dos números de universos distintos: el resumen del mes
    // deja fuera los que no contaron efectivo y la lista no, y a principio de
    // mes la ventana de 7 días toma días del mes anterior que el resumen no ve.
    // Restar daba avisos de más y de menos.
    const fueraDeLaVentana = useMemo(() => {
        const desdeLista = sumarDias(hoySV(), -(DIAS_PENDIENTES - 1));
        return deLaSala(mes).filter((c) => c.tipo === 'C' && c.estado === 'PENDIENTE'
            && String(c.fecha) < desdeLista).length;
    }, [mes, deLaSala]);

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
        setMontarDetalle(true);
        setModoInicial(modo || null);
        setAbierto(corte.id);
    }, []);

    // Estable a propósito, no una flecha en línea: `ModalShell` la recibe y una
    // identidad nueva en cada render le reinicia efectos mientras el diálogo
    // está abierto. Y esta baldosa se re-renderiza sola cada minuto.
    const cerrarDetalle = useCallback(() => { setAbierto(null); setModoInicial(null); }, []);

    // El camino de un clic: sólo para los que cuadran al centavo. Cuál es cuál
    // lo decide `TarjetaCorte`, para que el Inicio y el módulo no discrepen.
    const confirmarRapido = useCallback(async (corte) => {
        if (await resolver(corte, 'CONFIRMADO')) recargar();
    }, [resolver, recargar]);

    useResumenWidget(cargando ? null
        : error ? { texto: 'No se pudieron cargar', tono: 'danger' }
        : pendientes.length ? { valor: pendientes.length, texto: pendientes.length === 1 ? 'corte sin confirmar' : 'cortes sin confirmar', tono: 'warning', accion: { texto: 'Confirmar' } }
        : { texto: 'Todo confirmado' });

    if (cargando) return <div className="p-3"><SkeletonText lines={3} /></div>;

    return (
        <div className="h-full flex flex-col min-h-0">
            {/* ── Cómo va el mes ──────────────────────────────────────────── */}
            <div className="shrink-0 px-2 pt-2 pb-1 border-b border-divider">
                {/* Cada número dice de qué habla: «sin confirmar» es lo de la
                    lista de abajo (los últimos 7 días) y «confirmados» y las tres
                    tarjetas son del mes. El mismo rótulo para dos universos es
                    cómo la franja decía 3 con una sola tarjeta abajo. */}
                <div className="flex items-baseline justify-between gap-2 mb-1 px-0.5">
                    <span className="text-caption font-black uppercase tracking-widest text-content-3">
                        Este mes
                    </span>
                    {!error && !errorMes && (
                        <span className="text-caption text-content-3 tabular-nums truncate"
                            title={`${pendientes.length} sin confirmar en los últimos ${DIAS_PENDIENTES} días · ${resumen.confirmados} confirmados este mes`}>
                            {pendientes.length} sin confirmar ({DIAS_PENDIENTES} días) · {resumen.confirmados} {resumen.confirmados === 1 ? 'confirmado' : 'confirmados'}
                        </span>
                    )}
                </div>
                {errorMes ? (
                    <EmptyState linea icon={AlertTriangle} title="No se pudo leer el resumen del mes" />
                ) : (
                    <CarrilCards ariaLabel="Cortes del mes">
                        {METRICAS_MES.map((m) => (
                            <StatCard key={m.clave} densa icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                label={m.label} value={resumen[m.clave]} valueCls={m.valueCls} />
                        ))}
                    </CarrilCards>
                )}
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

                {/* La lista muestra los últimos 7 días. Si en el mes quedaron sin
                    confirmar de antes, hay que decirlo: una lista vacía se lee
                    como «ya está todo», que es justo lo contrario. */}
                {!error && !errorMes && fueraDeLaVentana > 0 && (
                    <div className="flex flex-col items-center gap-1 px-2 pt-1">
                        <p className="text-caption text-content-3 text-center">
                            {fueraDeLaVentana === 1 ? 'Hay 1 sin confirmar' : `Hay ${fueraDeLaVentana} sin confirmar`} de este mes
                            {' '}con más de {DIAS_PENDIENTES} días.{puedeVerCortes ? '' : ' Están en Cortes de caja.'}
                        </p>
                        {puedeVerCortes && (
                            <Button variant="ghost" size="xs" icon={ArrowRight}
                                onClick={() => navigate('/caja?tab=cortes')}>
                                Ver en Cortes de caja
                            </Button>
                        )}
                    </div>
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
                        ocupado={ocupadoId === c.id}
                        onAbrir={abrirDetalle}
                        onConfirmar={confirmarRapido}
                    />
                ))}
            </div>

            {montarDetalle && (
                <Suspense fallback={null}>
                    <CorteDetalleModal
                        corte={corteAbierto}
                        nombreSala={nombreSala}
                        modoInicial={modoInicial}
                        onClose={cerrarDetalle}
                        onResuelto={recargar}
                        origen="inicio"
                    />
                </Suspense>
            )}

            {/* La entrega de la caja al confirmar — ver `useResolverCorte`. */}
            {dialogoDeEntrega}
        </div>
    );
}
