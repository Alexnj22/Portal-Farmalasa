import Revelar from './Revelar';

/**
 * Sección del sitio: título grande alineado a la izquierda y el contenido.
 *   variante: '' | 'alterna' (fondo arena) | 'oliva' (superficie oliva)
 *   dividida: en escritorio, título en una columna y contenido en la otra
 *   angosta:  contenido a 720px (texto, formularios)
 */
export default function Seccion({ id, titulo, bajada, variante = '', dividida, angosta, children }) {
  return (
    <section id={id} className={`seccion ${variante}`}>
      <div className={`${angosta ? 'angosto' : 'contenedor'} ${dividida ? 'dividida' : ''}`}>
        <Revelar as="header" className="seccion-cabeza">
          <h2>{titulo}</h2>
          {bajada && <p>{bajada}</p>}
        </Revelar>
        <div className={`seccion-cuerpo ${variante === 'oliva' ? 'sobre-oliva' : ''}`}>{children}</div>
      </div>
    </section>
  );
}
