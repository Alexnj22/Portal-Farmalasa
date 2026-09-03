import React from 'react';
import { ChevronRight, UserX } from 'lucide-react';
import AvatarConEstado from '../common/AvatarConEstado';
import Badge from '../common/Badge';
import { cadenaDeEntregas } from '../../utils/cortesDiagnostico';
import { shortEmployeeName } from '../../utils/nameUtils';

/**
 * POR QUÉ MANOS PASÓ LA CAJA HOY — con las caras, y en el panel del día.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Desde v2.964.0 confirmar un corte pide quién recibe la caja: ese clic cierra
 * el turno, así que es el momento en que el dinero cambia de manos. El dato se
 * pedía, se firmaba con carné, se guardaba… y en «Hoy» —la pantalla donde
 * trabaja la sala— no se veía en ninguna parte («en ningún lado me sale quién
 * recibe», 3-sep).
 *
 * ── Y por qué NO es una tarjeta propia ────────────────────────────────────
 * Lo fue dos veces y las dos las devolvió el usuario. Primero en el carril
 * (*«quiero algo más visual, con la foto»*: 148–200px no dan para una cara, y
 * bajo el rótulo «Confirmado» el nombre de quien recibe se lee como el de quien
 * confirmó, que es otra persona a propósito). Después como banda propia
 * (*«espacios desperdiciados»*: una caja de ancho completo para una línea de
 * contenido deja ~1400px vacíos en un monitor de 1900).
 *
 * Así que no agrega ninguna caja: es el ENCABEZADO del panel del día, comparte
 * su borde y su relleno, y queda pegado al dinero del turno — que es de lo que
 * la entrega habla. Se eligió sobre otras cuatro maquetas.
 *
 * ── La cadena, que es la respuesta a «¿y si son 3 cortes?» ────────────────
 * Un día de sala no tiene una entrega: tiene tantas como cortes confirmados
 * —Salud 3 llegó a SIETE turnos en un día—. Se dibujan todas, cara y flecha,
 * en el orden en que ocurrieron, y la última va en verde: es quien tiene la
 * caja ahora. Con más de cuatro manos el medio se pliega en un «+N» y quedan la
 * primera y las dos últimas, que son las que alguien busca.
 *
 * La cadena puede tener un SALTO —que A le entregue a B no obliga a que el
 * corte siguiente lo haga B—, y ahí va una separación en vez de una flecha:
 * dibujar `B → C` sobre un traspaso que nadie hizo es una afirmación falsa que
 * no da error. La regla vive en `cadenaDeEntregas`.
 *
 * ── La foto la resuelve el avatar, no este componente ─────────────────────
 * `AvatarConEstado` busca la ficha por `id` en el padrón cuando el objeto no
 * trae retrato, así que alcanza con `{ id, name }`. Lo que NO se puede hacer es
 * pasarle sólo el nombre: sin id dibuja la inicial, que es indistinguible de
 * una persona sin foto. Ver el encabezado de `AvatarConEstado`.
 */
export default function EntregaDelTurno({ entregas, personas }) {
    const nodos = cadenaDeEntregas(entregas);
    if (nodos.length < 2) return null;

    /* La ficha completa si el padrón la trajo —ahí `photo` viene FIRMADA— y si
     * no, lo que la propia fila del corte sabe. */
    const ficha = (n) => (n.id ? (personas?.get(n.id) || { id: n.id, name: n.name }) : null);

    const ultimo = nodos[nodos.length - 1];
    const primero = nodos[0];
    const cuantas = nodos.filter((n) => n.hora).length;

    /* Con más de cuatro manos se pliega el medio. El «+N» no es un adorno:
     * cinco caras de 28px con sus flechas miden 250px y empujan la frase —que
     * es la que contesta— fuera del renglón. */
    const visibles = nodos.length > 4
        ? [nodos[0], { plegado: nodos.length - 3 }, nodos[nodos.length - 2], ultimo]
        : nodos;

    return (
        <div className="flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center gap-0.5 shrink-0">
                    {visibles.map((n, i) => (
                        <React.Fragment key={n.plegado ? 'plegado' : `${n.id || 'hueco'}-${i}`}>
                            {i > 0 && (n.salto
                                /* Un salto NO es una flecha: nadie entregó ahí. El
                                   punto separa sin afirmar un traspaso. */
                                ? <span className="text-content-3 px-1 leading-none" aria-hidden="true">·</span>
                                : <ChevronRight size={13} strokeWidth={2.5} className="text-content-3 shrink-0" />)}
                            {n.plegado
                                ? <Badge variant="neutral" size="sm">+{n.plegado}</Badge>
                                : n.hueco
                                    /* Un hueco es un DIBUJO, no un control: lleva su
                                       nombre accesible y no un `title`, que en un
                                       elemento que no se puede enfocar no existe
                                       para el teclado (§15.10). */
                                    ? <span role="img" aria-label="nadie recibió la caja"
                                        className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center
                                                   border-2 border-dashed border-warning/60">
                                        <UserX size={13} strokeWidth={2} className="text-warning-text" />
                                    </span>
                                    : <AvatarConEstado emp={ficha(n)} px={28} radio="rounded-full"
                                        marco="border-2 border-border-card"
                                        className={`shrink-0 ${n === ultimo ? 'ring-2 ring-success/45' : ''}`} />}
                        </React.Fragment>
                    ))}
                </div>

                <p className="text-body-sm text-content-2 min-w-0">
                    {ultimo.hueco ? (
                        <>
                            <b className="font-bold text-content">{shortEmployeeName(ficha(nodos[nodos.length - 2]))}</b>
                            {' '}confirmó <span className="font-bold text-warning-text">sin entregar la caja</span>
                            {ultimo.motivo ? ` · ${ultimo.motivo}` : ''}
                        </>
                    ) : cuantas > 1 ? (
                        <>
                            La caja pasó por <span className="tabular-nums">{cuantas}</span> manos hoy · ahora la tiene{' '}
                            <b className="font-bold text-success-text">{shortEmployeeName(ficha(ultimo))}</b>
                        </>
                    ) : (
                        <>
                            <b className="font-bold text-content">{shortEmployeeName(ficha(primero))}</b>
                            {' '}le entregó la caja a{' '}
                            <b className="font-bold text-success-text">{shortEmployeeName(ficha(ultimo))}</b>
                        </>
                    )}
                </p>
            </div>

            <span className="text-caption text-content-3 tabular-nums shrink-0">
                {cuantas > 1 ? 'última entrega' : 'corte'} de las {ultimo.hora}
            </span>
        </div>
    );
}
