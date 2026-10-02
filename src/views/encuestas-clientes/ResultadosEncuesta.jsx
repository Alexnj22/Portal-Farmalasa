import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Gauge, Users, Smile, Frown, Download, Sparkles, MessageSquareText, History, AlertTriangle, Store, Phone,
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
import { lecturaNps, categoriasDe, tablaDeRespuestas, tipoDe, estadoDe } from '@nucleo/utils/encuestasClientes';
import {
    fetchResultados, fetchComentarios, fetchRondas, fetchRespuestasParaExportar, fetchResumen, guardarResumen,
} from '@nucleo/data/encuestasClientes';
import { preguntarASaly } from '@nucleo/data/ia';
import { barraDeDimension } from './iconos';

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

    const branchId = sala ? Number(sala) : null;
    const cargar = useCallback(async () => {
        try {
            const [d, c, r, res] = await Promise.all([
                fetchResultados(encuesta.id, branchId), fetchComentarios(encuesta.id, branchId), fetchRondas(encuesta.id),
                fetchResumen(encuesta.id, branchId),
            ]);
            setDatos(d);
            setComentarios(c);
            setRondas(r);
            setResumen(res);
            setError(null);
        } catch (err) {
            setError(err);
        }
    }, [encuesta.id, branchId]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga de los resultados

    const salas = useMemo(() => (datos?.por_sucursal || []).map((s) => ({ value: String(s.branch_id), label: s.nombre })), [datos?.por_sucursal]);

    const exportar = async () => {
        setExportando(true);
        try {
            const filas = await fetchRespuestasParaExportar(encuesta.id);
            const { headers, rows } = tablaDeRespuestas(encuesta.cuestionario, filas,
                { fechaHora: (f) => `${fechaTexto(f, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${hora12(f)}` });
            exportCsv(headers, rows, `encuesta-${encuesta.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').toLowerCase()}.csv`, 'encuestas_clientes');
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
            const vistos = new Set();
            const lote = [];
            for (const c of comentarios) {
                const clave = c.texto.trim().toLowerCase();
                if (vistos.has(clave)) continue;
                vistos.add(clave);
                lote.push({ sucursal: c.sucursal, nps: c.nps, pregunta: c.pregunta, texto: c.texto.slice(0, 300) });
                if (lote.length >= 100) break;
            }
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
                    Exportar CSV
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
                            sub={Object.entries(datos.por_canal || {}).map(([c, n]) => `${n} ${c === 'qr' ? 'QR' : c === 'kiosco' ? 'tablet' : 'entrevista'}`).join(' · ')} />
                        <StatCard icon={Smile} label="Promotores" value={formatPct(pct(nps.promotores), { decimales: 0 })} sub={`${nps.promotores} dieron 9 o 10`} />
                        <StatCard icon={Frown} label="Detractores" value={formatPct(pct(nps.detractores), { decimales: 0 })}
                            valueCls={nps.detractores ? 'text-danger' : undefined} sub={`${nps.detractores} dieron 0 a 6`} />
                    </CarrilCards>

                    {nps.respuestas > 0 && (
                        <section data-surface="card" className="p-4 space-y-2">
                            <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Recomendación</h3>
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
                                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Por tema (0 a 100)</h3>
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
                                <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">NPS por sucursal</h3>
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

                    <section data-surface="card" className="p-4 space-y-5">
                        <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Pregunta por pregunta</h3>
                        {datos.por_pregunta.filter((p) => p.tipo !== 'texto').map((p, i) => (
                            <Distribucion key={p.id} p={p} numero={i + 1} />
                        ))}
                    </section>

                    <section data-surface="card" className="p-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5 flex-1">
                                <MessageSquareText size={13} /> Comentarios ({comentarios.length})
                            </h3>
                            {comentarios.length >= 3 && (() => {
                                const hay = !!resumen?.texto;
                                const nuevos = resumen?.nuevos ?? 0;
                                const puede = !hay || nuevos >= (resumen?.minimo_nuevos ?? 5);
                                return (
                                    <Button variant="secondary" size="sm" icon={Sparkles} loading={resumiendo} disabled={!puede}
                                        title={puede ? 'Resume los comentarios con IA y lo guarda para todos'
                                            : `Se actualiza cuando entren ${resumen.minimo_nuevos} comentarios nuevos (van ${nuevos}).`}
                                        onClick={resumir}>
                                        {!hay ? 'Resumir con IA' : puede ? `Actualizar resumen (${nuevos} nuevos)` : 'Resumen al día'}
                                    </Button>
                                );
                            })()}
                        </div>
                        {resumen?.texto && (
                            <div className="rounded-xl bg-brand/5 border border-brand/20 p-3 space-y-2">
                                <div className="text-body-sm text-content whitespace-pre-line"><ConNegritas texto={resumen.texto} /></div>
                                <p className="text-micro text-content-3">
                                    Resumen de {resumen.comentarios_n} comentario(s) · {fechaTexto(resumen.generado_at, { day: 'numeric', month: 'short' })} {hora12(resumen.generado_at)}
                                    {resumen.nuevos > 0 ? ` · ${resumen.nuevos} nuevo(s) desde entonces` : ''}
                                </p>
                            </div>
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
                    <h3 className="text-label uppercase tracking-wide font-semibold text-content-2 flex items-center gap-1.5">
                        <History size={13} /> Rondas de esta encuesta
                    </h3>
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
    return <span className="inline-flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-full ${cls}`} />{texto}</span>;
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

/** El resumen de la IA marca los títulos con **; acá se vuelven negritas. */
function ConNegritas({ texto }) {
    return texto.split(/(\*\*[^*]+\*\*)/g).map((t, i) => (t.startsWith('**') && t.endsWith('**')
        ? <strong key={i}>{t.slice(2, -2)}</strong> : <React.Fragment key={i}>{t}</React.Fragment>));
}
