import React, { useMemo, useState } from 'react';
import { PackageX } from 'lucide-react';
import Button from '../../components/common/Button';
import PortalInput from '../../components/common/PortalInput';
import PortalTextarea from '../../components/common/PortalTextarea';

/**
 * «Faltó algo en la bolsa», para la SOLICITUD.
 *
 * ── El agujero que cierra ──────────────────────────────────────────────────
 * Recibir una solicitud era un solo botón: «Sí, llegó completa». Si al abrir la
 * caja faltaba un producto no había dónde decirlo, y no es un detalle: el
 * traslado ya se despachó, así que **el sistema ya le puso el producto a la
 * sala**. El hueco quedaba invisible hasta que alguien lo tropezara en un
 * conteo, semanas después y sin forma de saber en qué viaje se perdió.
 *
 * La función que recibe lo decía en un comentario desde el primer día — «se
 * recibe COMPLETO lo que se despachó: recibir de menos es declarar un faltante,
 * y eso necesita a alguien mirando la caja, no una función» — y nunca hubo
 * dónde ponerlo.
 *
 * ── Y lo que NO hace ───────────────────────────────────────────────────────
 * No recibe de menos. La recepción sigue entrando completa contra el sistema;
 * esto es una DECLARACIÓN que queda anotada con nombre, cantidad, quién la vio
 * y cuándo, y que le avisa el mismo día a la sala que despachó y a supervisión.
 * Corregir las existencias es otro acto y deja su propio rastro.
 *
 * ── Por qué arranca cerrado ────────────────────────────────────────────────
 * El caso normal es que la caja venga completa, y un formulario abierto sobre
 * el camino normal es un formulario que la gente aprende a saltear. Se abre a
 * propósito, que es exactamente lo que quiere decir «vi de menos».
 *
 * @param items  los renglones de la bolsa, `[{ descripcion, cantidad }]` — lo
 *               que VIAJÓ, no lo que se pidió
 * @param valor  `[{ posicion, cantidad, nota }]`, controlado por quien lo usa
 */
export default function DeclararFaltantes({
    items = [], valor = [], onCambio, deshabilitado = false, origen = null,
}) {
    const [abierto, setAbierto] = useState(false);
    const [nota, setNota] = useState('');

    const porPosicion = useMemo(
        () => new Map(valor.map(f => [f.posicion, f])),
        [valor],
    );

    /* Un cambio de cantidad reescribe la lista entera y no la parchea: la lista
     * ES el valor, y mantener dos verdades —un mapa acá y un arreglo afuera—
     * es cómo se termina mandando un faltante que la pantalla ya no muestra. */
    const cambiarCantidad = (posicion, texto) => {
        const limpio = String(texto ?? '').replace(/[^\d]/g, '');
        const n = Number(limpio);
        const resto = valor.filter(f => f.posicion !== posicion);
        // Cero o vacío NO es un faltante de cero: es el renglón que llegó
        // completo, así que sale de la lista. Un cero guardado viajaría al
        // servidor y ahí se descarta igual — mejor no mentirle a la pantalla.
        const siguiente = Number.isFinite(n) && n > 0
            ? [...resto, { posicion, cantidad: n, nota: nota.trim() || null }]
            : resto;
        onCambio?.(siguiente.sort((a, b) => a.posicion - b.posicion));
    };

    // La nota es una sola para toda la bolsa —«llegó abierta», «el motorista
    // dice que se cayó»— y viaja pegada a cada renglón: es la misma explicación
    // y pedirla por producto sería pedir lo mismo tres veces.
    const cambiarNota = (texto) => {
        setNota(texto);
        onCambio?.(valor.map(f => ({ ...f, nota: texto.trim() || null })));
    };

    const cerrar = () => {
        setAbierto(false);
        setNota('');
        onCambio?.([]);
    };

    if (!abierto) {
        return (
            <Button size="xs" variant="ghost" icon={PackageX}
                className="min-h-[var(--tap-min)] self-start"
                disabled={deshabilitado}
                onClick={() => setAbierto(true)}>
                Faltó algo en la bolsa
            </Button>
        );
    }

    return (
        <div data-surface="card" className="px-3 py-2.5 flex flex-col gap-2">
            <p className="text-micro font-black text-content uppercase tracking-wider">
                Qué faltó
            </p>
            <p className="text-micro text-content-3 font-medium leading-snug">
                Escribe cuántos NO venían. El traslado entra igual —el producto ya está a nombre de
                tu sala— y queda anotado para que {origen ?? 'la otra sala'} lo busque hoy.
            </p>

            <div className="flex flex-col gap-1.5">
                {items.map((it, i) => {
                  // La POSICIÓN es el nombre del renglón para todo el circuito
                  // —es el índice dentro de `metadata.items`— y no siempre
                  // coincide con el lugar en esta lista. Se toma de la fila
                  // cuando la trae; el índice es sólo el respaldo.
                  const pos = it?.posicion ?? it?.idx ?? i;
                  return (
                    <div key={i} className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                            <p className="text-micro font-black text-content leading-snug truncate"
                                title={it?.descripcion ?? it?.nombre}>
                                {it?.descripcion ?? it?.nombre ?? `Producto ${i + 1}`}
                            </p>
                            <p className="text-micro text-content-3 font-semibold">
                                venían {it?.cantidad ?? 0}
                            </p>
                        </div>
                        {/* `inputMode` numérico y NO `type="number"`: en el
                            teléfono abre el teclado de números igual, y no trae
                            las flechitas ni el desplazamiento de la rueda que
                            cambian una cantidad sin que nadie la escriba. */}
                        <PortalInput
                            name={`falto-${pos}`}
                            value={porPosicion.get(pos)?.cantidad ?? ''}
                            onChange={e => cambiarCantidad(pos, e.target.value)}
                            inputMode="numeric"
                            placeholder="0"
                            aria-label={`Cuántos faltaron de ${it?.descripcion ?? it?.nombre ?? 'este producto'}`}
                            readOnly={deshabilitado}
                            className="w-20"
                        />
                    </div>
                  );
                })}
            </div>

            <PortalTextarea
                rows={2}
                value={nota}
                onChange={e => cambiarNota(e.target.value)}
                placeholder="Qué viste al abrir la caja (opcional)"
                aria-label="Qué viste al abrir la caja"
                readOnly={deshabilitado}
            />

            <Button size="xs" variant="ghost" className="min-h-[var(--tap-min)] self-start"
                disabled={deshabilitado} onClick={cerrar}>
                Llegó completa, olvidalo
            </Button>
        </div>
    );
}
