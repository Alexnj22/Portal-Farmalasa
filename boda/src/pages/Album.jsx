import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { boda } from '../config';
import { api } from '../lib/api';
import { t, useIdioma, rotuloMomento } from '../lib/idioma';
import { PaginaApp } from '../components/AppMarco';
import Mosaico from '../components/Mosaico';
import { Bloque } from '../components/Esqueleto';
import { encolar, procesar, pendientes, escuchar } from '../lib/colaSubidas';

const Presentacion = lazy(() => import('../components/Presentacion'));

const LS_CLAVE = 'boda-clave-album';
const LS_AUTOR = 'boda-autor';
const leerLS = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

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
  const [presentar, setPresentar] = useState(false);
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
    }).catch((e) => { console.error('Clave del álbum', e); setClaveOk(false); });
  }, [clave]);

  useEffect(() => {
    api.listarFotos().then(setFotos).catch((e) => setError(e.message));
    return api.suscribirFotos((f) => setFotos((xs) => (xs.some((x) => x.id === f.id) ? xs : [f, ...xs])));
  }, []);

  // La cola de subidas vive en IndexedDB: cerrar la página no pierde fotos.
  // Al entrar (y al volver la señal) se retoma lo que haya quedado.
  useEffect(() => {
    const alVolverRed = () => pendientes().then((p) => p.length && procesar(p)).catch((e) => console.error(e));
    alVolverRed();
    window.addEventListener('online', alVolverRed);
    const fuera = escuchar((p) => {
      setSubida(p);
      if (p && p.hechas + p.fallas >= p.total) {
        if (p.error) setError(p.error);
        api.listarFotos().then(setFotos).catch((e) => console.error('Álbum', e));
        if (entrada.current) entrada.current.value = '';
      }
    });
    return () => { window.removeEventListener('online', alVolverRed); fuera(); };
  }, []);
  const subiendo = !!subida && subida.hechas + subida.fallas < subida.total;

  const visibles = useMemo(
    () => (filtro === 'Todas' ? fotos : filtro === 'Mías' ? fotos.filter((f) => autor && f.autor === autor) : fotos.filter((f) => f.momento === filtro)),
    [fotos, filtro, autor],
  );

  async function subir(files) {
    const lista = [...files];
    if (!lista.length) return;
    setError('');
    guardarLS(LS_AUTOR, autor);
    const items = await encolar(lista, { autor, momento, clave });
    procesar(items);
  }

  const filtros = [
    ['Todas', t('Todas', 'All')],
    ...boda.momentos.map((m) => [m, rotuloMomento(m)]),
    ...(autor ? [['Mías', t('Mías', 'Mine')]] : []),
  ];
  const n = fotos.length;

  return (
    <PaginaApp titulo={<>{t('Álbum', 'Shared')} <em>{t('compartido', 'album')}</em></>}
      bajada={`${n} ${n === 1 ? t('recuerdo', 'memory') : t('recuerdos', 'memories')}${n ? '' : t(', por ahora', ' so far')} · ${boda.novios.hashtag}`}
      accion={n > 1 && <button type="button" className="btn claro" onClick={() => setPresentar(true)}>▶ {t('Ver como presentación', 'Play as slideshow')}</button>}>
        {presentar && <Suspense fallback={null}><Presentacion fotos={visibles.length > 1 ? visibles : fotos} alCerrar={() => setPresentar(false)} /></Suspense>}
        {claveOk === null && <Bloque alto={180} className="esq-subida" />}

        {claveOk === false && (
          <form className="clave-album" onSubmit={(e) => { e.preventDefault(); setClave(claveEscrita.trim().toUpperCase()); }}>
            <p style={{ maxWidth: '48ch' }}>{t('Para subir fotos, escanea el código QR de tu mesa o escribe la clave del álbum.', "To upload photos, scan the QR code on your table or type the album's code.")}</p>
            {clave && <p className="aviso error">{t('Esa clave no es correcta.', "That code isn't correct.")}</p>}
            <div className="buscar-codigo">
              <input value={claveEscrita} onChange={(e) => setClaveEscrita(e.target.value)} placeholder={t('Clave', 'Code')} aria-label={t('Clave del álbum', 'Album code')} autoComplete="off" />
              <button className="btn">{t('Entrar', 'Enter')}</button>
            </div>
          </form>
        )}
        {claveOk && (
          <div className="subida sobre-oliva">
            <div className="campos">
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
            <button className="btn btn-subir" disabled={subiendo} onClick={() => entrada.current.click()}>
              {t('Elegir o tomar fotos', 'Choose or take photos')}
            </button>
            {subida && (
              <div style={{ marginTop: 16 }} aria-live="polite">
                <div className="barra"><div style={{ width: `${((subida.hechas + subida.fallas) / subida.total) * 100}%` }} /></div>
                <p className="chico" style={{ margin: '8px 0 0' }}>
                  {subiendo
                    ? `${t('Subiendo', 'Uploading')} ${subida.hechas + subida.fallas + 1} ${t('de', 'of')} ${subida.total}…`
                    : `${t('¡Listo!', 'Done!')} ${subida.hechas} ${subida.hechas === 1 ? t('subida', 'uploaded') : t('subidas', 'uploaded')}${subida.fallas ? `, ${subida.fallas} ${t('con error', 'failed')}` : ''}. ${t('Gracias.', 'Thank you.')}`}
                  {subiendo && <><br />{t('Si cierras la página, las que faltan se suben solas cuando vuelvas.', 'If you close the page, the rest will upload when you come back.')}</>}
                </p>
                {subiendo && subida.reintentando > 0 && (
                  <p className="chico" style={{ margin: '4px 0 0', color: 'var(--texto-2)' }}>
                    {t('La señal está débil: reintentando solo.', 'Weak signal: retrying automatically.')}
                  </p>
                )}
              </div>
            )}
            {error && <p className="aviso error" style={{ marginTop: 12 }}>{error}</p>}
          </div>
        )}
        {!claveOk && error && <p className="aviso error">{error}</p>}

        <div className="filtros" role="group" aria-label={t('Filtrar por momento', 'Filter by moment')}>
          {filtros.map(([valor, rotulo]) => (
            <button key={valor} type="button" aria-pressed={filtro === valor} className={filtro === valor ? 'activo' : ''} onClick={() => setFiltro(valor)}>{rotulo}</button>
          ))}
        </div>

        {visibles.length
          ? <Mosaico items={visibles} conPie />
          : <p className="suave" style={{ padding: '48px 0' }}>{t('Aún no hay fotos aquí. Sé el primero en compartir una.', 'No photos here yet. Be the first to share one.')}</p>}
    </PaginaApp>
  );
}
