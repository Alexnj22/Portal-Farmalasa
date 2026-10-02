import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Mic, Tablet, ArrowLeft, AlertTriangle, Gift, Store } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto } from '@nucleo/utils/fecha';
import { preguntasEnOrden } from '@nucleo/utils/encuestasClientes';
import { fetchParaAplicar, guardarEntrevista, marcarMuestraEntregada } from '@nucleo/data/encuestasClientes';
import { salaDeHoy } from '@nucleo/data/puntos';
import FormularioEncuesta from './FormularioEncuesta';

/**
 * Aplicar una encuesta en sala: entrevistar a un cliente desde el portal, o
 * dejar la tablet del mostrador abierta en la encuesta.
 *
 * Permiso `encuestas_aplicar` (o diseñar encuestas): quien entrevista no
 * necesita ver el módulo entero. Las encuestas y sus sucursales las da
 * `encuestas_para_aplicar`, que ya filtra las publicadas y vigentes hoy.
 */
export default function AplicarEncuestaView() {
    const showToast = useToastStore((s) => s.showToast);
    const [encuestas, setEncuestas] = useState([]);
    const [miSala, setMiSala] = useState(null);
    const [salaElegida, setSalaElegida] = useState({});
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [entrevistando, setEntrevistando] = useState(null); // { encuesta, branchId }

    const cargar = useCallback(async () => {
        try {
            const [es, sala] = await Promise.all([fetchParaAplicar(), salaDeHoy().catch(() => null)]);
            setEncuestas(es.filter((e) => e.canales.includes('entrevista') || e.canales.includes('kiosco')));
            setMiSala(sala != null ? Number(sala) : null); // `empleado_sala_de_hoy` devuelve el id (bigint)
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga inicial

    // La sucursal de cada encuesta: la que eligió, o la de hoy si la encuesta
    // se aplica ahí, o la primera.
    const salaDe = useCallback((e) => {
        if (salaElegida[e.id]) return salaElegida[e.id];
        if (e.sucursales.some((s) => s.branch_id === miSala)) return miSala;
        return e.sucursales[0]?.branch_id ?? null;
    }, [salaElegida, miSala]);

    const nombreSala = useMemo(() => Object.fromEntries(encuestas.flatMap((e) => e.sucursales).map((s) => [s.branch_id, s.nombre])),
        [encuestas]);

    if (entrevistando) {
        const { encuesta, branchId } = entrevistando;
        return (
            <GlassViewLayout icon={Mic} title="Aplicar encuesta" transparentBody>
                <div className="p-4 md:p-6 flex justify-center">
                    <div className="w-full max-w-lg space-y-3">
                        <Button variant="ghost" icon={ArrowLeft} onClick={() => { setEntrevistando(null); cargar(); }}>
                            Volver a las encuestas
                        </Button>
                        <div data-surface="card" className="p-5 space-y-4">
                            <div>
                                <p className="text-body-lg font-semibold text-content">{encuesta.nombre}</p>
                                <p className="text-micro text-content-3 flex items-center gap-1"><Store size={12} />{nombreSala[branchId]}</p>
                            </div>
                            <Notice variant="info" compact>
                                Lee cada pregunta tal como está escrita y marca lo que responde el cliente, sin sugerirle la respuesta.
                            </Notice>
                            <FormularioEncuesta encuesta={encuesta} entrevista
                                onEntregarMuestra={marcarMuestraEntregada}
                                onEnviar={async (respuestas, contacto, segundos) => {
                                    const r = await guardarEntrevista(encuesta.id, branchId, { respuestas, contacto, segundos });
                                    if (r?.cerrada) showToast('La encuesta llegó a su meta', 'Se cerró sola. ¡Gracias!', 'success');
                                    return r;
                                }} />
                        </div>
                    </div>
                </div>
            </GlassViewLayout>
        );
    }

    let cuerpo;
    if (cargando) cuerpo = <LoadingState label="Buscando encuestas…" />;
    else if (error) cuerpo = <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudieron cargar las encuestas.')}</Notice>;
    else if (!encuestas.length) {
        cuerpo = <EmptyState icon={ClipboardCheck} title="Sin encuestas para aplicar"
            subtitle="Cuando marketing publique una encuesta para entrevista o tablet, aparece aquí." />;
    } else {
        cuerpo = (
            <div className="grid gap-4 md:grid-cols-2">
                {encuestas.map((e) => {
                    const b = salaDe(e);
                    const s = e.sucursales.find((x) => x.branch_id === b);
                    const n = preguntasEnOrden(e.cuestionario).length;
                    return (
                        <section key={e.id} data-surface="card" className="p-4 space-y-3 flex flex-col">
                            <div>
                                <p className="text-body-md font-semibold text-content">{e.nombre}</p>
                                {e.objetivo && <p className="text-body-sm text-content-2">{e.objetivo}</p>}
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    <Badge size="sm">{n} preguntas</Badge>
                                    {e.fecha_fin && <Badge size="sm">Hasta el {fechaTexto(e.fecha_fin, { day: 'numeric', month: 'short' })}</Badge>}
                                    {e.incentivo_tipo === 'muestra' && <Badge size="sm" variant="success"><Gift size={10} className="inline mr-0.5" />Muestra médica</Badge>}
                                    {e.incentivo_tipo === 'puntos' && <Badge size="sm" variant="success"><Gift size={10} className="inline mr-0.5" />{e.incentivo_puntos} puntos</Badge>}
                                </div>
                            </div>
                            {e.sucursales.length > 1 ? (
                                <LiquidSelect value={b} clearable={false} ariaLabel="Sucursal" icon={Store}
                                    options={e.sucursales.map((x) => ({ value: x.branch_id, label: x.nombre }))}
                                    onChange={(v) => v && setSalaElegida((m) => ({ ...m, [e.id]: Number(v) }))} />
                            ) : (
                                <p className="text-body-sm text-content-2 flex items-center gap-1"><Store size={14} />{s?.nombre}</p>
                            )}
                            {s && (
                                <p className="text-micro text-content-3">
                                    {s.respuestas} respuesta{s.respuestas === 1 ? '' : 's'} en esta sucursal{s.meta ? ` de ${s.meta}` : ''}
                                </p>
                            )}
                            <div className="flex flex-wrap gap-2 mt-auto pt-1">
                                {e.canales.includes('entrevista') && (
                                    <Button icon={Mic} disabled={!b} onClick={() => setEntrevistando({ encuesta: e, branchId: b })}>Entrevistar</Button>
                                )}
                                {e.canales.includes('kiosco') && s && (
                                    <Button variant="secondary" icon={Tablet}
                                        title="Abre la encuesta en esta pantalla para que los clientes respondan solos"
                                        onClick={() => window.open(`/e/${s.token}?modo=tablet`, '_blank', 'noopener')}>
                                        Modo tablet
                                    </Button>
                                )}
                            </div>
                        </section>
                    );
                })}
            </div>
        );
    }

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Aplicar encuesta" transparentBody>
            <div className="p-4 md:p-6 space-y-4">{cuerpo}</div>
        </GlassViewLayout>
    );
}
