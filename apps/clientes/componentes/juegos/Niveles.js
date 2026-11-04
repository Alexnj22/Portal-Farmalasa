// Los niveles de los juegos de Bienestar (2026-11-04, «aplica los niveles a los
// juegos que ya están»). Tres piezas que comparten Memoria, Torre y Burbujas:
//
// - `useProgreso`: hasta qué nivel llegó y cuántas estrellas sacó en cada uno,
//   guardado en el teléfono (expo-secure-store). El nivel superado se guarda
//   como número, igual que el récord viejo de Burbujas, así quien ya jugaba
//   no pierde lo que tenía.
// - `SelectorNiveles`: la grilla de niveles —abiertos, cerrados y sus
//   estrellas—. Son vistas comunes de React Native: se pintan una vez y no
//   compiten con el juego, que en esa pantalla no está corriendo.
// - `TarjetaNivel`: el cierre de un nivel con sus estrellas.
//
// Y `useRacha` para los ejercicios que no son juegos (Respira, 5·4·3·2·1): los
// días seguidos que se hicieron, sin puntaje ni presión.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Tocable, useSinMovimiento } from '../animacion';
import Icono from '../Icono';
import { BLANCO, BLANCO_2, BLANCO_3, PanelVidrio, VIDRIO, VIDRIO_BORDE } from './Escena';
import { tacto } from '../../lib/sensaciones';

export const ORO = '#FFD86B';
const APAGADA = 'rgba(255,255,255,0.22)';

/** Progreso de un juego por niveles: el último superado y las estrellas de cada uno. */
export function useProgreso(claveNivel, claveEstrellas) {
  const [estado, setEstado] = useState({ superado: 0, estrellas: {}, listo: false });
  const ref = useRef(estado);
  useEffect(() => {
    let vivo = true;
    Promise.all([
      SecureStore.getItemAsync(claveNivel).catch(() => null),
      SecureStore.getItemAsync(claveEstrellas).catch(() => null),
    ]).then(([n, e]) => {
      if (!vivo) return;
      let estrellas = {};
      try { const x = JSON.parse(e || '{}'); if (x && typeof x === 'object') estrellas = x; } catch { estrellas = {}; }
      const superado = Math.max(Number(n) || 0, ...Object.keys(estrellas).map(Number).filter(Number.isFinite), 0);
      ref.current = { superado, estrellas, listo: true };
      setEstado(ref.current);
    });
    return () => { vivo = false; };
  }, [claveNivel, claveEstrellas]);

  // Devuelve si es la primera vez que pasa ese nivel y si mejoró sus estrellas.
  const registrar = useCallback((nivel, estrellas) => {
    const antes = ref.current;
    const previas = antes.estrellas[nivel] || 0;
    const nuevo = {
      superado: Math.max(antes.superado, nivel),
      estrellas: { ...antes.estrellas, [nivel]: Math.max(previas, estrellas) },
      listo: true,
    };
    ref.current = nuevo;
    setEstado(nuevo);
    SecureStore.setItemAsync(claveNivel, String(nuevo.superado)).catch(() => {});
    SecureStore.setItemAsync(claveEstrellas, JSON.stringify(nuevo.estrellas)).catch(() => {});
    return { primera: nivel > antes.superado, mejoro: estrellas > previas };
  }, [claveNivel, claveEstrellas]);

  const total = Object.values(estado.estrellas).reduce((s, k) => s + (Number(k) || 0), 0);
  return { ...estado, total, registrar };
}

/** Tres estrellas, encendidas hasta `n`. `animar`: aparecen una tras otra (una sola vez, al montarse). */
export function Estrellas({ n, tam = 14, animar = false, hueco = 2 }) {
  const quieta = useSinMovimiento();
  return (
    <View style={{ flexDirection: 'row', gap: hueco }} accessibilityLabel={`${n} de 3 estrellas`}>
      {[1, 2, 3].map((k) => (
        <Animated.View key={k} entering={animar && !quieta ? ZoomIn.delay(120 + k * 160).springify() : undefined}>
          <Icono sf="star.fill" respaldo="★" tam={tam} color={k <= n ? ORO : APAGADA} />
        </Animated.View>
      ))}
    </View>
  );
}

/**
 * La grilla de niveles. `total`: cuántos hay. `progreso`: lo de `useProgreso`.
 * `detalle(n)`: una línea corta bajo el número («3×4», «12 s»).
 * Se abre hasta el siguiente al último superado.
 */
export function SelectorNiveles({ total, progreso, alElegir, detalle, titulo = 'Elige un nivel', columnas = 4, margen = 32 }) {
  const { width } = useWindowDimensions();
  // El ancho real de la grilla (bordes y rellenos de quien la contiene); hasta
  // medirlo, el de la ventana menos `margen`.
  const [medido, setMedido] = useState(0);
  const hueco = 10;
  const disponible = medido || Math.min(width, 560) - margen;
  const lado = Math.floor((disponible - hueco * (columnas - 1)) / columnas);
  const abierto = progreso.superado + 1;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Text accessibilityRole="header" style={{ flexShrink: 1, fontSize: 20, fontWeight: '800', color: BLANCO }}>{titulo}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={`${progreso.total} de ${total * 3} estrellas`}>
          <Icono sf="star.fill" respaldo="★" tam={15} color={ORO} />
          <Text style={{ fontSize: 15, fontWeight: '800', color: BLANCO, fontVariant: ['tabular-nums'] }}>{progreso.total} / {total * 3}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: hueco }}
        onLayout={(e) => { const w = Math.floor(e.nativeEvent.layout.width); if (w && w !== medido) setMedido(w); }}>
        {Array.from({ length: total }, (_, i) => {
          const n = i + 1;
          const cerrado = n > abierto;
          const siguiente = n === abierto && n <= total;
          const k = progreso.estrellas[n] || 0;
          const texto = detalle?.(n);
          const etiqueta = cerrado ? `Nivel ${n}, cerrado` : `Nivel ${n}${texto ? `, ${texto}` : ''}${k ? `, ${k} de 3 estrellas` : siguiente ? ', por jugar' : ''}`;
          const caja = (
            <View style={{
              width: lado, minHeight: lado, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 4, gap: 3,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: siguiente ? BLANCO : cerrado ? 'rgba(0,0,0,0.16)' : VIDRIO,
              borderWidth: 1, borderColor: siguiente ? BLANCO : cerrado ? 'rgba(255,255,255,0.10)' : VIDRIO_BORDE,
            }}>
              {cerrado ? <Icono sf="lock.fill" respaldo="" tam={20} color={BLANCO_3} /> : (
                <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 24, fontWeight: '900', color: siguiente ? '#1B1B2F' : BLANCO, fontVariant: ['tabular-nums'] }}>{n}</Text>
              )}
              {texto ? (
                <Text maxFontSizeMultiplier={1.3} numberOfLines={2} style={{ fontSize: 11, fontWeight: '700', textAlign: 'center',
                  color: siguiente ? 'rgba(27,27,47,0.62)' : cerrado ? 'rgba(255,255,255,0.4)' : BLANCO_2 }}>{texto}</Text>
              ) : null}
              {!cerrado && !siguiente ? <Estrellas n={k} tam={11} hueco={1} /> : null}
              {siguiente ? <Icono sf="play.fill" respaldo="▶" tam={12} color="#1B1B2F" /> : null}
            </View>
          );
          if (cerrado) {
            return <View key={n} accessible accessibilityLabel={etiqueta} accessibilityState={{ disabled: true }}>{caja}</View>;
          }
          return (
            <Tocable key={n} etiqueta={etiqueta} alTocar={() => { tacto.roce(); alElegir(n); }}>{caja}</Tocable>
          );
        })}
      </View>
    </View>
  );
}

/** El cierre de un nivel: estrellas, título y una línea. Los botones van como hijos. */
export function TarjetaNivel({ estrellas, titulo, texto, insignia, fondo = 'rgba(10,12,40,0.62)', children }) {
  return (
    <PanelVidrio estilo={{ gap: 10, alignItems: 'center', backgroundColor: fondo }}>
      {estrellas != null ? <Estrellas n={estrellas} tam={36} animar hueco={6} /> : null}
      {insignia ? (
        <View style={{ paddingHorizontal: 12, paddingVertical: 4, minHeight: 26, borderRadius: 13, justifyContent: 'center', backgroundColor: ORO }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#3A2A00' }}>{insignia}</Text>
        </View>
      ) : null}
      <Text style={{ fontSize: 22, fontWeight: '800', color: BLANCO, textAlign: 'center' }}>{titulo}</Text>
      {texto ? <Text style={{ fontSize: 15, lineHeight: 21, color: BLANCO_2, textAlign: 'center' }}>{texto}</Text> : null}
      <View style={{ alignSelf: 'stretch', gap: 10 }}>{children}</View>
    </PanelVidrio>
  );
}

// ——— Días seguidos (Respira, 5·4·3·2·1) ———
const diaDe = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoy = () => diaDe(new Date());
const ayer = () => { const d = new Date(); d.setDate(d.getDate() - 1); return diaDe(d); };

/** Días seguidos que se hizo un ejercicio. `marcar()` al completarlo; un día cuenta una vez. */
export function useRacha(clave) {
  const [r, setR] = useState({ dias: 0, ultimo: null, veces: 0 });
  const ref = useRef(r);
  useEffect(() => {
    SecureStore.getItemAsync(clave).then((v) => {
      try { const x = JSON.parse(v || 'null'); if (x && typeof x === 'object') { ref.current = { dias: Number(x.dias) || 0, ultimo: x.ultimo || null, veces: Number(x.veces) || 0 }; setR(ref.current); } } catch { /* sin datos */ }
    }).catch(() => {});
  }, [clave]);
  const marcar = useCallback(() => {
    const a = ref.current;
    const h = hoy();
    const dias = a.ultimo === h ? a.dias : a.ultimo === ayer() ? a.dias + 1 : 1;
    const nuevo = { dias, ultimo: h, veces: a.veces + 1 };
    ref.current = nuevo;
    setR(nuevo);
    SecureStore.setItemAsync(clave, JSON.stringify(nuevo)).catch(() => {});
    return nuevo;
  }, [clave]);
  // Si el último día fue antes de ayer, la racha ya se cortó.
  const vigente = r.ultimo === hoy() || r.ultimo === ayer() ? r.dias : 0;
  return { dias: vigente, hoyHecho: r.ultimo === hoy(), veces: r.veces, marcar };
}

/** «3 días seguidos» en una píldora, sólo si hay racha. */
export function textoRacha(dias) {
  if (!dias) return null;
  return dias === 1 ? '1 día' : `${dias} días seguidos`;
}
