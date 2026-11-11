import { useEffect, useState } from 'react';
import { boda } from '../config';
import { api } from '../lib/api';
import { enlaceSpotify, enlaceYoutube, enlaceApple } from '../lib/musica';

/** Pantalla del DJ: lo pedido ordenado por votos, con enlaces para ponerlo ya. */
export default function Dj() {
  const [lista, setLista] = useState([]);
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    const cargar = () => api.listarCanciones().then(setLista).catch(() => {});
    cargar();
    return api.suscribirCanciones(cargar);
  }, []);
  const pendientes = lista.filter((c) => !c.tocada);
  const copiar = () => {
    navigator.clipboard?.writeText(pendientes.map((c, i) => `${i + 1}. ${c.titulo}${c.artista ? ` – ${c.artista}` : ''}`).join('\n'))
      .then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000); }).catch(() => {});
  };
  return (
    <div className="pantalla-dj">
      <header>
        <span className="mono-dj">{boda.novios.firma}</span>
        <span>Canciones pedidas · {pendientes.length} <button type="button" className="btn-dj" onClick={copiar}>{copiado ? '✓ Copiada' : 'Copiar lista'}</button></span>
      </header>
      <ol>
        {pendientes.map((c, i) => (
          <li key={c.id}>
            <span className="puesto">{i + 1}</span>
            {c.portada ? <img className="portada-dj" src={c.portada} alt="" /> : <span className="portada-dj" />}
            <span className="cancion-texto"><b>{c.titulo}</b>{c.artista && <small>{c.artista}</small>}{c.pedido_por && <small>Pidió: {c.pedido_por}</small>}</span>
            <span className="enlaces-dj">
              <a href={enlaceSpotify(c)} target="_blank" rel="noreferrer">Spotify</a>
              <a href={enlaceYoutube(c)} target="_blank" rel="noreferrer">YouTube</a>
              <a href={enlaceApple(c)} target="_blank" rel="noreferrer">Apple</a>
            </span>
            <span className="votos-dj">♥ {c.votos}</span>
          </li>
        ))}
      </ol>
      {!pendientes.length && <p className="vacio-dj">Todavía no hay pedidos.</p>}
    </div>
  );
}
