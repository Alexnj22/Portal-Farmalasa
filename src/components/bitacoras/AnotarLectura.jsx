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

export default function AnotarLectura({ area, franja, lectura, fecha, onCerrar }) {
    const corrigiendo = Boolean(lectura);

    const [temp, setTemp]       = useState(() => (lectura?.temperatura != null ? String(Number(lectura.temperatura)) : ''));
    const [hum, setHum]         = useState(() => (lectura?.humedad != null ? String(Number(lectura.humedad)) : ''));
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
                    <Notice variant="info">
                        <span className="font-bold">El valor anterior no se borra.</span>
                        <span className="block mt-0.5 font-normal text-content-2">
                            Queda registrado junto al nuevo, con tu nombre y el motivo del cambio.
                        </span>
                    </Notice>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* `alto` es la variante para llenar DE PIE con una mano —
                        que es exactamente esto: se lee el termohigrómetro
                        mirando el aparato, no la pantalla. */}
                    <PortalInput
                        label="Temperatura (°C)" name="temperatura" type="number" inputMode="decimal"
                        step="0.1" icon={Thermometer} alto required
                        value={temp} onChange={(e) => setTemp(e.target.value)}
                        placeholder="0.0" inputClassName="tabular-nums"
                        hasError={fueraDeRango}
                    />
                    {area.mide_humedad && (
                        <PortalInput
                            label="Humedad (% HR)" name="humedad" type="number" inputMode="decimal"
                            step="1" min="0" max="100" icon={Droplets} alto
                            value={hum} onChange={(e) => setHum(e.target.value)}
                            placeholder="—" inputClassName="tabular-nums"
                            helperText="Informativa"
                        />
                    )}
                </div>

                {fueraDeRango && (
                    <>
                        <Notice variant="danger" icon={AlertTriangle}>
                            <span className="font-bold">Fuera del rango de {rotularRango(area)}.</span>
                            <span className="block mt-0.5 font-normal text-content-2">
                                Hay que anotar qué se hizo. Una lectura fuera de rango sin acción al lado
                                prueba que se vio y no se actuó.
                            </span>
                        </Notice>
                        <PortalTextarea
                            label="Qué se hizo" name="accion" required
                            value={accion} onChange={(e) => setAccion(e.target.value)}
                            rows={3}
                            placeholder="Se encendió el aire acondicionado y se bajó la persiana. Recontrolado a las 13:40 en 28.1 °C."
                        />
                    </>
                )}

                {corrigiendo && (
                    <PortalTextarea
                        label="Motivo de la corrección" name="motivo" required
                        value={motivo} onChange={(e) => setMotivo(e.target.value)}
                        rows={2}
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
