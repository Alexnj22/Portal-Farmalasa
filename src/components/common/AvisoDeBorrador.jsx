import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import Notice from './Notice';
import Button from './Button';

/**
 * «Tenés cambios sin guardar. ¿Los recuperás?»
 *
 * ── Por qué OFRECE en vez de reponer ──────────────────────────────────────
 * En un formulario de ALTA el borrador se repone solo y está bien: no hay nada
 * que pisar, la pantalla estaba vacía. Editando un registro que ya existe la
 * cuenta es otra — `UnifiedModal` lo dejó escrito cuando encendió el borrador
 * sólo para los dos tipos que son un alta:
 *
 *   > «NO cuando se está EDITANDO una ya registrada: ahí la fila de la base es
 *   > la verdad.»
 *
 * Ese razonamiento es correcto y por eso no se toca: reponer sobre un registro
 * vivo puede escribir datos viejos encima de lo que otra persona cambió en el
 * medio, y nadie lo notaría. Lo que sí se puede es no perder el trabajo: el
 * formulario guarda, y al volver **pregunta**. La fila de la base sigue siendo
 * la verdad hasta que alguien decida otra cosa a la vista de las dos.
 *
 * Y sin la HORA la pregunta no se puede contestar: lo que decide a una persona
 * no es «hay un borrador», es «hay uno de hace diez minutos». Por eso
 * `useBorrador` devuelve `cuando` y esto lo muestra siempre.
 *
 * Nota de plazos: un borrador caduca a las 24 h (`draftUtils`), así que lo que
 * se ofrece nunca es de anteayer.
 *
 * @param {number|null} cuando   milisegundos, de `useBorrador`
 * @param {() => void}  onRecuperar
 * @param {() => void}  onDescartar
 */
export default function AvisoDeBorrador({ cuando, onRecuperar, onDescartar, className = '' }) {
    if (!onRecuperar) return null;

    return (
        <Notice
            variant="warning"
            icon={RotateCcw}
            className={className}
            action={
                <span className="flex items-center gap-1.5">
                    {/* `size="sm"`, como los otros avisos con acción del portal
                        (`FormClienteDetail`, `CompletarRenglon`): un `Notice` es
                        compacto y el tamaño por defecto de `Button` es `md`. El
                        blanco de dedo no se pierde — `--tap-min` va dentro del
                        `max()` de cada tamaño, así que en táctil sigue siendo de
                        44px. */}
                    <Button size="sm" variant="secondary" onClick={onRecuperar}>Recuperar</Button>
                    {/* El ✕ va como `icon={X}` y NO como hijo: con `iconOnly`,
                        `Button` no dibuja sus `children` (`{!iconOnly && …}`),
                        así que el ícono pasado adentro no se veía y quedaba un
                        cuadro vacío. Lo reportó el usuario mirando la salida de
                        efectivo el 2026-09-03, y como esto es el canónico del
                        aviso de borrador, el cuadro estaba en TODOS: la única
                        forma de descartar lo guardado era un botón que no se
                        veía. */}
                    <Button size="sm" variant="secondary" iconOnly icon={X}
                            title="Descartar lo guardado" onClick={onDescartar} />
                </span>
            }
        >
            Quedaron cambios sin guardar{cuando ? ` de ${describirCuando(cuando)}` : ''}.
        </Notice>
    );
}

/**
 * «hace un momento», «hace 12 minutos», «hace 3 horas», «ayer a las 4:15 p.m.».
 *
 * En minutos y horas mientras eso signifique algo, y recién después la hora del
 * reloj: a las nueve de la mañana, «hace 14 horas» obliga a hacer la cuenta para
 * entender que fue anoche.
 */
function describirCuando(ts) {
    const min = Math.round((Date.now() - ts) / 60_000);
    if (min < 1)  return 'hace un momento';
    if (min === 1) return 'hace un minuto';
    if (min < 60) return `hace ${min} minutos`;

    const horas = Math.round(min / 60);
    if (horas < 6) return horas === 1 ? 'hace una hora' : `hace ${horas} horas`;

    const d = new Date(ts);
    const hoy = new Date().toDateString() === d.toDateString();
    const hora = d.toLocaleTimeString('es-SV', { hour: 'numeric', minute: '2-digit', hour12: true });
    return hoy ? `hoy a las ${hora}` : `ayer a las ${hora}`;
}
