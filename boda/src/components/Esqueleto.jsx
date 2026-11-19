/**
 * Mientras baja una pantalla: la forma de la página de verdad (título grande,
 * bajada y filas), con un brillo que la cruza. Sin texto «Cargando…».
 */
export default function Esqueleto({ filas = 4 }) {
  return (
    <div className="pagina-app esqueleto-pagina" aria-busy="true" aria-label="…">
      <div className="cabeza-app esq-cabeza" aria-hidden />
      <div className="contenedor cuerpo-app">
        <div className="titulo-app">
          <span className="esq esq-titulo" />
          <span className="esq esq-bajada" />
        </div>
        <div className="contenido-app">
          {Array.from({ length: filas }, (_, i) => <span key={i} className="esq esq-fila" style={{ '--i': i }} />)}
        </div>
      </div>
    </div>
  );
}

/** Un bloque suelto (p. ej. el álbum mientras revisa la clave). */
export function Bloque({ alto = 120, className = '' }) {
  return <span className={`esq esq-bloque ${className}`} style={{ height: alto }} aria-hidden />;
}
