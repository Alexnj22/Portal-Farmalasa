import { useState } from 'react';
import Visor from './Visor';
import { esVideo } from '../lib/api';
import { t, rotuloMomento } from '../lib/idioma';

/** items: [{ url, mini?, ruta?, autor?, momento? }] — el mosaico pinta `mini`; el visor, `url`. */
export default function Mosaico({ items, conPie = false }) {
  const [i, setI] = useState(null);
  return (
    <>
      <div className="mosaico">
        {items.map((it, n) => (
          <button key={it.id ?? it.url} onClick={() => setI(n)} style={{ border: 0, padding: 0, display: 'block', width: '100%' }} aria-label={t('Ver foto', 'View photo')}>
            {esVideo(it.ruta)
              ? <video src={it.url} poster={it.mini && it.mini !== it.url ? it.mini : undefined} muted playsInline preload={it.mini && it.mini !== it.url ? 'none' : 'metadata'} />
              : <img src={it.mini || it.url} alt="" loading="lazy" decoding="async" width={it.ancho || undefined} height={it.alto || undefined} />}
            {esVideo(it.ruta) && <span className="marca-video" aria-hidden>▶</span>}
            {conPie && (it.autor || it.momento) && <div className="pie">{[it.momento && rotuloMomento(it.momento), it.autor].filter(Boolean).join(' · ')}</div>}
          </button>
        ))}
      </div>
      {i != null && <Visor items={items} indice={i} alCambiar={setI} alCerrar={() => setI(null)} />}
    </>
  );
}
