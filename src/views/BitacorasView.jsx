import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { AlertTriangle, Award, Plus, BookOpen, CalendarCheck, CheckCircle2, Download, HelpCircle, Layers, PackageSearch, Pill, Search, Settings2, Thermometer } from 'lucide-react';
import GlassViewLayout from '../components/GlassViewLayout';
import ViewTabBar from '../components/common/ViewTabBar';
import { usePestanaEnUrl } from '../plataforma/usePestanaEnUrl';
import FilterBar from '../components/common/FilterBar';
import PeriodStepper from '../components/common/PeriodStepper';
import CarrilCards from '../components/common/CarrilCards';
import StatCard from '../components/common/StatCard';
import Notice from '../components/common/Notice';
import { SkeletonText } from '../components/common/StateViews';
import TabHoy from './bitacoras/TabHoy';
/* La pestaña de entrada («Hoy») viaja con la vista; las demás se bajan al
 * abrirlas: se ve una a la vez (2026-11-06, gate:bundle). */
const TabBajoReceta = lazy(() => import('./bitacoras/TabBajoReceta'));
const TablaDeLaRed = lazy(() => import('./bitacoras/TablaDeLaRed'));
const TabCierre = lazy(() => import('./bitacoras/TabCierre'));
const TabRegencia = lazy(() => import('./bitacoras/TabRegencia'));
const TabConfiguracion = lazy(() => import('./bitacoras/TabConfiguracion'));
const TabAntibioticos = lazy(() => import('./bitacoras/TabAntibioticos'));
const TabRegistroLote = lazy(() => import('./bitacoras/TabRegistroLote'));
const TabLotesPorRevisar = lazy(() => import('./bitacoras/TabLotesPorRevisar'));
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import {
    CLASE_ANTIBIOTICO, CLASE_BAJO_RECETA, LIBROS, VENTA_ANTIBIOTICO,
    correrPeriodo, fetchBitacoraDia, fetchLibro, fetchRegistroAntibioticosLote, pendientesDelDia, periodoDe,
} from '@nucleo/data/bitacoras';
import { nombreDelPeriodo } from '@nucleo/utils/cierreDeBitacoras';
import { contarPorEstado, csvDelRegistro, filasDelRegistro } from '@nucleo/utils/registroAntibioticos';
import { exportCsv } from '@nucleo/utils/csvExport';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { hoySV, sumarDias, ultimoDiaDelMes } from '@nucleo/utils/fecha';
import { rotularDia, salasDeBitacora } from '@nucleo/utils/rondaDeBitacora';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';

// ═══════════════════════════════════════════════════════════════════════════
// Bitácoras — los registros que exige la Superintendencia de Regulación
// Sanitaria en cada sala.
//
// ── Por qué NO hay pestaña «Historial» ─────────────────────────────────────
// Mirar el martes pasado es la MISMA pantalla con otra fecha: un recorte, no
// una sección (§16.9 — la píldora del header contesta «¿qué sección veo?», la
// del cuerpo «¿qué recorte?»). El día vive en la ranura de fecha del filtro, y
// «Hoy» es sólo su valor por defecto. Una pestaña Historial habría sido la
// misma lista dos veces en dos sitios, que es exactamente lo que Cortes de caja
// tuvo que deshacer.
//
// ── «Bajo receta» SÍ es una sección ────────────────────────────────────────
// Otras filas, otro trabajo y otro público: la sala completa recetas, el
// regente revisa el libro. Igual que Bolsas dentro de Cortes.
// ═══════════════════════════════════════════════════════════════════════════

const VACIO = [];

// Los estados que hacen ruido en el día. Son cuatro números fijos —los fija la
// vista, nunca el dato (§17.0)— y son los mismos que cuenta el widget del
// Inicio, del mismo `pendientesDelDia`: dos pantallas que cuenten por su cuenta
// terminan dando cifras distintas de lo mismo.
const METRICAS = [
    { clave: 'abiertas', label: 'Tocan ahora',   icon: Thermometer, iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
    { clave: 'vencidas', label: 'Se pasaron',    icon: Thermometer, iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
    { clave: 'hechas',   label: 'Anotadas hoy',  icon: Thermometer, iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'desvios',  label: 'Fuera de rango', icon: Thermometer, iconBg: 'bg-danger/10', iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
];

// El carril del registro por lote ES su filtro de estado (como en la bitácora
// de inyecciones): tocar una tarjeta muestra esos lotes, tocarla otra vez
// vuelve a todos. «Sin saldo inicial» incluye los lotes sin lote anotado.
const METRICAS_LOTES = [
    { clave: 'todos',      label: 'Lotes',             icon: Layers,        iconBg: 'bg-info/10',    iconCls: 'text-info-text' },
    { clave: 'cuadra',     label: 'Cuadran',           icon: CheckCircle2,  iconBg: 'bg-success/10', iconCls: 'text-success-text', valueCls: 'text-success-text' },
    { clave: 'diferencia', label: 'Con diferencia',    icon: AlertTriangle, iconBg: 'bg-danger/10',  iconCls: 'text-danger-text',  valueCls: 'text-danger-text' },
    { clave: 'sin_base',   label: 'Sin saldo inicial', icon: HelpCircle,    iconBg: 'bg-warning/10', iconCls: 'text-warning-text', valueCls: 'text-warning-text' },
];



// Los grupos de la barra. Cada sección sigue siendo una pestaña en la dirección.
const GRUPOS = [
    { key: 'g-diario',  label: 'Registro diario', icon: Thermometer, secciones: ['hoy'] },
    { key: 'g-receta',  label: 'Bajo receta',     icon: BookOpen,    secciones: ['libro', 'revision'] },
    { key: 'g-antib',   label: 'Antibióticos',    icon: Pill,        secciones: ['antibioticos', 'lotes'] },
    { key: 'g-regente', label: 'Regencia',        icon: Award,       secciones: ['regencia', 'cierre'] },
    { key: 'g-config',  label: 'Configuración',   icon: Settings2,   secciones: ['config'] },
];

export default function BitacorasView() {
    const { user, hasPermission, getScope } = useAuth();
    const branches = useStaff((s) => s.branches) || VACIO;

    const puedeAnotar   = hasPermission('bitacoras', 'can_edit');
    // El libro lo decide su pestaña, no el módulo: se puede dar Bitácoras sin
    // dar el libro. El servidor exige las dos (`bitacora_exigir_libro`).
    const puedeCompletarLibro = puedeAnotar && hasPermission('bitacoras_tab_libro', 'can_edit');
    const verLibro      = hasPermission('bitacoras_tab_libro', 'can_view');
    const verCierre     = hasPermission('bitacoras_tab_cierre', 'can_view');
    const verRegencia   = hasPermission('bitacoras_tab_regencia', 'can_view');
    const verAntibioticos = hasPermission('bitacoras_tab_antibioticos', 'can_view');
    const puedeConfirmarAware = hasPermission('bitacoras_confirmar_aware', 'can_edit');
    const puedeEditarAntibioticos = hasPermission('bitacoras_editar_antibioticos', 'can_edit');
    const puedeConfigurar = hasPermission('bitacoras_configurar', 'can_edit');
    // Lotes del libro por revisar (PENDIENTES 22): corrige la sala, confirma el regente.
    const puedeCorregirLote  = hasPermission('bitacoras_corregir_lote', 'can_edit');
    const puedeConfirmarLote = hasPermission('bitacoras_confirmar_lote', 'can_edit');
    const verRevisionLotes   = puedeCorregirLote || puedeConfirmarLote;
    // Quien ve una sola sala no elige sala: la guarda del servidor ya se lo
    // resolvió, y ofrecer el selector prometería un alcance que no existe.
    const alcanceTodas  = getScope('bitacoras') === 'ALL';

    const miSala = salaDelUsuario(user);
    const [sala, setSala] = useState(() => (alcanceTodas ? (miSala ?? '') : miSala));
    // Quien ve todas las salas y es de una que no lleva bitácora (Administración)
    // abría las ocho pestañas vacías con «Administración no almacena…» hasta
    // elegir una a mano (usuario, 2026-11-13: «esta vista es un desorden»).
    // Arranca en la primera sala que sí la lleva; elegir otra sigue igual.
    // Sólo al arrancar: vaciar el selector a mano (toda la red) sigue valiendo.
    const [arranqueResuelto, setArranqueResuelto] = useState(false);
    useEffect(() => {
        if (arranqueResuelto || !alcanceTodas || !branches.length) return;
        const opciones = salasDeBitacora(branches);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- corrige una vez el arranque cuando llegan las salas
        setArranqueResuelto(true);
        if (opciones.length && !opciones.some(o => o.value === String(sala))) setSala(opciones[0].value);
    }, [arranqueResuelto, alcanceTodas, branches, sala]);
    const [fecha, setFecha] = useState(hoySV);
    // Libro, cierre y regencia también se leen por MES, y su mes vive en la
    // píldora como el de los lotes — no en un segundo paso de mes dentro de la
    // pestaña. El cierre arranca en el mes ANTERIOR: el en curso no se cierra.
    const [periodoLibro, setPeriodoLibro] = useState(() => periodoDe(hoySV()));
    const [periodoCierre, setPeriodoCierre] = useState(() => correrPeriodo(periodoDe(hoySV()), -1));
    const [periodoRegencia, setPeriodoRegencia] = useState(() => periodoDe(hoySV()));
    const tabs = useMemo(() => ([
        { key: 'hoy', label: 'Registro diario', icon: Thermometer },
        ...(verLibro ? [{ key: 'libro', label: 'Libro', icon: BookOpen }] : []),
        ...(verAntibioticos ? [{ key: 'antibioticos', label: 'Listado', icon: Pill }] : []),
        ...(verAntibioticos ? [{ key: 'lotes', label: 'Por lote', icon: Layers }] : []),
        ...(verRevisionLotes ? [{ key: 'revision', label: 'Lotes por revisar', icon: PackageSearch }] : []),
        ...(verCierre ? [{ key: 'cierre', label: 'Cierre de mes', icon: CalendarCheck }] : []),
        ...(verRegencia ? [{ key: 'regencia', label: 'Visitas', icon: Award }] : []),
        ...(puedeConfigurar ? [{ key: 'config', label: 'Configuración', icon: Settings2 }] : []),
    ]), [verLibro, verAntibioticos, verRevisionLotes, verCierre, verRegencia, puedeConfigurar]);

    const [tab, setTab] = usePestanaEnUrl(tabs, 'hoy');
    // Ocho pestañas no entraban en la barra (usuario, 2026-11-13: «se ve fatal,
    // ¿por qué hay tanto?»). La barra muestra CINCO grupos y, dentro de uno con
    // más de una sección, un selector chico elige cuál. La dirección sigue
    // nombrando la sección (`?tab=lotes`), así que los enlaces viejos y los
    // avisos que apuntan a una sección siguen llegando a ella.
    const grupos = useMemo(() => GRUPOS
        .map(g => ({ ...g, secciones: g.secciones.filter(k => tabs.some(t => t.key === k)) }))
        .filter(g => g.secciones.length > 0), [tabs]);
    const grupo = grupos.find(g => g.secciones.includes(tab)) || grupos[0];
    const tabsDeGrupo = useMemo(() => grupos.map(({ key, label, icon }) => ({ key, label, icon })), [grupos]);
    const alElegirGrupo = (key) => {
        const g = grupos.find(x => x.key === key);
        if (g && !g.secciones.includes(tab)) setTab(g.secciones[0]);
    };
    const seccionesDelGrupo = (grupo?.secciones || []).map(k => ({ value: k, label: tabs.find(t => t.key === k)?.label || k }));
    const [busqueda, setBusqueda] = useState('');
    // Cuál de los dos libros se está mirando. El de antibióticos es el que
    // trae escrito un inspector, así que es el valor por defecto.
    const [claseLibro, setClaseLibro] = useState(CLASE_ANTIBIOTICO);

    const enLibro = tab === 'libro';
    // El listado es de toda la red: ni sala ni fecha lo recortan.
    const enAntibioticos = tab === 'antibioticos';
    // El registro por lote es de un MES: su paso de mes vive en la pestaña.
    const enLotes = tab === 'lotes';
    // La revisión de lotes es una COLA: sin fecha, y sin sala mira toda la red.
    const enRevision = tab === 'revision';

    const [dia, setDia] = useState(null);
    const [cargandoDia, setCargandoDia] = useState(true);
    const [errorDia, setErrorDia] = useState(null);

    const [libro, setLibro] = useState(VACIO);
    const [cargandoLibro, setCargandoLibro] = useState(false);
    const [errorLibro, setErrorLibro] = useState(null);

    // ── Qué sucursales ofrece cada sección ─────────────────────────────────
    //
    // Sale de `branches.type`, no de una lista de nombres a mano: el día que
    // abra una sala nueva entra sola, y el día que se renombre una no se rompe
    // nada. Es la regla del proyecto —una lista que existe como tabla no se
    // escribe a mano— aplicada a un filtro.
    //
    //   · Las bitácoras de AMBIENTE son de donde se GUARDA medicamento: las
    //     farmacias y la bodega. Administración no almacena nada, así que
    //     ofrecerla prometía una bitácora que no existe.
    //   · El libro BAJO RECETA es de donde se DISPENSA: sólo las farmacias.
    //     Bodega no vende, y su libro siempre estaría vacío — un vacío que se
    //     lee como «no hubo ventas bajo receta» en vez de «acá no se vende».
    const salaOptions = useMemo(() => salasDeBitacora(branches, { libro: enLibro || enRevision }), [branches, enLibro, enRevision]);
    const nombreSala = useMemo(
        () => salaOptions.find(o => o.value === String(sala))?.label || '',
        [salaOptions, sala],
    );
    // El nombre aunque la sala NO aplique a esta sección: hace falta para poder
    // decir «Bodega no dispensa» en vez de un vacío mudo.
    const nombreSalaCruda = useMemo(
        () => branches.find(b => String(b.id) === String(sala))?.name || '',
        [branches, sala],
    );
    const salasDeRed = useMemo(() => salasDeBitacora(branches), [branches]);
    const salaValida = Boolean(sala) && salaOptions.some(o => o.value === String(sala));

    // ── El día ──────────────────────────────────────────────────────────────
    const cargarDia = useCallback(async () => {
        if (!sala) { setDia(null); setCargandoDia(false); return; }
        setCargandoDia(true);
        const { dia: d, error } = await fetchBitacoraDia(sala, fecha);
        setDia(d);
        setErrorDia(error);
        setCargandoDia(false);
    }, [sala, fecha]);

    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial y al cambiar sala o fecha
    useEffect(() => { cargarDia(); }, [cargarDia]);

    // ── El libro ────────────────────────────────────────────────────────────
    // Se pide por MES completo y no por el día elegido: el libro se lee y se
    // imprime por período, y buscar un folio de principio de mes no debería
    // obligar a mover la fecha primero.
    //
    // Se traen los DOS libros en una sola llamada y el corte se hace acá. Pedir
    // sólo el elegido obligaría a una segunda consulta para poder decir cuántos
    // hay en el otro — y ese número es justo lo que evita que un libro se
    // olvide por no estar mirándolo.
    const cargarLibro = useCallback(async () => {
        if (!sala || !verLibro) { setLibro(VACIO); return; }
        setCargandoLibro(true);
        const { renglones, error } = await fetchLibro(sala, {
            desde: `${periodoLibro}-01`,
            hasta: ultimoDiaDelMes(`${periodoLibro}-01`),
        });
        setLibro(renglones);
        setErrorLibro(error);
        setCargandoLibro(false);
    }, [sala, periodoLibro, verLibro]);

    // El libro se pide al ENTRAR a su pestaña, no al montar la vista: son ~100
    // renglones que la mayoría de las visitas no mira.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al entrar a la pestaña
    useEffect(() => { if (tab === 'libro') cargarLibro(); }, [tab, cargarLibro]);

    // ── El registro por lote ────────────────────────────────────────────────
    // Se pide acá y no en la pestaña porque su carril, su mes y su descarga
    // viven en la fila de arriba, igual que los de las demás secciones.
    const mesDeHoy = periodoDe(hoySV());
    const [periodoLotes, setPeriodoLotes] = useState(() => periodoDe(hoySV()));
    const [filtroLotes, setFiltroLotes] = useState('todos');
    const [registroLotes, setRegistroLotes] = useState(null);
    const [cargandoLotes, setCargandoLotes] = useState(false);
    const [errorLotes, setErrorLotes] = useState(null);
    useEffect(() => {
        if (!enLotes || !salaValida) return undefined;
        let vivo = true;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- carga al cambiar de sala o de mes
        setCargandoLotes(true);
        fetchRegistroAntibioticosLote(sala, periodoLotes).then(({ registro: r, error }) => {
            if (!vivo) return;
            setRegistroLotes(r);
            setErrorLotes(error ? mensajeAmigable(error) : null);
            setCargandoLotes(false);
        });
        return () => { vivo = false; };
    }, [enLotes, salaValida, sala, periodoLotes]);
    const cuentaLotes = useMemo(() => {
        const c = contarPorEstado(filasDelRegistro(registroLotes));
        return { ...c, sin_base: c.sin_base + c.sin_lote };
    }, [registroLotes]);
    const descargarLotes = () => {
        const { headers, rows } = csvDelRegistro(registroLotes, nombreSala);
        exportCsv(headers, rows, `registro-antibioticos-por-lote-${nombreSala || sala}-${periodoLotes}.csv`, 'bitacoras');
    };

    const resumen = useMemo(() => pendientesDelDia(dia), [dia]);

    // La búsqueda del libro acepta el folio en cualquiera de sus formas y
    // también el nombre del medicamento, el paciente, el lote o el documento —
    // porque no siempre se llega con el folio en la mano.
    const delLibro = useMemo(
        () => libro.filter(r => (r.clase || CLASE_ANTIBIOTICO) === claseLibro),
        [libro, claseLibro],
    );

    // Cuántos hay en cada libro, para que el que no se está mirando no
    // desaparezca. Se cuenta sobre lo ya cargado, no con otra consulta.
    const cuentaPorLibro = useMemo(() => {
        const c = { [CLASE_ANTIBIOTICO]: 0, [CLASE_BAJO_RECETA]: 0 };
        for (const r of libro) c[r.clase || CLASE_ANTIBIOTICO] += 1;
        return c;
    }, [libro]);

    // «Sin completar»: los renglones que esperan su receta (usuario, 2026-11-13).
    const [soloSinCompletar, setSoloSinCompletar] = useState(false);
    // Antibióticos: qué vista, qué venta, sus cuentas y sus acciones (las
    // registra la pestaña; viven en la píldora).
    const [vistaRevision, setVistaRevision] = useState('abiertas');
    const [cuentasRevision, setCuentasRevision] = useState(null);
    const [vistaAntib, setVistaAntib] = useState('listado');
    const [ventaAntib, setVentaAntib] = useState('todos');
    const [cuentasAntib, setCuentasAntib] = useState(null);
    const [accionesAntib, setAccionesAntib] = useState(null);
    const sinCompletarDelLibro = useMemo(() => delLibro.filter(r => r.estado === 'pendiente').length, [delLibro]);
    const libroFiltrado = useMemo(() => {
        const base = soloSinCompletar ? delLibro.filter(r => r.estado === 'pendiente') : delLibro;
        if (!busqueda.trim()) return base;
        return base.filter(r => tokenMatch(busqueda,
            r.folio_txt, String(r.folio), r.producto_nombre, r.lote, r.paciente,
            r.medico, r.numero_junta, r.cliente, r.vendedor, r.correlativo_doc,
        ));
    }, [delLibro, busqueda, soloSinCompletar]);

    const filtersContent = (
        <ViewTabBar
            tabs={tabsDeGrupo}
            activeTab={grupo?.key}
            onTabChange={alElegirGrupo}
            searchValue={busqueda}
            onSearchChange={setBusqueda}
            placeholder={enAntibioticos ? 'Buscar molécula o producto…' : enLotes ? 'Buscar producto o lote…' : 'Buscar por folio, medicamento, lote, paciente o médico…'}
            showSearch={enLibro || enAntibioticos || enLotes}
        />
    );

    const esHoy = fecha === hoySV();
    // El mes de la pestaña, si se lee por mes: valor, cómo cambiarlo y a cuál
    // vuelve al limpiar.
    const mesAnterior = correrPeriodo(mesDeHoy, -1);
    const mes = enLotes ? { valor: periodoLotes, set: setPeriodoLotes, base: mesDeHoy }
        : enLibro ? { valor: periodoLibro, set: setPeriodoLibro, base: mesDeHoy }
        : tab === 'cierre' ? { valor: periodoCierre, set: setPeriodoCierre, base: mesAnterior }
        : tab === 'regencia' ? { valor: periodoRegencia, set: setPeriodoRegencia, base: mesDeHoy }
        : null;
    // El listado de antibióticos es de toda la red: la sucursal no lo recorta.
    const verSala = !enAntibioticos;

    return (
        <GlassViewLayout icon={Thermometer} title="Bitácoras" filtersContent={filtersContent}>
            <div className="p-4 md:p-6 space-y-6">

                {/* El carril y la píldora comparten UNA fila (§17.0): las dos
                    mitades —`lg:flex-row` acá y `flex-1` en el carril— son
                    obligatorias porque `useMedidaFila` busca el carril en el
                    abuelo de la píldora y le descuenta 314px lo tenga al lado o
                    no. En renglones separados roba ancho en silencio. */}
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {/* El carril describe el DÍA. En el libro, en el cierre y en
                        la configuración no habla de lo que hay en pantalla, y
                        una fila de métricas que no describe lo que se mira es
                        peor que no tenerla. */}
                    {tab === 'hoy' ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del día">
                            {METRICAS.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={resumen[m.clave]} valueCls={m.valueCls}
                                    loading={cargandoDia} />
                            ))}
                        </CarrilCards>
                    ) : enLotes && salaValida ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del registro por lote">
                            {METRICAS_LOTES.map((m) => (
                                <StatCard key={m.clave} icon={m.icon} iconBg={m.iconBg} iconCls={m.iconCls}
                                    label={m.label} value={cargandoLotes ? '—' : cuentaLotes[m.clave].toLocaleString('es-SV')}
                                    valueCls={m.valueCls} loading={cargandoLotes}
                                    active={filtroLotes === m.clave}
                                    onClick={() => setFiltroLotes(f => (f === m.clave || m.clave === 'todos' ? 'todos' : m.clave))} />
                            ))}
                        </CarrilCards>
                    ) : <div className="flex-1" />}

                    {/* Orden canónico de las ranuras: sección → ámbito → entidad →
                        tiempo (§17). La sección (dentro de un grupo con dos) va
                        en la píldora y no suelta arriba del contenido (usuario,
                        2026-11-13: «esto no es canónico, deben estar en el
                        filterpill»). Cada pestaña muestra SÓLO el tiempo que
                        la describe: día en el registro diario; mes en el libro,
                        los lotes, el cierre y la regencia; nada en la cola de
                        revisión, el listado ni la configuración. */}
                    <div className="flex justify-end min-w-0">
                        <FilterBar
                            onClear={() => {
                                if (mes) mes.set(mes.base);
                                if (tab === 'hoy') setFecha(hoySV());
                                setFiltroLotes('todos');
                                setSoloSinCompletar(false);
                                setVistaAntib('listado'); setVentaAntib('todos'); setVistaRevision('abiertas');
                                if (verSala && alcanceTodas) setSala(miSala ?? '');
                            }}
                            activeCount={[
                                mes ? mes.valor !== mes.base : tab === 'hoy' && !esHoy,
                                enLotes && filtroLotes !== 'todos',
                                enLibro && claseLibro !== CLASE_ANTIBIOTICO,
                                enLibro && soloSinCompletar,
                                enAntibioticos && vistaAntib !== 'listado',
                                enRevision && vistaRevision !== 'abiertas',
                                enAntibioticos && ventaAntib !== 'todos',
                                verSala && alcanceTodas && String(sala) !== String(miSala ?? ''),
                            ].filter(Boolean).length}
                            acciones={enLotes ? [{
                                key: 'descargar', icon: Download, label: 'Descargar', soloIcono: true, principal: false,
                                onClick: descargarLotes, disabled: !cuentaLotes.todos || cargandoLotes,
                            }] : enAntibioticos && accionesAntib ? [
                                ...(accionesAntib.agregar ? [{
                                    key: 'agregar', icon: Plus, label: 'Agregar producto', principal: true,
                                    onClick: accionesAntib.agregar,
                                }] : []),
                                { key: 'exportar', icon: Download, label: 'Exportar', soloIcono: true, principal: false,
                                    onClick: accionesAntib.exportar, disabled: !accionesAntib.hayFilas },
                            ] : []}
                        >
                            {seccionesDelGrupo.length > 1 && (
                                <FilterBar.Section label="sección">
                                    <FilterBar.Opciones value={tab} onChange={setTab}
                                        options={seccionesDelGrupo} label="Sección" />
                                </FilterBar.Section>
                            )}

                            {verSala && alcanceTodas && (
                                <FilterBar.Section active={String(sala) !== String(miSala ?? '')}
                                    onClear={() => setSala(miSala ?? '')} label="sucursal">
                                    <FilterBar.Sucursal value={String(sala || '')}
                                        onChange={(v) => setSala(v)} options={salaOptions} />
                                </FilterBar.Section>
                            )}

                            {/* Cuál de los dos libros: un RECORTE (mismas filas,
                                mismo trabajo), no una sección. Los dos a la vista
                                para que el segundo no se olvide. */}
                            {enLibro && (
                                <FilterBar.Section
                                    active={claseLibro !== CLASE_ANTIBIOTICO}
                                    onClear={() => setClaseLibro(CLASE_ANTIBIOTICO)}
                                    label="libro"
                                >
                                    <FilterBar.Opciones
                                        value={claseLibro}
                                        onChange={setClaseLibro}
                                        options={LIBROS.map(l => ({
                                            value: l.clave,
                                            label: `${l.corto} (${cuentaPorLibro[l.clave] ?? 0})`,
                                        }))}
                                        label="Libro"
                                    />
                                </FilterBar.Section>
                            )}

                            {enLibro && (
                                <FilterBar.Section active={soloSinCompletar}
                                    onClear={() => setSoloSinCompletar(false)} label="estado">
                                    <FilterBar.Opciones
                                        value={soloSinCompletar ? 'pendiente' : 'todos'}
                                        onChange={(v) => setSoloSinCompletar(v === 'pendiente')}
                                        options={[
                                            { value: 'todos', label: 'Todos' },
                                            { value: 'pendiente', label: `Sin completar (${sinCompletarDelLibro})` },
                                        ]}
                                        label="Estado"
                                    />
                                </FilterBar.Section>
                            )}

                            {enRevision && (
                                <FilterBar.Section active={vistaRevision !== 'abiertas'}
                                    onClear={() => setVistaRevision('abiertas')} label="estado">
                                    <FilterBar.Opciones value={vistaRevision} onChange={setVistaRevision}
                                        options={[
                                            { value: 'abiertas', label: `Abiertas (${cuentasRevision?.abiertas ?? '…'})` },
                                            { value: 'confirmadas', label: `Confirmadas (${cuentasRevision?.confirmadas ?? '…'})` },
                                        ]}
                                        label="Estado" />
                                </FilterBar.Section>
                            )}
                            {enAntibioticos && (
                                <FilterBar.Section active={vistaAntib !== 'listado'}
                                    onClear={() => setVistaAntib('listado')} label="vista">
                                    <FilterBar.Opciones value={vistaAntib} onChange={setVistaAntib}
                                        options={[
                                            { value: 'listado', label: `Listado (${cuentasAntib?.listado ?? '…'})` },
                                            { value: 'revisar', label: `Por revisar (${cuentasAntib?.revisar ?? '…'})` },
                                            { value: 'sacados', label: `Sacados (${cuentasAntib?.sacados ?? '…'})` },
                                        ]}
                                        label="Vista" />
                                </FilterBar.Section>
                            )}
                            {enAntibioticos && vistaAntib === 'listado' && (
                                <FilterBar.Section active={ventaAntib !== 'todos'}
                                    onClear={() => setVentaAntib('todos')} label="venta">
                                    <FilterBar.Opciones value={ventaAntib} onChange={setVentaAntib}
                                        options={[
                                            { value: 'todos', label: 'Toda venta' },
                                            ...Object.entries(VENTA_ANTIBIOTICO).map(([k, v]) => ({
                                                value: k, label: `${v.label} (${cuentasAntib?.[k] ?? 0})`,
                                            })),
                                        ]}
                                        label="Cómo se vende" />
                                </FilterBar.Section>
                            )}

                            {/* Las tarjetas ya filtran; el mismo filtro en la
                                píldora deja a la vista que se está filtrando. */}
                            {enLotes && salaValida && (
                                <FilterBar.Section active={filtroLotes !== 'todos'}
                                    onClear={() => setFiltroLotes('todos')} label="estado">
                                    <FilterBar.Opciones value={filtroLotes} onChange={setFiltroLotes}
                                        options={[
                                            { value: 'todos', label: 'Todos' },
                                            { value: 'diferencia', label: `Con diferencia (${cuentaLotes.diferencia ?? 0})` },
                                            { value: 'sin_base', label: `Sin saldo (${cuentaLotes.sin_base ?? 0})` },
                                        ]}
                                        label="Estado" />
                                </FilterBar.Section>
                            )}

                            {mes && (
                                <FilterBar.Section active={mes.valor !== mes.base}
                                    onClear={() => mes.set(mes.base)} label="mes">
                                    <PeriodStepper
                                        unit="mes"
                                        onPrev={() => mes.set(correrPeriodo(mes.valor, -1))}
                                        onNext={() => mes.set(correrPeriodo(mes.valor, 1))}
                                        nextDisabled={mes.valor >= mesDeHoy}
                                        isCurrent={mes.valor === mesDeHoy}
                                        onReset={() => mes.set(mes.base)}
                                        resetLabel={mes.base === mesDeHoy ? 'Este mes' : 'Mes pasado'}
                                        label={nombreDelPeriodo(mes.valor)}
                                    />
                                </FilterBar.Section>
                            )}

                            {/* `nextDisabled` en hoy: la bitácora de mañana no existe. */}
                            {tab === 'hoy' && <FilterBar.Section active={!esHoy} onClear={() => setFecha(hoySV())} label="fecha">
                                <PeriodStepper
                                    unit="día"
                                    onPrev={() => setFecha(f => sumarDias(f, -1))}
                                    onNext={() => setFecha(f => sumarDias(f, 1))}
                                    nextDisabled={esHoy}
                                >
                                    <span className="text-body-sm font-bold text-content-2">
                                        {rotularDia(fecha)}
                                    </span>
                                </PeriodStepper>
                            </FilterBar.Section>}
                        </FilterBar>
                    </div>
                </div>

                <Suspense fallback={<SkeletonText lines={4} className="w-full" />}>
                {enAntibioticos ? (
                    <TabAntibioticos busqueda={busqueda} puedeConfirmar={puedeConfirmarAware} puedeEditar={puedeEditarAntibioticos}
                        vista={vistaAntib} venta={ventaAntib} onCuentas={setCuentasAntib} onAcciones={setAccionesAntib} />
                ) : enRevision ? (
                    <TabLotesPorRevisar branchId={salaValida ? sala : (alcanceTodas ? null : sala)}
                        puedeCorregir={puedeCorregirLote} puedeConfirmar={puedeConfirmarLote}
                        vista={vistaRevision} onCuentas={setCuentasRevision} />
                ) : !salaValida ? (
                    <Notice variant="info" icon={Search}>
                        {!sala
                            ? 'Elige una sucursal para ver su bitácora.'
                            : enLibro
                                ? `${nombreSalaCruda || 'Esa sucursal'} no dispensa: el libro bajo receta es de las salas de venta.`
                                : enLotes
                                    ? `${nombreSalaCruda || 'Esa sucursal'} no guarda medicamentos, así que no tiene lotes que registrar.`
                                    : `${nombreSalaCruda || 'Esa sucursal'} no almacena medicamentos, así que no lleva bitácora de ambiente.`}
                    </Notice>
                ) : tab === 'hoy' ? (
                    <div className="space-y-6">
                        {alcanceTodas && salasDeRed.length > 1 && (
                            <TablaDeLaRed salas={salasDeRed} fecha={fecha} salaActual={sala}
                                onElegir={setSala} recarga={dia} />
                        )}
                        <TabHoy dia={dia} cargando={cargandoDia} error={errorDia}
                            puedeAnotar={puedeAnotar} onRecargar={cargarDia} />
                    </div>
                ) : tab === 'libro' ? (
                    <TabBajoReceta renglones={libroFiltrado} cargando={cargandoLibro} error={errorLibro}
                        branchId={sala} sucursalNombre={nombreSala} onRecargar={cargarLibro}
                        puedeCompletar={puedeCompletarLibro} clase={claseLibro} periodo={periodoLibro} />
                ) : enLotes ? (
                    <TabRegistroLote registro={registroLotes} cargando={cargandoLotes} error={errorLotes}
                        filtro={filtroLotes} busqueda={busqueda} />
                ) : tab === 'cierre' ? (
                    <TabCierre branchId={sala} periodo={periodoCierre} />
                ) : tab === 'regencia' ? (
                    <TabRegencia branchId={sala} periodo={periodoRegencia} />
                ) : (
                    <TabConfiguracion branchId={sala} sucursalNombre={nombreSala}
                        puedeEditar={puedeConfigurar} onCambio={cargarDia} />
                )}
                </Suspense>
            </div>
        </GlassViewLayout>
    );
}
