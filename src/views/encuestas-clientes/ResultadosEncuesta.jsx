import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Gauge, Users, Smile, Frown, Download, MessageSquareText, History, AlertTriangle, Store, Phone,
    Target, UserRound, MapPin, ListFilter, X,
} from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import RangeDatePicker from '../../components/common/RangeDatePicker';
import { LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { formatPct } from '@nucleo/utils/formatNumber';
import { exportCsv } from '@nucleo/utils/csvExport';
import {
    lecturaNps, CAMPO, tablaDeRespuestas, estadoDe, loteParaResumir, archivoDeEncuesta, estadoDelResumen, preguntasEnOrden,
    filtrosParaLaBase, cuantosFiltros, preguntasFiltrables, metaDelFiltro,
} from '@nucleo/utils/encuestasClientes';
import {
    fetchResultados, fetchComentarios, fetchRondas, fetchRespuestasParaExportar, fetchResumen, guardarResumen,
    fetchLectura, guardarLectura, fetchUbicaciones, fetchAvance,
} from '@nucleo/data/encuestasClientes';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import GraficaDePregunta from './GraficaDePregunta';
import { paqueteParaSaly, estadoDeLectura, avisoDeLectura } from '@nucleo/utils/encuestasLectura';
import LecturaDeSaly from './SalyLeeResultados';
import { useSalyEnPantalla } from '../../components/saly/salyAyudaStore';
import { preguntarASaly } from '@nucleo/data/ia';
import SalyDice from '../../components/common/SalyDice';
import SalyIcono from '../../components/common/SalyIcono';
import { barraDeDimension } from './iconos';
import UbicacionesDeCampo from './UbicacionesDeCampo';

import TituloDeSeccion from '../../components/common/TituloDeSeccion';
import PuntoDeEstado from '../../components/common/PuntoDeEstado';
/**
 * Lo que dijeron los clientes: NPS, puntaje por dimensión (escala común
 * 0-100), la distribución de cada pregunta, la comparación entre sucursales y
 * entre rondas, los comentarios con su resumen y el CSV.
 *
 * Todo lo cuenta la base (`encuesta_cliente_resultados`): acá sólo se pinta.
 *
 * Filtros (2026-11-20, pedido del usuario): sucursal, fechas, entrevistador,
 * zona y una respuesta («sólo quienes dijeron X»). Los aplica la base con un
 * solo juez (`encuesta_cliente_filtra`) para los resultados, los comentarios
 * y el CSV, así que lo que se ve y lo que se exporta es lo mismo. La lectura
 * de Saly y el resumen son de la sucursal entera: con otro filtro puesto, no
 * se rehacen.
 */
const SIN_FILTROS = { desde: '', hasta: '', entrevistador: '', zona: '', pregunta: '', valor: '' };

export default function ResultadosEncuesta({ encuesta }) {
    const showToast = useToastStore((s) => s.showToast);
    const [sala, setSala] = useState('');
    const [filtros, setFiltros] = useState(SIN_FILTROS);
    const [avance, setAvance] = useState(null);
    const [datos, setDatos] = useState(null);
    const [comentarios, setComentarios] = useState([]);
    const [rondas, setRondas] = useState([]);
    const [error, setError] = useState(null);
    const [exportando, setExportando] = useState(false);
    const [resumen, setResumen] = useState(null);
    const [resumiendo, setResumiendo] = useState(false);
    const [lecturaSaly, setLecturaSaly] = useState(null);
    const [leyendo, setLeyendo] = useState(false);
    // Para qué filtro está pintado lo que se ve (`undefined` = todavía nada):
    // Saly sólo lee cuando los números en pantalla son los del lugar elegido.
    const [cargadoPara, setCargadoPara] = useState(undefined);
    // Lo que se le pidió a Saly al tocarla: `{ b }` (null = todas).
    const [pedido, setPedido] = useState(null);
    const lecturaRef = useRef(null);

    const branchId = sala ? Number(sala) : null;
    const clave = JSON.stringify(filtrosParaLaBase(filtros));
    const filtrosBase = useMemo(() => JSON.parse(clave), [clave]);
    const nFiltros = cuantosFiltros(filtros);
    const conFiltros = nFiltros > 0;
    const poner = (cambios) => setFiltros((f) => ({ ...f, ...cambios }));
    // Sólo pinta la ÚLTIMA carga pedida: al cambiar rápido de sucursal, una
    // respuesta lenta de la anterior no puede quedar bajo el filtro nuevo.
    const vigente = useRef(0);
    const cargar = useCallback(async () => {
        const n = (vigente.current += 1);
        try {
            const [d, c, r, res, lec] = await Promise.all([
                fetchResultados(encuesta.id, branchId, filtrosBase), fetchComentarios(encuesta.id, branchId, filtrosBase), fetchRondas(encuesta.id),
                fetchResumen(encuesta.id, branchId), fetchLectura(encuesta.id, branchId),
            ]);
            if (n !== vigente.current) return;
            setLecturaSaly(lec);
            setDatos(d);
            // Saly sólo lee con la sucursal entera en pantalla (sin otro filtro).
            setCargadoPara(filtrosBase ? undefined : branchId);
            setComentarios(c);
            setRondas(r);
            setResumen(res);
            setError(null);
        } catch (err) {
            if (n === vigente.current) setError(err);
        }
    }, [encuesta.id, branchId, filtrosBase]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga de los resultados
    // La meta es de la encuesta: se lee una vez (la misma cuenta que Avance).
    useEffect(() => { fetchAvance(encuesta.id).then(setAvance).catch(() => setAvance(null)); }, [encuesta.id]);

    // El número de cada pregunta es el del cuestionario (el mismo del CSV, del
    // constructor y de los avisos de la base), no su posición en esta lista.
    const numeroDe = useMemo(() => Object.fromEntries(preguntasEnOrden(encuesta.cuestionario).map((p) => [p.id, p.numero])),
        [encuesta.cuestionario]);
    // Las opciones de cada filtro vienen contadas sobre TODA la encuesta: con
    // un filtro puesto, las listas no se encogen.
    const opciones = datos?.filtros;
    const salas = useMemo(() => (opciones?.sucursales || [])
        .map((x) => ({ value: String(x.branch_id), label: x.nombre, respuestas: x.respuestas })), [opciones]);
    const todas = { salas, total: datos?.total_encuesta ?? 0 };
    const entrevistadores = useMemo(() => (opciones?.entrevistadores || [])
        .map((x) => ({ value: x.id, label: `${shortEmployeeName(x.nombre)} (${x.respuestas})` })), [opciones]);
    const zonas = useMemo(() => (opciones?.zonas || [])
        .map((x) => ({ value: x.id, label: `${x.nombre} (${x.respuestas})` })), [opciones]);
    const preguntas = useMemo(() => preguntasFiltrables(encuesta.cuestionario), [encuesta.cuestionario]);
    const preguntaElegida = preguntas.find((q) => q.value === filtros.pregunta);
    const meta = metaDelFiltro(encuesta, avance, { branchId, zona: filtros.zona });
    const filtrarPorRespuesta = (pregunta, valor) => poner(valor == null ? { pregunta: '', valor: '' } : { pregunta, valor });
    const quitarTodo = () => { setFiltros(SIN_FILTROS); setSala(''); };

    const exportar = async () => {
        setExportando(true);
        try {
            // Lo mismo que se ve: la base aplica la sucursal y los filtros.
            const filas = await fetchRespuestasParaExportar(encuesta.id, branchId, filtrosBase);
            const { headers, rows } = tablaDeRespuestas(encuesta.cuestionario, filas,
                { fechaHora: (f) => `${fechaTexto(f, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${hora12(f)}` });
            const nombreSala = branchId ? salas.find((x) => Number(x.value) === branchId)?.label : null;
            const nombre = [encuesta.nombre, nombreSala, conFiltros ? 'filtrado' : null].filter(Boolean).join('-');
            exportCsv(headers, rows, `${archivoDeEncuesta(nombre)}.csv`, 'encuestas_clientes');
        } catch (err) {
            showToast('No se pudo exportar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setExportando(false);
        }
    };

    // La IA es cara y tiene cuota (pedido del usuario, 2026-10-02): el
    // resumen se guarda en la base y todos ven el mismo; sólo se rehace a mano
    // y cuando entraron `minimo_nuevos` comentarios desde el anterior. Viajan
    // los 100 más recientes, sin repetidos y recortados.
    const resumir = async () => {
        setResumiendo(true);
        try {
            const hasta = comentarios[0]?.created_at;
            // Sin repetidos, recortados y hasta 100: núcleo (`loteParaResumir`), lo mismo que la app.
            const lote = loteParaResumir(comentarios);
            const { data, error: e } = await preguntarASaly({
                action: 'analyze-customer-survey', payload: { encuesta: encuesta.nombre, comments: lote },
            });
            if (e) throw e;
            const texto = data?.aiSummary;
            if (!texto) throw new Error('La IA no devolvió un resumen.');
            await guardarResumen(encuesta.id, branchId, texto, hasta);
            setResumen(await fetchResumen(encuesta.id, branchId));
        } catch (err) {
            showToast('No se pudo resumir', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setResumiendo(false);
        }
    };

    // La LECTURA de Saly (2026-11-07): los números ya contados más los cruces
    // entre preguntas que se apartan del total (núcleo, `encuestasLectura`),
    // y ella dice qué significan y qué hacer. Se guarda y todos ven la misma;
    // se rehace a mano cuando entran respuestas nuevas suficientes.
    const leerResultados = async () => {
        setLeyendo(true);
        try {
            const enCampo = branchId === CAMPO;
            const [filas, ubic] = await Promise.all([
                fetchRespuestasParaExportar(encuesta.id, branchId),
                (!branchId || enCampo) && (datos?.por_canal?.campo || 0) > 0 ? fetchUbicaciones(encuesta.id).catch(() => null) : null,
            ]);
            const nombreSala = branchId ? salas.find((x) => Number(x.value) === branchId)?.label : null;
            const paquete = paqueteParaSaly({
                encuesta, datos, filas, comentarios, lugares: ubic?.por_lugar || [], filtro: nombreSala,
            });
            const { data, error: e } = await preguntarASaly({
                action: 'analyze-customer-survey-results', payload: { datos: paquete },
            });
            if (e) throw e;
            const texto = data?.aiSummary;
            if (!texto) throw new Error('Salvi no devolvió la lectura.');
            await guardarLectura(encuesta.id, branchId, texto, filas.length);
            setLecturaSaly(await fetchLectura(encuesta.id, branchId));
        } catch (err) {
            showToast('Salvi no pudo leer los resultados', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setLeyendo(false);
        }
    };

    // Al tocar a Saly: se pone el filtro del lugar elegido (así lo que se ve y
    // lo que ella lee son lo mismo), y cuando esos números ya están en
    // pantalla, lee —si hace falta— y lleva la vista a su lectura.
    const pedirLectura = (b) => {
        setFiltros(SIN_FILTROS);
        setSala(b == null ? '' : String(b));
        setPedido({ b: b ?? null });
    };
    useEffect(() => {
        if (!pedido || leyendo || cargadoPara !== pedido.b) return;
        setPedido(null);
        if (estadoDeLectura(lecturaSaly).puede) leerResultados();
        requestAnimationFrame(() => lecturaRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }));
    }, [pedido, cargadoPara, leyendo]); // eslint-disable-line react-hooks/exhaustive-deps -- `leerResultados` lee el render vigente

    const lugaresParaSaly = [
        { value: null, label: 'Todas las sucursales', respuestas: todas.total },
        ...todas.salas.filter((x) => x.respuestas > 0).map((x) => ({ value: Number(x.value), label: x.label, respuestas: x.respuestas })),
    ];
    // Saly flota en SU lugar (la burbuja de siempre, como en Efectivo): esta
    // vista sólo le pasa qué ofrecer. Con varios lugares, al tocarla pregunta
    // cuál leer.
    useSalyEnPantalla({
        modulo: 'encuestas_clientes',
        titulo: `Resultados · ${encuesta.nombre}`,
        leer: () => ({
            encuesta: encuesta.nombre, filtro: branchId == null ? 'todas las sucursales' : salas.find((x) => Number(x.value) === branchId)?.label,
            respuestas: datos?.total ?? null, nps: datos?.nps ?? null,
            lectura_de_saly: lecturaSaly?.texto ? String(lecturaSaly.texto).slice(0, 1500) : null,
        }),
        avisos: [avisoDeLectura({ lectura: lecturaSaly, lugares: todas.total > 0 ? lugaresParaSaly : [], leyendo, onLeer: pedirLectura })],
    });

    const nombreDelFiltro = branchId == null ? 'todas las sucursales' : (salas.find((x) => Number(x.value) === branchId)?.label || 'esta sucursal');

    if (!['publicada', 'cerrada', 'archivada'].includes(encuesta.estado)) {
        return <Notice variant="info" compact>Los resultados aparecen cuando la encuesta se publica y empieza a recibir respuestas.</Notice>;
    }
    if (error) return <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudieron cargar los resultados.')}</Notice>;
    if (!datos) return <LoadingState label="Calculando resultados…" />;

    const nps = datos.nps;
    const lectura = lecturaNps(nps.puntaje);
    const pct = (n) => (nps.respuestas ? (n / nps.respuestas) * 100 : 0);
    const recortado = conFiltros || !!sala;
    const canales = Object.entries(datos.por_canal || {})
        .map(([c, n]) => `${n} ${c === 'qr' ? 'QR' : c === 'kiosco' ? 'tablet' : c === 'app' ? 'app' : c === 'campo' ? 'campo' : 'entrevista'}`).join(' · ');

    return (
        <div className="space-y-5">
            <section data-surface="card" className="p-3 space-y-2.5" aria-label="Filtros de resultados">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="w-full sm:w-60">
                        <LiquidSelect value={sala} placeholder="Todas las sucursales" icon={Store} ariaLabel="Sucursal"
                            options={salas} clearable onChange={(v) => setSala(v || '')} />
                    </div>
                    <div className="w-full sm:w-56">
                        <RangeDatePicker startDate={filtros.desde} endDate={filtros.hasta} months={1} compact shortcuts
                            placeholder="Cualquier fecha" label="fechas"
                            onRangeChange={(desde, hasta) => poner({ desde: desde || '', hasta: hasta || desde || '' })} />
                    </div>
                    {entrevistadores.length > 1 && (
                        <div className="w-full sm:w-56">
                            <LiquidSelect value={filtros.entrevistador} placeholder="Quién entrevistó" icon={UserRound} ariaLabel="Quién entrevistó"
                                options={entrevistadores} clearable onChange={(v) => poner({ entrevistador: v || '' })} />
                        </div>
                    )}
                    {zonas.length > 0 && (
                        <div className="w-full sm:w-52">
                            <LiquidSelect value={filtros.zona} placeholder="Todas las zonas" icon={MapPin} ariaLabel="Zona"
                                options={zonas} clearable onChange={(v) => poner({ zona: v || '' })} />
                        </div>
                    )}
                    <div className="hidden sm:block flex-1" />
                    <Button variant="secondary" icon={Download} loading={exportando} disabled={!datos.total} onClick={exportar}>
                        {recortado ? 'Exportar lo filtrado' : 'Exportar CSV'}
                    </Button>
                </div>
                {preguntas.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="w-full sm:flex-1 sm:min-w-64">
                            <LiquidSelect value={filtros.pregunta} placeholder="Filtrar por una respuesta" icon={ListFilter} ariaLabel="Pregunta"
                                options={preguntas} clearable onChange={(v) => poner({ pregunta: v || '', valor: '' })} />
                        </div>
                        {preguntaElegida && (
                            <div className="w-full sm:w-64">
                                <LiquidSelect value={filtros.valor} placeholder="¿Qué respondieron?" ariaLabel="Respuesta"
                                    options={preguntaElegida.opciones} clearable onChange={(v) => poner({ valor: v || '' })} />
                            </div>
                        )}
                    </div>
                )}
                {recortado && (
                    <div className="flex flex-wrap items-center gap-2 text-body-sm text-content-2">
                        <span>Viendo <strong className="text-content tabular-nums">{datos.total}</strong> de {datos.total_encuesta} respuestas.</span>
                        <Button variant="ghost" size="sm" icon={X} onClick={quitarTodo}>Quitar filtros</Button>
                    </div>
                )}
            </section>

            {!datos.total ? (
                <Notice variant="info" compact>{recortado ? 'No hay respuestas con estos filtros.' : 'Todavía no hay respuestas.'}</Notice>
            ) : (
                <>
                    <CarrilCards ariaLabel="Resumen de resultados">
                        <StatCard icon={Users} label="Respuestas" value={datos.total}
                            sub={recortado ? `de ${datos.total_encuesta} en total` : canales} />
                        {meta?.meta ? (
                            <StatCard icon={Target} label="Meta" value={formatPct(Math.min(100, (meta.respuestas / meta.meta) * 100), { decimales: 0 })}
                                sub={`${meta.respuestas} de ${meta.meta}`}
                                valueCls={meta.respuestas >= meta.meta ? 'text-success' : undefined} />
                        ) : null}
                        {nps.respuestas > 0 && (
                            <StatCard icon={Gauge} label="NPS" value={nps.puntaje ?? '—'} sub={lectura.label}
                                valueCls={lectura.variant === 'danger' ? 'text-danger' : lectura.variant === 'success' ? 'text-success' : undefined} />
                        )}
                        {nps.respuestas > 0 && (
                            <StatCard icon={Smile} label="Promotores" value={formatPct(pct(nps.promotores), { decimales: 0 })} sub={`${nps.promotores} dieron 9 o 10`} />
                        )}
                        {nps.respuestas > 0 && (
                            <StatCard icon={Frown} label="Detractores" value={formatPct(pct(nps.detractores), { decimales: 0 })}
                                valueCls={nps.detractores ? 'text-danger' : undefined} sub={`${nps.detractores} dieron 0 a 6`} />
                        )}
                        <StatCard icon={MessageSquareText} label="Con comentario" value={datos.con_texto ?? 0}
                            sub={datos.total ? `${formatPct(((datos.con_texto ?? 0) / datos.total) * 100, { decimales: 0 })} escribió algo` : null} />
                    </CarrilCards>

                    <div ref={lecturaRef} className="scroll-mt-4">
                        {conFiltros ? (
                            <Notice variant="info" compact>La lectura de Salvi es de {nombreDelFiltro}. Quita los filtros para verla.</Notice>
                        ) : (
                            <LecturaDeSaly lectura={lecturaSaly} nombre={nombreDelFiltro} leyendo={leyendo}
                                onActualizar={leerResultados} />
                        )}
                    </div>

                    {nps.respuestas > 0 && (
                        <section data-surface="card" className="p-4 space-y-2">
                            <TituloDeSeccion nivel="seccion">Recomendación</TituloDeSeccion>
                            <div className="flex h-3 rounded-full overflow-hidden bg-surface-card-hover" data-medida="dato"
                                role="img" aria-label={`${nps.promotores} promotores, ${nps.pasivos} pasivos, ${nps.detractores} detractores`}>
                                <div className="bg-success" style={{ width: `${pct(nps.promotores)}%` }} />
                                <div className="bg-warning" style={{ width: `${pct(nps.pasivos)}%` }} />
                                <div className="bg-danger" style={{ width: `${pct(nps.detractores)}%` }} />
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1 text-micro text-content-2">
                                <Leyenda cls="bg-success" texto={`Promotores (9-10): ${nps.promotores}`} />
                                <Leyenda cls="bg-warning" texto={`Pasivos (7-8): ${nps.pasivos}`} />
                                <Leyenda cls="bg-danger" texto={`Detractores (0-6): ${nps.detractores}`} />
                            </div>
                        </section>
                    )}

                    <div className="grid gap-5 lg:grid-cols-2">
                        {datos.por_dimension.length > 0 && (
                            <section data-surface="card" className="p-4 space-y-3">
                                <TituloDeSeccion nivel="seccion">Por tema (0 a 100)</TituloDeSeccion>
                                <ul className="space-y-2.5">
                                    {datos.por_dimension.map((d) => (
                                        <Barra key={d.clave} label={d.nombre} valor={d.puntaje} max={100} cls={barraDeDimension(d.color)}
                                            sub={`${d.respuestas} respuesta(s)`} />
                                    ))}
                                </ul>
                            </section>
                        )}
                        {!sala && datos.por_sucursal.length > 1 && datos.por_sucursal.some((s) => s.nps != null) && (
                            <section data-surface="card" className="p-4 space-y-3">
                                <TituloDeSeccion nivel="seccion">NPS por sucursal</TituloDeSeccion>
                                <ul className="space-y-2">
                                    {datos.por_sucursal.map((s) => {
                                        const l = lecturaNps(s.nps);
                                        return (
                                            <li key={s.branch_id} className="flex items-center gap-2">
                                                <span className="text-body-sm text-content flex-1">{s.nombre}</span>
                                                <span className="text-micro text-content-3">{s.respuestas} resp.</span>
                                                <Badge size="sm" variant={l.variant}>{s.nps ?? '—'}</Badge>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        )}
                    </div>

                    {(!sala || Number(sala) === CAMPO) && (datos.por_canal?.campo || 0) > 0 && (
                        <UbicacionesDeCampo encuestaId={encuesta.id} zonas={encuesta.zonas_campo} />
                    )}

                    <section className="space-y-3">
                        <div className="flex flex-wrap items-baseline gap-2">
                            <TituloDeSeccion nivel="seccion" className="flex-1">Pregunta por pregunta</TituloDeSeccion>
                            <span className="text-micro text-content-3">Toca una respuesta para ver sólo a quienes la eligieron.</span>
                        </div>
                        <div className="grid gap-4 lg:grid-cols-2">
                            {datos.por_pregunta.filter((p) => p.tipo !== 'texto').map((p, i) => (
                                <div key={p.id} data-surface="card" className="p-4">
                                    <GraficaDePregunta p={p} numero={numeroDe[p.id] ?? i + 1}
                                        filtroActivo={filtrosBase} onFiltrar={filtrarPorRespuesta} />
                                </div>
                            ))}
                        </div>
                    </section>

                    <section data-surface="card" className="p-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <TituloDeSeccion nivel="seccion" className="flex items-center gap-1.5 flex-1">
                                <MessageSquareText size={13} /> Comentarios ({comentarios.length})
                            </TituloDeSeccion>
                            {comentarios.length >= 3 && (() => {
                                // Cuándo se puede rehacer y qué dice el botón: núcleo (`estadoDelResumen`).
                                const r = estadoDelResumen(resumen);
                                return (
                                    <Button variant="secondary" size="sm" icon={SalyIcono} loading={resumiendo} disabled={!r.puede || conFiltros}
                                        title={conFiltros ? 'Quita los filtros para resumir' : (r.ayuda || 'Resume los comentarios con IA y lo guarda para todos')}
                                        onClick={resumir}>
                                        {r.boton}
                                    </Button>
                                );
                            })()}
                        </div>
                        {salyLeyendo(resumiendo)}
                        {resumen?.texto && !resumiendo && (
                            <SalyDice animo="atencion" titulo={`leyó ${resumen.comentarios_n} comentario(s)`}
                                pie={<>{fechaTexto(resumen.generado_at, { day: 'numeric', month: 'short' })} {hora12(resumen.generado_at)}
                                    {resumen.nuevos > 0 ? ` · ${resumen.nuevos} nuevo(s) desde entonces` : ''}</>}>
                                <div className="whitespace-pre-line"><ConNegritas texto={resumen.texto} /></div>
                            </SalyDice>
                        )}
                        {!comentarios.length ? (
                            <p className="text-body-sm text-content-3">Sin comentarios escritos.</p>
                        ) : (
                            <ul className="divide-y divide-border-card max-h-[480px] overflow-y-auto">
                                {comentarios.map((c, i) => (
                                    <li key={`${c.id}-${i}`} className="py-2 space-y-0.5">
                                        <p className="text-body-sm text-content">«{c.texto}»</p>
                                        <p className="text-micro text-content-3 flex flex-wrap items-center gap-1">
                                            {c.nps != null && <Badge size="sm" variant={c.nps >= 9 ? 'success' : c.nps >= 7 ? 'warning' : 'danger'}>{c.nps}</Badge>}
                                            {c.sucursal} · {fechaTexto(c.created_at, { day: 'numeric', month: 'short' })} · {c.pregunta}
                                            {c.telefono && <span className="inline-flex items-center gap-0.5"><Phone size={10} />{c.contacto_nombre || c.telefono}</span>}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </>
            )}

            {rondas.length > 1 && (
                <section data-surface="card" className="p-4 space-y-3">
                    <TituloDeSeccion nivel="seccion" className="flex items-center gap-1.5">
                        <History size={13} /> Rondas de esta encuesta
                    </TituloDeSeccion>
                    <ul className="space-y-2">
                        {rondas.map((r) => {
                            const l = lecturaNps(r.nps);
                            return (
                                <li key={r.id} className={`flex flex-wrap items-center gap-2 ${r.id === encuesta.id ? 'font-semibold' : ''}`}>
                                    <span className="text-body-sm text-content flex-1">v{r.version} · {r.nombre}</span>
                                    <span className="text-micro text-content-3">
                                        {r.fecha_inicio ? fechaTexto(r.fecha_inicio, { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · {estadoDe(r.estado).label} · {r.respuestas} resp.
                                    </span>
                                    <Badge size="sm" variant={l.variant}>NPS {r.nps ?? '—'}</Badge>
                                </li>
                            );
                        })}
                    </ul>
                </section>
            )}

        </div>
    );
}

function Leyenda({ cls, texto }) {
    return <span className="inline-flex items-center gap-1.5"><PuntoDeEstado className={cls} />{texto}</span>;
}

function Barra({ label, valor, max, cls = 'bg-brand', sub }) {
    const ancho = valor != null && max ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
    return (
        <li className="space-y-1">
            <div className="flex items-baseline gap-2">
                <span className="text-body-sm text-content flex-1 min-w-0 truncate">{label}</span>
                {sub && <span className="text-micro text-content-3">{sub}</span>}
                <span className="text-body-sm font-semibold text-content w-10 text-right">{valor ?? '—'}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-card-hover overflow-hidden" data-medida="dato">
                <div className={`h-full ${cls}`} style={{ width: `${ancho}%` }} />
            </div>
        </li>
    );
}

/** Mientras Saly lee, se la ve leyendo. */
function salyLeyendo(resumiendo) {
    if (!resumiendo) return null;
    return <SalyDice animo="pensando">Estoy leyendo los comentarios, dame un momento…</SalyDice>;
}

/** El resumen de la IA marca los títulos con **; acá se vuelven negritas. */
function ConNegritas({ texto }) {
    return texto.split(/(\*\*[^*]+\*\*)/g).map((t, i) => (t.startsWith('**') && t.endsWith('**')
        ? <strong key={i}>{t.slice(2, -2)}</strong> : <React.Fragment key={i}>{t}</React.Fragment>));
}
