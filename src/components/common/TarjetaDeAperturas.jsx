import React from 'react';
import { DoorOpen } from 'lucide-react';
import AvatarConEstado from './AvatarConEstado';

/* «Así abrió la mañana», dentro de la campana.
 *
 * Pedido del usuario al ver la primera versión: *«no quiero notificaciones solo
 * de texto, quiero que sean modernas siempre»*. El aviso traía las seis salas
 * en un párrafo —«La Popular 06:53 Andy Mancia · Salud 5 06:54 …»— que se
 * cortaba en el tercer renglón y obligaba a desplegar para ver la última, que
 * es justo la que importa.
 *
 * ── Qué dibuja, y por qué eso ──────────────────────────────────────────────
 * El anillo lleva **cuántas de las seis abrieron**, no un porcentaje: son seis
 * salas y «5 de 6» se lee de un vistazo mientras que «83%» hay que traducirlo.
 * El hueco del arco ES la que falta.
 *
 * Cada renglón se tiñe cuando su hora cruzó **las 7:00**, que es la hora a la
 * que abren. Sin eso la lista es un dato plano: seis horas parecidas donde hay
 * que restar mentalmente para encontrar la que se pasó.
 *
 * ── Los que faltan se nombran en DOS listas ────────────────────────────────
 * «no abrió» y «no se pudo comprobar» son hechos distintos y van con tonos
 * distintos. Sumarlos convertiría un rato del sistema de la caja sin responder
 * en seis salas acusadas de no abrir — la falsa alarma que haría que este aviso
 * se deje de leer.
 *
 * ── `quien` vacío dice «desde la caja», nunca un nombre ────────────────────
 * Cuando el portal no vio quién apretó el botón, el único nombre disponible es
 * el de la CUENTA con la que la sala opera siempre («MI CAJA LA POPULAR»), que
 * no es el de quien actuó. La tarjeta lo dice tal cual en vez de pintar una
 * firma que nadie va a revisar.
 */

const R = 19;                      // radio del anillo, en las 46 unidades del viewBox
const VUELTA = 2 * Math.PI * R;

/** El anillo, en el lugar exacto que ocupa el recuadro del ícono. */
export function AnilloDeAperturas({ datos, isDark }) {
    const { abiertas, total, completa } = datos;
    const tono = completa
        ? (isDark ? 'text-success-text' : 'text-success')
        : (isDark ? 'text-danger-text' : 'text-danger');
    const avance = Math.max(0, Math.min(abiertas / total, 1));

    return (
        <div className="relative w-9 h-9 flex-shrink-0 mt-0.5">
            <svg viewBox="0 0 46 46" className="w-full h-full" role="img"
                aria-label={`${abiertas} de ${total} salas abrieron caja`}>
                <circle cx="23" cy="23" r={R} fill="none" strokeWidth="4"
                    className="stroke-border-card" />
                {/* Arranca en las doce y gira como un reloj: `rotate(-90)` sobre
                    su propio centro. Sin eso empieza a las tres y el hueco cae
                    donde nadie lo busca. */}
                <circle cx="23" cy="23" r={R} fill="none" strokeWidth="4"
                    strokeLinecap="round" transform="rotate(-90 23 23)"
                    className={`${tono} stroke-current`}
                    strokeDasharray={`${VUELTA * avance} ${VUELTA}`} />
            </svg>
            <span className={`absolute inset-0 grid place-items-center tabular-nums
                text-caption font-black ${tono}`} aria-hidden="true">
                {abiertas}
            </span>
        </div>
    );
}

export function CuerpoDeAperturas({ datos, claseTenue, isDark, buscarEmpleado }) {
    const { salas, total, abiertas, completa, noAbrieron, sinRespuesta,
            horaAviso, ultima, conRetraso } = datos;

    const rojo    = isDark ? 'text-danger-text'  : 'text-danger';
    const naranja = isDark ? 'text-warning-text' : 'text-warning';
    const verde   = isDark ? 'text-success-text' : 'text-success';

    return (
        <div className="flex flex-col gap-2 mt-1">
            {/* El renglón que se lee primero: cuántas abrieron y a qué hora
                cerró la mañana. El conteo va con su denominador —«6 de 6» y no
                «6»— porque el número solo no dice si están todas. */}
            <div className="flex items-baseline gap-2 flex-wrap tabular-nums">
                <span className={`text-body-lg font-black tracking-tight ${completa ? '' : rojo}`}>
                    {abiertas} de {total}
                </span>
                {ultima && (
                    <span className={`text-body-sm font-semibold ${conRetraso ? naranja : claseTenue}`}>
                        la última, {ultima.sala} a las {ultima.hora}
                    </span>
                )}
            </div>

            {/* Lo que falta. Dos listas y dos tonos: ver el encabezado. */}
            {noAbrieron.length > 0 && (
                <p className={`text-caption font-bold ${rojo}`}>
                    {horaAviso ? `A las ${horaAviso} todavía no ` : 'Todavía no '}
                    {noAbrieron.length === 1 ? 'abría ' : 'abrían '}
                    {noAbrieron.join(', ')}
                </p>
            )}
            {sinRespuesta.length > 0 && (
                <p className={`text-caption font-bold ${naranja}`}>
                    No se pudo comprobar {sinRespuesta.join(', ')}
                </p>
            )}

            {/* La lista, en el orden en que abrieron. La hora va PRIMERA y en
                cifras tabulares: así las seis quedan alineadas en columna y la
                que se pasó salta sin leer los nombres. */}
            {salas.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                    {salas.map((s, i) => {
                        // La ficha del store trae la foto ya firmada; lo del
                        // aviso es el respaldo para cuando esa persona no esté.
                        const emp = s.employeeId
                            ? (buscarEmpleado?.(s.employeeId) || { id: s.employeeId, name: s.quien })
                            : null;
                        return (
                            <li key={s.branchId ?? `${s.sala}-${i}`}
                                className="flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1">
                                <span className={`flex-shrink-0 w-11 tabular-nums text-caption font-black
                                    ${s.tarde ? naranja : verde}`}>
                                    {s.hora}
                                </span>
                                {emp ? (
                                    <span className="flex-shrink-0">
                                        <AvatarConEstado emp={emp} px={22} radio="rounded-full"
                                            marco="" mostrarChip={false} />
                                    </span>
                                ) : (
                                    <span aria-hidden="true"
                                        className={`flex-shrink-0 w-[22px] h-[22px] rounded-full grid
                                            place-items-center bg-surface-card-hover ${claseTenue}`}>
                                        <DoorOpen className="w-3 h-3" />
                                    </span>
                                )}
                                <span className="flex-1 min-w-0 truncate text-caption font-semibold">
                                    {s.sala}
                                </span>
                                <span className={`flex-shrink-0 max-w-[45%] truncate text-caption ${claseTenue}
                                    ${s.quien ? '' : 'italic'}`}>
                                    {s.quien || 'desde la caja'}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
