// La foto de un producto, o —si todavía no tiene— un cuadro con su color y sus
// iniciales: casi todo el catálogo está sin foto y no puede verse vacío.
//
// 2026-11-04 (auditoría de rendimiento): la miniatura de 40-160 pt bajaba la
// foto ORIGINAL y el teléfono la achicaba en memoria — una por tarjeta.
//
// 2026-11-10: esa miniatura se pedía al servidor de imágenes del almacenamiento
// (`/render/image/…`), que cobra por cada foto distinta que achica en el mes;
// el plan trae 100 y la app lo llevó a 208. Ahora la copia chica se hace UNA vez
// al subir la foto y se guarda al lado, en `product-photos/chicas/<ruta>` a 400
// px de lado mayor (src/plataforma/fotoConMiniatura.js, la función
// recortar-foto-producto y, para las que ya estaban,
// scripts/miniaturas-catalogo.py). Si una copia no existe, se cae a la original:
// en el peor caso se ve como antes. Sólo se reescribe una dirección pública del
// catálogo; cualquier otra va tal cual.
//
// Además: `recyclingKey` para que una celda reciclada de la lista no muestre un
// instante la foto de otro producto.
import { useState } from 'react';
import { PixelRatio, Text, View } from 'react-native';
import { Image as ImagenCache } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import Icono from './Icono';
import { iniciales, tonoDe } from '../lib/catalogo';

const CATALOGO = '/storage/v1/object/public/product-photos/';
const LADO_CHICA = 400;   // el de fotoConMiniatura.js

function achicada(url, altoPt) {
  if (typeof url !== 'string' || !url.includes(CATALOGO) || url.includes(`${CATALOGO}chicas/`)) return null;
  // Más grande que la copia chica (la ficha del producto), la original.
  if (Math.ceil(altoPt * PixelRatio.get()) > LADO_CHICA) return null;
  return url.replace(CATALOGO, `${CATALOGO}chicas/`);
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
