import React from 'react';
import ModalShell from './ModalShell';
import HojaMovil from './HojaMovil';


/**
 * `ExpedienteMovil` — el detalle de una fila, a pantalla completa en el teléfono.
 *
 * El hook vive en `usarExpediente.js` y NO en `expedienteMovil.js`: en macOS el
 * sistema de archivos es insensible a mayúsculas, así que dos módulos que sólo
 * se distinguen por la caja de una letra se resuelven al mismo archivo y el
 * bundler trae el equivocado. Falló como *«"default" is not exported by
 * expedienteMovil.js»*, que no dice nada de la causa.
 *
 * Doce vistas del portal cuelgan su detalle de un `<tr colSpan>` hermano de la
 * fila. En escritorio eso está bien: la fila se expande y el detalle aparece
 * debajo, dentro de la tabla. En el teléfono `DataTable` ya no pinta una tabla
 * —pinta fichas— así que ese `<tr>` no existe, y el toque no lleva a ningún
 * lado. Se reportó tal cual: *«al clickear no se abre nada»*.
 *
 * La salida es la misma en las doce: el MISMO componente de detalle, con el
 * `<tr><td colSpan>` afuera, montado a pantalla completa. Esto es esa receta
 * escrita una vez.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *   const { enTelefono, abierto } = useExpedienteMovil(filas, expandedId);
 *
 *   // en el cuerpo de la tabla, la expansión sólo en escritorio:
 *   {isExpanded && !enTelefono && <FilaExpandida … />}
 *
 *   // y el expediente, una vez, fuera de la tabla:
 *   <ExpedienteMovil abierto={abierto} onClose={() => setExpandedId(null)}
 *       titulo={abierto?.nombre}>
 *     {(fila) => <FilaExpandida comoPanel fila={fila} … />}
 *   </ExpedienteMovil>
 *
 * Y en el `DataTable`, `movil={{ usarAccionDeFila: true }}`: el toque de la
 * ficha tiene que ir al `onClick` que ya abre la fila, no a la hoja genérica.
 *
 * ── Por qué un componente y no cuatro líneas copiadas ─────────────────────
 * Porque las cuatro líneas incluyen tres decisiones que se equivocan solas:
 * que el corte de «teléfono» sea EL MISMO que usa `DataTable` para elegir
 * ficha o tabla (si divergen, hay un ancho donde la fila es ficha y el detalle
 * intenta expandirse dentro de una tabla que ya no está), que la expansión de
 * escritorio quede apagada en el teléfono para no montar el panel dos veces, y
 * que el detalle reciba `comoPanel` en vez de duplicarse. Copiadas once veces,
 * las tres se rompen en alguna.
 */

/**
 * El envase. Devuelve `null` si no hay fila abierta, así que la vista puede
 * dejarlo montado siempre sin condicionales alrededor.
 *
 * `children` es una FUNCIÓN que recibe la fila. Así el panel sólo se construye
 * cuando hay algo que mostrar — con doce secciones y tres historiales, armarlo
 * en cada render de la lista es trabajo que nadie ve.
 */
/**
 * ── NO hay ranura `pie`, y la ausencia es la decisión ─────────────────────
 * Existió en v2.505.0 para anclar al fondo de la hoja el resultado de la regla
 * de despacho, y se quitó en v2.508.2 junto con la hoja misma: sin hoja no hay
 * dónde anclar nada, y una prop sin usuarios es una prop que alguien va a usar
 * mal. Volvió sola el 2026-08-07 —otra sesión commiteó una copia vieja de este
 * archivo dentro de v2.511.0, que era un cambio de impresión del conteo— y con
 * ella volvió la hoja de Reglas y la pantalla negra del iPhone. Queda escrito
 * acá para que la tercera vez se note antes: si hace falta anclar algo al
 * fondo, el envase que lo resuelve es `variante="pantalla"`, cuya barra
 * superior ya queda fija.
 */
export default function ExpedienteMovil({ abierto, onClose, titulo, subtitulo, variante = 'auto', children }) {
    const cuerpo = abierto ? children(abierto) : null;

    // ── El envase lo decide el CONTENIDO, no la vista ─────────────────────
    // `pantalla` ocupa la pantalla entera siempre. Eso está bien para un
    // expediente que ES una pantalla —el producto lleva siete secciones y tres
    // historiales— y está mal para un detalle corto: una compra de tres ítems
    // abría a pantalla completa y quedaba media vacía. Lo preguntó el usuario
    // así: *«¿por qué no se adapta según contenido?»*.
    //
    // `auto` es la hoja canónica, que ya hace exactamente eso: crece con lo que
    // tiene y a partir de `88dvh` scrollea por dentro. Es el default porque es
    // el caso más común —un detalle es corto— y porque equivocarse hacia la
    // hoja sólo cuesta un scroll, mientras que equivocarse hacia la pantalla
    // completa deja media pantalla vacía y esconde la vista de atrás.
    if (variante === 'pantalla') {
        return (
            <ModalShell open={!!abierto} onClose={onClose} align="pantalla"
                titulo={titulo} ariaLabel={titulo || 'Detalle'}>
                {cuerpo}
            </ModalShell>
        );
    }

    return (
        <ModalShell open={!!abierto} onClose={onClose} surface={null}
            ariaLabel={titulo || 'Detalle'}>
            {abierto && (
                <HojaMovil titulo={titulo} subtitulo={subtitulo}>
                    {cuerpo}
                </HojaMovil>
            )}
        </ModalShell>
    );
}
