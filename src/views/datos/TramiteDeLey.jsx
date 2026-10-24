/**
 * Los pasos del trámite que pone la ley, dentro de una solicitud recibida
 * (2026-10-24). Antes sólo existían «Guardar» y «Dar por resuelta», y con eso
 * no quedaba constancia de una prórroga (Art. 20), una prevención (Art. 18),
 * una negativa con su causal (Art. 22) ni del aviso a quien había recibido los
 * datos corregidos o eliminados (cinco días hábiles).
 *
 * Cada paso va por `solicitud_datos_accion` / `solicitud_datos_tercero`: la
 * base comprueba que la prórroga y la prevención se den UNA sola vez, que no se
 * archive antes de los diez días y que la negativa diga su causal, y anota la
 * bitácora con el texto que se le comunicó a la persona.
 */
import React, { useEffect, useState } from 'react';
import { CalendarPlus, FileQuestion, Undo2, Archive, Ban, Send, Check } from 'lucide-react';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import Badge from '../../components/common/Badge';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import {
    CAUSALES_DE_NEGATIVA, accionSolicitud, plazoDePrevencion, fetchTercerosDeSolicitud, agregarTercero, anotarTerceroAvisado,
} from '@nucleo/data/solicitudesDatos';

const dia = (d) => fechaTexto(d, { day: 'numeric', month: 'long', year: 'numeric' });

const PASOS = {
    prorrogar: { titulo: 'Prorrogar', rotulo: 'Causa de la prórroga (se le comunica a la persona)', boton: 'Prorrogar veinte días hábiles' },
    prevenir:  { titulo: 'Prevenir',  rotulo: 'Qué le falta presentar o completar', boton: 'Registrar la prevención' },
    subsanar:  { titulo: 'Subsanada', rotulo: 'Qué presentó (opcional)', boton: 'La completó' },
    negar:     { titulo: 'Negar',     rotulo: 'Motivo de la negativa (va en la resolución)', boton: 'Negar la solicitud' },
};

export default function TramiteDeLey({ solicitud, onCambio }) {
    const showToast = useToastStore((s) => s.showToast);
    const [paso, setPaso] = useState(null);
    const [texto, setTexto] = useState('');
    const [causal, setCausal] = useState('');
    const [ocupado, setOcupado] = useState(false);

    const prevencion = plazoDePrevencion(solicitud);
    const prevenida = solicitud.estado === 'PREVENIDA';

    const correr = async (accion, txt = texto, cau = causal) => {
        setOcupado(true);
        try {
            const fila = await accionSolicitud(solicitud.id, accion, txt?.trim() || null, cau || null);
            showToast('Listo', `Solicitud ${solicitud.folio_txt}`, 'success');
            setPaso(null); setTexto(''); setCausal('');
            onCambio?.(fila);
        } catch (e) {
            showToast('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
        } finally { setOcupado(false); }
    };

    const abrir = (p) => { setPaso(p); setTexto(''); setCausal(''); };
    const listo = paso === 'negar' ? !!causal && !!texto.trim() : paso === 'subsanar' || !!texto.trim();

    return (
        <div className="flex flex-col gap-3">
            {solicitud.prorrogada_at && (
                <Notice variant="info" compact>
                    Prorrogada el {dia(solicitud.prorrogada_at)}: el plazo es de cuarenta días hábiles desde el acuse.
                    {solicitud.motivo_prorroga ? ` Causa: «${solicitud.motivo_prorroga}».` : ''}
                </Notice>
            )}
            {prevenida && prevencion && (
                <Notice variant={prevencion.vencida ? 'warning' : 'info'} bloque>
                    Prevenida el {dia(solicitud.prevenida_at)}{solicitud.prevencion ? `: «${solicitud.prevencion}»` : ''}.
                    {' '}{prevencion.vencida
                        ? `Los diez días hábiles vencieron el ${dia(prevencion.vence)}. Si no la completó, se archiva sin más trámite y puede presentar una nueva.`
                        : `Tiene hasta el ${dia(prevencion.vence)} para completarla.`}
                </Notice>
            )}

            <div className="flex flex-wrap gap-2">
                {!solicitud.prorrogada_at && !prevenida && (
                    <Button variant="secondary" size="sm" icon={CalendarPlus} onClick={() => abrir('prorrogar')}>Prorrogar</Button>
                )}
                {!solicitud.prevenida_at && (
                    <Button variant="secondary" size="sm" icon={FileQuestion} onClick={() => abrir('prevenir')}>Prevenir</Button>
                )}
                {prevenida && (
                    <Button variant="secondary" size="sm" icon={Undo2} onClick={() => abrir('subsanar')}>La completó</Button>
                )}
                {prevenida && prevencion?.vencida && (
                    <Button variant="secondary" size="sm" icon={Archive} loading={ocupado}
                        onClick={() => correr('archivar', null, null)}>Archivar</Button>
                )}
                {!prevenida && (
                    <Button variant="secondary" size="sm" icon={Ban} onClick={() => abrir('negar')}>Negar</Button>
                )}
            </div>

            {paso && (
                <div className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                    {paso === 'negar' && (
                        <div>
                            <span className="text-caption font-bold text-content-2 block mb-1.5">Causal (Art. 22)</span>
                            <LiquidSelect value={causal} onChange={setCausal} options={CAUSALES_DE_NEGATIVA}
                                placeholder="¿Por qué se niega?" />
                        </div>
                    )}
                    <PortalTextarea label={PASOS[paso].rotulo} rows={2} maxLength={600}
                        value={texto} onChange={(e) => setTexto(e.target.value)} />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setPaso(null)}>Cancelar</Button>
                        <Button size="sm" icon={Check} loading={ocupado} disabled={!listo}
                            onClick={() => correr(paso)}>{PASOS[paso].boton}</Button>
                    </div>
                </div>
            )}

            <Terceros solicitud={solicitud} />
        </div>
    );
}

/**
 * A quién se le habían comunicado los datos que se corrigieron o eliminaron.
 * La ley da cinco días hábiles para avisarle; el vigilante de solicitudes avisa
 * el día antes y al vencer.
 */
function Terceros({ solicitud }) {
    const showToast = useToastStore((s) => s.showToast);
    const [filas, setFilas] = useState(null);
    const [tercero, setTercero] = useState('');
    const [que, setQue] = useState('');
    const [medios, setMedios] = useState({});
    const [ocupado, setOcupado] = useState(false);

    useEffect(() => {
        let vivo = true;
        fetchTercerosDeSolicitud(solicitud.id)
            .then((d) => { if (vivo) setFilas(d); })
            .catch((e) => { if (vivo) { setFilas([]); showToast('No se pudo cargar', mensajeAmigable(e), 'error'); } });
        return () => { vivo = false; };
    }, [solicitud.id, showToast]);

    const pedir = async (fn) => {
        setOcupado(true);
        try {
            const fila = await fn();
            setFilas((p) => [...(p ?? []).filter((x) => x.id !== fila.id), fila]
                .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))));
            return true;
        } catch (e) {
            showToast('No se pudo', mensajeAmigable(e, 'Intenta de nuevo.'), 'error');
            return false;
        } finally { setOcupado(false); }
    };

    const pide = (solicitud.derechos ?? []).some((d) => ['rectificacion', 'cancelacion', 'olvido'].includes(d));
    if (!pide && !filas?.length) return null;

    return (
        <div className="flex flex-col gap-2">
            <p className="text-caption text-content-3">
                Si los datos corregidos o eliminados se le habían comunicado a otra empresa o persona, hay que avisarle
                en cinco días hábiles.
            </p>
            {(filas ?? []).map((t) => {
                const vencido = !t.avisado_at && t.vence < hoySV();
                return (
                    <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle px-3 py-2">
                        <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-semibold text-content">{t.tercero}</p>
                            <p className="text-caption text-content-3">{t.que}</p>
                        </div>
                        {t.avisado_at ? (
                            <Badge variant="success" uppercase={false}>Avisado el {fechaTexto(t.avisado_at, { day: 'numeric', month: 'short' })} · {t.medio}</Badge>
                        ) : (
                            <>
                                <Badge variant={vencido ? 'danger' : 'warning'} uppercase={false}>
                                    {vencido ? 'Plazo vencido' : `Hasta el ${fechaTexto(t.vence, { day: 'numeric', month: 'short' })}`}
                                </Badge>
                                <PortalInput placeholder="Por qué medio" value={medios[t.id] ?? ''}
                                    onChange={(e) => setMedios((m) => ({ ...m, [t.id]: e.target.value }))} />
                                <Button size="sm" variant="secondary" icon={Send} loading={ocupado}
                                    disabled={!(medios[t.id] ?? '').trim()}
                                    onClick={() => pedir(() => anotarTerceroAvisado(t.id, medios[t.id]))}>Ya se avisó</Button>
                            </>
                        )}
                    </div>
                );
            })}
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <PortalInput label="A quién" value={tercero} onChange={(e) => setTercero(e.target.value)} />
                <PortalInput label="Qué se corrigió o eliminó" value={que} onChange={(e) => setQue(e.target.value)} />
                <Button size="sm" variant="secondary" loading={ocupado} disabled={!tercero.trim() || !que.trim()}
                    onClick={async () => { if (await pedir(() => agregarTercero(solicitud.id, tercero, que))) { setTercero(''); setQue(''); } }}>
                    Anotar
                </Button>
            </div>
        </div>
    );
}
