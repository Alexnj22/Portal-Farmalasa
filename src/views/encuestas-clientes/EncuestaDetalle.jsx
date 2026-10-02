import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeft, Send, ThumbsUp, Undo2, Rocket, Square, Archive, Copy, Trash2, AlertTriangle, CheckCircle2,
    Loader2, Cloud, BookmarkPlus,
} from 'lucide-react';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Notice from '../../components/common/Notice';
import PromptModal from '../../components/common/PromptModal';
import ConfirmModal from '../../components/common/ConfirmModal';
import AvatarConEstado from '../../components/common/AvatarConEstado';
import { LoadingState } from '../../components/common/StateViews';
import { useToastStore } from '@nucleo/store/toastStore';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaTexto } from '@nucleo/utils/fecha';
import { hora12 } from '@nucleo/utils/hora';
import { estadoDe, preguntasEnOrden, canalDe, resumenDeCierre } from '@nucleo/utils/encuestasClientes';
import {
    fetchEncuesta, fetchEventos, fetchProblemas, fetchPersonas, guardarDiseno, guardarSucursales,
    enviarARevision, revisarEncuesta, publicarEncuesta, cerrarEncuesta, archivarEncuesta, duplicarEncuesta, borrarEncuesta,
} from '@nucleo/data/encuestasClientes';
import Constructor from './Constructor';
import AjustesEncuesta from './AjustesEncuesta';
import FormularioEncuesta from './FormularioEncuesta';
import AvanceEncuesta from './AvanceEncuesta';

const RETARDO_GUARDADO = 900;

const EVENTO = {
    creada: 'Creó la encuesta', enviada: 'La envió a revisión', aprobada: 'La aprobó', rechazada: 'La devolvió con cambios',
    publicada: 'La publicó', cerrada: 'La cerró', archivada: 'La archivó', duplicada: 'La creó como copia',
};

/**
 * Una encuesta abierta: el constructor, los ajustes, la vista previa y el
 * historial, con las acciones del ciclo según el estado y el permiso.
 *
 * El diseño se guarda solo: cada cambio espera un instante y se escribe. No
 * hay botón «Guardar» que olvidar, y la sesión que se cierra a los cinco
 * minutos no se lleva nada. Fuera de borrador todo queda de sólo lectura —la
 * base lo exige igual—.
 */
export default function EncuestaDetalle({
    id, vista, dimensiones, salas, poblacion, puedeEditar, puedeAprobar, onVolver, onAbrir, onCambio,
}) {
    const showToast = useToastStore((s) => s.showToast);
    const [encuesta, setEncuesta] = useState(null);
    const [sucursales, setSucursales] = useState([]);
    const [eventos, setEventos] = useState([]);
    const [personas, setPersonas] = useState({});
    const [problemas, setProblemas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState(null);
    const [guardado, setGuardado] = useState('listo'); // listo | pendiente | guardando | error
    const [dialogo, setDialogo] = useState(null);
    const [procesando, setProcesando] = useState(false);

    const pendientes = useRef({});
    const temporizador = useRef(null);
    const sucursalesGuardadas = useRef([]);

    const cargar = useCallback(async () => {
        try {
            const [e, ev, pr] = await Promise.all([fetchEncuesta(id), fetchEventos(id), fetchProblemas(id)]);
            if (!e) throw new Error('La encuesta no existe o no tienes acceso.');
            const gente = await fetchPersonas([...ev.map((x) => x.autor_id), e.created_by, e.aprobada_por]);
            setEncuesta(e);
            setSucursales(e.sucursales || []);
            sucursalesGuardadas.current = e.sucursales || [];
            setEventos(ev);
            setProblemas(pr);
            setPersonas(gente);
            setError(null);
        } catch (err) {
            setError(err);
        } finally {
            setCargando(false);
        }
    }, [id]);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- la carga de la encuesta abierta

    const editable = !!encuesta && encuesta.estado === 'borrador' && puedeEditar;

    const revisarProblemas = useCallback(async () => {
        try { setProblemas(await fetchProblemas(id)); } catch { /* el aviso se refresca en la próxima */ }
    }, [id]);

    const guardarYa = useCallback(async () => {
        clearTimeout(temporizador.current);
        const cambios = pendientes.current;
        if (!Object.keys(cambios).length) return;
        pendientes.current = {};
        setGuardado('guardando');
        try {
            await guardarDiseno(id, cambios);
            setGuardado(Object.keys(pendientes.current).length ? 'pendiente' : 'listo');
            revisarProblemas();
            onCambio?.();
        } catch (err) {
            // Lo que no entró vuelve a la cola, debajo de lo que se escribió después.
            pendientes.current = { ...cambios, ...pendientes.current };
            setGuardado('error');
            showToast('No se guardó el último cambio', mensajeAmigable(err, 'Revisa la conexión; se reintenta con el próximo cambio.'), 'error');
        }
    }, [id, revisarProblemas, onCambio, showToast]);

    // Al salir de la encuesta, lo pendiente se escribe igual. Por una
    // referencia: con `guardarYa` de dependencia, la limpieza correría (y
    // guardaría antes de tiempo) cada vez que cambia su identidad.
    const guardarAlSalir = useRef(guardarYa);
    useEffect(() => { guardarAlSalir.current = guardarYa; }, [guardarYa]);
    useEffect(() => () => { guardarAlSalir.current(); }, []);

    const cambiar = useCallback((cambios) => {
        setEncuesta((e) => ({ ...e, ...cambios }));
        pendientes.current = { ...pendientes.current, ...cambios };
        setGuardado('pendiente');
        clearTimeout(temporizador.current);
        temporizador.current = setTimeout(guardarYa, RETARDO_GUARDADO);
    }, [guardarYa]);

    const cambiarSucursales = useCallback(async (lista) => {
        setSucursales(lista);
        setGuardado('guardando');
        try {
            await guardarSucursales(id, lista, sucursalesGuardadas.current);
            sucursalesGuardadas.current = lista;
            setGuardado('listo');
            revisarProblemas();
        } catch (err) {
            setGuardado('error');
            showToast('No se guardaron las sucursales', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
            cargar();
        }
    }, [id, revisarProblemas, showToast, cargar]);

    // ── Acciones del ciclo ────────────────────────────────────────────────
    // Una función común y no un `useCallback`: sólo la llaman los botones y
    // los diálogos, nunca el render.
    async function accion(fn, exito, { volver = false, abrir = false } = {}) {
        setProcesando(true);
        try {
            await guardarYa();
            const r = await fn();
            showToast(exito, encuesta?.nombre, 'success');
            setDialogo(null);
            onCambio?.();
            if (abrir && r) onAbrir(r);
            else if (volver) onVolver();
            else cargar();
        } catch (err) {
            showToast('No se pudo completar', mensajeAmigable(err, 'Intenta de nuevo.'), 'error');
        } finally {
            setProcesando(false);
        }
    }

    const preguntas = useMemo(() => preguntasEnOrden(encuesta?.cuestionario), [encuesta?.cuestionario]);

    if (cargando) return <LoadingState label="Cargando la encuesta…" />;
    if (error || !encuesta) {
        return (
            <div className="space-y-3">
                <Button variant="ghost" icon={ArrowLeft} onClick={onVolver}>Volver</Button>
                <Notice variant="danger" icon={AlertTriangle}>{mensajeAmigable(error, 'No se pudo abrir la encuesta.')}</Notice>
            </div>
        );
    }

    const estado = estadoDe(encuesta.estado);
    const listo = problemas.length === 0;
    const ultimoRechazo = encuesta.estado === 'borrador' ? eventos.find((e) => e.tipo === 'rechazada' || e.tipo === 'enviada') : null;

    const botones = [];
    if (encuesta.es_plantilla) {
        if (puedeEditar) botones.push({ k: 'usar', icon: Copy, label: 'Crear encuesta con esta plantilla', variant: 'primary',
            hacer: 'usar' });
    } else if (encuesta.estado === 'borrador' && puedeEditar) {
        botones.push({ k: 'enviar', icon: Send, label: 'Enviar a revisión', variant: 'primary', disabled: !listo,
            title: listo ? 'Mandarla a gerencia para aprobar' : 'Resuelve lo pendiente primero', dialogo: 'enviar' });
    }
    if (encuesta.estado === 'en_revision' && puedeAprobar) {
        botones.push({ k: 'aprobar', icon: ThumbsUp, label: 'Aprobar', variant: 'primary', tone: 'success', dialogo: 'aprobar' });
        botones.push({ k: 'rechazar', icon: Undo2, label: 'Devolver con cambios', variant: 'secondary', dialogo: 'rechazar' });
    }
    if (encuesta.estado === 'aprobada' && puedeEditar) {
        botones.push({ k: 'publicar', icon: Rocket, label: 'Publicar', variant: 'primary', dialogo: 'publicar' });
    }
    if (encuesta.estado === 'publicada' && puedeEditar) {
        botones.push({ k: 'cerrar', icon: Square, label: 'Cerrar ahora', variant: 'secondary', dialogo: 'cerrar' });
    }
    if (!encuesta.es_plantilla && puedeEditar && encuesta.estado !== 'borrador') {
        botones.push({ k: 'dup', icon: Copy, label: 'Nueva versión', variant: 'secondary', title: 'Duplicarla como borrador para cambiarla',
            hacer: 'version' });
    }
    if (!encuesta.es_plantilla && puedeEditar) {
        botones.push({ k: 'plantilla', icon: BookmarkPlus, label: 'Guardar como plantilla', variant: 'ghost', iconOnly: true,
            hacer: 'plantilla' });
    }
    if (['borrador', 'aprobada', 'cerrada'].includes(encuesta.estado) && puedeEditar && !encuesta.es_plantilla) {
        botones.push({ k: 'archivar', icon: Archive, label: 'Archivar', variant: 'ghost', iconOnly: true, dialogo: 'archivar' });
    }
    if (encuesta.estado === 'borrador' && puedeEditar) {
        botones.push({ k: 'borrar', icon: Trash2, label: 'Borrar', variant: 'ghost', iconOnly: true, dialogo: 'borrar' });
    }

    function pulsar(b) {
        if (b.dialogo) { setDialogo(b.dialogo); return; }
        if (b.hacer === 'plantilla') accion(() => duplicarEncuesta(encuesta.id, true), 'Plantilla guardada');
        else accion(() => duplicarEncuesta(encuesta.id), b.hacer === 'usar' ? 'Encuesta creada' : 'Versión nueva creada', { abrir: true });
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-start gap-3">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                    <Button variant="ghost" iconOnly icon={ArrowLeft} title="Volver a la lista" onClick={onVolver} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-body-xl font-semibold text-content">{encuesta.nombre}</h2>
                            {encuesta.es_plantilla ? <Badge variant="info">Plantilla</Badge>
                                : <Badge variant={estado.variant}>{estado.label}</Badge>}
                            {!encuesta.es_plantilla && encuesta.version > 1 && <Badge>v{encuesta.version}</Badge>}
                        </div>
                        <p className="text-body-sm text-content-2">
                            {preguntas.length} pregunta{preguntas.length === 1 ? '' : 's'}
                            {!encuesta.es_plantilla && <> · {encuesta.canales.map((c) => canalDe(c).label).join(', ') || 'sin canal'}
                                {' · '}{resumenDeCierre(encuesta, sucursales, fechaTexto)}</>}
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {editable && <IndicadorGuardado estado={guardado} />}
                    {botones.map((b) => (
                        <Button key={b.k} variant={b.variant} tone={b.tone} icon={b.icon} iconOnly={b.iconOnly}
                            title={b.title || b.label} disabled={b.disabled || procesando} onClick={() => pulsar(b)}>
                            {b.iconOnly ? null : b.label}
                        </Button>
                    ))}
                </div>
            </div>

            {!encuesta.es_plantilla && (
                <Notice variant="info" compact>
                    {estado.texto}
                </Notice>
            )}
            {ultimoRechazo?.tipo === 'rechazada' && ultimoRechazo.comentario && (
                <Notice variant="warning" icon={Undo2}>
                    <span className="font-semibold">Devuelta por {shortEmployeeName(personas[ultimoRechazo.autor_id]?.name) || 'gerencia'}:</span>{' '}
                    {ultimoRechazo.comentario}
                </Notice>
            )}
            {encuesta.estado === 'borrador' && !listo && (
                <section data-surface="card" className="p-3">
                    <p className="text-label uppercase tracking-wide font-semibold text-content-2 mb-1.5">Falta para enviarla</p>
                    <ul className="space-y-1">
                        {problemas.map((p) => (
                            <li key={p} className="flex items-start gap-1.5 text-body-sm text-content">
                                <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />{p}
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {vista === 'ajustes' ? (
                <AjustesEncuesta encuesta={encuesta} sucursales={sucursales} salas={salas} poblacion={poblacion}
                    soloLectura={!editable} onChange={cambiar} onSucursales={cambiarSucursales} />
            ) : vista === 'vista' ? (
                <div className="flex justify-center">
                    <div data-surface="card" className="w-full max-w-md p-5">
                        <p className="text-micro uppercase tracking-wide font-semibold text-content-3 mb-3">Así la ve el cliente</p>
                        <FormularioEncuesta encuesta={encuesta} />
                    </div>
                </div>
            ) : vista === 'avance' ? (
                <AvanceEncuesta encuesta={encuesta} puedeEditar={puedeEditar} />
            ) : vista === 'historial' ? (
                <Historial eventos={eventos} personas={personas} />
            ) : (
                <Constructor cuestionario={encuesta.cuestionario} dimensiones={dimensiones}
                    soloLectura={!editable} onChange={(c) => cambiar({ cuestionario: c })} />
            )}

            <PromptModal isOpen={dialogo === 'enviar'} onClose={() => setDialogo(null)} isProcessing={procesando}
                title="Enviar a revisión" message="Gerencia recibe el aviso. Mientras la revisa, la encuesta no se puede editar."
                placeholder="Nota para quien aprueba (opcional)" confirmText="Enviar"
                onConfirm={(nota) => accion(() => enviarARevision(encuesta.id, nota), 'Enviada a revisión')} />
            <PromptModal isOpen={dialogo === 'aprobar'} onClose={() => setDialogo(null)} isProcessing={procesando}
                title="Aprobar la encuesta" message="Quedará lista para publicarse tal como está."
                placeholder="Comentario (opcional)" confirmText="Aprobar"
                onConfirm={(c) => accion(() => revisarEncuesta(encuesta.id, 'aprobar', c), 'Encuesta aprobada')} />
            <PromptModal isOpen={dialogo === 'rechazar'} onClose={() => setDialogo(null)} isProcessing={procesando} required
                title="Devolver con cambios" message="Vuelve a borrador y quien la diseñó recibe tu comentario."
                placeholder="Qué hay que cambiar" confirmText="Devolver"
                onConfirm={(c) => accion(() => revisarEncuesta(encuesta.id, 'rechazar', c), 'Encuesta devuelta')} />
            <PromptModal isOpen={dialogo === 'cerrar'} onClose={() => setDialogo(null)} isProcessing={procesando}
                title="Cerrar la encuesta" message="Deja de recibir respuestas. No se puede reabrir: para repetirla, se duplica."
                placeholder="Motivo (opcional)" confirmText="Cerrar"
                onConfirm={(m) => accion(() => cerrarEncuesta(encuesta.id, m), 'Encuesta cerrada')} />
            <ConfirmModal isOpen={dialogo === 'publicar'} onClose={() => setDialogo(null)} isProcessing={procesando}
                isDestructive={false} title="Publicar la encuesta" confirmText="Publicar"
                message={`Empieza a recibir respuestas${encuesta.fecha_inicio ? ` desde el ${fechaTexto(encuesta.fecha_inicio)}` : ' hoy'}. Desde ahora sólo se puede cerrar.`}
                onConfirm={() => accion(() => publicarEncuesta(encuesta.id), 'Encuesta publicada')} />
            <ConfirmModal isOpen={dialogo === 'archivar'} onClose={() => setDialogo(null)} isProcessing={procesando}
                isDestructive={false} title="Archivar la encuesta" confirmText="Archivar"
                message="Sale de la lista principal y queda en «Cerradas». No se borra nada."
                onConfirm={() => accion(() => archivarEncuesta(encuesta.id), 'Encuesta archivada', { volver: true })} />
            <ConfirmModal isOpen={dialogo === 'borrar'} onClose={() => setDialogo(null)} isProcessing={procesando}
                title={encuesta.es_plantilla ? 'Borrar la plantilla' : 'Borrar el borrador'} confirmText="Borrar"
                message="Se borra con todas sus preguntas. No se puede deshacer."
                onConfirm={() => accion(() => borrarEncuesta(encuesta.id, encuesta.nombre), 'Borrada', { volver: true })} />
        </div>
    );
}

function IndicadorGuardado({ estado }) {
    const m = {
        listo:     { icon: CheckCircle2, texto: 'Guardado', cls: 'text-content-3' },
        pendiente: { icon: Cloud, texto: 'Cambios sin guardar', cls: 'text-content-3' },
        guardando: { icon: Loader2, texto: 'Guardando…', cls: 'text-content-3', spin: true },
        error:     { icon: AlertTriangle, texto: 'Sin guardar', cls: 'text-danger' },
    }[estado];
    const I = m.icon;
    return (
        <span className={`inline-flex items-center gap-1 text-micro font-semibold ${m.cls}`} aria-live="polite">
            <I size={13} className={m.spin ? 'animate-spin' : ''} />{m.texto}
        </span>
    );
}

function Historial({ eventos, personas }) {
    if (!eventos.length) return <p className="text-body-sm text-content-3">Sin movimientos.</p>;
    return (
        <ol data-surface="card" className="p-4 space-y-3">
            {eventos.map((e) => {
                const quien = personas[e.autor_id];
                return (
                    <li key={e.id} className="flex items-start gap-2.5">
                        <AvatarConEstado emp={quien || { id: e.autor_id }} px={28} radio="rounded-full" marco="" />
                        <div className="min-w-0">
                            <p className="text-body-sm text-content">
                                <span className="font-semibold">{quien ? shortEmployeeName(quien.name) : 'Sistema'}</span>{' '}
                                {(EVENTO[e.tipo] || e.tipo).toLowerCase()}
                            </p>
                            {e.comentario && <p className="text-body-sm text-content-2">«{e.comentario}»</p>}
                            <p className="text-micro text-content-3">
                                {fechaTexto(e.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}
                                {' · '}{hora12(e.created_at)}
                            </p>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
