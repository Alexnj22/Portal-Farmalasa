import React, { useState } from 'react';
import { Loader2, PackageCheck } from 'lucide-react';
import Button from '../../components/common/Button';
import { recibirTraslado } from '../../data/traslados';

// Las hermanas de una misma solicitud, juntas.
//
// Cuando alguien pide en una sola vez a tres salas, salen tres solicitudes —cada
// sala ve y contesta sólo lo suyo— y del lado de quien pidió eso se veía como
// tres cosas sin relación. Pedido del usuario, 2026-08-20: *«para la sala de
// origen de la solicitud, si lo puede ver de alguna manera conectado, para
// entender que fue una sola solicitud»*.
//
// ── Lo que este encabezado dice y una tarjeta sola no puede ────────────────
// Cuántas salas contestaron. Las que NO contestaron no están en esta lista —la
// lista es de lo que ya salió—, así que el dato no se puede contar acá: sale de
// `fetchEstadoDeGrupos`, que trae el grupo entero.
//
// Y no se resume en un solo estado a propósito: Salud 1 te mandó, Salud 2 te
// rechazó y Salud 3 todavía no abrió. Un estado único tendría que mentir sobre
// dos de las tres.

/**
 * @param grupo  El estado del grupo entero (de `fetchEstadoDeGrupos`).
 * @param filas  Las hermanas que están EN ESTA lista, o sea las que se ven.
 * @param onHecho Recargar, cuando algo se recibió.
 */
export default function GrupoPorRecibir({ grupo, filas, onHecho, children }) {
    const [ocupado, setOcupado] = useState(false);
    const [avance,  setAvance]  = useState(null);   // { hechas, total, sala }
    const [error,   setError]   = useState('');

    const salas = grupo?.total ?? filas.length;
    const contestaron = salas - (grupo?.sinResponder ?? 0);

    /* El botón de una sola vez aparece cuando ya contestaron TODAS y hay más de
     * una caja esperando. Con una sola no agrega nada —el botón de la tarjeta
     * hace lo mismo— y con alguna sala todavía sin contestar sería «recibir
     * todo» sobre un todo que aún no está. */
    const puedeTodas = (grupo?.sinResponder ?? 0) === 0 && filas.length > 1;

    /* ── Va de una en una, por dentro ──────────────────────────────────────
     *
     * Cada recepción es un viaje al sistema de origen con su propia sesión de
     * esa sucursal, y las tres juntas en un solo viaje no entran en el tiempo
     * que tiene una llamada. Así que se aprieta una vez y se ven pasar: si una
     * falla, las anteriores YA quedaron recibidas y se reintenta sólo la que
     * falló, con el botón de su propia tarjeta.
     */
    const recibirTodas = async () => {
        setError(''); setOcupado(true);
        let hechas = 0;
        for (const f of filas) {
            setAvance({ hechas, total: filas.length, sala: f.metadata?.origen_branch_name ?? 'la otra sala' });
            const r = await recibirTraslado(f.id);
            if (!r?.ok) {
                setError(
                    `Entraron ${hechas} de ${filas.length}. `
                    + `${f.metadata?.origen_branch_name ?? 'Una sala'}: ${r?.error ?? 'no se pudo recibir'}. `
                    + 'Vuelve a intentar sólo esa desde su tarjeta.',
                );
                break;
            }
            hechas += 1;
        }
        setOcupado(false); setAvance(null);
        if (hechas > 0) onHecho?.();
    };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2 px-1 flex-wrap">
                <p className="text-micro font-black text-content-2 uppercase tracking-widest">
                    Lo pediste a {salas} salas
                </p>
                <p className="text-micro text-content-3">
                    {grupo?.sinResponder > 0
                        ? `${contestaron} de ${salas} respondieron · ${grupo.sinResponder} sin responder`
                        : `las ${salas} respondieron`}
                    {grupo?.rechazadas > 0 && ` · ${grupo.rechazadas} no pudo mandarlo`}
                </p>
            </div>

            {children}

            {/* ── Confirmar todo, con lo que está confirmando A LA VISTA ─────
                El botón va DEBAJO de las tarjetas y no arriba, y eso es toda la
                regla: recibir es decir «esto llegó y lo conté», así que lo que
                se confirma tiene que haberse podido leer antes de apretar. Un
                botón que acepta tres cajas sin que se haya visto ninguna es el
                mismo problema del motivo de rechazo que venía elegido de
                fábrica —6 de 8 rechazos decían el primero de la lista porque
                nadie lo eligió—. */}
            {puedeTodas && (
                <div className="px-1">
                    <Button size="sm" icon={PackageCheck} disabled={ocupado} onClick={recibirTodas}>
                        {ocupado && <Loader2 size={13} className="animate-spin" />}
                        {avance
                            ? `Recibiendo ${avance.sala}… (${avance.hechas} de ${avance.total})`
                            : `Ya llegaron las ${filas.length}`}
                    </Button>
                </div>
            )}

            {error && <p className="text-micro text-danger-text font-medium px-1 leading-snug">{error}</p>}
        </div>
    );
}
