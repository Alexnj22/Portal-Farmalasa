import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Copy, Plus, Printer } from 'lucide-react';
import Button from '../common/Button';
import LiquidSelect from '../common/LiquidSelect';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import { fetchCajasDeImpresion, fetchColaDeImpresion, registrarCaja } from '../../data/impresion';
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
    const [impresora, setImpresora] = useState('pos-80');
    const [nueva, setNueva] = useState(null);
    const [guardando, setGuardando] = useState(false);

    const cargar = useCallback(async () => {
        setCajas(await fetchCajasDeImpresion());
        setCola(await fetchColaDeImpresion({ limite: 15 }));
    }, []);

    useEffect(() => { cargar(); }, [cargar]); // eslint-disable-line react-hooks/set-state-in-effect -- carga inicial

    const nombreSala = useMemo(
        () => Object.fromEntries(branches.map((b) => [b.id, b.name])), [branches],
    );

    const registrar = useCallback(async () => {
        if (!sala || !nombre.trim() || guardando) return;
        setGuardando(true);
        const { data, error } = await registrarCaja({
            branchId: Number(sala), nombre: nombre.trim(), impresora: impresora.trim(),
        });
        setGuardando(false);
        if (error) {
            showToast?.('No se pudo registrar', mensajeAmigable(error, 'Vuelve a intentar.'), 'error');
            return;
        }
        setNueva(data?.[0] || null);
        setNombre('');
        cargar();
    }, [sala, nombre, impresora, guardando, showToast, cargar]);

    const copiar = useCallback(async (texto) => {
        try {
            await navigator.clipboard.writeText(texto);
            showToast?.('Copiado', 'Pégalo en el archivo agente.conf de esa caja.', 'success');
        } catch {
            showToast?.('No se pudo copiar', 'Selecciónalo y cópialo a mano.', 'error');
        }
    }, [showToast]);

    return (
        <div className="space-y-4">
            {nueva && (
                <Notice variant="warning" icon={AlertTriangle}>
                    <span className="font-bold">Guarda esto ahora: no se vuelve a mostrar</span>
                    <span className="block mt-1 font-normal text-content-2">
                        Va en el archivo <code>agente.conf</code> de esa computadora.
                    </span>
                    <span className="block mt-2 font-mono text-caption break-all select-all text-content">
                        DEVICE_ID={nueva.id}
                        <br />
                        DEVICE_TOKEN={nueva.token}
                    </span>
                    <span className="flex gap-2 mt-2">
                        <Button size="sm" variant="secondary" icon={Copy}
                            onClick={() => copiar(`DEVICE_ID=${nueva.id}\nDEVICE_TOKEN=${nueva.token}`)}>
                            Copiar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setNueva(null)}>
                            Ya lo guardé
                        </Button>
                    </span>
                </Notice>
            )}

            {!cajas.length && (
                <Notice variant="info" icon={Printer}>
                    <span className="font-bold">Ninguna sala imprime todavía</span>
                    <span className="block mt-0.5 font-normal text-content-2">
                        Sin una caja registrada, un documento que se manda desde el teléfono o
                        desde la oficina no tiene dónde salir. La instalación está en
                        <code> scripts/agente-impresion/README.md</code>.
                    </span>
                </Notice>
            )}

            {cajas.map((c) => {
                const latido = haceCuanto(c.ultimo_latido);
                return (
                    <div key={c.id} data-surface="card" className="p-3 flex items-center gap-3 flex-wrap">
                        <Printer size={16} className="text-content-3 shrink-0" />
                        <div className="min-w-0 flex-1">
                            <p className="text-label font-bold text-content truncate">{c.nombre}</p>
                            <p className="text-caption text-content-3 truncate">
                                {nombreSala[c.branch_id] || `Sucursal ${c.branch_id}`} · {c.impresora}
                            </p>
                        </div>
                        <span className={`text-caption font-bold shrink-0 ${latido.vivo ? 'text-success-text' : 'text-content-3'}`}>
                            {latido.txt}
                        </span>
                    </div>
                );
            })}

            {puedeEditar && (
                <div data-surface="card" className="p-3 space-y-3">
                    <p className="text-label font-bold text-content">Registrar una caja</p>
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
                    <PortalInput
                        label="Cola de impresión (CUPS)" name="impresora" value={impresora}
                        onChange={(e) => setImpresora(e.target.value)}
                        placeholder="pos-80"
                    />
                    <Button variant="primary" size="sm" icon={Plus} loading={guardando}
                        disabled={!sala || !nombre.trim()} onClick={registrar}>
                        Registrar
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
        </div>
    );
}
