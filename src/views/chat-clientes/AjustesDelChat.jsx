import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquareText, Moon, Save, Store } from 'lucide-react';
import LiquidModal from '../../components/common/LiquidModal';
import PortalTextarea from '../../components/common/PortalTextarea';
import Button from '../../components/common/Button';
import Notice from '../../components/common/Notice';
import { LoadingState } from '../../components/common/StateViews';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore as useStaff } from '@nucleo/store/staffStore';
import { fetchAjustesDelChat, guardarAjustesDelChat, guardarRespuestasAutomaticas } from '@nucleo/data/horarios';
import Switch from '../../components/common/Switch';
import { LARGO_MAXIMO_MENSAJE, MARCADORES_DEL_CHAT, trozosDelMensaje } from '@nucleo/utils/horarioDelChat';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { fechaHora12 } from '@nucleo/utils/hora';
import EstadoDeLaFarmacia from './EstadoDeLaFarmacia';

/**
 * «Ajustes del chat»: los dos mensajes automáticos que recibe un cliente al
 * escribir —uno con la farmacia en horario y otro fuera de él—. Admiten
 * {abre} y {cierra}, que el servidor rellena con el horario REAL de las salas
 * (especiales y feriados incluidos). La vista previa los rellena con el estado
 * de ahora; si ahora no aplica (la hora de apertura con la farmacia abierta),
 * el marcador se muestra tal cual, sin inventar una hora.
 *
 * Sólo lo abre quien tiene `chat_clientes` para editar; la policy de la base
 * vuelve a exigirlo y además que `updated_by` sea la ficha de quien guarda.
 */

const CAMPOS = [
    { clave: 'mensaje_abierto', rotulo: 'Con la farmacia en horario', icono: Store,
      ayuda: 'Lo recibe quien escribe mientras alguna farmacia está abierta.' },
    { clave: 'mensaje_cerrado', rotulo: 'Fuera de horario', icono: Moon,
      ayuda: 'Lo recibe quien escribe con todas las farmacias cerradas. Conviene decir cuándo abren: {abre}.' },
];

function VistaPrevia({ texto, estado }) {
    const trozos = useMemo(() => trozosDelMensaje(texto, estado), [texto, estado]);
    if (!String(texto || '').trim()) return <p className="text-caption text-content-3 italic">El mensaje está vacío.</p>;
    return (
        <p className="text-body-sm text-content leading-relaxed whitespace-pre-wrap break-words">
            {trozos.map((t, i) => (t.marcador
                ? <mark key={i} className={`rounded px-0.5 font-bold ${t.faltante ? 'bg-warning/15 text-warning-text' : 'bg-brand/12 text-brand-text'}`}
>{t.texto}</mark>
                : <React.Fragment key={i}>{t.texto}</React.Fragment>))}
            {trozos.some((t) => t.faltante) && (
                <span className="block mt-1 text-caption text-warning-text">
                    Lo marcado en amarillo no aplica en este momento; se completa solo cuando corresponda.
                </span>
            )}
        </p>
    );
}

function EditorDeMensaje({ campo, valor, onCambio, estado, deshabilitado }) {
    const cursor = useRef(null);
    const Icono = campo.icono;
    const insertar = (marcador) => {
        const pos = cursor.current ?? valor.length;
        const nuevo = `${valor.slice(0, pos)}${marcador}${valor.slice(pos)}`.slice(0, LARGO_MAXIMO_MENSAJE);
        cursor.current = Math.min(pos + marcador.length, nuevo.length);
        onCambio(nuevo);
    };
    const recordar = (e) => { cursor.current = e.target.selectionStart; };
    const vacio = !valor.trim();
    return (
        <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <Icono size={15} className="text-brand-text shrink-0" />
                <h3 className="text-body-sm font-black text-content">{campo.rotulo}</h3>
            </div>
            <p className="text-caption text-content-3">{campo.ayuda}</p>
            <PortalTextarea name={campo.clave} rows={4} compact value={valor} maxLength={LARGO_MAXIMO_MENSAJE}
                readOnly={deshabilitado} hasError={vacio} errorMessage="Escribe un mensaje"
                aria-label={campo.rotulo}
                onChange={(e) => { cursor.current = e.target.selectionStart; onCambio(e.target.value); }}
                onSelect={recordar} onKeyUp={recordar} onClick={recordar} />
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-micro font-black uppercase tracking-widest text-content-3 mr-1">Insertar</span>
                {MARCADORES_DEL_CHAT.map((m) => (
                    <Button key={m.clave} variant="secondary" size="sm" disabled={deshabilitado || valor.length + m.clave.length > LARGO_MAXIMO_MENSAJE}
                        title={m.ayuda} onClick={() => insertar(m.clave)}>
                        {m.rotulo} <span className="font-mono text-content-3">{m.clave}</span>
                    </Button>
                ))}
            </div>
            <div data-surface="card" className="rounded-card p-3 flex flex-col gap-1.5">
                <span className="text-micro font-black uppercase tracking-widest text-content-3">Así lo verá el cliente ahora</span>
                <VistaPrevia texto={valor} estado={estado} />
            </div>
        </section>
    );
}

export default function AjustesDelChat({ abierto, onClose, estado }) {
    const { user, hasPermission } = useAuth();
    const puedeEditar = hasPermission('chat_clientes', 'can_edit');
    const empleados = useStaff((s) => s.employees);
    const [fila, setFila] = useState(null);
    const [f, setF] = useState({ mensaje_abierto: '', mensaje_cerrado: '' });
    const [cargando, setCargando] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState('');
    const [guardado, setGuardado] = useState(false);

    useEffect(() => {
        if (!abierto) return undefined;
        let vivo = true;
        setCargando(true); setError(''); setGuardado(false);
        fetchAjustesDelChat()
            .then((r) => {
                if (!vivo) return;
                setFila(r);
                setF({ mensaje_abierto: r?.mensaje_abierto ?? '', mensaje_cerrado: r?.mensaje_cerrado ?? '' });
            })
            .catch((e) => { if (vivo) setError(e?.message || 'No se pudieron leer los mensajes.'); })
            .finally(() => { if (vivo) setCargando(false); });
        return () => { vivo = false; };
    }, [abierto]);

    const editor = useMemo(() => {
        if (!fila?.updated_by) return null;
        return (empleados || []).find((e) => String(e.id) === String(fila.updated_by)) ?? null;
    }, [empleados, fila]);

    const cambiado = !!fila && (f.mensaje_abierto !== fila.mensaje_abierto || f.mensaje_cerrado !== fila.mensaje_cerrado);
    const valido = f.mensaje_abierto.trim() && f.mensaje_cerrado.trim();
    const listo = puedeEditar && cambiado && valido && !guardando && !!user?.id;

    // Las respuestas automáticas (2026-10-20): se guardan al tocar el interruptor.
    const [cambiandoAuto, setCambiandoAuto] = useState(false);
    const cambiarAuto = async (v) => {
        setCambiandoAuto(true); setError('');
        try {
            setFila(await guardarRespuestasAutomaticas({ encendidas: v, employeeId: user.id }));
        } catch (e) {
            setError(e?.message || 'No se pudo guardar.');
        } finally {
            setCambiandoAuto(false);
        }
    };

    const guardar = async () => {
        setGuardando(true); setError(''); setGuardado(false);
        try {
            const r = await guardarAjustesDelChat({ mensajeAbierto: f.mensaje_abierto, mensajeCerrado: f.mensaje_cerrado, employeeId: user.id });
            setFila(r);
            setF({ mensaje_abierto: r.mensaje_abierto, mensaje_cerrado: r.mensaje_cerrado });
            setGuardado(true);
        } catch (e) {
            setError(e?.message || 'No se pudieron guardar los mensajes.');
        } finally {
            setGuardando(false);
        }
    };

    return (
        <LiquidModal open={abierto} onClose={guardando ? undefined : onClose} maxWidth="max-w-2xl" ariaLabel="Ajustes del chat">
            <LiquidModal.Header>
                <div className="flex items-center gap-2.5 min-w-0">
                    <MessageSquareText size={18} className="text-brand-text shrink-0" />
                    <h2 className="text-title font-black text-content truncate">Ajustes del chat</h2>
                </div>
            </LiquidModal.Header>
            <LiquidModal.Body>
                <div className="flex flex-col gap-5">
                    <div className="flex flex-col gap-1.5">
                        <p className="text-caption text-content-2">
                            Respuestas automáticas que recibe el cliente al escribir. El horario sale de las sucursales: los feriados y los horarios especiales se aplican solos.
                        </p>
                        <EstadoDeLaFarmacia estado={estado} />
                    </div>
                    {error && <Notice variant="danger" bloque>{error}</Notice>}
                    {fila && (
                        <div data-surface="card" className="flex items-start justify-between gap-4 p-3">
                            <div className="flex flex-col gap-1 min-w-0">
                                <span className="text-body-sm font-bold text-content">Contestar solo lo sencillo</span>
                                <span className="text-caption text-content-2">
                                    Horario de hoy, teléfonos, direcciones y precio y existencias de un producto, con los datos del portal. Nunca contesta solo dosis, síntomas, embarazo, niños ni recomendaciones: eso te llega a ti. El cliente lo ve como «Respuesta automática» y puede pedir hablar con una persona.
                                </span>
                            </div>
                            <Switch checked={fila.respuestas_automaticas !== false} onChange={cambiarAuto} disabled={!puedeEditar || cambiandoAuto}
                                aria-label="Respuestas automáticas del chat" />
                        </div>
                    )}
                    {guardado && !error && <Notice variant="success" bloque>Mensajes guardados. Los próximos clientes ya los reciben.</Notice>}
                    {cargando && !fila ? <LoadingState label="Cargando mensajes" /> : (
                        CAMPOS.map((c) => (
                            <EditorDeMensaje key={c.clave} campo={c} valor={f[c.clave]} estado={estado}
                                deshabilitado={!puedeEditar || guardando}
                                onCambio={(v) => { setGuardado(false); setF((x) => ({ ...x, [c.clave]: v })); }} />
                        ))
                    )}
                    {fila?.updated_by && (
                        <p className="text-caption text-content-3">
                            Última edición: <span className="font-bold text-content-2">{shortEmployeeName(editor)}</span>
                            {fila.updated_at ? ` · ${fechaHora12(fila.updated_at, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                        </p>
                    )}
                </div>
            </LiquidModal.Body>
            <LiquidModal.Footer>
                <div className="flex items-center justify-end gap-2 w-full">
                    <Button variant="ghost" onClick={onClose} disabled={guardando}>Cerrar</Button>
                    {puedeEditar && (
                        <Button variant="primary" icon={guardando ? Loader2 : Save} disabled={!listo} onClick={guardar}>Guardar mensajes</Button>
                    )}
                </div>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
