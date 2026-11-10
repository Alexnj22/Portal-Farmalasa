import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export default function QR({ texto, tam = 200, ...resto }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(texto, { width: tam * 2, margin: 1, color: { dark: '#2f2a24', light: '#ffffff' } })
      .then(setSrc).catch(() => setSrc(''));
  }, [texto, tam]);
  return src ? <img src={src} width={tam} height={tam} alt={`Código QR: ${texto}`} {...resto} /> : <div style={{ width: tam, height: tam }} />;
}
