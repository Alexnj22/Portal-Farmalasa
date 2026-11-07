import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Mic, Tablet, ArrowLeft, AlertTriangle, Gift, Store, MapPin, Navigation } from 'lucide-react';
import GlassViewLayout from '../../components/GlassViewLayout';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import LiquidSelect from '../../components/common/LiquidSelect';
import PortalInput from '../../components/common/PortalInput';
import { LoadingState, EmptyState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { fechaTexto, hoySV } from '@nucleo/utils/fecha';
import { preguntasEnOrden, enlaceDeEncuesta } from '@nucleo/utils/encuestasClientes';
import { fetchParaAplicar, guardarEntrevista, guardarEntrevistaCampo, marcarMuestraEntregada } from '@nucleo/data/encuestasClientes';
import { salaDeHoy } from '@nucleo/data/puntos';
import { leer, guardar } from '../../plataforma/almacen';
import { leerPosicion } from '../../plataforma/ubicacion';
import FormularioEncuesta from './FormularioEncuesta';

/**
 * Aplicar una encuesta: entrevistar a un cliente desde el portal (en una sala
 * o en campo), o dejar la tablet del mostrador abierta en la encuesta.
 *
 * Permiso `encuestas_aplicar` (o diseñar encuestas): quien entrevista no
 * necesita ver el módulo entero. Las encuestas y sus sucursales las da
 * `encuestas_para_aplicar`, que ya filtra las publicadas y vigentes hoy.
 *
 * «¿Dónde estás?» se elige UNA vez arriba y vale para todas las entrevistas
 * del día (pedido del usuario 2026-11-07: un practicante elige la sala donde
 * está y todo lo que haga ese rato queda en esa sala). Sin sala asignada hoy
 * no hay valor por defecto: antes arrancaba en la primera de la lista y una
 * distracción mandaba las respuestas a otra sucursal.
 */

const CLAVE = 'encuestas.aplicar.donde';

/** Lo elegido HOY en este aparato: `{ sala: id }` o `{ campo: true, lugar }`. */
function leerDonde() {
    try {
        const d = JSON.parse(leer(CLAVE) || 'null');
        return d && d.dia === hoySV() ? d : null;
    } catch { return null; }
}
function guardarDonde(d) {
    try { guardar(CLAVE, JSON.stringify({ ...d, dia: hoySV() })); } catch { /* sin almacenamiento: se elige de nuevo */ }
}

const OPCION_CAMPO = 'campo';

export default function AplicarEncuestaView() {
    const showToast = useToastStore((s) => s.showToast);
    const [encuestas, setEncuestas] = useState([]);
    const [miSala, setMiSala] = useState(null);
    const [donde, setDonde] = useState(leerDonde);   // null = falta elegir
    const [gps, setGps] = useState(null);             // null | 'buscando' | 'sin' | { lat, lng, precision }
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [entrevistando, setEntrevistando] = useState(null); // la encuesta
    // La encuesta se cerró con la última entrevista: «Otra entrevista» vuelve a
    // la lista en vez de dejar contestar una entera que la base va a rechazar.
    const [seCerro, setSeCerro] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const [es, sala] = await Promise.all([fetchParaAplicar(), salaDeHoy().catch(() => null)]);
            setEncuestas(es.filter((e) => ['entrevista', 'kiosco', 'campo'].some((c) => e.canales.includes(c))));
            setMiSala(sala != null ? Number(sala) : null); // `empleado_sala_de_hoy` devuelve el id (bigint)
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setCargando(false);
        }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);

    // Las salas donde hay algo que aplicar, y si alguna encuesta va a campo.
    const salas = useMemo(() => {
        const m = new Map();
        for (const e of encuestas) {
            if (!e.canales.includes('entrevista') && !e.canales.includes('kiosco')) continue;
            for (const s of e.sucursales) m.set(s.branch_id, s.nombre);
        }
        return [...m].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    }, [encuestas]);
    const hayCampo = encuestas.some((e) => e.canales.includes('campo'));

    // Lo elegido, o la sala de hoy si tiene algo que aplicar. Nunca «la primera».
    const efectivo = useMemo(() => {
        if (donde?.campo && hayCampo) return donde;
        if (donde?.sala && salas.some((s) => s.id === donde.sala)) return donde;
        if (miSala != null && salas.some((s) => s.id === miSala)) return { sala: miSala };
        return null;
    }, [donde, miSala, salas, hayCampo]);
    const enCampo = !!efectivo?.campo;
    const nombreSala = efectivo?.sala ? salas.find((s) => s.id === efectivo.sala)?.nombre : null;

    const elegir = (v) => {
        const d = v === OPCION_CAMPO ? { campo: true, lugar: donde?.lugar || '' } : { sala: Number(v) };
        setDonde(d);
        guardarDonde(d);
    };
    const escribirLugar = (lugar) => {
        const d = { campo: true, lugar };
        setDonde(d);
        guardarDonde(d);
    };

    // En campo se pide la ubicación al elegirlo: el permiso del teléfono
    // aparece ahora y no en medio de la primera entrevista.
    const buscarUbicacion = useCallback(async () => {
        setGps('buscando');
        const p = await leerPosicion({ espera: 12000 });
        setGps(p || 'sin');
        return p;
    }, []);
    useEffect(() => {
        if (enCampo && gps === null) buscarUbicacion();
    }, [enCampo, gps, buscarUbicacion]);

    const lugar = (donde?.lugar || '').trim();
    const gpsListo = !!gps && typeof gps === 'object';
    const campoListo = enCampo && (!!lugar || gpsListo);

    const visibles = useMemo(() => {
        if (!efectivo) return [];
        if (enCampo) return encuestas.filter((e) => e.canales.includes('campo'));
        return encuestas.filter((e) => (e.canales.includes('entrevista') || e.canales.includes('kiosco'))
            && e.sucursales.some((s) => s.branch_id === efectivo.sala));
    }, [encuestas, efectivo, enCampo]);

    const volver = () => { setEntrevistando(null); setSeCerro(false); cargar(); };

    if (entrevistando) {
        const encuesta = entrevistando;
        return (
            <GlassViewLayout icon={Mic} title="Aplicar encuesta" transparentBody>
                <div className="p-4 md:p-6 flex justify-center">
                    <div className="w-full max-w-lg space-y-3">
                        <Button variant="ghost" icon={ArrowLeft} onClick={volver}>Volver a las encuestas</Button>
                        <div data-surface="card" className="p-5 space-y-4">
                            <div>
                                <p className="text-body-lg font-semibold text-content">{encuesta.nombre}</p>
                                <p className="text-micro text-content-3 flex items-center gap-1">
                                    {enCampo
                                        ? <><MapPin size={12} />Campo{lugar ? ` · ${lugar}` : ''}</>
                                        : <><Store size={12} />{nombreSala}</>}
                                </p>
                            </div>
                            <Notice variant="info" compact>
                                Lee cada pregunta tal como está escrita y marca lo que responde el cliente, sin sugerirle la respuesta.
                            </Notice>
                            <FormularioEncuesta encuesta={encuesta} entrevista
                                onEntregarMuestra={marcarMuestraEntregada}
                                onReiniciar={() => { if (seCerro) volver(); }}
                                onEnviar={async (respuestas, contacto, segundos, referencia) => {
                                    let r;
                                    if (enCampo) {
                                        // La posición se lee al guardar: el encuestador se mueve
                                        // durante la jornada. Si no llega, vale la última buena.
                                        const p = (await leerPosicion({ espera: 6000 })) || (gpsListo ? gps : null);
                                        if (p) setGps(p);
                                        r = await guardarEntrevistaCampo(encuesta.id,
                                            { lugar: lugar || null, ...(p ? { lat: p.lat, lng: p.lng, precision: p.precision } : {}) },
                                            { respuestas, contacto, segundos, referencia });
                                    } else {
                                        r = await guardarEntrevista(encuesta.id, efectivo.sala, { respuestas, contacto, segundos, referencia });
                                    }
                                    if (r?.cerrada) {
                                        setSeCerro(true);
                                        showToast('La encuesta llegó a su meta', 'Se cerró sola. ¡Gracias!', 'success');
                                    }
                                    return r;
                                }} />
                        </div>
                    </div>
                </div>
            </GlassViewLayout>
        );
    }

    const opciones = [
        ...salas.map((s) => ({ value: String(s.id), label: s.nombre })),
        ...(hayCampo ? [{ value: OPCION_CAMPO, label: 'Campo (fuera de las salas)' }] : []),
    ];

    let cuerpo;
    if (cargando) cuerpo = <LoadingState label="Buscando encuestas…" />;
    else if (error) cuerpo = <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudieron cargar las encuestas.')}</Notice>;
    else if (!encuestas.length) {
        cuerpo = <EmptyState icon={ClipboardCheck} title="Sin encuestas para aplicar"
            subtitle="Cuando marketing publique una encuesta para entrevista, tablet o campo, aparece aquí." />;
    } else {
        cuerpo = (
            <>
                <section data-surface="card" className="p-4 space-y-3 max-w-xl">
                    <div>
                        <p className="text-body-md font-semibold text-content">¿Dónde estás haciendo encuestas?</p>
                        <p className="text-micro text-content-3">Vale para todas las que hagas hoy en este teléfono. Si te mueves, cámbialo aquí.</p>
                    </div>
                    <LiquidSelect value={efectivo ? (enCampo ? OPCION_CAMPO : String(efectivo.sala)) : ''}
                        placeholder="Elige la sucursal o campo" clearable={false} ariaLabel="Dónde estás"
                        icon={enCampo ? MapPin : Store} options={opciones} onChange={(v) => v && elegir(v)} />
                    {enCampo && (
                        <>
                            <PortalInput label="Lugar" name="lugar-campo" value={donde?.lugar || ''} maxLength={120}
                                placeholder="Ej. Mercado de Soyapango" onChange={(e) => escribirLugar(e.target.value)} />
                            <div className="text-micro text-content-3 flex flex-wrap items-center gap-1.5" aria-live="polite">
                                <Navigation size={12} />
                                {gps === 'buscando' && <span>Buscando tu ubicación…</span>}
                                {gpsListo && <span>Ubicación activa{gps.precision ? ` (±${Math.round(gps.precision)} m)` : ''}: se guarda con cada encuesta.</span>}
                                {gps === 'sin' && <span>El teléfono no dio la ubicación: se guarda sólo el lugar que escribas.</span>}
                                {gps === 'sin' && <Button variant="ghost" size="sm" onClick={buscarUbicacion}>Reintentar</Button>}
                            </div>
                            {!campoListo && gps !== 'buscando' && (
                                <Notice variant="warning" compact>Escribe el lugar donde estás para poder empezar.</Notice>
                            )}
                        </>
                    )}
                </section>

                {!efectivo ? (
                    <Notice variant="info" compact>Elige dónde estás para ver las encuestas que puedes aplicar.</Notice>
                ) : !visibles.length ? (
                    <EmptyState icon={ClipboardCheck} title="Sin encuestas aquí"
                        subtitle={enCampo ? 'Ninguna encuesta publicada se aplica en campo.' : 'Ninguna encuesta publicada se aplica en esta sucursal.'} />
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                        {visibles.map((e) => {
                            const s = enCampo ? null : e.sucursales.find((x) => x.branch_id === efectivo.sala);
                            const n = preguntasEnOrden(e.cuestionario).length;
                            const puedeEntrevistar = enCampo ? campoListo : e.canales.includes('entrevista');
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
                                    {s && (
                                        <p className="text-micro text-content-3">
                                            {s.respuestas} respuesta{s.respuestas === 1 ? '' : 's'} en esta sucursal{s.meta ? ` de ${s.meta}` : ''}
                                        </p>
                                    )}
                                    <div className="flex flex-wrap gap-2 mt-auto pt-1">
                                        {(enCampo || e.canales.includes('entrevista')) && (
                                            <Button icon={Mic} disabled={!puedeEntrevistar} onClick={() => setEntrevistando(e)}>Entrevistar</Button>
                                        )}
                                        {!enCampo && e.canales.includes('kiosco') && s?.token_tablet && (
                                            <Button variant="secondary" icon={Tablet}
                                                title="Abre la encuesta en esta pantalla para que los clientes respondan solos"
                                                onClick={() => window.open(enlaceDeEncuesta(s.token_tablet, true, window.location.origin), '_blank', 'noopener')}>
                                                Modo tablet
                                            </Button>
                                        )}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </>
        );
    }

    return (
        <GlassViewLayout icon={ClipboardCheck} title="Aplicar encuesta" transparentBody>
            <div className="p-4 md:p-6 space-y-4">{cuerpo}</div>
        </GlassViewLayout>
    );
}
