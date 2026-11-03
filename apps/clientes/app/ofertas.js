// Las ofertas, como pantalla de la pila (2026-11-03): dejaron de ser una
// pestaña y se abren desde la Tienda. La ruta `/ofertas` se mantiene porque
// es destino de historias y banners del portal (DESTINOS_DE_LA_APP en
// src/utils/ofertasClientes.js) y de «Ver ofertas» en Mis reservas.
import ListaOfertas from '../componentes/ListaOfertas';

export default function Ofertas() {
  return <ListaOfertas />;
}
