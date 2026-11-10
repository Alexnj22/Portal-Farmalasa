import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { boda } from '../config';
import { api } from '../lib/api';
import { t, useIdioma, rotuloMomento, BotonIdioma } from '../lib/idioma';
import Mosaico from '../components/Mosaico';

const LS_CLAVE = 'boda-clave-album';
const LS_AUTOR = 'boda-autor';
const leerLS = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

// La señal del salón se cae: un error de red se reintenta solo (y si el
// teléfono quedó sin conexión, se espera a que vuelva). Un error que no se
// arregla reintentando —clave mala, archivo no permitido— no se reintenta.
const PERMANENTE = /clave|tipo de archivo|pesado|demasiadas|no se pueden subir|mime|size|exceeded/i;
const ESPERAS = [2000, 5000, 12000];
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hayRed = () => new Promise((r) => {
  if (navigator.onLine !== false) { r(); return; }
  window.addEventListener('online', () => r(), { once: true });
});

async function subirConReintentos(f, datos, alReintentar) {
  for (let intento = 0; ; intento++) {
    try {
      await hayRed();
      return await api.subirFoto(f, datos);
    } catch (e) {
      if (PERMANENTE.test(e.message || '') || intento >= ESPERAS.length) throw e;
      alReintentar();
      await dormir(ESPERAS[intento]);
    }
  }
}

export default function Album() {
  useIdioma();
  const [params, setParams] = useSearchParams();
  const [clave, setClave] = useState(() => (params.get('k') || leerLS(LS_CLAVE)).toUpperCase());
  const [claveOk, setClaveOk] = useState(null);
  const [claveEscrita, setClaveEscrita] = useState('');
  const [autor, setAutor] = useState(() => leerLS(LS_AUTOR));
  const [momento, setMomento] = useState(boda.momentos[0]);
  const [fotos, setFotos] = useState([]);
  const [filtro, setFiltro] = useState('Todas');
  const [subida, setSubida] = useState(null); // { total, hechas, fallas, reintentando }
  const [error, setError] = useState('');
  const entrada = useRef(null);

  // La clave del QR se guarda y se quita de la dirección (para que no se comparta al reenviar el enlace).
  useEffect(() => {
    if (params.get('k')) { params.delete('k'); setParams(params, { replace: true }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!clave) { setClaveOk(false); return; }
    api.verificarClaveAlbum(clave).then((ok) => {
      setClaveOk(ok);
      if (ok) guardarLS(LS_CLAVE, clave);
    }).catch(() => setClaveOk(false));
  }, [clave]);

  useEffect(() => {
    api.listarFotos().then(setFotos).catch((e) => setError(e.message));
    return api.suscribirFotos((f) => setFotos((xs) => (xs.some((x) => x.id === f.id) ? xs : [f, ...xs])));
  }, []);

  // Cerrar la pestaña a mitad de una subida pierde lo que falta: se avisa.
  const subiendo = !!subida && subida.hechas + subida.fallas < subida.total;
  useEffect(() => {
    if (!subiendo) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [subiendo]);

  const visibles = useMemo(
    () => (filtro === 'Todas' ? fotos : filtro === 'Mías' ? fotos.filter((f) => autor && f.autor === autor) : fotos.filter((f) => f.momento === filtro)),
    [fotos, filtro, autor],
  );

  async function subir(files) {
    const lista = [...files];
    if (!lista.length) return;
    setError('');
    guardarLS(LS_AUTOR, autor);
    let hechas = 0; let fallas = 0; let reintentando = 0;
    const pintar = () => setSubida({ total: lista.length, hechas, fallas, reintentando });
    pintar();
    // De a 3 en paralelo: rápido sin ahogar la conexión del salón.
    const cola = [...lista];
    const trabajador = async () => {
      while (cola.length) {
        const f = cola.shift();
        try {
          if (f.size > 25 * 1024 * 1024 && f.type.startsWith('video/')) throw new Error(t('Video muy pesado (máx. 25 MB)', 'Video too large (max. 25 MB)'));
          await subirConReintentos(f, { autor, momento, clave }, () => { reintentando++; pintar(); });
          hechas++;
        } catch (e) {
          fallas++;
          setError(e.message);
        }
        pintar();
      }
    };
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    if (entrada.current) entrada.current.value = '';
    api.listarFotos().then(setFotos).catch(() => {});
    setTimeout(() => setSubida(null), 4000);
  }

  const filtros = [
    ['Todas', t('Todas', 'All')],
    ...boda.momentos.map((m) => [m, rotuloMomento(m)]),
    ...(autor ? [['Mías', t('Mías', 'Mine')]] : []),
  ];
  const n = fotos.length;

  return (
    <>
      <nav className="nav">
        <div className="contenedor">
          <Link to="/" className="marca">{boda.novios.ella[0]} & {boda.novios.el[0]}</Link>
          <ul>
            <li><Link to="/">{t('Inicio', 'Home')}</Link></li>
            <li><a className="activo" href="#">{t('Álbum', 'Album')}</a></li>
          </ul>
          <BotonIdioma />
        </div>
      </nav>
      <section className="seccion" style={{ paddingTop: 40 }}>
        <div className="contenedor">
          <div className="titulo centro">
            <span className="script" style={{ color: 'var(--oro)', fontSize: '2rem' }}>{t('Álbum compartido', 'Shared album')}</span>
            <h2>{boda.novios.firma}</h2>
            <p className="suave">{n} {n === 1 ? t('recuerdo', 'memory') : t('recuerdos', 'memories')} · {boda.novios.hashtag}</p>
          </div>

          <div className="angosto" style={{ marginBottom: 24 }}>
            {claveOk === false && (
              <form className="tarjeta centro" onSubmit={(e) => { e.preventDefault(); setClave(claveEscrita.trim().toUpperCase()); }}>
                <p>{t('Para subir fotos escanea el código QR de tu mesa, o escribe la clave del álbum:', "To upload photos, scan the QR code on your table or type the album's code:")}</p>
                {clave && <p className="aviso error">{t('Esa clave no es correcta.', "That code isn't correct.")}</p>}
                <div style={{ display: 'flex', gap: 8, maxWidth: 320, margin: '0 auto' }}>
                  <input value={claveEscrita} onChange={(e) => setClaveEscrita(e.target.value)} placeholder={t('Clave', 'Code')} aria-label={t('Clave del álbum', 'Album code')} style={{ textTransform: 'uppercase', textAlign: 'center' }} />
                  <button className="btn">{t('Entrar', 'Enter')}</button>
                </div>
              </form>
            )}
            {claveOk && (
              <div className="subida">
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', textAlign: 'left' }}>
                  <label className="campo" style={{ margin: 0 }}><span>{t('Tu nombre (opcional)', 'Your name (optional)')}</span>
                    <input value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={60} placeholder={t('Para saber quién la tomó', 'So we know who took it')} />
                  </label>
                  <label className="campo" style={{ margin: 0 }}><span>{t('Momento', 'Moment')}</span>
                    <select value={momento} onChange={(e) => setMomento(e.target.value)}>
                      {boda.momentos.map((m) => <option key={m} value={m}>{rotuloMomento(m)}</option>)}
                    </select>
                  </label>
                </div>
                <input ref={entrada} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => subir(e.target.files)} />
                <button className="btn oro" style={{ marginTop: 16, fontSize: '1rem' }} disabled={subiendo} onClick={() => entrada.current.click()}>
                  📷 {t('Elegir o tomar fotos', 'Choose or take photos')}
                </button>
                {subida && (
                  <div style={{ marginTop: 14 }} aria-live="polite">
                    <div className="barra"><div style={{ width: `${((subida.hechas + subida.fallas) / subida.total) * 100}%` }} /></div>
                    <p className="chico suave" style={{ margin: '6px 0 0' }}>
                      {subiendo
                        ? `${t('Subiendo', 'Uploading')} ${subida.hechas + subida.fallas + 1} ${t('de', 'of')} ${subida.total}…`
                        : `${t('¡Listo!', 'Done!')} ${subida.hechas} ${subida.hechas === 1 ? t('subida', 'uploaded') : t('subidas', 'uploaded')}${subida.fallas ? `, ${subida.fallas} ${t('con error', 'failed')}` : ''}. ${t('Gracias', 'Thank you')} 💛`}
                    </p>
                    {subiendo && subida.reintentando > 0 && (
                      <p className="chico suave" style={{ margin: '4px 0 0' }}>
                        {t('La señal está débil: reintentando solo. No cierres esta página.', "Weak signal: retrying automatically. Don't close this page.")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {error && <p className="aviso error" style={{ marginTop: 12 }}>{error}</p>}
          </div>

          <div className="filtros" role="tablist">
            {filtros.map(([valor, rotulo]) => (
              <button key={valor} role="tab" aria-selected={filtro === valor} className={filtro === valor ? 'activo' : ''} onClick={() => setFiltro(valor)}>{rotulo}</button>
            ))}
          </div>

          {visibles.length
            ? <Mosaico items={visibles} conPie />
            : <p className="centro suave" style={{ padding: 40 }}>{t('Aún no hay fotos aquí. ¡Sé el primero en compartir una!', 'No photos here yet. Be the first to share one!')}</p>}
        </div>
      </section>
    </>
  );
}
