import { useEffect, useState } from 'react';
import { api, esVideo } from '../../lib/api';
import { fechaHora } from '../../lib/fechas';

// client-zip sólo se descarga al apretar el botón.
let zipPromise = null;
function getZip() {
  if (!zipPromise) {
    zipPromise = import('client-zip')
      .catch((err) => { zipPromise = null; throw err; });
  }
  return zipPromise;
}

// Un ZIP de 800 fotos no cabe cómodo en la memoria de un teléfono: se parte.
const POR_ZIP = 250;

function nombreArchivo(f, i) {
  const ext = (f.ruta.split('.').pop() || 'jpg').toLowerCase();
  const fecha = f.created_at.slice(0, 16).replace(/[-:T]/g, '');
  const quien = (f.autor || 'anonimo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 30);
  const carpeta = (f.momento || 'Sin momento').replace(/[\\/:*?"<>|]+/g, '_');
  return `${carpeta}/${fecha}_${quien}_${String(i + 1).padStart(4, '0')}.${ext}`;
}

export default function FotosAdmin() {
  const [fotos, setFotos] = useState([]);
  const [error, setError] = useState('');
  const [zip, setZip] = useState(null); // { parte, partes, hechas, total }
  const cargar = () => api.listarFotos({ incluirOcultas: true }).then(setFotos).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  const accion = (f) => async () => { try { await f(); cargar(); } catch (e) { setError(e.message); } };

  function listaEnlaces() {
    const texto = fotos.filter((f) => !f.oculta).map((f) => f.url).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain' }));
    a.download = 'album-enlaces.txt';
    a.click();
  }

  async function descargarZip() {
    setError('');
    const visibles = fotos.filter((f) => !f.oculta).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!visibles.length) return;
    const partes = Math.ceil(visibles.length / POR_ZIP);
    let hechas = 0;
    try {
      const { downloadZip } = await getZip();
      for (let p = 0; p < partes; p++) {
        const tanda = visibles.slice(p * POR_ZIP, (p + 1) * POR_ZIP);
        setZip({ parte: p + 1, partes, hechas, total: visibles.length });
        async function* archivos() {
          for (const [i, f] of tanda.entries()) {
            const r = await fetch(f.url);
            if (!r.ok) throw new Error(`No se pudo bajar ${f.ruta} (${r.status})`);
            yield { name: nombreArchivo(f, p * POR_ZIP + i), input: r, lastModified: new Date(f.created_at) };
            hechas++;
            setZip({ parte: p + 1, partes, hechas, total: visibles.length });
          }
        }
        const blob = await downloadZip(archivos()).blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = partes > 1 ? `album-boda-${p + 1}-de-${partes}.zip` : 'album-boda.zip';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setZip(null);
    }
  }

  return (
    <>
      <div className="herramientas">
        <b>{fotos.length} archivos · {fotos.filter((f) => f.oculta).length} ocultos</b>
        <button className="btn chico" style={{ marginLeft: 'auto' }} onClick={descargarZip} disabled={!!zip || !fotos.length}>
          {zip ? `Preparando ZIP ${zip.partes > 1 ? `${zip.parte}/${zip.partes} ` : ''}· ${zip.hechas} de ${zip.total}` : 'Descargar todo (ZIP)'}
        </button>
        <button className="btn claro chico" onClick={listaEnlaces}>Lista de enlaces</button>
      </div>
      <p className="chico suave">El ZIP trae las fotos visibles en tamaño completo, ordenadas en carpetas por momento{fotos.length > POR_ZIP ? `, partido en archivos de ${POR_ZIP}` : ''}. Conviene hacerlo desde una computadora.</p>
      {error && <p className="aviso error">{error}</p>}
      <div className="qr-tarjetas">
        {fotos.map((f) => (
          <div key={f.id} className="tarjeta" style={{ padding: 10, opacity: f.oculta ? 0.45 : 1 }}>
            {esVideo(f.ruta)
              ? <video src={f.url} poster={f.mini !== f.url ? f.mini : undefined} controls preload="none" style={{ width: '100%', borderRadius: 8 }} />
              : <img src={f.mini || f.url} alt="" loading="lazy" style={{ borderRadius: 8, aspectRatio: '1', objectFit: 'cover', width: '100%' }} />}
            <div className="chico suave" style={{ margin: '6px 0' }}>{f.autor || 'Anónimo'} · {f.momento || '—'} · {fechaHora(f.created_at)}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn claro chico" onClick={accion(() => api.ocultarFoto(f.id, !f.oculta))}>{f.oculta ? 'Mostrar' : 'Ocultar'}</button>
              <button className="btn peligro chico" onClick={accion(async () => { if (confirm('¿Borrar definitivamente?')) await api.borrarFoto(f); })}>Borrar</button>
            </div>
          </div>
        ))}
      </div>
      {!fotos.length && <p className="suave centro">Aún no hay fotos en el álbum.</p>}
    </>
  );
}
