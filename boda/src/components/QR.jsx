import { useEffect, useState } from 'react';

// La librería del QR baja sólo cuando hay que dibujar uno.
let libQR = null;
function cargarQR() {
  if (!libQR) {
    libQR = import('qrcode').then((m) => m.default || m).catch((err) => { libQR = null; throw err; });
  }
  return libQR;
}

export default function QR({ texto, tam = 200, ...resto }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let vivo = true;
    cargarQR()
      .then((QRCode) => QRCode.toDataURL(texto, { width: tam * 2, margin: 1, color: { dark: '#2f2a24', light: '#ffffff' } }))
      .then((u) => { if (vivo) setSrc(u); })
      .catch((e) => { console.error('QR', e); if (vivo) setSrc(''); });
    return () => { vivo = false; };
  }, [texto, tam]);
  return src ? <img src={src} width={tam} height={tam} alt={`Código QR: ${texto}`} {...resto} /> : <div className="esq" style={{ width: tam, height: tam }} aria-hidden />;
}
