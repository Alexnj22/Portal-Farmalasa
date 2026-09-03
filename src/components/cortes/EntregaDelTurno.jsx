import React from 'react';
import { ArrowDown, ArrowRight, UserX } from 'lucide-react';
import AvatarConEstado from '../common/AvatarConEstado';
import { shortEmployeeName } from '../../utils/nameUtils';

/**
 * EN MANOS DE QUIÉN QUEDÓ LA CAJA — con la cara, no con un nombre suelto.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * Desde v2.964.0 confirmar un corte pide quién recibe la caja: ese clic cierra
 * el turno, así que es el momento en que el dinero cambia de manos. El dato se
 * pedía, se firmaba con carné y se guardaba… y en «Hoy» —la pantalla donde
 * trabaja la sala— **no se veía en ninguna parte**. Lo reportó el usuario el
 * 3-sep («en ningún lado me sale quién recibe»).
 *
 * El primer intento lo metió en la cuarta tarjeta del carril y el usuario lo
 * rechazó: *«quiero algo más moderno, más visual, con la foto»*. Y la forma
 * estaba mal por dos razones medibles, no de gusto:
 *
 *   · una tarjeta del carril mide 148–200px y ahí no entra una cara ni un
 *     nombre completo — el texto trunca, que es justo «no me sale quién
 *     recibe» otra vez;
 *   · bajo el rótulo «Confirmado», el nombre de quien recibe se lee como el de
 *     quien confirmó, y son dos personas distintas a propósito (el servidor
 *     rechaza que quien hizo el corte reciba su propia caja).
 *
 * ── La entrega se DIBUJA como lo que es: un traspaso ──────────────────────
 * Dos caras y una flecha. El acto tiene dos lados y el portal ya lo dice así
 * en la tarjeta del corte (`hizo → recibe`); acá esa flecha se pinta. Quien
 * recibe va en verde y a la derecha —es quien se hace cargo del efectivo desde
 * ese momento, o sea la respuesta a «¿quién tiene la caja ahora?»—.
 *
 * ── Y cuando NO la recibió nadie, se dibuja igual ─────────────────────────
 * Con el hueco a la vista: un círculo punteado en ámbar y el motivo escrito.
 * Es la mitad «avisar» de la decisión del usuario (3-sep: «avisar primero,
 * medir, después bloquear»), y un aviso que se esconde cuando la respuesta es
 * la mala no es un aviso. El último corte del día NO llega acá — ahí no hay a
 * quién entregarle; lo filtra quien elige el corte.
 *
 * ── La foto la resuelve el avatar, no este componente ─────────────────────
 * `AvatarConEstado` busca la ficha por `id` en el padrón cuando el objeto no
 * trae retrato, así que alcanza con `{ id, name }`. Lo que NO se puede hacer
 * es pasarle sólo el nombre: sin id no hay a quién buscar y dibuja la inicial,
 * que es indistinguible de una persona sin foto. Ver
 * [[feedback_el_arreglo_de_un_canonico_no_llega_a_su_gemelo]] y el encabezado
 * de `AvatarConEstado`.
 */
export default function EntregaDelTurno({ corte, personas }) {
    if (!corte) return null;

    const recibida = corte.entrega === 'RECIBIDO';

    /* La ficha completa si el padrón la trajo —ahí `photo` viene FIRMADA— y si
     * no, lo que la propia fila del corte sabe. Sin `id` no se arma nada: un
     * objeto con nombre y sin id pinta la inicial en silencio. */
    const ficha = (id, nombre) => (id ? (personas?.get(id) || { id, name: nombre || '' }) : null);

    /* Quien ENTREGA es quien tenía la caja: el que hizo el corte. Cuando el
     * corte se hizo desde la pantalla de la caja esa fila no existe, y ahí el
     * lado izquierdo es quien lo confirmó — con su propio rótulo, porque
     * llamar «entregó» a quien sólo firmó sería nombrar un acto que no hizo. */
    const izquierda = ficha(corte.employee_id, corte.hizo?.name)
        ? { emp: ficha(corte.employee_id, corte.hizo?.name), rotulo: 'Entregó' }
        : ficha(corte.resuelto_por, null)
            ? { emp: ficha(corte.resuelto_por, null), rotulo: 'Confirmó' }
            : null;

    const derecha = recibida ? ficha(corte.recibido_por, corte.recibe?.name) : null;

    // Sin ninguno de los dos lados no hay traspaso que contar.
    if (!izquierda && !derecha) return null;

    const hora = String(corte.hora || '').slice(0, 5);

    return (
        <div data-surface="card" className="rounded-2xl px-4 py-3 space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <h3 className="text-micro font-black uppercase tracking-widest text-content-3">
                    La caja de este turno
                </h3>
                {hora && (
                    <span className="text-micro text-content-3 tabular-nums">
                        se entregó en el corte de las {hora}
                    </span>
                )}
            </div>

            {/* Los dos lados se JUNTAN, no se reparten la fila. Con `flex-1`
                cada uno se llevaba media pantalla y en un monitor ancho las dos
                caras quedaban a 800px una de la otra: un traspaso dibujado así
                deja de leerse como un traspaso. Pegados, la flecha hace el
                trabajo que le toca.

                En el teléfono se apila con la flecha hacia abajo: dos caras y
                dos nombres miden ~356px y no entran en 340 sin cortar el
                nombre, que es el dato. */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                {izquierda && <Persona emp={izquierda.emp} rotulo={izquierda.rotulo} />}

                <div className={`shrink-0 self-start sm:self-center ml-5 sm:ml-0
                    w-7 h-7 rounded-full flex items-center justify-center
                    ${recibida ? 'bg-success/15 text-success-text' : 'bg-warning/15 text-warning-text'}`}>
                    <ArrowDown size={15} strokeWidth={2.5} className="sm:hidden" />
                    <ArrowRight size={15} strokeWidth={2.5} className="hidden sm:block" />
                </div>

                {recibida
                    ? <Persona emp={derecha} rotulo="Recibió la caja" destacada />
                    : <SinRecibir motivo={corte.sin_entrega_motivo} />}
            </div>
        </div>
    );
}

function Persona({ emp, rotulo, destacada = false }) {
    return (
        <div className="flex items-center gap-2.5 min-w-0">
            <AvatarConEstado emp={emp} px={36} radio="rounded-full"
                marco="border-2 border-border-card" className="shadow-sm shrink-0" />
            <div className="min-w-0">
                <p className={`text-micro font-bold ${destacada ? 'text-success-text' : 'text-content-3'}`}>
                    {rotulo}
                </p>
                {/* El nombre CORTO, el mismo del resto del portal: la caja
                    escribe «RODRIGO EDUARDO MARQUEZ» y truncado se pierde el
                    apellido, que es lo que distingue a dos Rodrigos. */}
                <p className={`text-body-sm font-bold truncate leading-tight ${destacada ? 'text-success-text' : 'text-content'}`}
                    title={emp?.name || undefined}>
                    {shortEmployeeName(emp)}
                </p>
            </div>
        </div>
    );
}

function SinRecibir({ motivo }) {
    return (
        <div className="flex items-center gap-2.5 min-w-0">
            {/* Punteado y vacío: el hueco ES el dato. Un avatar gris se leería
                como una persona que no tiene foto. */}
            <div className="w-9 h-9 rounded-full shrink-0 border-2 border-dashed border-warning/60
                flex items-center justify-center">
                <UserX size={16} strokeWidth={2} className="text-warning-text" />
            </div>
            <div className="min-w-0">
                <p className="text-micro font-bold text-warning-text">Nadie la recibió</p>
                <p className="text-body-sm text-content-2 truncate leading-tight" title={motivo || undefined}>
                    {motivo || 'se confirmó sin entregar la caja'}
                </p>
            </div>
        </div>
    );
}
