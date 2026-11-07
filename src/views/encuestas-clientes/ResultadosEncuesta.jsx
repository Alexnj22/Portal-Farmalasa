import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Gauge, Users, Smile, Frown, Download, MessageSquareText, History, AlertTriangle, Store, Phone,
} from 'lucide-react';
import CarrilCards from '../../components/common/CarrilCards';
import StatCard from '../../components/common/StatCard';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import { LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { formatPct } from '@nucleo/utils/formatNumber';
import { exportCsv } from '@nucleo/utils/csvExport';
import { lecturaNps, categoriasDe, CAMPO, tablaDeRespuestas, tipoDe, estadoDe, loteParaResumir, archivoDeEncuesta, estadoDelResumen, preguntasEnOrden } from '@nucleo/utils/encuestasClientes';
import {
    fetchResultados, fetchComentarios, fetchRondas, fetchRespuestasParaExportar, fetchResumen, guardarResumen,
    fetchLectura, guardarLectura, fetchUbicaciones,
} from '@nucleo/data/encuestasClientes';
import { paqueteParaSaly, estadoDeLectura } from '@nucleo/utils/encuestasLectura';
import SalyFlotante, { LecturaDeSaly } from './SalyLeeResultados';
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
 */
export default function ResultadosEncuesta({ encuesta }) {
    const showToast = useToastStore((s) => s.showToast);
    const [sala, setSala] = useState('');
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
    // Las sucursales y el total de TODA la encuesta: con un filtro puesto,
    // `por_sucursal` trae sólo la elegida, y la lista no puede encogerse.
    const [todas, setTodas] = useState({ salas: [], total: 0 });
    const lecturaRef = useRef(null);

    const branchId = sala ? Number(sala) : null;
    // Sólo pinta la ÚLTIMA carga pedida: al cambiar rápido de sucursal, una
    // respuesta lenta de la anterior no puede quedar bajo el filtro nuevo.
    const vigente = useRef(0);
    const cargar = useCallback(async () => {
        const n = (vigente.current += 1);
        try {
            const [d, c, r, res, lec] = await Promise.all([
                fetchResultados(encuesta.id, branchId), fetchComentarios(encuesta.id, branchId), fetchRondas(encuesta.id),
                fetchResumen(encuesta.id, branchId), fetchLectura(encuesta.id, branchId),
            ]);
            if (n !== vigente.current) return;
            setLecturaSaly(lec);
            setDatos(d);
            setCargadoPara(branchId);
            if (branchId == null) {
                setTodas({ salas: (d?.por_sucursal || []).map((s) => ({ value: String(s.branch_id), label: s.nombre, respuestas: s.respuestas })), total: d?.total || 0 });
            }
            setComentarios(c);
            setRondas(r);
            setResumen(res);
            setError(null);
        } catch (err) {
            if (n === vigente.current) setError(err);
        }
    }, [encuesta.id, branchId]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga de los resultados

    // El número de cada pregunta es el del cuestionario (el mismo del CSV, del
    // constructor y de los avisos de la base), no su posición en esta lista.
    const numeroDe = useMemo(() => Object.fromEntries(preguntasEnOrden(encuesta.cuestionario).map((p) => [p.id, p.numero])),
        [encuesta.cuestionario]);
    const salas = todas.salas;

    const exportar = async () => {
        setExportando(true);
        try {
            const todas = await fetchRespuestasParaExportar(encuesta.id);
            // Con una sucursal elegida se exporta esa, igual que lo que se ve.
            const filas = branchId ? todas.filter((f) => Number(f.branch_id ?? CAMPO) === branchId) : todas;
            const { headers, rows } = tablaDeRespuestas(encuesta.cuestionario, filas,
                { fechaHora: (f) => `${fechaTexto(f, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${hora12(f)}` });
            const nombreSala = branchId ? salas.find((x) => Number(x.value) === branchId)?.label : null;
            exportCsv(headers, rows, `${archivoDeEncuesta(nombreSala ? `${encuesta.nombre}-${nombreSala}` : encuesta.nombre)}.csv`, 'encuestas_clientes');
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
            const [todas, ubic] = await Promise.all([
                fetchRespuestasParaExportar(encuesta.id),
                (!branchId || enCampo) && (datos?.por_canal?.campo || 0) > 0 ? fetchUbicaciones(encuesta.id).catch(() => null) : null,
            ]);
            const filas = branchId ? todas.filter((f) => Number(f.branch_id ?? CAMPO) === branchId) : todas;
            const nombreSala = branchId ? salas.find((x) => Number(x.value) === branchId)?.label : null;
            const paquete = paqueteParaSaly({
                encuesta, datos, filas, comentarios, lugares: ubic?.por_lugar || [], filtro: nombreSala,
            });
            const { data, error: e } = await preguntarASaly({
                action: 'analyze-customer-survey-results', payload: { datos: paquete },
            });
            if (e) throw e;
            const texto = data?.aiSummary;
            if (!texto) throw new Error('Saly no devolvió la lectura.');
            await guardarLectura(encuesta.id, branchId, texto, filas.length);
            setLecturaSaly(await fetchLectura(encuesta.id, branchId));
        } catch (err) {
            showToast('Saly no pudo leer los resultados', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setLeyendo(false);
        }
    };

    // Al tocar a Saly: se pone el filtro del lugar elegido (así lo que se ve y
    // lo que ella lee son lo mismo), y cuando esos números ya están en
    // pantalla, lee —si hace falta— y lleva la vista a su lectura.
    const pedirLectura = (b) => {
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
    const nombreDelFiltro = branchId == null ? 'todas las sucursales' : (salas.find((x) => Number(x.value) === branchId)?.label || 'esta sucursal');

    if (!['publicada', 'cerrada', 'archivada'].includes(encuesta.estado)) {
        return <Notice variant="info" compact>Los resultados aparecen cuando la encuesta se publica y empieza a recibir respuestas.</Notice>;
    }
    if (error) return <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudieron cargar los resultados.')}</Notice>;
    if (!datos) return <LoadingState label="Calculando resultados…" />;

    const nps = datos.nps;
    const lectura = lecturaNps(nps.puntaje);
    const pct = (n) => (nps.respuestas ? (n / nps.respuestas) * 100 : 0);

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
                <div className="w-56">
                    <LiquidSelect value={sala} placeholder="Todas las sucursales" icon={Store} ariaLabel="Sucursal"
                        options={salas} onChange={(v) => setSala(v || '')} />
                </div>
                <div className="flex-1" />
                <Button variant="secondary" icon={Download} loading={exportando} disabled={!datos.total} onClick={exportar}>
                    {sala ? 'Exportar CSV de la sucursal' : 'Exportar CSV'}
                </Button>
            </div>

            {!datos.total ? (
                <Notice variant="info" compact>Todavía no hay respuestas{sala ? ' en esta sucursal' : ''}.</Notice>
            ) : (
                <>
                    <CarrilCards ariaLabel="Resumen de resultados">
                        <StatCard icon={Gauge} label="NPS" value={nps.puntaje ?? '—'} sub={lectura.label}
                            valueCls={lectura.variant === 'danger' ? 'text-danger' : lectura.variant === 'success' ? 'text-success' : undefined} />
                        <StatCard icon={Users} label="Respuestas" value={datos.total}
                            sub={Object.entries(datos.por_canal || {}).map(([c, n]) => `${n} ${c === 'qr' ? 'QR' : c === 'kiosco' ? 'tablet' : c === 'app' ? 'app' : c === 'campo' ? 'campo' : 'entrevista'}`).join(' · ')} />
                        <StatCard icon={Smile} label="Promotores" value={formatPct(pct(nps.promotores), { decimales: 0 })} sub={`${nps.promotores} dieron 9 o 10`} />
                        <StatCard icon={Frown} label="Detractores" value={formatPct(pct(nps.detractores), { decimales: 0 })}
                            valueCls={nps.detractores ? 'text-danger' : undefined} sub={`${nps.detractores} dieron 0 a 6`} />
                    </CarrilCards>

                    <div ref={lecturaRef} className="scroll-mt-4">
                        <LecturaDeSaly lectura={lecturaSaly} nombre={nombreDelFiltro} leyendo={leyendo}
                            onActualizar={leerResultados} />
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
                        {!sala && datos.por_sucursal.length > 1 && (
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
                        <UbicacionesDeCampo encuestaId={encuesta.id} />
                    )}

                    <section data-surface="card" className="p-4 space-y-5">
                        <TituloDeSeccion nivel="seccion">Pregunta por pregunta</TituloDeSeccion>
                        {datos.por_pregunta.filter((p) => p.tipo !== 'texto').map((p, i) => (
                            <Distribucion key={p.id} p={p} numero={numeroDe[p.id] ?? i + 1} />
                        ))}
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
                                    <Button variant="secondary" size="sm" icon={SalyIcono} loading={resumiendo} disabled={!r.puede}
                                        title={r.ayuda || 'Resume los comentarios con IA y lo guarda para todos'}
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

            {todas.total > 0 && (
                <SalyFlotante lectura={lecturaSaly} lugares={lugaresParaSaly} leyendo={leyendo} onLeer={pedirLectura} />
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

/** La distribución de una pregunta: barras por opción, o el promedio si es un número. */
function Distribucion({ p, numero }) {
    const cats = categoriasDe(p);
    const total = p.respuestas || 0;
    let cuerpo;
    if (p.tipo === 'ranking') {
        const orden = Object.entries(p.ranking || {}).sort((a, b) => a[1] - b[1]);
        cuerpo = (
            <ol className="space-y-1 text-body-sm text-content">
                {orden.map(([id, pos], i) => (
                    <li key={id}>{i + 1}. {p.opciones?.find((o) => o.id === id)?.texto || id}
                        <span className="text-micro text-content-3"> · posición promedio {pos}</span></li>
                ))}
            </ol>
        );
    } else if (p.tipo === 'numero') {
        cuerpo = <p className="text-body-sm text-content">Promedio: <strong>{p.promedio ?? '—'}</strong></p>;
    } else {
        const max = Math.max(1, ...cats.map((c) => p.conteo?.[c.clave] || 0));
        cuerpo = (
            <ul className="space-y-1.5">
                {cats.map((c) => {
                    const n = p.conteo?.[c.clave] || 0;
                    return <Barra key={c.clave} label={c.label} valor={n} max={max}
                        sub={total ? formatPct((n / total) * 100, { decimales: 0 }) : null} />;
                })}
            </ul>
        );
    }
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-body-sm font-semibold text-content flex-1"><span className="text-content-3">{numero}.</span> {p.texto}</p>
                <span className="text-micro text-content-3">{tipoDe(p.tipo).corto} · {total} resp.{p.puntaje != null ? ` · ${p.puntaje}/100` : ''}</span>
            </div>
            {cuerpo}
        </div>
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
