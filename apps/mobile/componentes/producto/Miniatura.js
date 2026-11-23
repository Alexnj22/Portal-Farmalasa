// La miniatura de la foto de un producto (2026-11-23), gemela de
// `FotoMiniatura` del portal: pide la copia chica (`product-photos/chicas/…`,
// 400 px) en vez de la original y, si esa copia no existe, cae a la original.
// La traducción vive en `@nucleo/utils/fotoChica`. `onError` se llama sólo si
// falla también la original.
import { useState } from 'react';
import { Image } from 'react-native';
import { urlFotoChica } from '@nucleo/utils/fotoChica';

export default function Miniatura({ uri, style, onError }) {
  const chica = urlFotoChica(uri);
  // La dirección chica que falló: si cambia la foto, se vuelve a intentar.
  const [fallo, setFallo] = useState(null);
  const usar = chica && fallo !== chica ? chica : uri;
  return <Image source={{ uri: usar }} style={style} resizeMode="contain" onError={() => { if (usar === chica) setFallo(chica); else onError?.(); }} />;
}
