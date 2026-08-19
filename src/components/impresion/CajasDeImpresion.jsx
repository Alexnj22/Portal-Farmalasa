import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, Plus, Printer, Trash2 } from 'lucide-react';
import Button from '../common/Button';
import ConfirmModal from '../common/ConfirmModal';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import {
    crearCodigoDeVinculacion, eliminarCajaDeImpresion,
    fetchCajasDeImpresion, fetchColaDeImpresion, fetchVersionPublicadaDelAgente,
} from '../../data/impresion';
import { mensajeAmigable } from '../../utils/errorMessages';
import { useStaffStore as useStaff } from '../../store/staffStore';
import { useToastStore } from '../../store/toastStore';

/**
 * Las cajas que pueden imprimir, y qué pasó con el papel.
 *
 * ── Por qué existe esta pantalla ───────────────────────────────────────────
 * El camino directo de impresión sólo alcanza la computadora que tiene el
 * navegador abierto. Para que el papel salga en la caja de una sucursal —lo
 * mande quien lo mande, incluso desde el teléfono— hay un agente corriendo en
 * esa caja que pregunta por su cola. Acá se registra esa caja y se ve si
 * contesta.
 *
 * ── El token se muestra UNA vez ────────────────────────────────────────────
 * La policy de la tabla no publica el token: no se puede volver a leer desde
 * ninguna pantalla. Un token que se puede releer es un token que viaja. Si se
 * pierde, se registra la caja de nuevo — cuesta un minuto.
 *
 * ── Y el latido es el dato que importa ─────────────────────────────────────
 * «Registrada» no significa «funciona»: significa que alguien la dio de alta. Lo
 * que dice si va a salir papel es cuándo preguntó por última vez. Por eso esa
 * columna se pinta y no se esconde detrás de un ícono verde.
 */

const VACIO = [];
const MINUTO = 60_000;

const haceCuanto = (iso) => {
    if (!iso) return { txt: 'nunca preguntó', vivo: false };
    const ms = Date.now() - Date.parse(iso);
    if (ms < 2 * MINUTO) return { txt: 'ahora mismo', vivo: true };
    if (ms < 60 * MINUTO) return { txt: `hace ${Math.round(ms / MINUTO)} min`, vivo: false };
    if (ms < 48 * 60 * MINUTO) return { txt: `hace ${Math.round(ms / (60 * MINUTO))} h`, vivo: false };
    return { txt: `hace ${Math.round(ms / (24 * 60 * MINUTO))} días`, vivo: false };
};

/**
 * Qué decir de una caja: si está al día y por dónde le escribe a la ticketera.
 *
 * **El canal no es un detalle técnico y por eso se pinta.** Una caja que
 * imprime por CUPS le QUITA la ticketera al sistema de facturación —el backend
 * `usb` de CUPS desengancha el dispositivo del kernel— y esa sala deja de poder
 * facturar hasta que alguien apaga y prende el aparato. Pasó en Salud 1 el
 * 19-ago-2026. Escrito en una nota de instalación no lo ve nadie; acá sí.
 *
 * Y sin versión publicada la pantalla NO opina: no poder leer el archivo no es
 * lo mismo que estar atrasada, y mandar a actualizar una caja que estaba bien
 * enseña a ignorar el aviso.
 */
const estadoDelAgente = (caja, publicada) => {
    if (!caja.vinculada_at) return null;
    const version = caja.agente_version || null;
    const canal = caja.agente_canal || null;
    // Un agente viejo no informa nada: es exactamente el que hay que actualizar,
    // y decir «sin datos» sería esconder la respuesta que se está buscando.
    if (!version) return { txt: 'versión vieja — hay que actualizarla', mal: true };

    // Los dos problemas se DICEN JUNTOS, no gana uno. Con `if/else`, una caja
    // atrasada Y en CUPS sólo mostraba el CUPS, y eso manda a revisar la
    // impresora cuando lo que pasa es que la corrección todavía no le llegó —
    // dos acciones distintas para un mismo renglón (Salud 1, 19-ago-2026).
    const problemas = [];
    if (publicada && version !== publicada) problemas.push('atrasada — la corrección aún no le llega');
    if (canal === 'CUPS') problemas.push('imprime por CUPS, le quita la ticketera al otro sistema');
    if (problemas.length) return { txt: problemas.join(' · '), mal: true };

    return { txt: `al día · escribe en ${canal || 'la ticketera'}`, mal: false };
};

/**
 * La línea que pone al día una caja. Vive acá y se puede copiar de la pantalla
 * a propósito: el agente **no se puede actualizar a distancia** —lo único que
 * ejecuta es el comando de imprimir, y eso no se cambia—, así que alguien tiene
 * que correr algo en esa computadora. Que sea UNA línea dictable por teléfono
 * es la diferencia entre eso y viajar a cada sucursal.
 */
const LINEA_DE_ACTUALIZAR =
    'curl -fsSL https://portal.farmasalud.lat/agente-impresion/actualizar.sh | sudo bash';

const ESTADOS = {
    PENDIENTE:   { txt: 'Esperando',  icon: Clock,         clase: 'text-content-3' },
    IMPRIMIENDO: { txt: 'Saliendo',   icon: Printer,       clase: 'text-content-2' },
    IMPRESO:     { txt: 'Impreso',    icon: CheckCircle2,  clase: 'text-success-text' },
    ERROR:       { txt: 'No salió',   icon: AlertTriangle, clase: 'text-danger-text' },
};

export default function CajasDeImpresion({ puedeEditar }) {
    // El `|| []` va DENTRO del selector: afuera crea un array nuevo en cada
    // render y le cambia la identidad al `useMemo` de abajo en cada uno.
    const branches = useStaff((s) => s.branches ?? VACIO);
    const showToast = useToastStore((s) => s.showToast);

    const [cajas, setCajas] = useState([]);
    const [cola, setCola] = useState([]);
    const [sala, setSala] = useState('');
    const [nombre, setNombre] = useState('');
    const [nueva, setNueva] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [aBorrar, setABorrar] = useState(null);
    const [borrando, setBorrando] = useState(false);
    const [publicada, setPublicada] = useState(null);
    const [falloLaLista, setFalloLaLista] = useState(null);

    const cargar = useCallback(async () => {
        const { cajas: filas, error } = await fetchCajasDeImpresion();
        setCajas(filas);
        setFalloLaLista(error || null);
        setCola(await fetchColaDeImpresion({ limite: 15 }));
        setPublicada(await fetchVersionPublicadaDelAgente());
    }, []);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

    const nombreSala = useMemo(
        () => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches],
    );

    const registrar = useCallback(async () => {
        if (!sala || !nombre.trim() || guardando) return;
        setGuardando(true);
        const { data, error } = await crearCodigoDeVinculacion({
            branchId: Number(sala), nombre: nombre.trim(),
        });
        setGuardando(false);
        if (error) {
            showToast?.('No se pudo generar el código', mensajeAmigable(error, 'Vuelve a intentar.'), 'error');
            return;
        }
        setNueva(data?.[0] || null);
        setNombre('');
        cargar();
    }, [sala, nombre, guardando, showToast, cargar]);

    const copiar = useCallback(async (texto) => {
        try {
            await navigator.clipboard.writeText(texto);
            showToast?.('Copiado', 'Pégalo en la computadora de esa caja.', 'success');
        } catch {
            showToast?.('No se pudo copiar', 'Selecciónalo y cópialo a mano.', 'error');
        }
    }, [showToast]);

    const borrar = useCallback(async () => {
        if (!aBorrar || borrando) return;
        setBorrando(true);
        const { data, error } = await eliminarCajaDeImpresion(aBorrar.id);
        setBorrando(false);
        if (error) {
            showToast?.('No se pudo quitar', mensajeAmigable(error, 'Vuelve a intentar.'), 'error');
            return;
        }
        // Sacar una caja deja una sala sin dónde imprimir si era la única, así
        // que queda en la bitácora con su sala y su nombre — no alcanza con el
        // id de una fila que ya no existe.
        useStaff.getState().appendAuditLog('IMPRESION_CAJA_ELIMINADA', String(aBorrar.branch_id), {
            caja: data || aBorrar.nombre,
            sala: nombreSala[aBorrar.branch_id] || aBorrar.branch_id,
            equipo: aBorrar.equipo,
        });
        showToast?.('Caja quitada', `Ya no aparece «${data || aBorrar.nombre}».`, 'success');
        setABorrar(null);
        cargar();
    }, [aBorrar, borrando, nombreSala, showToast, cargar]);

    return (
        <div className="space-y-4">
            {nueva && (
                <Notice variant="success" icon={CheckCircle2}>
                    <span className="font-bold">Escribe este código en la computadora de la caja</span>
                    {/* El código es lo ÚNICO que se transcribe, así que se pinta
                        grande, espaciado y partido en dos mitades: es la forma
                        de que no se lea mal desde el otro lado del mostrador. */}
                    <span className="block my-2 font-mono text-title font-black tracking-[0.2em] text-content select-all">
                        {nueva.codigo.slice(0, 4)}-{nueva.codigo.slice(4)}
                    </span>
                    <span className="block font-normal text-content-2">
                        En esa computadora, abre una terminal y escribe{' '}
                        <code>bash instalar.sh</code>. Te va a pedir este código.
                        {' '}<strong>Dura 15 minutos</strong> y se usa una sola vez.
                    </span>
                    <span className="flex gap-2 mt-2">
                        <Button size="sm" variant="secondary" icon={Copy}
                            onClick={() => copiar(nueva.codigo)}>
                            Copiar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setNueva(null)}>
                            Listo
                        </Button>
                    </span>
                </Notice>
            )}

            {falloLaLista && (
                <Notice variant="danger" icon={AlertTriangle}>
                    <span className="font-bold">No se pudo leer la lista de cajas</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Esto NO significa que no haya ninguna: significa que la consulta falló.
                        Las cajas registradas pueden estar imprimiendo igual.
                        {' '}<span className="text-content-3">{mensajeAmigable(falloLaLista, '')}</span>
                    </span>
                </Notice>
            )}

            {!cajas.length && !falloLaLista && (
                <Notice variant="info" icon={Printer}>
                    <span className="font-bold">Ninguna sala imprime todavía</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Sin una caja registrada, un documento que se manda desde el teléfono o
                        desde la oficina no tiene dónde salir. La instalación está en
                        <code> scripts/agente-impresion/README.md</code>.
                    </span>
                </Notice>
            )}

            {cajas.some((c) => estadoDelAgente(c, publicada)?.mal) && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-bold">Hay cajas que hay que poner al día</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        En la computadora de esa caja, abre una terminal y pega esta línea. No
                        pide nada más y no cambia la configuración de la caja — sólo el programa.
                        Después de esto, cada caja se actualiza sola.
                    </span>
                    <code className="block mt-2 p-2 text-caption break-all bg-surface-card-hover border border-border-card">
                        {LINEA_DE_ACTUALIZAR}
                    </code>
                    <span className="flex gap-2 mt-2">
                        <Button size="sm" variant="secondary" icon={Copy}
                            onClick={() => copiar(LINEA_DE_ACTUALIZAR)}>
                            Copiar la línea
                        </Button>
                    </span>
                </Notice>
            )}

            {cajas.map((c) => {
                // «Sin instalar» y «no contesta» son cosas distintas: la primera
                // es un código que nadie canjeó, la segunda una caja apagada. Un
                // solo texto para las dos mandaría a revisar el lugar equivocado.
                const latido = c.vinculada_at
                    ? haceCuanto(c.ultimo_latido)
                    : { txt: 'sin instalar', vivo: false };
                const agente = estadoDelAgente(c, publicada);
                return (
                    <div key={c.id} data-surface="card" className="p-3 flex items-center gap-3 flex-wrap">
                        <Printer size={16} className="text-content-3 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="text-label font-bold text-content truncate">{c.nombre}</p>
                            <p className="text-caption text-content-3 truncate">
                                {nombreSala[c.branch_id] || `Sucursal ${c.branch_id}`} · {c.impresora}
                            </p>
                            {agente && (
                                <p className={`text-caption truncate ${agente.mal ? 'text-danger-text font-bold' : 'text-content-3'}`}>
                                    {agente.txt}
                                </p>
                            )}
                        </div>
                        <span className={`text-caption font-bold shrink-0 ${latido.vivo ? 'text-success-text' : 'text-content-3'}`}>
                            {latido.txt}
                        </span>
                        {puedeEditar && (
                            <Button
                                variant="ghost" size="sm" icon={Trash2} iconOnly
                                aria-label={`Quitar ${c.nombre}`}
                                onClick={() => setABorrar(c)}
                            />
                        )}
                    </div>
                );
            })}

            {puedeEditar && (
                <div data-surface="card" className="p-3 space-y-3">
                    <p className="text-label font-bold text-content">Agregar una caja</p>
                    <LiquidSelect
                        value={sala} onChange={setSala}
                        options={branches.map((b) => ({ value: String(b.id), label: b.name }))}
                        placeholder="¿De qué sala es?" ariaLabel="Sucursal de la caja"
                    />
                    <PortalInput
                        label="Nombre" name="nombre" value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        placeholder="Caja Salud 3"
                    />
                    {/* La ticketera NO se pregunta acá: la encuentra el
                        instalador mirando la propia computadora. Preguntarla
                        desde el portal era pedir un dato que quien está frente
                        a esta pantalla no tiene por qué saber. */}
                    <Button variant="primary" size="sm" icon={Plus} loading={guardando}
                        disabled={!sala || !nombre.trim()} onClick={registrar}>
                        Generar el código
                    </Button>
                </div>
            )}

            {cola.length > 0 && (
                <div data-surface="card" className="p-3">
                    <p className="text-label font-bold text-content mb-2">Lo último que se mandó</p>
                    <div className="space-y-1.5">
                        {cola.map((j) => {
                            const e = ESTADOS[j.estado] || ESTADOS.PENDIENTE;
                            const Icono = e.icon;
                            return (
                                <div key={j.id} className="flex items-center gap-2 text-caption">
                                    <Icono size={13} className={`${e.clase} shrink-0`} />
                                    <span className="text-content truncate flex-1">{j.titulo}</span>
                                    <span className="text-content-3 truncate shrink-0">
                                        {nombreSala[j.branch_id] || j.branch_id}
                                    </span>
                                    <span className={`${e.clase} font-bold shrink-0`}>{e.txt}</span>
                                </div>
                            );
                        })}
                    </div>
                    {/* El error se muestra entero: es lo único que dice por qué no
                        salió el papel, y es exactamente lo que hasta ahora no se
                        podía saber desde el portal. */}
                    {cola.filter((j) => j.error).slice(0, 2).map((j) => (
                        <p key={`e-${j.id}`} className="text-caption text-danger-text mt-2 break-words">
                            {j.titulo}: {j.error}
                        </p>
                    ))}
                </div>
            )}

            {/* El aviso cambia según lo que esa caja esté haciendo AHORA: quitar
                una que nunca dio señales es limpiar la lista, y quitar la que
                está imprimiendo deja a esa sala sin dónde salir el papel. Un
                solo texto para las dos cosas haría que la segunda se apruebe con
                la confianza de la primera. */}
            <ConfirmModal
                isOpen={!!aBorrar}
                onClose={() => (borrando ? null : setABorrar(null))}
                onConfirm={borrar}
                title={`¿Quitar «${aBorrar?.nombre ?? ''}»?`}
                message={
                    aBorrar?.ultimo_latido
                        ? `Esta caja está contestando: ${nombreSala[aBorrar.branch_id] || 'esa sala'} `
                          + 'deja de recibir papel hasta que la vuelvas a instalar. '
                          + 'Lo que ya se imprimió por ella se conserva.'
                        : 'Nunca dio señales de vida, así que no está imprimiendo nada. '
                          + 'Desaparece de la lista y no se puede deshacer.'
                }
                confirmText="Sí, quitar"
                isProcessing={borrando}
            />
        </div>
    );
}
