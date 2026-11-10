import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { boda } from '../config';
import { api } from '../lib/api';
import Mosaico from '../components/Mosaico';

const LS_CLAVE = 'boda-clave-album';
const LS_AUTOR = 'boda-autor';
const leerLS = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, v); } catch { /* modo privado */ } };

export default function Album() {
  const [params, setParams] = useSearchParams();
  const [clave, setClave] = useState(() => (params.get('k') || leerLS(LS_CLAVE)).toUpperCase());
  const [claveOk, setClaveOk] = useState(null);
  const [claveEscrita, setClaveEscrita] = useState('');
  const [autor, setAutor] = useState(() => leerLS(LS_AUTOR));
  const [momento, setMomento] = useState(boda.momentos[0]);
  const [fotos, setFotos] = useState([]);
  const [filtro, setFiltro] = useState('Todas');
  const [subida, setSubida] = useState(null); // { total, hechas, fallas }
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

  const visibles = useMemo(
    () => (filtro === 'Todas' ? fotos : filtro === 'Mías' ? fotos.filter((f) => autor && f.autor === autor) : fotos.filter((f) => f.momento === filtro)),
    [fotos, filtro, autor],
  );

  async function subir(files) {
    const lista = [...files];
    if (!lista.length) return;
    setError('');
    guardarLS(LS_AUTOR, autor);
    let hechas = 0; let fallas = 0;
    setSubida({ total: lista.length, hechas, fallas });
    // De a 3 en paralelo: rápido sin ahogar la conexión del salón.
    const cola = [...lista];
    const trabajador = async () => {
      while (cola.length) {
        const f = cola.shift();
        try {
          if (f.size > 25 * 1024 * 1024 && f.type.startsWith('video/')) throw new Error('Video muy pesado (máx. 25 MB)');
          await api.subirFoto(f, { autor, momento, clave });
          hechas++;
        } catch (e) {
          fallas++;
          setError(e.message);
        }
        setSubida({ total: lista.length, hechas, fallas });
      }
    };
    await Promise.all([trabajador(), trabajador(), trabajador()]);
    if (entrada.current) entrada.current.value = '';
    api.listarFotos().then(setFotos).catch(() => {});
    setTimeout(() => setSubida(null), 4000);
  }

  return (
    <>
      <nav className="nav">
        <div className="contenedor">
          <Link to="/" className="marca">{boda.novios.el[0]} & {boda.novios.ella[0]}</Link>
          <ul><li><Link to="/">Inicio</Link></li><li><a className="activo" href="#">Álbum</a></li></ul>
        </div>
      </nav>
      <section className="seccion" style={{ paddingTop: 40 }}>
        <div className="contenedor">
          <div className="titulo centro">
            <span className="script" style={{ color: 'var(--oro)', fontSize: '2rem' }}>Álbum compartido</span>
            <h2>{boda.novios.firma}</h2>
            <p className="suave">{fotos.length} {fotos.length === 1 ? 'recuerdo' : 'recuerdos'} · {boda.novios.hashtag}</p>
          </div>

          <div className="angosto" style={{ marginBottom: 24 }}>
            {claveOk === false && (
              <form className="tarjeta centro" onSubmit={(e) => { e.preventDefault(); setClave(claveEscrita.trim().toUpperCase()); }}>
                <p>Para subir fotos escanea el código QR de tu mesa, o escribe la clave del álbum:</p>
                {clave && <p className="aviso error">Esa clave no es correcta.</p>}
                <div style={{ display: 'flex', gap: 8, maxWidth: 320, margin: '0 auto' }}>
                  <input value={claveEscrita} onChange={(e) => setClaveEscrita(e.target.value)} placeholder="Clave" aria-label="Clave del álbum" style={{ textTransform: 'uppercase', textAlign: 'center' }} />
                  <button className="btn">Entrar</button>
                </div>
              </form>
            )}
            {claveOk && (
              <div className="subida">
                <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', textAlign: 'left' }}>
                  <label className="campo" style={{ margin: 0 }}><span>Tu nombre (opcional)</span>
                    <input value={autor} onChange={(e) => setAutor(e.target.value)} maxLength={60} placeholder="Para saber quién la tomó" />
                  </label>
                  <label className="campo" style={{ margin: 0 }}><span>Momento</span>
                    <select value={momento} onChange={(e) => setMomento(e.target.value)}>
                      {boda.momentos.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </label>
                </div>
                <input ref={entrada} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => subir(e.target.files)} />
                <button className="btn oro" style={{ marginTop: 16, fontSize: '1rem' }} disabled={!!subida && subida.hechas + subida.fallas < subida.total} onClick={() => entrada.current.click()}>
                  📷 Elegir o tomar fotos
                </button>
                {subida && (
                  <div style={{ marginTop: 14 }}>
                    <div className="barra"><div style={{ width: `${((subida.hechas + subida.fallas) / subida.total) * 100}%` }} /></div>
                    <p className="chico suave" style={{ margin: '6px 0 0' }}>
                      {subida.hechas + subida.fallas < subida.total
                        ? `Subiendo ${subida.hechas + subida.fallas + 1} de ${subida.total}…`
                        : `¡Listo! ${subida.hechas} ${subida.hechas === 1 ? 'subida' : 'subidas'}${subida.fallas ? `, ${subida.fallas} con error` : ''}. Gracias 💛`}
                    </p>
                  </div>
                )}
              </div>
            )}
            {error && <p className="aviso error" style={{ marginTop: 12 }}>{error}</p>}
          </div>

          <div className="filtros" role="tablist">
            {['Todas', ...boda.momentos, ...(autor ? ['Mías'] : [])].map((m) => (
              <button key={m} role="tab" aria-selected={filtro === m} className={filtro === m ? 'activo' : ''} onClick={() => setFiltro(m)}>{m}</button>
            ))}
          </div>

          {visibles.length
            ? <Mosaico items={visibles} conPie />
            : <p className="centro suave" style={{ padding: 40 }}>Aún no hay fotos aquí. ¡Sé el primero en compartir una!</p>}
        </div>
      </section>
    </>
  );
}
