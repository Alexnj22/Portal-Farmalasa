import React, { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Droplets, Thermometer } from 'lucide-react';
import Button from '../common/Button';
import LiquidModal from '../common/LiquidModal';
import Notice from '../common/Notice';
import PortalInput from '../common/PortalInput';
import PortalTextarea from '../common/PortalTextarea';
import { corregirLectura, registrarLectura, rotularRango } from '../../data/bitacoras';

// ═══════════════════════════════════════════════════════════════════════════
// Anotar —o corregir— una lectura.
//
// ── El fuera de rango se avisa acá, pero lo DECIDE la base ─────────────────
// La pantalla compara contra el rango del área para poder pedir la acción
// correctiva antes de mandar; el `fuera_de_rango` que se guarda lo calcula el
// RPC contra la misma configuración. Si esto fuera la única comprobación,
// alcanzaría con abrir la consola para guardar un 35 °C como si estuviera bien.
//
// ── Corregir AGREGA, nunca pisa ────────────────────────────────────────────
// Por eso la corrección exige motivo y el formulario lo dice: el valor viejo no
// se pierde, queda al lado del nuevo. Es el «control de correcciones» que pide
// el ítem 3.7 de la guía, y es lo que hace que el libro digital valga tanto
// como el de papel foliado.
// ═══════════════════════════════════════════════════════════════════════════

const hhmm = (t) => String(t || '').slice(0, 5);

export default function AnotarLectura({ area, franja, lectura, fecha, valores, onCerrar }) {
    const corrigiendo = Boolean(lectura);

    // `valores` llega cuando el diálogo se abre DESDE la grilla porque la
    // temperatura tecleada ahí quedó fuera de rango: lo escrito viaja con él en
    // vez de perderse. Sin esto, la persona teclea 33.5, el portal le dice que
    // hay que anotar qué se hizo, y le pide el número otra vez.
    const [temp, setTemp]       = useState(() => valores?.temp
        ?? (lectura?.temperatura != null ? String(Number(lectura.temperatura)) : ''));
    const [hum, setHum]         = useState(() => valores?.hum
        ?? (lectura?.humedad != null ? String(Number(lectura.humedad)) : ''));
    const [accion, setAccion]   = useState(() => lectura?.accion_correctiva || '');
    const [motivo, setMotivo]   = useState('');
    const [guardando, setGuardando] = useState(false);
    const [error, setError]     = useState(null);

    const tempNum = temp === '' ? null : Number(temp);

    const fueraDeRango = useMemo(() => {
        if (tempNum === null || Number.isNaN(tempNum)) return false;
        const min = area.temp_min == null ? null : Number(area.temp_min);
        const max = area.temp_max == null ? null : Number(area.temp_max);
        return (min !== null && tempNum < min) || (max !== null && tempNum > max);
    }, [tempNum, area.temp_min, area.temp_max]);

    const faltaAccion = fueraDeRango && !accion.trim();
    const faltaMotivo = corrigiendo && !motivo.trim();
    const sinTemp     = tempNum === null || Number.isNaN(tempNum);

    const guardar = useCallback(async () => {
        setError(null);
        setGuardando(true);
        const res = corrigiendo
            ? await corregirLectura({
                lecturaId: lectura.id, temperatura: tempNum,
                humedad: area.mide_humedad ? hum : null, accion, motivo,
            })
            : await registrarLectura({
                areaId: area.id, fecha, franja: franja.clave,
                temperatura: tempNum, humedad: area.mide_humedad ? hum : null, accion,
            });
        setGuardando(false);
        if (res.error) { setError(res.error); return; }
        onCerrar(true);
    }, [corrigiendo, lectura, tempNum, area, hum, accion, motivo, fecha, franja, onCerrar]);

    return (
        <LiquidModal open onClose={guardando ? undefined : () => onCerrar(false)}
            maxWidth="max-w-md" className="h-fit"
            ariaLabel={corrigiendo ? 'Corregir la lectura' : 'Anotar la lectura'}>
            <LiquidModal.Header>
                <div className="min-w-0">
                    <h3 className="text-body font-bold text-content">
                        {corrigiendo ? 'Corregir la lectura' : 'Anotar la lectura'}
                    </h3>
                    <p className="text-caption text-content-3 truncate">
                        {area.nombre} · {franja.label} ({hhmm(franja.desde)}–{hhmm(franja.hasta)}) · {rotularRango(area)}
                    </p>
                </div>
            </LiquidModal.Header>

            <LiquidModal.Body className="space-y-4">
                {corrigiendo && (
                    <Notice variant="info" compact>
                        <span className="font-bold">El valor anterior no se borra.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Queda junto al nuevo, con tu nombre y el motivo.
                        </span>
                    </Notice>
                )}

                {/* ── Dos campos en una fila, con el rótulo de la COLUMNA ──────
                    Antes cada campo llevaba su etiqueta larga («HUMEDAD (% HR)»
                    con «INFORMATIVA» al lado), que en un diálogo angosto se
                    partía en dos renglones y dejaba los dos campos a distinta
                    altura. El rótulo corto arriba de la columna dice lo mismo,
                    entra siempre en una línea, y de paso los alinea con la
                    ronda — que es la otra pantalla donde se anota esto mismo.

                    `type="text"` con máscara DECIMAL, NUNCA `type="number"`: el
                    campo numérico del navegador se traga la coma sin avisar y
                    «24,9» entraba como 249 °C. Está medido. */}
                <div className={`grid gap-3 ${area.mide_humedad ? 'grid-cols-2' : 'grid-cols-1'}`}>
                    <div className="space-y-1.5">
                        <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                            Temperatura °C
                        </p>
                        <PortalInput
                            name="temperatura" type="text" inputMode="decimal" maskType="DECIMAL"
                            icon={Thermometer} required aria-label="Temperatura en grados"
                            value={temp} onChange={(e) => setTemp(e.target.value)}
                            inputClassName="tabular-nums" hasError={fueraDeRango}
                        />
                    </div>
                    {area.mide_humedad && (
                        <div className="space-y-1.5">
                            <p className="text-caption font-black uppercase tracking-widest text-content-3 ml-1">
                                Humedad % HR
                            </p>
                            <PortalInput
                                name="humedad" type="text" inputMode="decimal" maskType="DECIMAL"
                                icon={Droplets} aria-label="Humedad relativa en porcentaje"
                                value={hum} onChange={(e) => setHum(e.target.value)}
                                inputClassName="tabular-nums"
                            />
                            {/* La norma la pide informativa (RTS 6.2.16): no tiene
                                rango que cumplir, y decirlo evita que alguien
                                crea que una humedad alta invalida la lectura. */}
                            <p className="text-label text-content-3 ml-1">Informativa</p>
                        </div>
                    )}
                </div>

                {fueraDeRango && (
                    <>
                        <Notice variant="danger" compact icon={AlertTriangle}>
                            <span className="font-bold">Fuera del rango de {rotularRango(area)}.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                Hay que anotar qué se hizo: una lectura fuera de rango sin acción al
                                lado prueba que se vio y no se actuó.
                            </span>
                        </Notice>
                        <PortalTextarea
                            label="Qué se hizo" name="accion" required
                            value={accion} onChange={(e) => setAccion(e.target.value)}
                            rows={2} compact
                            placeholder="Se encendió el aire y se bajó la persiana. Recontrolado a las 13:40 en 28.1 °C."
                        />
                    </>
                )}

                {corrigiendo && (
                    <PortalTextarea
                        label="Motivo de la corrección" name="motivo" required
                        value={motivo} onChange={(e) => setMotivo(e.target.value)}
                        rows={2} compact
                        placeholder="Se anotó 26 en vez de 28 por error de tipeo."
                    />
                )}

                {error && <Notice variant="danger" icon={AlertTriangle}>{error}</Notice>}
            </LiquidModal.Body>

            <LiquidModal.Footer>
                <Button variant="ghost" onClick={() => onCerrar(false)} disabled={guardando}>
                    Cancelar
                </Button>
                <Button variant="primary" onClick={guardar} loading={guardando}
                    disabled={sinTemp || faltaAccion || faltaMotivo}>
                    {corrigiendo ? 'Guardar la corrección' : 'Anotar'}
                </Button>
            </LiquidModal.Footer>
        </LiquidModal>
    );
}
