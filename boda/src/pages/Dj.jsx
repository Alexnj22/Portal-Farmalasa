import { useEffect, useState } from 'react';
import { boda } from '../config';
import { api } from '../lib/api';

/** Pantalla del DJ: las canciones pedidas ordenadas por votos. Se actualiza sola. */
export default function Dj() {
  const [lista, setLista] = useState([]);
  useEffect(() => {
    const cargar = () => api.listarCanciones().then(setLista).catch(() => {});
    cargar();
    return api.suscribirCanciones(cargar);
  }, []);
  const pendientes = lista.filter((c) => !c.tocada);
  return (
    <div className="pantalla-dj">
      <header><span className="mono-dj">{boda.novios.firma}</span><span>Canciones pedidas · {pendientes.length}</span></header>
      <ol>
        {pendientes.map((c, i) => (
          <li key={c.id}>
            <span className="puesto">{i + 1}</span>
            <span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}</small>}{c.pedido_por && <small>Pidió: {c.pedido_por}</small>}</span>
            <span className="votos-dj">♥ {c.votos}</span>
          </li>
        ))}
      </ol>
      {!pendientes.length && <p className="vacio-dj">Todavía no hay pedidos.</p>}
    </div>
  );
}
