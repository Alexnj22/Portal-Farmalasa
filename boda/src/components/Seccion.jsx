import Revelar from './Revelar';

/** El último término del título va en cursiva: «Nuestra *historia*». */
export function Titulo({ texto, as: Tag = 'h2' }) {
  if (typeof texto !== 'string') return <Tag>{texto}</Tag>;
  const i = texto.lastIndexOf(' ');
  return i > 0 ? <Tag>{texto.slice(0, i)} <em>{texto.slice(i + 1)}</em></Tag> : <Tag>{texto}</Tag>;
}

/**
 * Sección del sitio.
 *   variante: '' | 'alterna' (arena) | 'oliva' (superficie oliva)
 *   dividida: en escritorio, título en una columna y contenido en la otra
 *   angosta:  contenido a 720px
 */
export default function Seccion({ id, titulo, bajada, variante = '', dividida, angosta, children }) {
  return (
    <section id={id} className={`seccion ${variante}`}>
      <div className={`${angosta ? 'angosto' : 'contenedor'} ${dividida ? 'dividida' : ''}`}>
        <Revelar as="header" className="seccion-cabeza">
          <Titulo texto={titulo} />
          {bajada && <p>{bajada}</p>}
        </Revelar>
        <div className={`seccion-cuerpo ${variante === 'oliva' ? 'sobre-oliva' : ''}`}>{children}</div>
      </div>
    </section>
  );
}
