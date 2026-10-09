import React, { useState } from 'react';
import { Droplet } from 'lucide-react';
import Button from '../../components/common/Button';
import LiquidModal from '../../components/common/LiquidModal';
import PortalInput from '../../components/common/PortalInput';
import { aplicacionesPorDosis, fmtMl } from '@nucleo/utils/inyeccionDosis';
import { CASILLAS_DE_DOSIS as CASILLAS, leerMililitros } from '@nucleo/utils/inyeccionesAjustes';

/*
 * Contar un producto por mililitros (2026-10-03).
 *
 * Pedido del usuario sobre RUBRAVIDA: «el vial viene x 10 ml, normalmente se
 * ponen 2 ml por aplicación o 2.5; que se pueda asignar y preguntar». Acá se
 * declara lo que trae una unidad y hasta cuatro dosis; al cobrar se elige una
 * y salen las aplicaciones (10 ml a 2.5 → 4).
 *
 * Cuatro casillas fijas y no una lista libre separada por comas: en español
 * «2,5» es un número, y una coma que separa y otra que es decimal no se pueden
 * distinguir.
 */
export default function MililitrosModal({ fila, guardando, onGuardar, onQuitar, onClose }) {
    const [contenido, setContenido] = useState(fila.contenido_ml != null ? fmtMl(fila.contenido_ml) : '');
    const [dosis, setDosis] = useState(() => {
        const d = (fila.opciones_ml || []).map(fmtMl);
        return [...d, ...Array(CASILLAS).fill('')].slice(0, CASILLAS);
    });

    const { c, lista, valido } = leerMililitros(contenido, dosis);

    return (
        <LiquidModal open onClose={guardando ? undefined : onClose} maxWidth="max-w-md" ariaLabel="Contar por mililitros">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="text-h3 font-bold text-content">Contar por mililitros</h3>
                    <p className="text-body-sm text-content-2 mt-1">{fila.descripcion}</p>
                </div>
                <PortalInput label="Cuánto trae una unidad (ml)" name="ml_contenido" inputMode="decimal" icon={Droplet}
                    value={contenido} onChange={(e) => setContenido(e.target.value)} placeholder="10" />
                <div className="space-y-2">
                    <p className="text-body-sm text-content-2">Cuánto se pone por aplicación (ml). Al cobrar se elige una.</p>
                    <div className="grid grid-cols-4 gap-2">
                        {dosis.map((d, i) => (
                            <PortalInput key={i} label={`Dosis ${i + 1}`} name={`ml_dosis_${i + 1}`} inputMode="decimal" value={d}
                                placeholder={i === 0 ? '2' : i === 1 ? '2.5' : ''}
                                onChange={(e) => setDosis((x) => x.map((v, j) => (j === i ? e.target.value : v)))} />
                        ))}
                    </div>
                </div>
                {c != null && lista.length > 0 && (
                    <ul data-surface="card" className="rounded-xl p-3 space-y-1">
                        {lista.map((d) => (
                            <li key={d} className="flex justify-between text-body-sm">
                                <span className="text-content-2">{fmtMl(d)} ml</span>
                                <span className={d > c ? 'text-danger font-semibold' : 'font-black text-content'}>
                                    {d > c ? `pasa de ${fmtMl(c)} ml` : `${aplicacionesPorDosis(c, d)} aplicaciones por unidad`}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex flex-wrap justify-between gap-2">
                    {fila.contenido_ml != null ? (
                        <Button variant="ghost" disabled={guardando} onClick={onQuitar}
                            title="Vuelve a contar un número fijo de aplicaciones por unidad">
                            Dejar de contar por ml
                        </Button>
                    ) : <span />}
                    <div className="flex gap-2">
                        <Button variant="ghost" onClick={onClose} disabled={guardando}>Cancelar</Button>
                        <Button variant="primary" loading={guardando} disabled={!valido}
                            onClick={() => onGuardar({ contenidoMl: c, dosisMl: lista })}>
                            Guardar
                        </Button>
                    </div>
                </div>
            </div>
        </LiquidModal>
    );
}
