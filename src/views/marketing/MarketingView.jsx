import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Megaphone, CalendarDays, KanbanSquare, Inbox, Plus, Send, ThumbsUp, Settings2, Target,
    CheckCircle2, AlertTriangle, DollarSign, Layers, MessageSquare, Sparkles,
} from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import ViewTabBar from '../../components/common/ViewTabBar';
import FilterBar from '../../components/common/FilterBar';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import PeriodStepper from '../../components/common/PeriodStepper';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import Button from '../../components/common/Button';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import usePestanaEnUrl from '../../plataforma/usePestanaEnUrl';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { formatMoney, formatPct } from '@nucleo/utils/formatNumber';
import { mesSV, correrMes, etiquetaMes, fechaTexto } from '@nucleo/utils/fecha';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import {
    ESTADOS_MES, ESTADOS_SOLICITUD, resumenDelMes, mezclaDelMes, totalesDePauta, textoDePieza, pilarDe, formatoDe,
} from '@nucleo/utils/marketing';
import {
    fetchCatalogos, fetchMes, crearMes, fetchPiezas, fetchComentarios, fetchSolicitudes, fetchPersonas,
    firmarDisenos, moverPieza,
} from '@nucleo/data/marketing';
import TabCalendario from './TabCalendario';
import TabTablero from './TabTablero';
import TabSolicitudes from './TabSolicitudes';
import TabPauta from './TabPauta';
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
    const { hasPermission, user } = useAuth();
    const puedeEditar = hasPermission('marketing', 'can_edit');
    const puedeAprobar = hasPermission('marketing', 'can_approve');
    const yoId = user?.id;
    const showToast = useToastStore((s) => s.showToast);

    const tabs = useMemo(() => ([
        { key: 'calendario',  label: 'Calendario',  icon: CalendarDays },
        { key: 'tablero',     label: 'Flujo',       icon: KanbanSquare },
        { key: 'solicitudes', label: 'Solicitudes', icon: Inbox },
        { key: 'pauta',       label: 'Pauta',       icon: Megaphone },
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
    const [fSolicitud, setFSolicitud] = useState('');

    const [catalogos, setCatalogos] = useState({ marcas: [], redes: [] });
    const [mesFila, setMesFila] = useState(null);
    const [piezas, setPiezas] = useState([]);
    const [comentarios, setComentarios] = useState([]);
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

    const cargar = useCallback(async ({ silencioso = false } = {}) => {
        if (!silencioso) setCargando(true);
        try {
            const [cat, fila, sols] = await Promise.all([fetchCatalogos(), fetchMes(mes), fetchSolicitudes()]);
            const [ps, cs] = fila ? await Promise.all([fetchPiezas(fila.id), fetchComentarios(fila.id)]) : [[], []];
            const [gente, firmas] = await Promise.all([
                fetchPersonas([...cs.map((c) => c.autor_id), ...sols.map((s) => s.solicitado_por), fila?.publicado_por, fila?.aprobado_por]),
                firmarDisenos(ps),
            ]);
            setCatalogos(cat);
            setMesFila(fila);
            setPiezas(ps);
            setComentarios(cs);
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
    const recargar = useCallback(() => cargar({ silencioso: true }), [cargar]);

    const marcasPorId = useMemo(() => Object.fromEntries(catalogos.marcas.map((m) => [m.id, m])), [catalogos.marcas]);

    const visibles = useMemo(() => piezas
        .filter((p) => !fMarca || String(p.marca_id) === String(fMarca))
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
        ...(tab === 'solicitudes' ? [{
            key: 'pedir', icon: Plus, label: 'Pedir', title: 'Pedirle una pieza al diseñador',
            rotulo: 'Pedir', variant: 'primary', onClick: () => setSolicitudAbierta({}),
        }] : []),
        ...(puedeEditar && mesFila && resumen.total > 0 && mesFila.estado !== 'en_revision' ? [{
            key: 'publicar', icon: Send, label: mesFila.version > 0 ? 'Reenviar' : 'Enviar a revisión',
            title: 'Enviar el calendario del mes a quien aprueba', rotulo: mesFila.version > 0 ? 'Reenviar' : 'Enviar',
            variant: 'secondary', onClick: () => setDecision('publicar'),
        }] : []),
        ...(puedeAprobar && publicado && mesFila.estado !== 'aprobado' ? [{
            key: 'aprobar', icon: ThumbsUp, label: 'Aprobar mes', title: 'Aprobar el calendario completo',
            rotulo: 'Aprobar', variant: 'secondary', tone: 'success', onClick: () => setDecision('aprobar'),
        }] : []),
        // El presupuesto de pauta lo fija gerencia: quien aprueba también puede.
        ...((puedeEditar || puedeAprobar) && tab !== 'solicitudes' ? [{
            key: 'datos', icon: Target, label: 'Objetivo y presupuesto', title: 'Objetivo del mes y presupuesto de pauta',
            soloIcono: true, variant: 'secondary', onClick: abrirDatosDelMes,
        }] : []),
        ...(puedeEditar ? [{
            key: 'ajustes', icon: Settings2, label: 'Marcas y redes', title: 'Marcas y redes',
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
    ] : tab === 'solicitudes' ? [] : [
        { key: 'piezas', icon: Layers, label: 'Piezas', value: resumen.total,
            sub: Object.entries(mezcla.formatos).map(([f, c]) => `${c} ${formatoDe(f).label.toLowerCase()}`).join(' · ') || 'Sin planificar' },
        { key: 'avance', icon: CheckCircle2, label: 'Listas', value: formatPct(resumen.avance * 100, { decimales: 0 }),
            sub: `${resumen.listas} de ${resumen.total}` },
        { key: 'abiertas', icon: AlertTriangle, label: 'Con cambios', value: resumen.por.cambios,
            valueCls: resumen.por.cambios ? 'text-warning' : undefined, sub: `${resumen.abiertas} sin terminar` },
        { key: 'pauta', icon: Megaphone, label: 'Se pautan', value: resumen.pautadas,
            sub: pauta.presupuesto ? formatMoney(pauta.presupuesto) : 'Sin inversión' },
    ];

    const filtrosPuestos = (fMarca ? 1 : 0) + (fSolicitud ? 1 : 0);
    const limpiar = () => { setFMarca(''); setFSolicitud(''); };
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
        if (tab === 'solicitudes') {
            return (
                <TabSolicitudes solicitudes={solicitudes} marcas={marcasPorId} personas={personas}
                    busqueda={busqueda} filtroEstado={fSolicitud}
                    onAbrir={setSolicitudAbierta} onNueva={() => setSolicitudAbierta({})} />
            );
        }
        if (!mesFila) {
            return (
                <EmptyState icon={Sparkles} title={`Sin calendario para ${etiquetaMes(mes)}`}
                    subtitle={puedeEditar ? 'Empieza a planificar las publicaciones del mes.' : 'El diseñador todavía no empezó este mes.'}
                    action={puedeEditar ? <Button icon={Plus} onClick={() => nuevaPieza(null)}>Agregar la primera pieza</Button> : undefined} />
            );
        }
        if (tab === 'tablero') {
            return (
                <TabTablero piezas={visibles} marcas={marcasPorId} comentariosPorPieza={comentariosPorPieza}
                    puedeEditar={puedeEditar} onAbrir={abrirPieza} onMover={mover} />
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
                <TabCalendario mes={mes} piezas={visibles} marcas={marcasPorId} comentariosPorPieza={comentariosPorPieza}
                    puedeEditar={puedeEditar} onAbrir={abrirPieza}
                    onNueva={(fecha) => nuevaPieza(fecha)} onMover={mover} />
                {(publicado || comentariosDelMes.length > 0) && (
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
                            {tab !== 'solicitudes' && (
                                <FilterBar.Section label="mes" fija>
                                    <PeriodStepper unit="mes" label={etiquetaMes(mes)} isCurrent={esMesActual}
                                        resetLabel="Este mes" onReset={() => cambiarParam('mes', null)}
                                        onPrev={() => cambiarParam('mes', correrMes(mes, -1))}
                                        onNext={() => cambiarParam('mes', correrMes(mes, 1))} />
                                </FilterBar.Section>
                            )}
                            {tab !== 'solicitudes' && catalogos.marcas.length > 1 && (
                                <FilterBar.Section label="marca" active={!!fMarca} onClear={() => setFMarca('')}>
                                    <FilterBar.Opciones value={fMarca} onChange={(v) => setFMarca(v || '')} label="Marca" placeholder="Marca"
                                        umbral={0}
                                        options={[{ value: '', label: 'Marca' },
                                            ...catalogos.marcas.map((m) => ({ value: String(m.id), label: m.nombre }))]} />
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

                {tab !== 'solicitudes' && mesFila && estadoMes && (
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
                    catalogos={catalogos} personas={personas} comentarios={comentarios} firmadas={firmadas}
                    puedeEditar={puedeEditar} puedeAprobar={puedeAprobar} yoId={yoId}
                    onCambio={recargar} onEditarPauta={(p) => { abrirPieza(null); setPautaId(p.id); }} />
            )}
            {pautaDe && (
                <PautaModal key={pautaDe.id} open onClose={() => setPautaId(null)} pieza={pautaDe}
                    redes={catalogos.redes} onCambio={recargar} />
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
            {datosMes && <DatosDelMesModal open mes={mesFila} onClose={() => setDatosMes(false)} onCambio={recargar} />}
            <AjustesModal open={ajustes} onClose={() => setAjustes(false)} marcas={catalogos.marcas} redes={catalogos.redes} onCambio={recargar} />
        </GlassViewLayout>
    );
}
