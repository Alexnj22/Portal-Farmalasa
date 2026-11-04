// La foto de un producto, o —si todavía no tiene— un cuadro con su color y sus
// iniciales: casi todo el catálogo está sin foto y no puede verse vacío.
//
// 2026-11-04 (auditoría de rendimiento): la miniatura de 40-160 pt bajaba la
// foto ORIGINAL del almacenamiento (cientos de kB, a veces más de 1000 px) y
// el teléfono la achicaba en memoria — en el catálogo, una por tarjeta.
// Ahora pide la versión achicada al servidor de imágenes del almacenamiento
// (`/render/image/public/…?height=…`). Que ese servidor está encendido en el
// proyecto no es una suposición: el portal ya lo usa en producción
// (src/utils/storageFiles.js, `aRender`, medido 168 kB PNG → 20 kB WEBP). Lo
// que no está medido es la ruta PÚBLICA con `height` (allá son firmadas), así
// que si la versión achicada falla por lo que sea, se cae a la original: en el
// peor caso se ve como antes. Sólo se reescribe una dirección pública del
// almacenamiento; cualquier otra va tal cual.
//
// Además: `recyclingKey` para que una celda reciclada de la lista no muestre un
// instante la foto de otro producto, y el alto pedido redondeado a pocos
// tamaños (×densidad de la pantalla) para que el caché sirva entre pantallas.
import { useState } from 'react';
import { PixelRatio, Text, View } from 'react-native';
import { Image as ImagenCache } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Icono from './Icono';
import { iniciales, tonoDe } from '../lib/catalogo';

const PUBLICA = '/storage/v1/object/public/';
const ALTOS = [96, 192, 320, 480, 720];

function achicada(url, altoPt) {
  if (typeof url !== 'string' || !url.includes(PUBLICA)) return null;
  const px = Math.ceil(altoPt * PixelRatio.get());
  const alto = ALTOS.find((a) => a >= px) ?? ALTOS[ALTOS.length - 1];
  const sep = url.includes('?') ? '&' : '?';
  return `${url.replace(PUBLICA, '/storage/v1/render/image/public/')}${sep}height=${alto}&resize=contain&quality=80`;
}

export default function FotoProducto({ id, nombre, foto, alto = 120, radio = 16, grande = false }) {
  // La dirección achicada que falló (no la original): así, si cambia la foto,
  // se vuelve a intentar con la nueva.
  const [fallo, setFallo] = useState(null);
  if (foto) {
    const chica = achicada(foto, alto);
    const uri = chica && fallo !== chica ? chica : foto;
    return (
      // El blanco es a propósito: las fotos de producto vienen recortadas
      // sobre blanco y en un fondo de color se ve el borde.
      <View style={{ height: alto, borderRadius: radio, backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
        <ImagenCache source={{ uri }} cachePolicy="memory-disk" contentFit="contain" transition={150}
          recyclingKey={String(id ?? foto)} onError={() => { if (uri === chica) setFallo(chica); }}
          style={{ flex: 1, margin: grande ? 18 : 10 }} accessibilityIgnoresInvertColors />
      </View>
    );
  }
  const [a, b] = tonoDe(id);
  return (
    <LinearGradient colors={[a, b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ height: alto, borderRadius: radio, alignItems: 'center', justifyContent: 'center', gap: grande ? 10 : 4 }}>
      <Icono sf="pills.fill" respaldo="" tam={grande ? 34 : 20} color="rgba(255,255,255,0.85)" />
      <Text style={{ color: '#FFFFFF', fontSize: grande ? 28 : 18, fontWeight: '900', letterSpacing: 1 }}>{iniciales(nombre)}</Text>
    </LinearGradient>
  );
}
