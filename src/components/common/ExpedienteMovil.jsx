import React from 'react';
import ModalShell from './ModalShell';


/**
 * `ExpedienteMovil` — el detalle de una fila, a pantalla completa en el teléfono.
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
export default function ExpedienteMovil({ abierto, onClose, titulo, children }) {
    return (
        <ModalShell
            open={!!abierto}
            onClose={onClose}
            align="pantalla"
            titulo={titulo}
            ariaLabel={titulo || 'Detalle'}
        >
            {abierto ? children(abierto) : null}
        </ModalShell>
    );
}
