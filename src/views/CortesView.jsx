import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarDays, CheckCircle2, Clock, DoorOpen, Landmark, Pencil, Scale, Search, ShieldCheck, Trash2, TrendingDown, TrendingUp, UserX, Wallet } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import FilterBar from '../components/common/FilterBar';
import Button from '../components/common/Button';
import CarrilCards from '../components/common/CarrilCards';
import PeriodPicker from '../components/common/PeriodPicker';
import PeriodStepper from '../components/common/PeriodStepper';
import StatCard from '../components/common/StatCard';
import TablePagination from '../components/common/TablePagination';
import Notice from '../components/common/Notice';
import { EmptyState, LoadingState } from '../components/common/StateViews';
import AsentarDiferencias from '../components/cortes/AsentarDiferencias';
import CorteDetalleModal from '../components/cortes/CorteDetalleModal';
import AperturasDeCaja from '../components/cortes/AperturasDeCaja';
import MovimientosDeCaja from '../components/cortes/MovimientosDeCaja';
import TarjetaCorte from '../components/cortes/TarjetaCorte';
import { useStaffStore as useStaff } from '../store/staffStore';
import { useAuth } from '../context/AuthContext';
import useResolverCorte from '../hooks/useResolverCorte';
import { usePestanaEnUrl } from '../hooks/usePestanaEnUrl';
import {
    fetchAperturas, fetchCortes, fetchDiferencias, fetchEntradasParaCruce,
    fetchHistorialDeMovimientos, fetchMovimientosDeCaja, fetchPersonas,
} from '../data/cortes';
import { conTramoPorSalaYDia, resumenDeCortes, severidad } from '../utils/cortesDiagnostico';
import { correrPeriodo, granularidadDePeriodo, periodoAlcanzaHoy } from '../utils/periodo';
import { formatMoney } from '../utils/formatNumber';
import { tokenMatch } from '../utils/searchUtils';

// ── Bolsas de efectivo salió de acá el 2026-08-24 ───────────────────────────
//
// Fue una pestaña de esta vista desde que existe, con un argumento bueno: es lo
// que le pasa al MISMO dinero después del corte, y separarlo obligaría a saltar
// de pantalla para seguir un billete. Lo abrió el usuario: «me estoy perdiendo
// en los pasos, al tener tantos, me pierdo y no sé dónde está qué».
//
// Son dos trabajos con dos públicos —un corte se confirma o se descarta; una
// bolsa se entrega, se recibe, se cuenta y se deposita—, y compartir vista los
// obligaba a compartir una píldora que cambiaba de significado según la
// pestaña: dos períodos distintos, dos carriles, ranuras que aparecían y
// desaparecían. Hoy Bolsas es `/bolsas` (`BolsasView`), con las cuatro etapas
// como pestañas propias y su contador en cada una.
//
// Esta vista se quedó SIN pestañas hasta v2.838.0: los estados de un corte ya
// viven en la píldora del cuerpo (ver la nota de `ESTADOS`), y cinco recortes de
// la misma lista no son cinco secciones.
//
// ── Y entonces por qué SÍ hay dos pestañas ahora ────────────────────────────
// Porque «Movimientos» no es un recorte de los cortes: es otra lista, con otras
// filas. La píldora del header contesta «¿qué sección estoy viendo?» (§16.9) y
// acá hay dos respuestas honestas — los cortes, y las entradas y salidas de
// efectivo que los explican.
//
// La lección de Bolsas se respeta y por eso NO son dos rutas: lo que hizo
// insostenible aquella convivencia era que la píldora del período CAMBIABA de
// significado según la pestaña —un corte pasa en un instante, una bolsa vive
// días—. Acá sucursal y período significan exactamente lo mismo en las dos, así
// que se comparten; lo que cambia son las dos ranuras de la derecha.
const PESTANAS = [
    { key: 'cortes',      label: 'Cortes',      icon: Wallet },
    { key: 'movimientos', label: 'Movimientos', icon: ArrowDownLeft },
    // «Aperturas» y NO «Turnos»: esa palabra ya es el turno de trabajo de
    // Horarios, y el sistema de la caja la usa para un tercer sentido —el
    // número 1, 2 ó 3 que sale en el tiquete dentro de una misma apertura—.
    { key: 'aperturas',   label: 'Aperturas',   icon: DoorOpen },
];

const VACIO = [];

// Hora de El Salvador (UTC−6, sin horario de verano). Se calcula así y no con
// la fecha local del equipo porque la fecha del corte es la de la sala: un
// navegador en otro huso mostraría el día equivocado sin avisar.
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
        weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
    });
};

// ── Los estados NO son pestañas: son filtros (§16.9) ────────────────────────
//
// Reportado por el usuario (2026-08-14): «las pestañas no deberían ser filtros?
// ya que no son vistas diferentes, solo estados de los cortes». Es exactamente
// lo que dice §16.9 — la píldora del HEADER (`ViewTabBar`) contesta «¿qué
// sección estoy viendo?» y la del CUERPO (`FilterBar`) contesta «¿qué recorte?».
// Cinco pestañas que muestran la MISMA lista recortada son cinco recortes, no
// cinco secciones. En el header queda sólo el buscador.
//
// Y se parten en DOS ranuras, porque eran dos preguntas metidas en una fila:
// «Con diferencia» no es un estado, es una severidad. Separadas se pueden
// cruzar —los confirmados con faltante, que antes no se podían pedir— y cada
// una queda en su sitio del orden canónico (ámbito → entidad → tiempo → estado).
const ESTADOS = [
    { value: 'TODOS',      label: 'Cualquier estado' },
    { value: 'PENDIENTE',  label: 'Sin confirmar' },
    { value: 'CONFIRMADO', label: 'Confirmados' },
    { value: 'DESCARTADO', label: 'Descartados' },
];

const DIFERENCIAS = [
    { value: 'TODAS', label: 'Cualquier cifra' },
    { value: 'ok',    label: 'Cuadraron' },
    { value: 'sobra', label: 'Con exceso' },
    { value: 'falta', label: 'Con faltante' },
];

// Los dos recortes propios de «Movimientos». Van acá y no dentro del componente
// porque el lugar único donde se mira qué se filtra es la píldora del cuerpo
// (§17), y ésa la arma esta vista.
const TIPOS_MOV = [
    { value: 'TODOS',   label: 'Entradas y salidas' },
    { value: 'ENTRADA', label: 'Sólo entradas' },
    { value: 'SALIDA',  label: 'Sólo salidas' },
];

// «Ya no está» es un estado y no una fila borrada: cuando un movimiento
// desaparece del sistema de la caja, esta lista es lo único que queda de él.
const ESTADOS_MOV = [
    { value: 'TODOS',         label: 'Cualquier estado' },
    { value: 'VIGENTES',      label: 'Vigentes' },
    { value: 'EDITADOS',      label: 'Se modificaron' },
    { value: 'DESAPARECIDOS', label: 'Ya no están' },
];

// Las dos preguntas de «Aperturas», en dos ranuras y no en una: «¿sigue
// abierta?» y «¿la abrió una persona?» son independientes, y juntas no se
// podrían cruzar —una caja abierta AHORA con una cuenta compartida es
// exactamente la fila que hay que mirar—.
const ESTADOS_APER = [
    { value: 'TODAS',    label: 'Abiertas y cerradas' },
    { value: 'ABIERTAS', label: 'Abiertas ahora' },
    { value: 'CERRADAS', label: 'Ya cerradas' },
];

const QUIEN_APER = [
    { value: 'TODOS',   label: 'Cualquiera' },
    { value: 'PERSONA', label: 'Abrió una persona' },
    { value: 'CUENTA',  label: 'Cuenta compartida' },
];

// El carril de la vista: cuatro números fijos, no un desglose de largo variable
// (§17.0 — «cuántas tarjetas hay lo fija la vista, nunca el dato»). Son las
// MISMAS cuatro que muestra la baldosa del Inicio, y salen del mismo
// `resumenDeCortes`: dos pantallas que cuentan por su cuenta terminan dando
// números distintos del mismo mes.
//
// Cada una es además el ATAJO de su filtro: es el patrón de `StaffManagementView`
// —«las tarjetas son el atajo visual, no el único acceso» (§17)—, y es lo que
// evita que el carril sea decoración al lado de una ranura que dice lo mismo.
const METRICAS = [
    { clave: 'pendientes', filtro: 'estado',     valor: 'PENDIENTE', icon: Clock,        label: 'Sin confirmar', iconBg: 'bg-brand/10',   iconCls: 'text-brand-text' },
    { clave: 'cuadrados',  filtro: 'diferencia', valor: 'ok',        icon: ShieldCheck,  label: 'Cuadraron',     iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'exceso',     filtro: 'diferencia', valor: 'sobra',     icon: TrendingUp,   label: 'Exceso',        iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'faltante',   filtro: 'diferencia', valor: 'falta',     icon: TrendingDown, label: 'Faltante',      iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
];

const CortesView = () => {
    const branches = useStaff((s) => s.branches) || VACIO;
    const { hasPermission, getScope } = useAuth();
    const puedeResolver = hasPermission('cortes_caja', 'can_edit');
    // Quien ve una sola sala no elige sala: la policy de `cortes_caja` ya se lo
    // resolvió, y ofrecerle el filtro sería un control que no recorta nada.
    const alcanceTodas = getScope('cortes_caja') === 'ALL';


    // Arranca en HOY (regla del usuario, 2026-08-14). El período es
    // `PeriodPicker` y no tres chips de «7 · 30 · 90 días»: los chips contestan
    // tres preguntas y la pregunta real —«¿qué pasó el martes?»— no era ninguna
    // de las tres. Y es `PeriodPicker` y no `RangeDatePicker` porque es el que
    // nombra sus presets: con el rango de hoy la píldora dice **«Hoy»**, no
    // «14/08/2026 · 1d». Además cuenta los días en hora de El Salvador, que es
    // la que tiene la fecha de un corte.
    //
    // Su `value` es la cadena `inicio|fin` — el formato del canónico, el mismo
    // que usa Ventas.
    // Bolsas tenía el SUYO —30 días, porque una bolsa que lleva seis esperando
    // es la que hay que ver— y se fue con ella a `/bolsas`. Compartir la píldora
    // obligaba a dos períodos en la misma ranura: la más clara de las señales de
    // que eran dos vistas.
    const [periodo, setPeriodo] = useState(() => `${hoySV()}|${hoySV()}`);
    const [desde, hasta] = periodo.split('|');
    const [estado, setEstado] = useState('TODOS');
    const [diferencia, setDiferencia] = useState('TODAS');
    const [busqueda, setBusqueda] = useState('');
    const [sala, setSala] = useState('');

    const [cortes, setCortes] = useState(VACIO);
    const [personas, setPersonas] = useState(() => new Map());
    const [cargando, setCargando] = useState(true);
    // Las diferencias ya resueltas del período. Se piden con los cortes porque
    // lo que hay que HACER con ellas —anotarlas en el sistema— es trabajo
    // pendiente que la pantalla tiene que anunciar, no algo que se descubra
    // abriendo corte por corte.
    const [difs, setDifs] = useState(VACIO);
    const [asentando, setAsentando] = useState(false);

    // El detalle: qué corte está abierto y con qué modo. Lo que se PINTA
    // mientras el panel sale lo resuelve el propio modal.
    const [abierto, setAbierto] = useState(null);           // id del corte
    const [modoInicial, setModoInicial] = useState(null);

    const [pagina, setPagina] = useState(1);
    const [porPagina, setPorPagina] = useState(50);

    // La pestaña vive en la DIRECCIÓN y no en `useState`: la sesión de sala se
    // cierra sola a los 5 minutos y el service worker recarga al publicar, así
    // que una pestaña en memoria devuelve a «Cortes» sin decir nada — y eso no
    // se reporta como un defecto, se reporta como «la pantalla se movió sola».
    const [pestana, setPestana] = usePestanaEnUrl(PESTANAS, 'cortes');
    const enMovimientos = pestana === 'movimientos';
    const enAperturas   = pestana === 'aperturas';

    const [movs, setMovs] = useState(VACIO);
    const [historial, setHistorial] = useState(VACIO);
    const [cargandoMovs, setCargandoMovs] = useState(false);
    const [tipoMov, setTipoMov] = useState('TODOS');
    const [estadoMov, setEstadoMov] = useState('TODOS');

    const [aperturas, setAperturas] = useState(VACIO);
    const [entradas, setEntradas] = useState(VACIO);
    const [pudeAsistencia, setPudeAsistencia] = useState(true);
    const [cargandoAper, setCargandoAper] = useState(false);
    const [estadoAper, setEstadoAper] = useState('TODAS');
    const [quienAper, setQuienAper] = useState('TODOS');

    const cargar = useCallback(async () => {
        setCargando(true);
        const filas = await fetchCortes({ desde, hasta });
        setCortes(filas || VACIO);
        setCargando(false);
        // Quién firmó cada decisión. Se pide aparte y después: la tarjeta se
        // pinta con o sin la cara, y esperar a las fotos para mostrar los
        // cortes retrasaría lo único que la pantalla tiene que hacer.
        const autores = await fetchPersonas((filas || []).map((c) => c.resuelto_por));
        setPersonas(new Map(autores.map((p) => [p.id, p])));
        setDifs(await fetchDiferencias({ desde, hasta }) || VACIO);
    }, [desde, hasta]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial + al cambiar el rango

    // Los movimientos se piden SÓLO con la pestaña abierta: son ~130 por día
    // entre las seis salas y no aportan nada a la lista de cortes, así que
    // traerlos siempre sería pagar un mes de filas para no mirarlas.
    const cargarMovs = useCallback(async () => {
        if (!enMovimientos) return;
        setCargandoMovs(true);
        const [filas, cambios] = await Promise.all([
            fetchMovimientosDeCaja({ desde, hasta, branchId: sala || null }),
            fetchHistorialDeMovimientos({ desde, hasta, branchId: sala || null }),
        ]);
        setMovs(filas || VACIO);
        setHistorial(cambios || VACIO);
        setCargandoMovs(false);
    }, [enMovimientos, desde, hasta, sala]);

    useEffect(() => { cargarMovs(); }, [cargarMovs]); // eslint-disable-line react-hooks/set-state-in-effect -- al abrir la pestaña y al cambiar sala o rango

    // Las aperturas y las marcaciones con las que se cruzan. La asistencia va
    // aparte y sin `branchId`: se cruza por PERSONA, y una persona puede haber
    // marcado en otra sala —cubrir un turno ajeno es normal— así que acotarla
    // por sala haría aparecer un «no marcó» que no es cierto.
    const cargarAper = useCallback(async () => {
        if (!enAperturas) return;
        setCargandoAper(true);
        const [filas, asistencia] = await Promise.all([
            fetchAperturas({ desde, hasta, branchId: sala || null }),
            fetchEntradasParaCruce({ desde, hasta }),
        ]);
        setAperturas(filas || VACIO);
        setEntradas(asistencia.filas || VACIO);
        setPudeAsistencia(asistencia.pude);
        setCargandoAper(false);
    }, [enAperturas, desde, hasta, sala]);

    useEffect(() => { cargarAper(); }, [cargarAper]); // eslint-disable-line react-hooks/set-state-in-effect -- al abrir la pestaña y al cambiar sala o rango

    const nombreSala = useMemo(() => {
        const m = {};
        for (const b of branches) m[b.id] = b.name;
        return m;
    }, [branches]);

    // La escritura (bitácora y avisos incluidos) es la misma para las cuatro
    // pantallas que resuelven un corte. Ver `useResolverCorte`.
    const { resolver, ocupadoId } = useResolverCorte({ nombreSala, origen: 'modulo' });

    // El tramo se calcula POR SALA Y POR DÍA — el porqué está en
    // `conTramoPorSalaYDia`, que es el mismo cálculo que usa el Inicio.
    const conTramoTodos = useMemo(() => {
        const out = conTramoPorSalaYDia(cortes);
        out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))
            || String(b.hora).localeCompare(String(a.hora)));
        return out;
    }, [cortes]);

    // El carril describe el PERÍODO y la sucursal elegida, no lo que las otras
    // ranuras recortan: son recortes de este mismo conjunto, así que si el
    // carril los siguiera, «Sin confirmar» diría 23 y al aplicarlo diría 23 otra
    // vez, con las otras tres en cero. Y como cada tarjeta ES el atajo de su
    // filtro, un número que cambia al apretarlo no se podría volver a apretar.
    const resumen = useMemo(
        () => resumenDeCortes(sala
            ? conTramoTodos.filter((c) => String(c.branch_id) === String(sala))
            : conTramoTodos),
        [conTramoTodos, sala],
    );

    // `MovimientosDeCaja` pide un Map y no el objeto de arriba: adentro se
    // consulta por fila y por token de búsqueda, y un `Map` no confunde un
    // `branch_id` con una propiedad heredada del prototipo.
    const salasMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

    // Las cuatro cifras de «Movimientos», con la misma regla que las de arriba:
    // describen el PERÍODO y la sala elegida, no lo que las otras ranuras
    // recortan. Dos son dinero y dos son hallazgos.
    //
    // Los desaparecidos NO suman a las dos primeras: un movimiento que ya no
    // está tampoco está en la caja, y meterlo en el total daría una suma que no
    // coincide con ningún tiquete. Se cuentan en su propia tarjeta, que es
    // exactamente lo que hay que mirar.
    const resumenMovs = useMemo(() => {
        const editados = new Set(historial
            .filter((h) => h.cambio === 'EDITADO')
            .map((h) => `${h.branch_id}:${h.erp_movimiento_id}`));
        let entradas = 0, salidas = 0, tocados = 0, idos = 0;
        for (const m of movs) {
            if (m.desaparecido_at) { idos++; continue; }
            if (editados.has(`${m.branch_id}:${m.erp_movimiento_id}`)) tocados++;
            if (m.tipo === 'ENTRADA') entradas += Number(m.monto) || 0;
            else salidas += Number(m.monto) || 0;
        }
        return { entradas, salidas, tocados, idos };
    }, [movs, historial]);

    const METRICAS_MOV = useMemo(() => [
        { clave: 'entradas', filtro: 'tipo',   valor: 'ENTRADA',       icon: ArrowDownLeft, label: 'Entró',          valor_txt: formatMoney(resumenMovs.entradas), iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
        { clave: 'salidas',  filtro: 'tipo',   valor: 'SALIDA',        icon: ArrowUpRight,  label: 'Salió',          valor_txt: formatMoney(resumenMovs.salidas),  iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
        { clave: 'tocados',  filtro: 'estado', valor: 'EDITADOS',      icon: Pencil,        label: 'Se modificaron', valor_txt: resumenMovs.tocados,               iconBg: 'bg-brand/10',   iconCls: 'text-brand-text' },
        { clave: 'idos',     filtro: 'estado', valor: 'DESAPARECIDOS', icon: Trash2,        label: 'Ya no están',    valor_txt: resumenMovs.idos,                  iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: resumenMovs.idos ? 'text-danger-text' : undefined },
    ], [resumenMovs]);

    // Las cuatro de «Aperturas». «Sin marcación» sólo cuenta cuando hay con qué
    // cruzar: sin marcaciones en el período, un cero ahí diría «todos marcaron».
    const resumenAper = useMemo(() => {
        const marcaron = new Set(entradas.map((e) => e.employee_id));
        const hayConQueCruzar = pudeAsistencia && entradas.length > 0;
        return {
            total:      aperturas.length,
            abiertas:   aperturas.filter((a) => !a.cerrada_at).length,
            sinPersona: aperturas.filter((a) => !a.employee_id).length,
            sinMarcar:  hayConQueCruzar
                ? aperturas.filter((a) => a.employee_id && !marcaron.has(a.employee_id)).length
                : null,
        };
    }, [aperturas, entradas, pudeAsistencia]);

    const METRICAS_APER = useMemo(() => [
        { clave: 'total',      filtro: null,     valor: null,       icon: DoorOpen,   label: 'Aperturas',       valor_txt: resumenAper.total },
        { clave: 'abiertas',   filtro: 'estado', valor: 'ABIERTAS', icon: Clock,      label: 'Abiertas ahora',  valor_txt: resumenAper.abiertas,   iconBg: 'bg-success/10', iconCls: 'text-success-text' },
        { clave: 'sinPersona', filtro: 'quien',  valor: 'CUENTA',   icon: UserX,      label: 'Sin persona',     valor_txt: resumenAper.sinPersona, iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: resumenAper.sinPersona ? 'text-warning-text' : undefined },
        { clave: 'sinMarcar',  filtro: null,     valor: null,       icon: AlertTriangle, label: 'Sin marcación', valor_txt: resumenAper.sinMarcar ?? '—', iconBg: 'bg-danger/10', iconCls: 'text-danger-text', valueCls: resumenAper.sinMarcar ? 'text-danger-text' : undefined },
    ], [resumenAper]);

    const aplicarMetricaAper = useCallback((m) => {
        if (m.filtro === 'estado') setEstadoAper((v) => (v === m.valor ? 'TODAS' : m.valor));
        else if (m.filtro === 'quien') setQuienAper((v) => (v === m.valor ? 'TODOS' : m.valor));
    }, []);

    const aperturasFiltradas = useMemo(() => aperturas.filter((a) => {
        if (estadoAper === 'ABIERTAS' && a.cerrada_at) return false;
        if (estadoAper === 'CERRADAS' && !a.cerrada_at) return false;
        if (quienAper === 'PERSONA' && !a.employee_id) return false;
        if (quienAper === 'CUENTA'  && a.employee_id) return false;
        return true;
    }), [aperturas, estadoAper, quienAper]);

    const aplicarMetricaMov = useCallback((m) => {
        if (m.filtro === 'tipo') setTipoMov((v) => (v === m.valor ? 'TODOS' : m.valor));
        else setEstadoMov((v) => (v === m.valor ? 'TODOS' : m.valor));
    }, []);

    // Lo que falta anotar en el sistema. Sigue a la ranura de sala porque el
    // movimiento se hace POR sala: al mirar una sola, el aviso tiene que hablar
    // de esa y no del total de las seis. Las justificadas quedan fuera — no
    // mueven dinero, así que no hay nada que anotar allá.
    const sinAsentar = useMemo(() => (difs || []).filter((d) => (
        !d.anulada_at && !d.asentado_at && d.via !== 'JUSTIFICA'
        && (!sala || String(d.branch_id) === String(sala))
    )), [difs, sala]);

    const filtrados = useMemo(() => conTramoTodos.filter((c) => {
        if (sala && String(c.branch_id) !== String(sala)) return false;

        // El cierre del día (Z) no es un conteo, no se confirma y no tiene
        // diferencia: sólo aparece como contexto, cuando no hay ningún recorte
        // de estado ni de cifra. Bajo «Sin confirmar» no significaría nada.
        if (c.tipo === 'Z') {
            if (estado !== 'TODOS' || diferencia !== 'TODAS') return false;
        } else {
            if (estado !== 'TODOS' && c.estado !== estado) return false;
            if (diferencia !== 'TODAS' && severidad(c.tramo) !== diferencia) return false;
        }

        if (!busqueda.trim()) return true;
        return tokenMatch(busqueda,
            nombreSala[c.branch_id], c.empleado_texto, c.fecha, c.hora,
            String(c.total_declarado ?? ''), String(c.tramo ?? ''),
            String(c.erp_corte_id ?? ''), c.motivo_descarte);
    }), [conTramoTodos, estado, diferencia, busqueda, sala, nombreSala]);

    const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
    const pagActual = Math.min(pagina, totalPaginas);
    const enPagina = useMemo(
        () => filtrados.slice((pagActual - 1) * porPagina, pagActual * porPagina),
        [filtrados, pagActual, porPagina],
    );

    // Agrupar por día y, dentro del día, POR SALA. Los cortes de una sala son
    // una serie —cada uno se mide contra el anterior—, así que intercalarlos
    // con los de otra sala obliga a reconstruir mentalmente cuál sigue a cuál.
    // Cada sala queda entonces en su propia rejilla, que además aprovecha el
    // ancho: en escritorio entran tres tarjetas por renglón donde antes iba
    // una fila.
    const porDia = useMemo(() => {
        const dias_ = new Map();
        for (const c of enPagina) {
            if (!dias_.has(c.fecha)) dias_.set(c.fecha, new Map());
            const salas = dias_.get(c.fecha);
            if (!salas.has(c.branch_id)) salas.set(c.branch_id, []);
            salas.get(c.branch_id).push(c);
        }
        return [...dias_.entries()].map(([fecha, salas]) => {
            const grupos = [...salas.entries()]
                .map(([branchId, lista]) => ({
                    branchId,
                    nombre: nombreSala[branchId] || `Sucursal ${branchId}`,
                    lista,
                    conDiferencia: lista.filter((c) => c.tipo === 'C' && severidad(c.tramo) !== 'ok').length,
                }))
                .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
            return {
                fecha,
                grupos,
                total: grupos.reduce((n, g) => n + g.lista.length, 0),
                conDiferencia: grupos.reduce((n, g) => n + g.conDiferencia, 0),
            };
        });
    }, [enPagina, nombreSala]);

    const corteAbierto = useMemo(
        () => (abierto == null ? null : conTramoTodos.find((c) => c.id === abierto) || null),
        [abierto, conTramoTodos],
    );

    const abrirDetalle = useCallback((corte, modo) => {
        setModoInicial(modo || null);
        setAbierto(corte.id);
    }, []);

    const cerrarDetalle = useCallback(() => { setAbierto(null); setModoInicial(null); }, []);

    // El camino de un clic: sólo para los que cuadran al centavo. La decisión
    // de cuándo se usa vive en `TarjetaCorte`, para que el Inicio y el módulo
    // no puedan discrepar; la escritura, en `useResolverCorte`, por lo mismo.
    const confirmarRapido = useCallback(async (corte) => {
        if (await resolver(corte, 'CONFIRMADO')) cargar();
    }, [resolver, cargar]);

    const salaOptions = useMemo(
        () => branches
            .filter((b) => cortes.some((c) => String(c.branch_id) === String(b.id)))
            .map((b) => ({ value: String(b.id), label: b.name })),
        [branches, cortes],
    );

    const HOY = `${hoySV()}|${hoySV()}`;
    const verPeriodo = useCallback((v) => {
        setPeriodo(v || `${hoySV()}|${hoySV()}`);
        setPagina(1);
    }, []);
    const periodoIntacto = periodo === HOY;

    // Las flechas corren el período por SU propia unidad: un día pasa al día
    // siguiente, un mes al mes siguiente, un año al año siguiente. La cuenta
    // vive en `PeriodPicker` —es quien define el formato `inicio|fin`— para que
    // quien lo escribe y quien lo corre no puedan discrepar.
    const { unidad } = granularidadDePeriodo(periodo);
    const correr = useCallback((dir) => verPeriodo(correrPeriodo(periodo, dir)),
        [periodo, verPeriodo]);

    // Las tarjetas del carril son el ATAJO de su ranura: apretar «Faltante»
    // aplica el mismo filtro que elegirlo en la píldora, y volver a apretarla lo
    // quita. Sin el segundo clic, una tarjeta que ya está aplicada es un botón
    // que no hace nada.
    const aplicarMetrica = useCallback((m) => {
        setPagina(1);
        if (m.filtro === 'estado') setEstado((v) => (v === m.valor ? 'TODOS' : m.valor));
        else setDiferencia((v) => (v === m.valor ? 'TODAS' : m.valor));
    }, []);
    const metricaActiva = (m) => (m.filtro === 'estado' ? estado : diferencia) === m.valor;

    const limpiar = () => {
        setSala(''); setPeriodo(HOY);
        setEstado('TODOS'); setDiferencia('TODAS');
        setTipoMov('TODOS'); setEstadoMov('TODOS');
        setEstadoAper('TODAS'); setQuienAper('TODOS');
        setBusqueda(''); setPagina(1);
    };


    // El buscador dice QUÉ se puede buscar, y eso cambia con la pestaña: en
    // movimientos no hay personas ni horas, y ofrecerlas sería prometer una
    // búsqueda que devuelve vacío sin explicar por qué.
    const filtersContent = (
        <ViewTabBar
            tabs={PESTANAS}
            activeTab={pestana}
            onTabChange={setPestana}
            searchValue={busqueda}
            onSearchChange={(v) => { setBusqueda(v); setPagina(1); }}
            placeholder={enAperturas
                ? 'Buscar por sala, persona u hora…'
                : enMovimientos
                    ? 'Buscar por concepto, sala o monto…'
                    : 'Buscar por sala, persona, hora o monto…'}
        />
    );

    return (
        <GlassViewLayout icon={Wallet} title="Cortes de caja" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">

                {/* El carril y la píldora comparten UNA fila (§17.0): las dos
                    mitades —`lg:flex-row` acá y `flex-1` en el carril— son
                    obligatorias, porque `useMedidaFila` busca el carril en el
                    abuelo de la píldora y le descuenta 314px lo tenga al lado o
                    no. En renglones separados no falla: roba ancho en silencio. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* Cuatro números fijos del período, y cada uno es el ATAJO
                        de su ranura (§17.0). El carril del efectivo se fue con
                        Bolsas a `/bolsas`: describía otro circuito y compartir
                        fila obligaba a que la misma tira de tarjetas cambiara de
                        tema según la pestaña. */}
                    {/* Cuatro tarjetas en las dos pestañas, y en las dos cada
                        una es el atajo de su ranura. Las de movimientos no son
                        las mismas cuatro con otro número: son otras preguntas
                        —cuánto entró, cuánto salió, a cuántos los tocaron—, que
                        es justamente por qué esto es una sección y no un
                        recorte. */}
                    <CarrilCards className="flex-1"
                        ariaLabel={enMovimientos
                            ? 'Resumen de los movimientos del período'
                            : 'Resumen de los cortes del período'}>
                        {enAperturas
                            ? METRICAS_APER.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={m.valor_txt} valueCls={m.valueCls}
                                    active={m.filtro === 'estado' ? estadoAper === m.valor
                                        : m.filtro === 'quien' ? quienAper === m.valor : false}
                                    onClick={m.filtro ? () => aplicarMetricaAper(m) : undefined}
                                    loading={cargandoAper} />
                            ))
                            : enMovimientos
                            ? METRICAS_MOV.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={m.valor_txt} valueCls={m.valueCls}
                                    active={(m.filtro === 'tipo' ? tipoMov : estadoMov) === m.valor}
                                    onClick={() => aplicarMetricaMov(m)}
                                    loading={cargandoMovs} />
                            ))
                            : METRICAS.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={resumen[m.clave]} valueCls={m.valueCls}
                                    active={metricaActiva(m)} onClick={() => aplicarMetrica(m)}
                                    loading={cargando} />
                            ))}
                    </CarrilCards>

                    {/* El orden de las ranuras es el de §17: ámbito → entidad →
                        tiempo → estado. `MAX_RANURAS` son 3, así que la cuarta
                        vive tras el `···` — y una ranura APLICADA nunca se
                        esconde, que es lo que hace que el cupo no rompa la
                        promesa de «el lugar único donde mirar qué se filtra». */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar onClear={limpiar}
                            activeCount={[sala, !periodoIntacto,
                                enAperturas ? estadoAper !== 'TODAS' : enMovimientos ? tipoMov !== 'TODOS' : estado !== 'TODOS',
                                enAperturas ? quienAper !== 'TODOS' : enMovimientos ? estadoMov !== 'TODOS' : diferencia !== 'TODAS',
                            ].filter(Boolean).length}>
                            {/* La ranura de sucursal SÓLO con alcance ALL. Con
                                BRANCH la policy de `cortes_caja` ya devuelve
                                únicamente la sala propia, así que el selector
                                ofrecería elegir entre una — y prometería un
                                alcance que no existe. Es el mismo criterio que
                                `facturas_sala`, `meta_sala` y el widget de
                                cortes en el Inicio. */}
                            {alcanceTodas && (
                                <FilterBar.Section active={!!sala} onClear={() => setSala('')} label="sucursal">
                                    <FilterBar.Sucursal value={sala} onChange={(v) => { setSala(v); setPagina(1); }} options={salaOptions} />
                                </FilterBar.Section>
                            )}

                            {/* `PeriodStepper` con el `PeriodPicker` de rótulo:
                                es la ranura `children` del canónico, que existe
                                justamente para cuando el centro no es texto sino
                                un control que se abre. Tocar «Hoy» abre el panel;
                                las flechas corren el período por su unidad. */}
                            <FilterBar.Section active={!periodoIntacto} onClear={() => verPeriodo(null)}
                                label="fecha">
                                <PeriodStepper
                                    unit={unidad}
                                    onPrev={() => correr(-1)}
                                    onNext={() => correr(1)}
                                    nextDisabled={periodoAlcanzaHoy(periodo)}
                                >
                                    <PeriodPicker value={periodo} onChange={verPeriodo} placeholder="Período…" />
                                </PeriodStepper>
                            </FilterBar.Section>

                            {/* Las dos ranuras de la derecha son las de la
                                PESTAÑA. Sucursal y período se quedan porque
                                significan lo mismo en las dos; el estado de un
                                corte no significa nada sobre un vale. */}
                            {enAperturas ? (
                                <>
                                    <FilterBar.Section active={estadoAper !== 'TODAS'} onClear={() => setEstadoAper('TODAS')} label="estado">
                                        <FilterBar.Opciones
                                            label="Estado" icon={Clock}
                                            value={estadoAper} onChange={(v) => setEstadoAper(v || 'TODAS')}
                                            options={ESTADOS_APER} ancho="185px"
                                        />
                                    </FilterBar.Section>

                                    <FilterBar.Section active={quienAper !== 'TODOS'} onClear={() => setQuienAper('TODOS')} label="quién">
                                        <FilterBar.Opciones
                                            label="Quién" icon={UserX}
                                            value={quienAper} onChange={(v) => setQuienAper(v || 'TODOS')}
                                            options={QUIEN_APER} ancho="185px"
                                        />
                                    </FilterBar.Section>
                                </>
                            ) : enMovimientos ? (
                                <>
                                    <FilterBar.Section active={tipoMov !== 'TODOS'} onClear={() => setTipoMov('TODOS')} label="tipo">
                                        <FilterBar.Opciones
                                            label="Tipo" icon={ArrowDownLeft}
                                            value={tipoMov} onChange={(v) => setTipoMov(v || 'TODOS')}
                                            options={TIPOS_MOV} ancho="185px"
                                        />
                                    </FilterBar.Section>

                                    <FilterBar.Section active={estadoMov !== 'TODOS'} onClear={() => setEstadoMov('TODOS')} label="estado">
                                        <FilterBar.Opciones
                                            label="Estado" icon={CheckCircle2}
                                            value={estadoMov} onChange={(v) => setEstadoMov(v || 'TODOS')}
                                            options={ESTADOS_MOV} ancho="175px"
                                        />
                                    </FilterBar.Section>
                                </>
                            ) : (
                                <>
                                    <FilterBar.Section active={estado !== 'TODOS'} onClear={() => setEstado('TODOS')} label="estado">
                                        <FilterBar.Opciones
                                            label="Estado" icon={CheckCircle2}
                                            value={estado} onChange={(v) => { setEstado(v || 'TODOS'); setPagina(1); }}
                                            options={ESTADOS} ancho="165px"
                                        />
                                    </FilterBar.Section>

                                    <FilterBar.Section active={diferencia !== 'TODAS'} onClear={() => setDiferencia('TODAS')} label="diferencia">
                                        <FilterBar.Opciones
                                            label="Diferencia" icon={Scale}
                                            value={diferencia} onChange={(v) => { setDiferencia(v || 'TODAS'); setPagina(1); }}
                                            options={DIFERENCIAS} ancho="165px"
                                        />
                                    </FilterBar.Section>
                                </>
                            )}
                        </FilterBar>
                    </div>
                </div>

                {/* El trabajo que queda después de resolver una diferencia: el
                    movimiento en el sistema. Va como aviso y no como pestaña
                    porque no es otra sección de la pantalla —son los mismos
                    cortes— sino algo pendiente de hacer, y esconderlo detrás de
                    un recorte sería no anunciarlo. */}
                {enAperturas && (
                    <AperturasDeCaja
                        aperturas={aperturasFiltradas}
                        entradas={entradas}
                        pudeLeerAsistencia={pudeAsistencia}
                        salas={salasMap}
                        cargando={cargandoAper}
                        busqueda={busqueda}
                        onLimpiarBusqueda={() => setBusqueda('')}
                    />
                )}

                {enMovimientos && (
                    <MovimientosDeCaja
                        movimientos={movs}
                        historial={historial}
                        salas={salasMap}
                        cargando={cargandoMovs}
                        busqueda={busqueda}
                        tipo={tipoMov}
                        estado={estadoMov}
                        onLimpiarBusqueda={() => setBusqueda('')}
                    />
                )}

                {!enMovimientos && !enAperturas && !cargando && puedeResolver && sinAsentar.length > 0 && (
                    <Notice variant="warning" icon={Landmark}>
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                                <span className="font-bold">
                                    {sinAsentar.length === 1
                                        ? 'Hay una diferencia resuelta sin anotar en el sistema'
                                        : `Hay ${sinAsentar.length} diferencias resueltas sin anotar en el sistema`}
                                </span>
                                <span className="block mt-0.5 font-normal text-content-2">
                                    Un solo movimiento por sala las cubre a todas.
                                </span>
                            </div>
                            <Button variant="secondary" size="sm" onClick={() => setAsentando(true)}>
                                Registrar
                            </Button>
                        </div>
                    </Notice>
                )}

                {!enMovimientos && !enAperturas && cargando && <LoadingState label="Buscando los cortes" />}

                {/* Dos vacíos distintos (§26.2): el del filtro se arregla
                    borrándolo y el de verdad no. Y el de «Sin confirmar» vacío
                    es un vacío FELIZ (§26.3) — la sala quería que no hubiera
                    nada. Los tres llevan su salida (§18.1). */}
                {!enMovimientos && !enAperturas && !cargando && filtrados.length === 0 && (
                    busqueda ? (
                        <EmptyState
                            compact icon={Search} title="Sin resultados"
                            subtitle={`Ningún corte coincide con «${busqueda}».`}
                            action={<Button variant="secondary" onClick={() => { setBusqueda(''); setPagina(1); }}>Limpiar la búsqueda</Button>}
                        />
                    ) : estado === 'PENDIENTE' && cortes.length ? (
                        <EmptyState
                            compact icon={ShieldCheck} iconClass="text-success-text"
                            title="Todo confirmado"
                            subtitle="No queda ningún corte por revisar en estas fechas."
                            action={<Button variant="secondary" onClick={() => setEstado('TODOS')}>Ver todos</Button>}
                        />
                    ) : (
                        <EmptyState
                            compact icon={Wallet}
                            title={periodoIntacto ? 'Sin cortes hoy' : 'Sin cortes en estas fechas'}
                            subtitle="La vista arranca en el día de hoy. Amplía las fechas para ver más atrás."
                            action={<Button variant="secondary" icon={CalendarDays}
                                onClick={() => verPeriodo(`${correrDia(hoySV(), -6)}|${hoySV()}`)}>
                                Ver los últimos 7 días
                            </Button>}
                        />
                    )
                )}

                {!enMovimientos && !enAperturas && !cargando && porDia.map((g) => (
                    <section key={g.fecha} className="space-y-3">
                        <div className="flex items-baseline justify-between gap-3 px-1">
                            <h3 className="text-label font-bold text-content capitalize">{rotularDia(g.fecha)}</h3>
                            <span className="text-caption text-content-3">
                                {g.total} {g.total === 1 ? 'corte' : 'cortes'}
                                {g.conDiferencia > 0 && ` · ${g.conDiferencia} con diferencia`}
                            </span>
                        </div>

                        {g.grupos.map((s) => (
                            <div key={s.branchId} className="space-y-1.5">
                                <div className="flex items-baseline justify-between gap-3 px-1">
                                    <h4 className="text-caption font-black uppercase tracking-widest text-content-2">
                                        {s.nombre}
                                    </h4>
                                    <span className="text-micro text-content-3">
                                        {s.lista.length} {s.lista.length === 1 ? 'corte' : 'cortes'}
                                        {s.conDiferencia > 0 && ` · ${s.conDiferencia} con diferencia`}
                                    </span>
                                </div>

                                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                    {s.lista.map((c) => (
                                        <TarjetaCorte
                                            key={c.id}
                                            corte={c}
                                            persona={personas.get(c.resuelto_por) || null}
                                            puedeResolver={puedeResolver}
                                            ocupado={ocupadoId === c.id}
                                            onAbrir={abrirDetalle}
                                            onConfirmar={confirmarRapido}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </section>
                ))}

                {!enMovimientos && !enAperturas && !cargando && filtrados.length > porPagina && (
                    <TablePagination
                        page={pagActual}
                        totalPages={totalPaginas}
                        onPageChange={setPagina}
                        pageSize={porPagina}
                        onPageSizeChange={(v) => { setPorPagina(Number(v)); setPagina(1); }}
                        total={filtrados.length}
                        unit="cortes"
                    />
                )}
            </div>

            <AsentarDiferencias
                abierto={asentando}
                diferencias={sinAsentar}
                nombreSala={nombreSala}
                onClose={() => setAsentando(false)}
                onHecho={cargar}
            />

            <CorteDetalleModal
                corte={corteAbierto}
                nombreSala={nombreSala}
                modoInicial={modoInicial}
                onClose={cerrarDetalle}
                onResuelto={cargar}
                origen="modulo"
            />
        </GlassViewLayout>
    );
};

export default CortesView;
