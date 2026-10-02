import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Image as ImageIcon, Clapperboard, MapPin, Timer, CalendarClock, PencilLine, BookOpen, Inbox,
    FileSignature, FileDown, Plus, Trash2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import SegmentedControl from '../../components/common/SegmentedControl';
import PortalTextarea from '../../components/common/PortalTextarea';
import PortalInput from '../../components/common/PortalInput';
import LiquidSelect from '../../components/common/LiquidSelect';
import LiquidDatePicker from '../../components/common/LiquidDatePicker';
import { LoadingState } from '../../components/common/StateViews';
import { DataTable, DataRow, DataCell } from '../../components/common/DataTable';
import Campo from '../promociones/Campo';
import { useToastStore } from '@nucleo/store/toastStore';
import { useStaffStore } from '@nucleo/store/staffStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { etiquetaMes, fechaTexto, rangoDelMes, hoySV } from '@nucleo/utils/fecha';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { RESULTADOS_CIERRE, resultadoCierreDe } from '@nucleo/utils/marketing';
import {
    fetchCumplimiento, fetchMesesConCierre, cerrarMes, fetchVisitas, registrarVisita, quitarVisita, fetchPersonas,
} from '@nucleo/data/marketing';
import { registrarEgreso } from '@nucleo/data/egreso';
import { Quien } from './Historial';

/** Una medida del contrato: lo logrado contra la meta, con su color. */
function Medida({ icon: Icono, titulo, valor, meta, detalle, estado }) {
    const tono = estado === 'ok' ? 'text-success' : estado === 'mal' ? 'text-danger' : estado === 'aviso' ? 'text-warning' : 'text-content';
    return (
        <div data-surface="card" className="p-3 space-y-1 min-w-0">
            <div className="flex items-center gap-1.5 text-label uppercase tracking-wide font-semibold text-content-3">
                <Icono size={13} aria-hidden /> <span className="truncate">{titulo}</span>
            </div>
            <p className={`text-body-xl font-bold tabular-nums ${tono}`}>
                {valor}{meta != null && <span className="text-body-sm font-normal text-content-3"> de {meta}</span>}
            </p>
            {detalle && <p className="text-caption text-content-3">{detalle}</p>}
        </div>
    );
}

const cumple = (v, meta) => (meta == null ? undefined : v >= meta ? 'ok' : 'aviso');

/**
 * El control del servicio del diseñador, contra su oferta (30-sep-2026): la
 * cuota del mes, la anticipación, las visitas, el manual de marca y la
 * capacidad de respuesta. Al final del mes, quien aprueba firma el CIERRE: el
 * acta congela los números de ese momento para el pago, y el mes se puede
 * seguir corrigiendo sin que el acta cambie.
 */
export default function TabServicio({ mes, mesFila, puedeAprobar, puedeEditar, yoId, personas: personasBase }) {
    const showToast = useToastStore((s) => s.showToast);
    const branches = useStaffStore((s) => s.branches);
    const [datos, setDatos] = useState(null);
    const [meses, setMeses] = useState([]);
    const [visitas, setVisitas] = useState([]);
    const [personas, setPersonas] = useState(personasBase || {});
    const [cargando, setCargando] = useState(true);
    const [resultado, setResultado] = useState('cumplio');
    const [observaciones, setObservaciones] = useState('');
    const [firmando, setFirmando] = useState(false);
    const [visita, setVisita] = useState({ fecha: hoySV(), branch_id: '', notas: '' });
    const [guardandoVisita, setGuardandoVisita] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const [desde, hasta] = rangoDelMes(mes);
            const [c, ms, vs] = await Promise.all([
                mesFila ? fetchCumplimiento(mesFila.id) : null,
                fetchMesesConCierre(6),
                fetchVisitas(desde, hasta),
            ]);
            // La tendencia: el cumplimiento de cada uno de los últimos meses.
            const conDatos = await Promise.all(ms.map(async (m) => ({
                ...m,
                cierre: Array.isArray(m.cierre) ? m.cierre[0] || null : m.cierre,
                datos: await fetchCumplimiento(m.id).catch(() => null),
            })));
            setDatos(c);
            setMeses(conDatos);
            setVisitas(vs);
            const ids = [...vs.map((v) => v.registrada_por), ...conDatos.map((m) => m.cierre?.firmado_por)];
            const faltan = ids.filter((id) => id && !(personasBase || {})[id]);
            if (faltan.length) setPersonas({ ...(personasBase || {}), ...(await fetchPersonas(faltan)) });
        } catch (err) {
            showToast('No se pudo cargar el control', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setCargando(false);
        }
    }, [mes, mesFila, personasBase, showToast]);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga al abrir la pestaña

    const cierre = useMemo(() => meses.find((m) => m.id === mesFila?.id)?.cierre || null, [meses, mesFila]);
    const nombreSala = (id) => branches?.find((b) => String(b.id) === String(id))?.name;

    const firmar = async () => {
        setFirmando(true);
        try {
            await cerrarMes(mesFila.id, resultado, observaciones);
            showToast('Cierre firmado', etiquetaMes(mes), 'success');
            setObservaciones('');
            cargar();
        } catch (err) {
            showToast('No se pudo firmar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setFirmando(false);
        }
    };

    const agregarVisita = async () => {
        setGuardandoVisita(true);
        try {
            await registrarVisita(visita, yoId);
            setVisita({ fecha: hoySV(), branch_id: '', notas: '' });
            cargar();
        } catch (err) {
            showToast('No se pudo registrar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setGuardandoVisita(false);
        }
    };

    const borrarVisita = async (id) => {
        try {
            await quitarVisita(id);
            cargar();
        } catch (err) {
            showToast('No se pudo quitar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    const descargarActa = async () => {
        try {
            const { descargarActaPdf } = await import('@nucleo/utils/marketingActa');
            await descargarActaPdf({ mes, cierre, firmante: shortEmployeeName(personas[cierre.firmado_por]?.name) });
            registrarEgreso('marketing', { formato: 'pdf', filas: 1, detalle: { acta: mes } });
        } catch (err) {
            showToast('No se pudo generar el acta', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        }
    };

    if (cargando && !meses.length) return <LoadingState label="Cargando el control del servicio…" />;

    const d = datos;
    const m = d?.metas || {};
    const cal = d?.calendario || {};
    const evaluables = (d?.puntualidad?.a_tiempo ?? 0) + (d?.puntualidad?.tarde ?? 0);

    return (
        <div className="space-y-6">
            {!mesFila && <Notice compact>Este mes todavía no tiene calendario: no hay nada que medir.</Notice>}

            {d && (
                <section className="space-y-3">
                    <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Cumplimiento de {etiquetaMes(mes)}</h3>
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                        <Medida icon={ImageIcon} titulo="Publicaciones" valor={d.publicaciones.aprobadas} meta={m.publicaciones}
                            estado={cumple(d.publicaciones.aprobadas, m.publicaciones)}
                            detalle={`${d.publicaciones.planificadas} planificadas · aprobadas cuentan`} />
                        <Medida icon={Clapperboard} titulo="Videos y reels" valor={d.videos.aprobados} meta={m.videos}
                            estado={cumple(d.videos.aprobados, m.videos)} detalle={`${d.videos.planificados} planificados · ${d.historias} historias`} />
                        <Medida icon={MapPin} titulo="Visitas" valor={d.visitas} meta={m.visitas} estado={cumple(d.visitas, m.visitas)} />
                        <Medida icon={Timer} titulo={`${m.dias_anticipacion} días antes`}
                            valor={d.puntualidad.exento ? 'No aplica' : evaluables ? `${d.puntualidad.a_tiempo}/${evaluables}` : '—'}
                            estado={!d.puntualidad.exento && evaluables ? (d.puntualidad.tarde ? 'aviso' : 'ok') : undefined}
                            detalle={d.puntualidad.exento ? 'Se exige desde noviembre 2026' : `${d.puntualidad.por_vencer} todavía en plazo`} />
                        <Medida icon={CalendarClock} titulo="Calendario"
                            valor={cal.exento ? 'No aplica' : cal.a_tiempo == null ? 'Sin enviar' : cal.a_tiempo ? 'A tiempo' : 'Tarde'}
                            estado={cal.exento ? undefined : cal.a_tiempo ? 'ok' : cal.a_tiempo === false ? 'mal' : undefined}
                            detalle={cal.exento ? 'Se exige desde noviembre 2026' : `Límite: ${fechaTexto(cal.limite, { day: 'numeric', month: 'long' })}`} />
                        <Medida icon={PencilLine} titulo="Cambios pedidos" valor={d.cambios.rondas}
                            detalle={`${d.cambios.piezas_con_cambios} piezas · máx. ${d.cambios.maximo}${d.cambios.horas_correccion != null ? ` · corrige en ${d.cambios.horas_correccion} h` : ''}`} />
                        <Medida icon={BookOpen} titulo="Manual de marca" valor={d.manual} estado={d.manual ? 'ok' : 'aviso'}
                            detalle="Entregables subidos a Marca este mes" />
                        <Medida icon={Inbox} titulo="Extraordinarias" valor={d.extraordinarias.entregadas} meta={d.extraordinarias.pedidas}
                            detalle={d.extraordinarias.dias_entrega != null ? `${d.extraordinarias.dias_entrega} días en promedio` : 'Solicitudes del mes'} />
                    </div>
                </section>
            )}

            {mesFila && (
                <section data-surface="card" className="p-4 space-y-3">
                    <h3 className="flex items-center gap-2 text-label uppercase tracking-wide font-semibold text-content-2">
                        <FileSignature size={14} /> Cierre del mes
                    </h3>
                    {cierre ? (
                        <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge variant={resultadoCierreDe(cierre.resultado).variant}>{resultadoCierreDe(cierre.resultado).label}</Badge>
                                <Quien id={cierre.firmado_por} personas={personas} />
                                <span className="text-caption text-content-3">{fechaTexto(cierre.firmado_at, { day: 'numeric', month: 'long' })}</span>
                                <Button variant="secondary" size="sm" icon={FileDown} className="ml-auto" onClick={descargarActa}>Acta PDF</Button>
                            </div>
                            {cierre.observaciones && <p className="text-body-sm text-content-2 whitespace-pre-wrap">{cierre.observaciones}</p>}
                            <p className="text-caption text-content-3">
                                El acta guarda los números del momento en que se firmó. El mes se puede seguir corrigiendo; si hace falta, se vuelve a firmar.
                            </p>
                        </div>
                    ) : (
                        <p className="text-body-sm text-content-3">
                            {puedeAprobar ? 'Revisa el cumplimiento y firma el cierre antes del pago (último día hábil).' : 'Gerencia todavía no firma el cierre de este mes.'}
                        </p>
                    )}
                    {puedeAprobar && (
                        <div className="space-y-2 pt-2 border-t border-divider">
                            <SegmentedControl value={resultado} onChange={setResultado} label="Resultado"
                                options={RESULTADOS_CIERRE.map((r) => ({ value: r.value, label: r.label }))} />
                            <PortalTextarea label={resultado === 'cumplio' ? 'Observaciones (opcional)' : 'Observaciones'} name="observaciones"
                                value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={2}
                                placeholder="Qué faltó, qué se acordó corregir…" />
                            <div className="flex justify-end">
                                <Button icon={FileSignature} loading={firmando}
                                    disabled={resultado !== 'cumplio' && !observaciones.trim()} onClick={firmar}>
                                    {cierre ? 'Volver a firmar' : 'Firmar cierre'}
                                </Button>
                            </div>
                        </div>
                    )}
                </section>
            )}

            <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-label uppercase tracking-wide font-semibold text-content-2">
                    <MapPin size={14} /> Visitas presenciales de {etiquetaMes(mes)}
                </h3>
                {visitas.map((v) => (
                    <div key={v.id} data-surface="card" className="p-3 flex items-start gap-3">
                        <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-semibold text-content">
                                {fechaTexto(v.fecha, { weekday: 'long', day: 'numeric', month: 'long' })}{v.branch_id ? ` · ${nombreSala(v.branch_id) || 'Sala'}` : ''}
                            </p>
                            {v.notas && <p className="text-caption text-content-2 whitespace-pre-wrap">{v.notas}</p>}
                            <Quien id={v.registrada_por} personas={personas} px={16} />
                        </div>
                        {(puedeAprobar || v.registrada_por === yoId) && (
                            <Button variant="ghost" size="xs" iconOnly icon={Trash2} title="Quitar la visita" onClick={() => borrarVisita(v.id)} />
                        )}
                    </div>
                ))}
                {!visitas.length && (
                    <p className="text-body-sm text-content-3 flex items-center gap-1.5">
                        <AlertTriangle size={13} className="text-warning" /> Sin visitas registradas este mes.
                    </p>
                )}
                {(puedeEditar || puedeAprobar) && (
                    <div data-surface="card" className="p-3 grid gap-3 sm:grid-cols-[auto_1fr_2fr_auto] items-end">
                        <Campo rotulo="Fecha">
                            <LiquidDatePicker value={visita.fecha} onChange={(v) => setVisita((x) => ({ ...x, fecha: v }))} />
                        </Campo>
                        <Campo rotulo="Sala">
                            <LiquidSelect value={visita.branch_id} placeholder="Sala" onChange={(v) => setVisita((x) => ({ ...x, branch_id: v || '' }))}
                                options={(branches || []).map((b) => ({ value: b.id, label: b.name }))} />
                        </Campo>
                        <PortalInput label="Qué se hizo" name="visita_notas" value={visita.notas}
                            onChange={(e) => setVisita((x) => ({ ...x, notas: e.target.value }))} placeholder="Fotos de la sala, entrevista a la regente…" />
                        <Button icon={Plus} loading={guardandoVisita} disabled={!visita.fecha} onClick={agregarVisita}>Registrar</Button>
                    </div>
                )}
            </section>

            {meses.length > 0 && (
                <section className="space-y-3">
                    <h3 className="text-label uppercase tracking-wide font-semibold text-content-2">Últimos meses (período de prueba)</h3>
                    <DataTable minWidth="560px" movil={{ usarAccionDeFila: false }}
                        columns={[
                            { key: 'mes', label: 'Mes' },
                            { key: 'pub', label: 'Publicaciones', align: 'right' },
                            { key: 'vid', label: 'Videos', align: 'right' },
                            { key: 'tiempo', label: 'A tiempo', align: 'right', hideBelow: 'sm' },
                            { key: 'cambios', label: 'Cambios', align: 'right', hideBelow: 'md' },
                            { key: 'cierre', label: 'Cierre' },
                        ]}>
                        {meses.map((x, i) => {
                            const dd = x.cierre?.resumen || x.datos;
                            const ev = dd ? (dd.puntualidad?.a_tiempo ?? 0) + (dd.puntualidad?.tarde ?? 0) : 0;
                            return (
                                <DataRow key={x.id} index={i}>
                                    <DataCell>{etiquetaMes(x.mes)}</DataCell>
                                    <DataCell align="right"><span className="tabular-nums">{dd ? `${dd.publicaciones?.aprobadas ?? 0}/${dd.metas?.publicaciones ?? '—'}` : '—'}</span></DataCell>
                                    <DataCell align="right"><span className="tabular-nums">{dd ? `${dd.videos?.aprobados ?? 0}/${dd.metas?.videos ?? '—'}` : '—'}</span></DataCell>
                                    <DataCell align="right" hideBelow="sm"><span className="tabular-nums">{ev ? `${dd.puntualidad.a_tiempo}/${ev}` : '—'}</span></DataCell>
                                    <DataCell align="right" hideBelow="md"><span className="tabular-nums">{dd?.cambios?.rondas ?? '—'}</span></DataCell>
                                    <DataCell>
                                        {x.cierre
                                            ? <Badge variant={resultadoCierreDe(x.cierre.resultado).variant} size="sm">{resultadoCierreDe(x.cierre.resultado).label}</Badge>
                                            : <span className="text-caption text-content-3">Sin firmar</span>}
                                    </DataCell>
                                </DataRow>
                            );
                        })}
                    </DataTable>
                </section>
            )}
        </div>
    );
}
