import { useState } from 'react';
import Visor from './Visor';
import { esVideo } from '../lib/api';

/** items: [{ url, ruta?, autor?, momento? }] */
export default function Mosaico({ items, conPie = false }) {
  const [i, setI] = useState(null);
  return (
    <>
      <div className="mosaico">
        {items.map((it, n) => (
          <button key={it.id ?? it.url} onClick={() => setI(n)} style={{ border: 0, padding: 0, display: 'block', width: '100%' }} aria-label="Ver foto">
            {esVideo(it.ruta)
              ? <video src={it.url} muted playsInline preload="metadata" />
              : <img src={it.url} alt="" loading="lazy" width={it.ancho || undefined} height={it.alto || undefined} />}
            {conPie && (it.autor || it.momento) && <div className="pie">{[it.momento, it.autor].filter(Boolean).join(' · ')}</div>}
          </button>
        ))}
      </div>
      {i != null && <Visor items={items} indice={i} alCambiar={setI} alCerrar={() => setI(null)} />}
    </>
  );
}
