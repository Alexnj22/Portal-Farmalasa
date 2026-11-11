import React, { useCallback, useEffect, useState } from 'react';
import { Award, ClipboardList, Plus, Printer, ShieldCheck, Ban } from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PeriodStepper from '../../components/common/PeriodStepper';
import PromptModal from '../../components/common/PromptModal';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { EmptyState, LoadingState } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useToastStore } from '@nucleo/store/toastStore';
import { anularVisitaDeRegencia, fetchRegenciaDeSala, mensajeDeRegencia, rotuloDeActividad } from '@nucleo/data/regencia';
import { correrPeriodo, periodoDe } from '@nucleo/data/bitacoras';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { nombreDelPeriodo } from '@nucleo/utils/cierreDeBitacoras';
import { rango12 } from '@nucleo/utils/hora';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { registrarEgreso } from '@nucleo/data/egreso';
import { abrirVentanaDeImpresion, escribirEImprimir, VENTANA_BLOQUEADA } from '../../plataforma/ventanaDeImpresion';
import RegistrarVisitaModal from './RegistrarVisitaModal';

/*
 * La regencia de la sala (2026-11-10, auditoría de sucursales).
 *
 * Quién es el regente, cuántas horas al mes le pide la categoría de la sala,
 * cuántas lleva anotadas y sus visitas del mes. El regente anota las suyas; la
 * administración puede anotarlas en su nombre y anular una mal hecha. Dos
 * papeles: el rótulo de la entrada (a la vista del público) y la hoja de
 * asistencia del mes, que el regente firma y sella.
 *
 * El regente y el referente se ASIGNAN en el expediente de la sucursal
 * (Sucursales → la sala → Expediente); aquí se leen.
 */

export default function TabRegencia({ branchId }) {
    const { hasPermission } = useAuth();
    const showToast = useToastStore((s) => s.showToast);
    const puedeAdministrar = hasPermission('bitacoras_tab_regencia', 'can_edit');
    const [periodo, setPeriodo] = useState(() => periodoDe());
    const [regencia, setRegencia] = useState(null);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [anotando, setAnotando] = useState(false);
    const [anulando, setAnulando] = useState(null);
    const [procesando, setProcesando] = useState(false);

    const cargar = useCallback(async () => {
        setCargando(true);
        setError(null);
        const { regencia: r, error: e } = await fetchRegenciaDeSala(branchId, `${periodo}-01`);
        setCargando(false);
        if (e) { setError(mensajeDeRegencia(e)); return; }
        setRegencia(r);
    }, [branchId, periodo]);
    useEffect(() => { cargar(); }, [cargar]);

    const imprimir = async (cual) => {
        const win = abrirVentanaDeImpresion({ ancho: 1000, alto: 800 });
        if (!win) { setError(VENTANA_BLOQUEADA); return; }
        const papel = await import('@nucleo/utils/papelDeRegencia').catch(() => null);
        if (!papel) {
            try { win.close(); } catch { /* ya no está */ }
            setError('No se pudo preparar la impresión. Revisa tu conexión y vuelve a intentar.');
            return;
        }
        const html = cual === 'rotulo' ? papel.htmlDelRotulo(regencia) : papel.htmlDeLaHojaDeAsistencia(regencia);
        const r = escribirEImprimir(win, html);
        if (!r.ok) { setError(r.motivo); return; }
        registrarEgreso('bitacoras', {
            formato: 'pdf',
            filas: cual === 'rotulo' ? 1 : (regencia?.visitas?.length ?? 0),
            detalle: { papel: cual === 'rotulo' ? 'rotulo_regente' : 'asistencia_regente', branch_id: branchId, periodo },
        });
    };

    const anular = async (motivo) => {
        setProcesando(true);
        const { error: e } = await anularVisitaDeRegencia(anulando.id, motivo);
        setProcesando(false);
        if (e) { showToast('No se pudo anular', mensajeDeRegencia(e), 'error'); return; }
        setAnulando(null);
        showToast('Visita anulada', regencia?.sala, 'success');
        cargar();
    };

    if (cargando && !regencia) return <LoadingState label="Cargando la regencia…" />;
    if (error && !regencia) return <Notice variant="danger">{error}</Notice>;
    if (!regencia) return null;

    const horas = Number(regencia.horas_registradas || 0);
    const minimo = regencia.minimo ? Number(regencia.minimo) : null;
    const pct = minimo ? Math.min(100, Math.round((horas / minimo) * 100)) : null;
    const tono = minimo === null ? 'neutral' : horas >= minimo ? 'success' : 'warning';
    const puedeAnotar = !!regencia.regente && (regencia.soy_el_regente || puedeAdministrar);
    const faltaEnExpediente = [
        !regencia.regente && 'regente',
        !regencia.referente && 'referente de farmacovigilancia',
        regencia.regente && !regencia.jvpqf && 'número JVPQF del regente',
        regencia.regente && !regencia.horario && 'horario del regente',
    ].filter(Boolean);

    return (
        <div className="space-y-4">
            {faltaEnExpediente.length > 0 && (
                <Notice variant="warning" icon={ShieldCheck}>
                    Falta en el expediente de {regencia.sala}: {faltaEnExpediente.join(', ')}. Se completa en
                    Sucursales → {regencia.sala} → Expediente.
                </Notice>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                    { titulo: 'Regente', persona: regencia.regente, icono: Award },
                    { titulo: 'Referente de farmacovigilancia', persona: regencia.referente, icono: ShieldCheck },
                ].map(({ titulo, persona, icono: Icono }) => (
                    <div key={titulo} data-surface="card" className="p-4 flex items-center gap-3">
                        {persona
                            ? <AvatarConEstado emp={{ id: persona.id, name: persona.nombre, photo: persona.foto }} px={48} />
                            : <Icono size={28} className="text-content-3" />}
                        <div className="min-w-0">
                            <p className="text-caption font-bold text-content-3">{titulo}</p>
                            <p className="text-body font-bold text-content truncate">
                                {persona ? shortEmployeeName({ name: persona.nombre }) : 'Sin asignar'}
                            </p>
                            {titulo === 'Regente' && regencia.horario && (
                                <p className="text-caption text-content-2 whitespace-pre-line">{regencia.horario}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <div data-surface="card" className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <PeriodStepper unit="mes"
                        onPrev={() => setPeriodo((p) => correrPeriodo(p, -1))}
                        onNext={() => setPeriodo((p) => correrPeriodo(p, 1))}
                        nextDisabled={periodo >= periodoDe(hoySV())}>
                        <span className="text-body-sm font-bold text-content-2">{nombreDelPeriodo(periodo)}</span>
                    </PeriodStepper>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" size="sm" icon={Printer} onClick={() => imprimir('rotulo')} disabled={!regencia.regente}>
                            Rótulo de entrada
                        </Button>
                        <Button variant="secondary" size="sm" icon={ClipboardList} onClick={() => imprimir('hoja')} disabled={!regencia.regente}>
                            Hoja del mes
                        </Button>
                        {puedeAnotar && (
                            <Button variant="primary" size="sm" icon={Plus} onClick={() => setAnotando(true)}>Anotar visita</Button>
                        )}
                    </div>
                </div>
                <div>
                    <div className="flex items-baseline justify-between gap-2">
                        <p className="text-body-sm font-bold text-content">
                            {horas.toFixed(1)} h anotadas{minimo ? ` de ${minimo} h que pide la categoría` : ''}
                        </p>
                        {minimo !== null && <Badge variant={tono} uppercase={false}>{horas >= minimo ? 'Cumple' : `Faltan ${(minimo - horas).toFixed(1)} h`}</Badge>}
                    </div>
                    {pct !== null && (
                        <div className="mt-2 h-2 rounded-full bg-surface-sunken overflow-hidden" role="progressbar"
                            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Horas del mes">
                            <div className={`h-full ${tono === 'success' ? 'bg-success' : 'bg-warning'}`} style={{ width: `${pct}%` }} />
                        </div>
                    )}
                    {minimo === null && (
                        <p className="text-caption text-content-3 mt-1">La sala no tiene categoría en su expediente: no se puede calcular el mínimo.</p>
                    )}
                </div>
                {error && <Notice variant="danger">{error}</Notice>}
            </div>

            {regencia.visitas.length === 0 ? (
                <EmptyState icon={ClipboardList} title="Sin visitas anotadas este mes"
                    subtitle={puedeAnotar ? 'Cada visita del regente se anota con su horario y lo que revisó.' : undefined} />
            ) : (
                <ul className="space-y-2">
                    {regencia.visitas.map((v) => (
                        <li key={v.id} data-surface="card" className={`p-4 flex flex-col sm:flex-row sm:items-start gap-3 ${v.anulada_at ? 'opacity-60' : ''}`}>
                            <div className="min-w-0 flex-1">
                                <p className="text-body font-bold text-content">
                                    {fechaTexto(v.fecha, { weekday: 'short', day: '2-digit', month: 'short' })} · {rango12(v.entrada, v.salida)}
                                    <span className="text-content-3 font-normal"> · {Number(v.horas).toFixed(1)} h</span>
                                </p>
                                <p className="text-body-sm text-content-2">{(v.actividades || []).map(rotuloDeActividad).join(' · ')}</p>
                                {v.notas && <p className="text-caption text-content-3 mt-1">{v.notas}</p>}
                                {v.registrado_por && v.registrado_por !== v.regente_id && (
                                    <p className="text-caption text-content-3 mt-1">
                                        Anotada por {shortEmployeeName({ name: v.registrado_por_nombre })} en nombre del regente
                                    </p>
                                )}
                                {v.anulada_at && (
                                    <p className="text-caption text-danger-text mt-1">Anulada: {v.anulada_motivo}</p>
                                )}
                            </div>
                            {!v.anulada_at && (regencia.soy_el_regente || puedeAdministrar) && (
                                <Button variant="ghost" size="sm" icon={Ban} onClick={() => setAnulando(v)}>Anular</Button>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {anotando && (
                <RegistrarVisitaModal branchId={branchId} sala={regencia.sala}
                    regente={regencia.regente ? shortEmployeeName({ name: regencia.regente.nombre }) : null}
                    enSuNombre={!regencia.soy_el_regente}
                    onClose={() => setAnotando(false)}
                    onHecho={() => { setAnotando(false); cargar(); }} />
            )}
            <PromptModal isOpen={!!anulando} onClose={() => setAnulando(null)} onConfirm={anular}
                title="Anular visita" message="La visita no se borra: queda anulada con este motivo."
                placeholder="¿Por qué se anula?" confirmText="Anular" required isProcessing={procesando} />
        </div>
    );
}
