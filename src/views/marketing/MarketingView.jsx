import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Megaphone, CalendarDays, KanbanSquare, Inbox, Plus, Send, ThumbsUp, Settings2, Target,
    CheckCircle2, AlertTriangle, DollarSign, Layers, MessageSquare, FileDown, Clock, Images, Palette, Copy,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import PeriodStepper from '../../components/common/PeriodStepper';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import { LoadingState } from '../../components/common/StateViews';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { mesSV, correrMes, etiquetaMes, fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import {
    ESTADOS_MES, ESTADOS_SOLICITUD, resumenDelMes, mezclaDelMes, totalesDePauta, textoDePieza, pilarDe, formatoDe,
    ultimoCambioPorPieza, esDeMarca, asignadoEnPauta, FORMATOS,
} from '@nucleo/utils/marketing';
import {
    fetchCatalogos, fetchMes, crearMes, fetchPiezas, fetchComentarios, fetchSolicitudes, fetchPersonas,
    firmarDisenos, moverPieza, fetchAjustes, fetchFechasEspeciales, fetchPromocionesLigables, fetchEfectoEnVentas, fetchHistorial, fetchGaleria, fetchRecursos, liberarPieza,
} from '@nucleo/data/marketing';
import { registrarEgreso } from '@nucleo/data/egreso';
import TabCalendario from './TabCalendario';
import TabTablero from './TabTablero';
import TabSolicitudes from './TabSolicitudes';
import TabPauta from './TabPauta';
import TabBiblioteca from './TabBiblioteca';
import Galeria from './Galeria';
import DuplicarModal from './DuplicarModal';
import PiezaModal from './PiezaModal';
import PautaModal from './PautaModal';
import SolicitudModal from './SolicitudModal';
import AjustesModal from './AjustesModal';
import Conversacion from './Conversacion';
import { DecisionMesModal, DatosDelMesModal } from './MesModales';

/**
 * Marketing — el planificador de contenido para redes.
 *
 * El diseñador planifica el mes pieza por pieza (post, carrusel, reel, video,
 * historia), lleva cada una por su flujo y sube los diseños. Mientras arma el
 * mes, el resto ve CÓMO VA —estados y avance— pero no los diseños: eso lo
 * decide la base, no esta pantalla. Cuando lo envía a revisión, quien aprueba
 * ve todo, comenta, pide cambios por pieza o aprueba el calendario entero.
 *
 * Al lado viven las solicitudes (lo que la empresa le pide al diseñador) y la
 * pauta (cuánto se invierte en cada pieza y qué trajo).
 *
 * Permisos del módulo `marketing`: ver (mirar, comentar, pedir), editar
 * (planificar, diseñar, pautar) y aprobar (revisar el calendario).
 */
export default function MarketingView() {
    const { hasPermission, user, isSU } = useAuth();
    const puedeEditar = hasPermission('marketing', 'can_edit');
    const puedeAprobar = hasPermission('marketing', 'can_approve');
    const yoId = user?.id;
    const showToast = useToastStore((s) => s.showToast);

    const tabs = useMemo(() => ([
        { key: 'calendario',  label: 'Calendario',  icon: CalendarDays },
        { key: 'tablero',     label: 'Flujo',       icon: KanbanSquare },
        { key: 'solicitudes', label: 'Solicitudes', icon: Inbox },
        { key: 'pauta',       label: 'Pauta',       icon: Megaphone },
        { key: 'galeria',     label: 'Galería',     icon: Images },
        { key: 'biblioteca',  label: 'Marca',       icon: Palette },
    ]), []);
    const [tab, setTab] = usePestanaEnUrl(tabs, 'calendario');

    // El mes también vive en la dirección: el aviso del calendario trae
    // `?mes=2026-11&pieza=…` y tiene que abrir justo eso.
    const [params, setParams] = useSearchParams();
    const mes = /^\d{4}-\d{2}$/.test(params.get('mes') || '') ? params.get('mes') : mesSV();
    const piezaEnUrl = params.get('pieza');
    const cambiarParam = useCallback((k, v) => {
        setParams((p) => {
            const n = new URLSearchParams(p);
            if (v) n.set(k, v); else n.delete(k);
            return n;
        }, { replace: k === 'pieza' });
    }, [setParams]);

    const [busqueda, setBusqueda] = useState('');
    const [fMarca, setFMarca] = useState('');
    const [fFormato, setFFormato] = useState('');
    const [fSolicitud, setFSolicitud] = useState('');

    const [catalogos, setCatalogos] = useState({ marcas: [], redes: [] });
    const [ajustesMes, setAjustesMes] = useState(null);
    const [fechasEspeciales, setFechasEspeciales] = useState([]);
    const [promociones, setPromociones] = useState([]);
    const [mesSiguiente, setMesSiguiente] = useState(null);
    const [generando, setGenerando] = useState(false);
    const [mesFila, setMesFila] = useState(null);
    const [piezas, setPiezas] = useState([]);
    const [comentarios, setComentarios] = useState([]);
    const [historial, setHistorial] = useState([]);
    const [solicitudes, setSolicitudes] = useState([]);
    const [personas, setPersonas] = useState({});
    const [firmadas, setFirmadas] = useState(new Map());
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);

    // Modales. La pieza abierta vive en la dirección (`?pieza=`): el aviso
    // llega con ella, y así se deriva de la lista recién cargada en vez de
    // copiarse a un estado que habría que resincronizar en cada recarga.
    const [nueva, setNueva] = useState(null);                 // { fecha, prellenado } de una pieza nueva
    const [pautaId, setPautaId] = useState(null);
    const [solicitudAbierta, setSolicitudAbierta] = useState(null); // {} nueva | fila
    const [decision, setDecision] = useState(null);           // 'publicar' | 'aprobar'
    const [datosMes, setDatosMes] = useState(false);
    const [ajustes, setAjustes] = useState(false);
    const [duplicando, setDuplicando] = useState(null);       // { pieza? } — sin pieza, el mes
    // Galería y biblioteca no son del mes: se cargan al abrir su pestaña.
    const [galeria, setGaleria] = useState([]);
    const [recursos, setRecursos] = useState([]);
    const [firmasExtra, setFirmasExtra] = useState(new Map());
    const [cargandoExtra, setCargandoExtra] = useState(false);
    const [fLiberada, setFLiberada] = useState('');
    const delMes = ['calendario', 'tablero', 'pauta'].includes(tab);

    const cargar = useCallback(async ({ silencioso = false } = {}) => {
        if (!silencioso) setCargando(true);
        try {
            const [cat, fila, sols, aj, fechas, promos, sig] = await Promise.all([
                fetchCatalogos(), fetchMes(mes), fetchSolicitudes(), fetchAjustes(), fetchFechasEspeciales(),
                fetchPromocionesLigables(), fetchMes(correrMes(mesSV(), 1)),
            ]);
            const [ps, cs, hs] = fila
                ? await Promise.all([fetchPiezas(fila.id), fetchComentarios(fila.id), fetchHistorial(fila.id)])
                : [[], [], []];
            const [gente, firmas] = await Promise.all([
                fetchPersonas([...cs.map((c) => c.autor_id), ...sols.map((s) => s.solicitado_por), ...hs.map((h) => h.actor),
                    ...ps.map((p) => p.created_by), fila?.publicado_por, fila?.aprobado_por]),
                firmarDisenos(ps),
            ]);
            setCatalogos(cat);
            setAjustesMes(aj);
            setFechasEspeciales(fechas);
            setPromociones(promos);
            setMesSiguiente(sig);
            setMesFila(fila);
            setPiezas(ps);
            setComentarios(cs);
            setHistorial(hs);
            setSolicitudes(sols);
            setPersonas(gente);
            setFirmadas(firmas);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setCargando(false);
        }
    }, [mes]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial del mes; no hay forma de tenerlo antes de pedirlo

    const cargarExtra = useCallback(async () => {
        if (tab !== 'galeria' && tab !== 'biblioteca') return;
        setCargandoExtra(true);
        try {
            if (tab === 'galeria') {
                const ps = await fetchGaleria({ desde: `${correrMes(mesSV(), -6)}-01` });
                setGaleria(ps);
                setFirmasExtra(await firmarDisenos(ps));
            } else {
                const rs = await fetchRecursos();
                setRecursos(rs);
                setFirmasExtra(await firmarDisenos([{ archivos: rs.filter((r) => r.url) }]));
            }
        } catch (err) {
            showToast('No se pudo cargar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setCargandoExtra(false);
        }
    }, [tab, showToast]);
    useEffect(() => { cargarExtra(); }, [cargarExtra]); // eslint-disable-line react-hooks/set-state-in-effect -- galería y biblioteca se piden al abrir su pestaña

    const recargar = useCallback(() => cargar({ silencioso: true }), [cargar]);

    const liberarDesdeGaleria = useCallback(async (p, on) => {
        try {
            await liberarPieza(p.id, on);
            setGaleria((g) => g.map((x) => (x.id === p.id ? { ...x, liberada: on } : x)));
            recargar();
        } catch (err) {
            showToast('No se pudo cambiar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    }, [recargar, showToast]);

    const marcasPorId = useMemo(() => Object.fromEntries(catalogos.marcas.map((m) => [m.id, m])), [catalogos.marcas]);

    const visibles = useMemo(() => piezas
        .filter((p) => !fMarca || esDeMarca(p, fMarca))
        .filter((p) => !busqueda || tokenMatch(busqueda, textoDePieza(p, marcasPorId))),
    [piezas, fMarca, busqueda, marcasPorId]);

    const comentariosPorPieza = useMemo(() => {
        const m = {};
        for (const c of comentarios) {
            if (!c.pieza_id) continue;
            const e = (m[c.pieza_id] ||= { total: 0, cambiosAbiertos: 0 });
            e.total += 1;
            if (c.tipo === 'cambio' && !c.resuelto) e.cambiosAbiertos += 1;
        }
        return m;
    }, [comentarios]);
    const ultimos = useMemo(() => ultimoCambioPorPieza(historial), [historial]);
    const marcasDe = useCallback((p) => (p.marcas?.length ? p.marcas : [p.marca_id])
        .map((id) => marcasPorId[id]).filter(Boolean), [marcasPorId]);
    // Sólo quien creó la pieza la mueve (la base lo vuelve a exigir).
    const puedeMoverla = useCallback((p) => puedeEditar && (!p.created_by || p.created_by === yoId || isSU),
        [puedeEditar, yoId, isSU]);

    const comentariosDelMes = useMemo(() => comentarios.filter((c) => !c.pieza_id), [comentarios]);

    const resumen = useMemo(() => resumenDelMes(piezas), [piezas]);
    const mezcla = useMemo(() => mezclaDelMes(piezas), [piezas]);
    const pauta = useMemo(() => totalesDePauta(piezas.map((p) => p.pauta).filter(Boolean), mesFila?.presupuesto_pauta),
        [piezas, mesFila?.presupuesto_pauta]);

    const piezaAbierta = piezaEnUrl ? piezas.find((p) => p.id === piezaEnUrl) || null : null;
    const abrirPieza = useCallback((p) => cambiarParam('pieza', p?.id || null), [cambiarParam]);
    const pautaDe = pautaId ? piezas.find((p) => p.id === pautaId) || null : null;

    const asegurarMes = useCallback(async () => {
        if (mesFila) return mesFila;
        const fila = await crearMes(mes);
        setMesFila(fila);
        return fila;
    }, [mesFila, mes]);

    const abrirDatosDelMes = useCallback(async () => {
        try {
            await asegurarMes();
            setDatosMes(true);
        } catch (err) {
            showToast('No se pudo empezar el mes', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    }, [asegurarMes, showToast]);

    // El informe del mes en PDF. Mide el efecto en ventas de las piezas ligadas
    // a una promoción justo al generarlo: es lo que gerencia quiere ver.
    const descargarInforme = useCallback(async () => {
        if (!mesFila) return;
        setGenerando(true);
        try {
            const ligadas = piezas.filter((p) => p.promocion_id);
            const efectos = Object.fromEntries(await Promise.all(
                ligadas.map(async (p) => [p.id, await fetchEfectoEnVentas(p.id).catch(() => null)])));
            const { descargarInformePdf } = await import('@nucleo/utils/marketingInforme');
            await descargarInformePdf({
                mes: mesFila, piezas, marcas: marcasPorId, redes: catalogos.redes, efectos,
                promociones: Object.fromEntries(promociones.map((x) => [x.id, x])),
            });
            registrarEgreso('marketing', { formato: 'pdf', filas: piezas.length, detalle: { mes } });
        } catch (err) {
            showToast('No se pudo generar el informe', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGenerando(false);
        }
    }, [mesFila, piezas, marcasPorId, catalogos.redes, promociones, mes, showToast]);

    const nuevaPieza = useCallback(async (fecha, prellenado = null) => {
        try {
            await asegurarMes();
            setNueva({ prellenado, fecha: fecha || prellenado?.fecha || `${mes}-01` });
        } catch (err) {
            showToast('No se pudo empezar el mes', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    }, [asegurarMes, mes, showToast]);

    const mover = useCallback(async (pieza, cambios) => {
        // Se mueve en pantalla primero: arrastrar y ver la tarjeta volver a su
        // sitio medio segundo se lee como que no funcionó.
        setPiezas((ps) => ps.map((p) => (p.id === pieza.id ? { ...p, ...cambios } : p)));
        try {
            await moverPieza(pieza.id, cambios);
            recargar();
        } catch (err) {
            showToast('No se pudo mover la pieza', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
            recargar();
        }
    }, [recargar, showToast]);

    // Aceptar una solicitud abre la pieza ya escrita en el mes de la fecha
    // pedida (o en el que se está mirando, si no pidió fecha).
    const aceptarSolicitud = useCallback((s) => {
        const mesDestino = s.fecha_deseada ? s.fecha_deseada.slice(0, 7) : mes;
        const prellenado = {
            titulo: s.titulo, notas: s.descripcion || '', marca_id: s.marca_id || '',
            formato: s.formato || 'post', solicitud_id: s.id,
            fecha: s.fecha_deseada && mesDestino === mes ? s.fecha_deseada : `${mes}-01`,
        };
        if (mesDestino !== mes) {
            showToast('Solicitud aceptada', `Planifícala en ${etiquetaMes(mesDestino)}.`, 'success');
            // Una sola escritura de la dirección: dos seguidas se pisan.
            setParams((p) => {
                const n = new URLSearchParams(p);
                n.set('mes', mesDestino);
                n.set('tab', 'calendario');
                return n;
            });
            return;
        }
        setTab('calendario');
        nuevaPieza(prellenado.fecha, prellenado);
    }, [mes, setParams, setTab, nuevaPieza, showToast]);

    const estadoMes = mesFila ? ESTADOS_MES[mesFila.estado] : null;
    const publicado = !!mesFila?.publicado_at;
    const nuevasSolicitudes = solicitudes.filter((s) => s.estado === 'nueva').length;

    const acciones = [
        ...(puedeEditar && ['calendario', 'tablero'].includes(tab) ? [{
            key: 'nueva', icon: Plus, label: 'Pieza', title: 'Agregar una pieza al calendario',
            rotulo: 'Pieza', variant: 'primary', onClick: () => nuevaPieza(null),
        }] : []),
        ...(puedeEditar && ['calendario', 'tablero'].includes(tab) && piezas.length > 0 ? [{
            key: 'duplicar', icon: Copy, label: 'Duplicar a otro mes', title: 'Copiar piezas de este mes a otro',
            soloIcono: true, variant: 'secondary', onClick: () => setDuplicando({}),
        }] : []),
        ...(tab === 'solicitudes' ? [{
            key: 'pedir', icon: Plus, label: 'Pedir', title: 'Pedirle una pieza al diseñador',
            rotulo: 'Pedir', variant: 'primary', onClick: () => setSolicitudAbierta({}),
        }] : []),
        ...(delMes && puedeEditar && mesFila && resumen.total > 0 && mesFila.estado !== 'en_revision' ? [{
            key: 'publicar', icon: Send, label: mesFila.version > 0 ? 'Reenviar' : 'Enviar a revisión',
            title: 'Enviar el calendario del mes a quien aprueba', rotulo: mesFila.version > 0 ? 'Reenviar' : 'Enviar',
            variant: 'secondary', onClick: () => setDecision('publicar'),
        }] : []),
        ...(delMes && puedeAprobar && publicado && mesFila.estado !== 'aprobado' ? [{
            key: 'aprobar', icon: ThumbsUp, label: 'Aprobar mes', title: 'Aprobar el calendario completo',
            rotulo: 'Aprobar', variant: 'secondary', tone: 'success', onClick: () => setDecision('aprobar'),
        }] : []),
        // El presupuesto de pauta lo fija gerencia: quien aprueba también puede.
        ...((puedeEditar || puedeAprobar) && delMes ? [{
            key: 'datos', icon: Target, label: 'Objetivo y presupuesto', title: 'Objetivo del mes y presupuesto de pauta',
            soloIcono: true, variant: 'secondary', onClick: abrirDatosDelMes,
        }] : []),
        ...(mesFila && resumen.total > 0 && delMes ? [{
            key: 'informe', icon: FileDown, label: generando ? 'Generando…' : 'Informe PDF',
            title: 'Descargar el informe del mes en PDF', soloIcono: true, variant: 'secondary',
            onClick: generando ? undefined : descargarInforme,
        }] : []),
        ...((puedeEditar || puedeAprobar) ? [{
            key: 'ajustes', icon: Settings2, label: 'Ajustes', title: 'Fecha límite, recordatorios, fechas especiales, marcas y redes',
            soloIcono: true, variant: 'secondary', onClick: () => setAjustes(true),
        }] : []),
    ];

    const tarjetas = tab === 'pauta' ? [
        { key: 'presupuesto', icon: DollarSign, label: 'Presupuesto del mes', value: formatMoney(pauta.presupuestoMes),
            sub: `${formatMoney(pauta.presupuesto)} asignado` },
        { key: 'disponible', icon: Layers, label: 'Sin asignar', value: formatMoney(pauta.disponible),
            valueCls: pauta.disponible < 0 ? 'text-danger' : undefined,
            sub: pauta.disponible < 0 ? 'Se pasó del presupuesto' : 'Por repartir' },
        { key: 'gastado', icon: CheckCircle2, label: 'Gastado', value: formatMoney(pauta.gastado),
            sub: `${pauta.conResultado} pieza(s) con resultado` },
        { key: 'costo', icon: MessageSquare, label: 'Costo por mensaje',
            value: pauta.costoPorMensaje != null ? formatMoney(pauta.costoPorMensaje) : '—',
            sub: pauta.costoPorClic != null ? `${formatMoney(pauta.costoPorClic)} por clic` : 'Sin resultados' },
    ] : !delMes ? [] : [
        { key: 'piezas', icon: Layers, label: 'Piezas', value: resumen.total,
            sub: Object.entries(mezcla.formatos).map(([f, c]) => `${c} ${formatoDe(f).label.toLowerCase()}`).join(' · ') || 'Sin planificar' },
        { key: 'avance', icon: CheckCircle2, label: 'Listas', value: formatPct(resumen.avance * 100, { decimales: 0 }),
            sub: `${resumen.listas} de ${resumen.total}` },
        { key: 'abiertas', icon: AlertTriangle, label: 'Con cambios', value: resumen.por.cambios,
            valueCls: resumen.por.cambios ? 'text-warning' : undefined, sub: `${resumen.abiertas} sin terminar` },
        { key: 'pauta', icon: Megaphone, label: 'Se pautan', value: resumen.pautadas,
            sub: pauta.presupuesto ? formatMoney(pauta.presupuesto) : 'Sin inversión' },
    ];

    // La fecha límite del mes siguiente: se avisa en pantalla desde tres días
    // antes, igual que el recordatorio de las 8:00.
    const avisoLimite = (() => {
        if (!ajustesMes || mesSiguiente?.publicado_at) return null;
        const limite = ajustesMes.dia_limite_envio;
        const hoy = Number(hoySV().slice(8));
        if (hoy < limite - 3) return null;
        const sig = etiquetaMes(correrMes(mesSV(), 1));
        if (hoy > limite) return { vencido: true, texto: `El calendario de ${sig} debía enviarse a revisión el día ${limite} y todavía no se envía.` };
        return { vencido: false, texto: hoy === limite
            ? `Hoy es el último día para enviar el calendario de ${sig} a revisión.`
            : `Quedan ${limite - hoy} días para enviar el calendario de ${sig} a revisión (límite: día ${limite}).` };
    })();

    const filtrosPuestos = (fMarca ? 1 : 0) + (fSolicitud ? 1 : 0) + (fFormato ? 1 : 0) + (fLiberada ? 1 : 0);
    const limpiar = () => { setFMarca(''); setFSolicitud(''); setFFormato(''); setFLiberada(''); };
    const esMesActual = mes === mesSV();

    const cuerpo = () => {
        if (cargando) return <LoadingState label="Cargando el calendario…" />;
        if (error) {
            return (
                <Notice variant="danger" icon={AlertTriangle}>
                    {mensajeAmigable(error, 'No se pudo cargar el planificador.')}
                </Notice>
            );
        }
        if (tab === 'galeria' || tab === 'biblioteca') {
            if (cargandoExtra && !(tab === 'galeria' ? galeria : recursos).length) return <LoadingState label="Cargando…" />;
            if (tab === 'biblioteca') {
                return (
                    <TabBiblioteca recursos={recursos} marcas={marcasPorId} firmadas={firmasExtra}
                        puedeGestionar={puedeEditar || puedeAprobar} yoId={yoId} onCambio={cargarExtra} />
                );
            }
            const enGaleria = galeria
                .filter((p) => !fMarca || esDeMarca(p, fMarca))
                .filter((p) => !fFormato || p.formato === fFormato)
                .filter((p) => !fLiberada || (fLiberada === 'si' ? p.liberada : !p.liberada))
                .filter((p) => !busqueda || tokenMatch(busqueda, p.titulo, p.copy, p.hashtags));
            return (
                <Galeria piezas={enGaleria} marcas={marcasPorId} firmadas={firmasExtra} gestion
                    puedeLiberar={puedeEditar || puedeAprobar} onLiberar={liberarDesdeGaleria}
                    onAbrir={(p) => setParams((prev) => {
                        const n = new URLSearchParams(prev);
                        n.set('tab', 'calendario');
                        n.set('mes', String(p.fecha).slice(0, 7));
                        n.set('pieza', p.id);
                        return n;
                    })} />
            );
        }
        if (tab === 'solicitudes') {
            return (
                <TabSolicitudes solicitudes={solicitudes} marcas={marcasPorId} personas={personas}
                    busqueda={busqueda} filtroEstado={fSolicitud}
                    onAbrir={setSolicitudAbierta} onNueva={() => setSolicitudAbierta({})} />
            );
        }
        // Sin el mes creado todavía, el calendario se pinta igual (pedido del
        // usuario): tocar un día lo crea. Las tablas de abajo quedan vacías.
        if (tab === 'tablero') {
            return (
                <TabTablero piezas={visibles} marcasDe={marcasDe} comentariosPorPieza={comentariosPorPieza}
                    ultimos={ultimos} personas={personas}
                    puedeMoverla={puedeMoverla} onAbrir={abrirPieza} onMover={mover} />
            );
        }
        if (tab === 'pauta') {
            return (
                <TabPauta piezas={visibles} marcas={marcasPorId} redes={catalogos.redes} puedeEditar={puedeEditar}
                    onAbrir={(p) => (puedeEditar ? setPautaId(p.id) : abrirPieza(p))} />
            );
        }
        return (
            <div className="space-y-6">
                <TabCalendario mes={mes} piezas={visibles} marcasDe={marcasDe} comentariosPorPieza={comentariosPorPieza}
                    ultimos={ultimos} personas={personas} especiales={fechasEspeciales}
                    puedeEditar={puedeEditar} puedeMoverla={puedeMoverla} onAbrir={abrirPieza}
                    onNueva={(fecha, prellenado) => nuevaPieza(fecha, prellenado)} onMover={mover} />
                {mesFila && (publicado || comentariosDelMes.length > 0) && (
                    <section data-surface="card" className="p-4 space-y-3">
                        <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                            <MessageSquare size={13} /> Comentarios del mes
                        </h3>
                        <Conversacion comentarios={comentariosDelMes} personas={personas} mesId={mesFila.id}
                            yoId={yoId} puedeResolver={puedeEditar || puedeAprobar} onCambio={recargar} />
                    </section>
                )}
            </div>
        );
    };

    return (
        <GlassViewLayout icon={Megaphone} title="Marketing" filtersContent={(
            <ViewTabBar
                tabs={tabs.map((t) => (t.key === 'solicitudes' && puedeEditar ? { ...t, cuenta: nuevasSolicitudes } : t))}
                activeTab={tab} onTabChange={setTab}
                searchValue={busqueda} onSearchChange={setBusqueda}
                placeholder={tab === 'solicitudes' ? 'Buscar solicitud…' : 'Buscar pieza…'} />
        )} transparentBody>
            <div className="p-4 md:p-6 space-y-6">
                <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                    {tarjetas.length > 0 ? (
                        <CarrilCards className="flex-1" ariaLabel="Resumen del mes">
                            {tarjetas.map((m) => (
                                <StatCard key={m.key} icon={m.icon} valueCls={m.valueCls}
                                    label={m.label} value={m.value} sub={m.sub} />
                            ))}
                        </CarrilCards>
                    ) : <div className="flex-1" />}
                    <div className="flex justify-end min-w-0">
                        <FilterBar acciones={acciones} activeCount={filtrosPuestos} onClear={filtrosPuestos ? limpiar : undefined}>
                            {delMes && (
                                <FilterBar.Section label="mes" fija>
                                    <PeriodStepper unit="mes" label={etiquetaMes(mes)} isCurrent={esMesActual}
                                        resetLabel="Este mes" onReset={() => cambiarParam('mes', null)}
                                        onPrev={() => cambiarParam('mes', correrMes(mes, -1))}
                                        onNext={() => cambiarParam('mes', correrMes(mes, 1))} />
                                </FilterBar.Section>
                            )}
                            {(delMes || tab === 'galeria') && catalogos.marcas.length > 1 && (
                                <FilterBar.Section label="marca" active={!!fMarca} onClear={() => setFMarca('')}>
                                    <FilterBar.Opciones value={fMarca} onChange={(v) => setFMarca(v || '')} label="Marca" placeholder="Marca"
                                        umbral={0}
                                        options={[{ value: '', label: 'Marca' },
                                            ...catalogos.marcas.map((m) => ({ value: String(m.id), label: m.nombre }))]} />
                                </FilterBar.Section>
                            )}
                            {tab === 'galeria' && (
                                <FilterBar.Section label="formato" active={!!fFormato} onClear={() => setFFormato('')}>
                                    <FilterBar.Opciones value={fFormato} onChange={(v) => setFFormato(v || '')} label="Formato" placeholder="Formato"
                                        options={[{ value: '', label: 'Formato' }, ...FORMATOS.map((f) => ({ value: f.value, label: f.label }))]} />
                                </FilterBar.Section>
                            )}
                            {tab === 'galeria' && (
                                <FilterBar.Section label="salas" active={!!fLiberada} onClear={() => setFLiberada('')}>
                                    <FilterBar.Opciones value={fLiberada} onChange={(v) => setFLiberada(v || '')} label="Salas"
                                        options={[{ value: '', label: 'Todas' }, { value: 'si', label: 'Liberadas' }, { value: 'no', label: 'Sin liberar' }]} />
                                </FilterBar.Section>
                            )}
                            {tab === 'solicitudes' && (
                                <FilterBar.Section label="estado" active={!!fSolicitud} onClear={() => setFSolicitud('')}>
                                    <FilterBar.Opciones value={fSolicitud} onChange={(v) => setFSolicitud(v || '')} label="Estado" placeholder="Estado"
                                        options={[{ value: '', label: 'Estado' },
                                            ...ESTADOS_SOLICITUD.map((e) => ({ value: e.value, label: e.label }))]} />
                                </FilterBar.Section>
                            )}
                        </FilterBar>
                    </div>
                </div>

                {delMes && avisoLimite && (
                    <Notice variant={avisoLimite.vencido ? 'danger' : 'warning'} icon={Clock}>
                        {avisoLimite.texto}
                    </Notice>
                )}

                {delMes && mesFila && estadoMes && (
                    <Notice variant={estadoMes.variant === 'neutral' ? 'info' : estadoMes.variant}
                        icon={mesFila.estado === 'aprobado' ? CheckCircle2 : CalendarDays}>
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Badge variant={estadoMes.variant} size="sm">{estadoMes.label}</Badge>
                            {mesFila.version > 1 && <span className="text-caption text-content-3">versión {mesFila.version}</span>}
                            <span>{estadoMes.texto}</span>
                            {mesFila.estado === 'aprobado' && personas[mesFila.aprobado_por] && (
                                <span className="text-caption text-content-3">
                                    {shortEmployeeName(personas[mesFila.aprobado_por].name)} · {fechaTexto(mesFila.aprobado_at, { day: 'numeric', month: 'short' })}
                                </span>
                            )}
                        </span>
                        {mesFila.objetivo && <span className="block mt-1 text-content-2"><strong>Objetivo:</strong> {mesFila.objetivo}</span>}
                        {Object.keys(mezcla.pilares).length > 0 && (
                            <span className="block mt-1 text-caption text-content-3">
                                {Object.entries(mezcla.pilares).map(([k, c]) => `${pilarDe(k).label} ${c}`).join(' · ')}
                            </span>
                        )}
                    </Notice>
                )}

                {cuerpo()}
            </div>

            {(piezaAbierta || nueva) && mesFila && (
                <PiezaModal key={piezaAbierta?.id || 'nueva'} open
                    onClose={() => (piezaAbierta ? abrirPieza(null) : setNueva(null))}
                    mes={mesFila} pieza={piezaAbierta || nueva?.prellenado} fechaInicial={nueva?.fecha}
                    catalogos={catalogos} promociones={promociones} personas={personas} comentarios={comentarios} firmadas={firmadas}
                    historial={historial} piezasDelMes={piezas} esSU={isSU}
                    puedeEditar={puedeEditar} puedeAprobar={puedeAprobar} yoId={yoId}
                    onCambio={recargar} onEditarPauta={(p) => { abrirPieza(null); setPautaId(p.id); }}
                    onDuplicar={(p) => { abrirPieza(null); setDuplicando({ pieza: p }); }} />
            )}
            {pautaDe && (
                <PautaModal key={pautaDe.id} open onClose={() => setPautaId(null)} pieza={pautaDe}
                    redes={catalogos.redes} limite={Number(mesFila?.presupuesto_pauta) || 0}
                    otros={asignadoEnPauta(piezas, pautaDe.id)} onCambio={recargar} />
            )}
            {solicitudAbierta && (
                <SolicitudModal key={solicitudAbierta.id || 'nueva'} open onClose={() => setSolicitudAbierta(null)}
                    solicitud={solicitudAbierta} marcas={catalogos.marcas} personas={personas}
                    puedeEditar={puedeEditar} yoId={yoId} onCambio={recargar} onAceptar={aceptarSolicitud} />
            )}
            {decision && (
                <DecisionMesModal key={decision} modo={decision} mes={mesFila} resumen={resumen}
                    onClose={() => setDecision(null)} onCambio={recargar} />
            )}
            {datosMes && <DatosDelMesModal open mes={mesFila} puedeAprobar={puedeAprobar} asignado={pauta.presupuesto}
                onClose={() => setDatosMes(false)} onCambio={recargar} />}
            {duplicando && (
                <DuplicarModal mes={mes} piezas={piezas} preseleccion={duplicando.pieza || null}
                    onClose={() => setDuplicando(null)}
                    onListo={(destino) => {
                        setDuplicando(null);
                        if (destino !== mes) cambiarParam('mes', destino); else recargar();
                    }} />
            )}
            <AjustesModal open={ajustes} onClose={() => setAjustes(false)} marcas={catalogos.marcas} redes={catalogos.redes}
                ajustes={ajustesMes} fechas={fechasEspeciales} puedeEditar={puedeEditar} puedeAprobar={puedeAprobar}
                onCambio={recargar} />
        </GlassViewLayout>
    );
}
