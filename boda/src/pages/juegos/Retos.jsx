import { useRef, useState } from 'react';
import { boda } from '../../config';
import { api } from '../../lib/api';
import { t, useIdioma } from '../../lib/idioma';
import { miNombre } from '../../lib/yo';
import { lanzar, vibrar } from '../../lib/confeti';
import { PaginaApp } from '../../components/AppMarco';

const LS = 'boda-retos';
const LS_CLAVE = 'boda-clave-album';
const leer = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };

/** Retos de fotos: cada uno abre la cámara y la foto va al álbum con la etiqueta «Retos». */
export default function Retos() {
  useIdioma();
  const retos = boda.juego?.retos || [];
  const [hechos, setHechos] = useState(() => leer(LS, []));
  const [clave, setClave] = useState(() => { try { return localStorage.getItem(LS_CLAVE) || ''; } catch { return ''; } });
  const [claveEscrita, setClaveEscrita] = useState('');
  const [subiendo, setSubiendo] = useState(null);
  const [error, setError] = useState('');
  const entrada = useRef(null);
  const actual = useRef(null);

  const abrir = (i) => { actual.current = i; setError(''); entrada.current.click(); };
  async function subir(file) {
    if (!file) return;
    const i = actual.current;
    setSubiendo(i);
    try {
      await api.subirFoto(file, { autor: miNombre() || null, momento: 'Retos', clave });
      const h = [...new Set([...hechos, i])];
      setHechos(h); try { localStorage.setItem(LS, JSON.stringify(h)); } catch { /* privado */ }
      vibrar([20, 40, 20]); lanzar({ cantidad: h.length === retos.length ? 200 : 70 });
    } catch (e) { setError(e.message); } finally { setSubiendo(null); if (entrada.current) entrada.current.value = ''; }
  }
  async function usarClave(e) {
    e.preventDefault();
    const c = claveEscrita.trim().toUpperCase();
    if (await api.verificarClaveAlbum(c)) { setClave(c); try { localStorage.setItem(LS_CLAVE, c); } catch { /* privado */ } }
    else setError(t('Esa clave no es correcta. Está en el QR de tu mesa.', "That code isn't right. It's on your table's QR."));
  }

  return (
    <PaginaApp titulo={<>{t('Retos de', 'Photo')} <em>{t('fotos', 'challenges')}</em></>} bajada={t('Cumple los retos con tu cámara. Cada foto aparece en el álbum y en la pantalla del salón.', 'Complete the challenges with your camera. Each photo shows up in the album and on the big screen.')}>
      <div className="progreso-retos" aria-label={t(`${hechos.length} de ${retos.length}`, `${hechos.length} of ${retos.length}`)}>
        <div className="barra-retos"><span style={{ transform: `scaleX(${retos.length ? hechos.length / retos.length : 0})` }} /></div>
        <b>{hechos.length}/{retos.length}</b>
      </div>
      {!clave && (
        <form className="clave-album" onSubmit={usarClave}>
          <p>{t('Para subir fotos, escribe la clave del álbum (está en el QR de tu mesa).', "To upload photos, type the album code (it's on your table's QR).")}</p>
          <div className="buscar-codigo"><input value={claveEscrita} onChange={(e) => setClaveEscrita(e.target.value)} placeholder={t('Clave', 'Code')} aria-label={t('Clave del álbum', 'Album code')} /><button className="btn">{t('Entrar', 'Enter')}</button></div>
        </form>
      )}
      {error && <p className="aviso error">{error}</p>}
      <input ref={entrada} type="file" accept="image/*" capture="environment" hidden onChange={(e) => subir(e.target.files[0])} />
      <ol className="lista-retos">
        {retos.map((r, i) => {
          const hecho = hechos.includes(i);
          return (
            <li key={i} className={hecho ? 'hecho' : ''}>
              <span className="num-reto">{hecho ? '✓' : i + 1}</span>
              <span className="txt-reto">{r}</span>
              <button type="button" className={`btn chico ${hecho ? 'claro' : ''}`} disabled={!clave || subiendo != null} onClick={() => abrir(i)}>
                {subiendo === i ? t('Subiendo…', 'Uploading…') : hecho ? t('Otra', 'Again') : t('Tomar foto', 'Take photo')}
              </button>
            </li>
          );
        })}
      </ol>
      {hechos.length === retos.length && retos.length > 0 && <p className="bingo-cantado"><b>{t('¡Completaste todos!', 'All done!')}</b><span>{t('Eres la estrella de la noche.', "You're the star of the night.")}</span></p>}
    </PaginaApp>
  );
}
