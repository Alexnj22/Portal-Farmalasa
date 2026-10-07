// Inyecciones: arriba las pendientes —las que ya pagaste y te faltan aplicar,
// en cualquier sala—, y abajo el HISTORIAL del último año con fecha, sucursal
// y si la compraste aquí o la trajiste (usuario, 2026-10-06: «siempre llevar
// el control»; las traídas aparecen cuando la sala elige tu ficha al cobrar).
// Una mezcla se muestra como una sola aplicación con sus partes.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../componentes/ui';
import { Entrada, NumeroAnimado } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';
import Icono from '../componentes/Icono';

/** Un anillo que se expande y se desvanece detrás del número: «tienes algo pendiente». */
function Anillo({ color }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }), 3);
  }, [p]);
  const estilo = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - p.value),
    transform: [{ scale: 1 + p.value * 0.9 }],
  }));
  return <Animated.View style={[{ position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 3, borderColor: color }, estilo]} />;
}

/** «DICLOFENACO 75 MG 3 ml + DEXAMETASONA 4 MG 1 ml» → [{nombre, ml}, …]. */
function partes(producto) {
  return String(producto ?? '').split(' + ').map((p) => {
    const m = p.match(/^(.*?)\s+([\d.]+)\s*ml$/i);
    return m ? { nombre: m[1], ml: m[2] } : { nombre: p, ml: null };
  });
}

const titulo = (s) => String(s ?? '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, l) => a + l.toUpperCase());

export default function Inyecciones() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [datos, setDatos] = useState(null);
  const [refrescando, setRefrescando] = useState(false);

  // Si falla la red y ya había datos, se conservan: un tropiezo al cambiar de
  // pestaña no puede cambiar la lista por una pantalla de error.
  const cargar = useCallback(async () => { const r = await pedir('inyecciones'); setDatos((ant) => (r?.ok || !ant?.ok ? r : ant)); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;
  if (datos.pendiente) {
    return (
      <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="Disponible al completar tu ficha">Cuando completes tu registro en sala verás aquí tus inyecciones.</Vacio>
      </Pantalla>
    );
  }

  const pendientes = datos.disponibles ?? [];
  const aplicadas = datos.aplicadas ?? [];
  const verde = t.color.verde;

  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Entrada indice={0}>
        <Tarjeta tono={verde} estilo={{ alignItems: 'center', paddingVertical: 28, gap: 10 }}>
          <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
            {pendientes.length ? <Anillo color={verde} /> : null}
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: suave(verde, t.oscuro ? 0.3 : 0.2), alignItems: 'center', justifyContent: 'center' }}>
              <NumeroAnimado valor={pendientes.length} formato="entero"
                estilo={{ fontSize: 44, fontWeight: '900', color: t.color.verdeTexto, textAlign: 'center', minWidth: 60 }} />
            </View>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colorSistema.texto }}>
            {pendientes.length === 1 ? 'Inyección por aplicar' : pendientes.length ? 'Inyecciones por aplicar' : 'Estás al día'}
          </Text>
          <Texto nivel={2} estilo={{ textAlign: 'center', fontSize: 15 }}>
            {pendientes.length
              ? 'Ya están pagadas. Pasa a cualquiera de nuestras salas y te la aplicamos.'
              : 'No tienes inyecciones pendientes. Cuando compres una aparece aquí.'}
          </Texto>
        </Tarjeta>
      </Entrada>

      {pendientes.map((a, i) => {
        const ps = partes(a.producto);
        const mezcla = ps.length > 1;
        return (
          <Entrada key={a.id} indice={i + 1}>
            <Tarjeta estilo={{ flexDirection: 'row', gap: 14, padding: 0 }}>
              {/* La barra de acento: verde, lo que es tuyo y está listo. */}
              <View style={{ width: 6, backgroundColor: verde }} />
              <View style={{ flex: 1, paddingVertical: 16, paddingRight: 16, gap: 8 }}>
                {mezcla ? (
                  <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: t.color.verdeTexto }}>MEZCLA · UNA SOLA APLICACIÓN</Text>
                ) : null}
                {ps.map((p, j) => (
                  <View key={j} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: colorSistema.texto }} numberOfLines={2}>{titulo(p.nombre)}</Text>
                    {(p.ml ?? (j === 0 && !mezcla ? a.dosis_ml : null)) != null ? (
                      <View style={{ backgroundColor: suave(verde, 0.18), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.verdeTexto }}>{Number(p.ml ?? a.dosis_ml)} ml</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
                <Texto nivel={2} estilo={{ fontSize: 14 }}>
                  {a.origen === 'TRAIDA' ? 'La trajiste · pagada' : 'Pagada'} el {fecha(a.pagada_at)}{a.sala ? ` en ${a.sala}` : ''}
                </Texto>
              </View>
            </Tarjeta>
          </Entrada>
        );
      })}

      {aplicadas.length ? (
        <>
          <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: colorSistema.texto2, marginLeft: 4, marginTop: 8 }}>
            Historial
          </Text>
          <Tarjeta estilo={{ padding: 0, gap: 0 }}>
            {aplicadas.map((a, i) => (
              <View key={`${a.aplicada_at}-${i}`}>
                {i > 0 ? <View style={{ height: 0.5, backgroundColor: colorSistema.separador, marginLeft: 58 }} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: suave(verde, 0.2) }}>
                    <Icono sf="checkmark" respaldo="✓" tam={13} color={t.color.verdeTexto} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto }} numberOfLines={2}>
                      {partes(a.producto).map((p) => titulo(p.nombre)).join(' + ')}
                    </Text>
                    <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>
                      {fecha(a.aplicada_at)}{a.sala ? ` · ${a.sala}` : ''}{a.origen === 'TRAIDA' ? ' · la trajiste' : ''}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </Tarjeta>
        </>
      ) : null}

      {/* Lo que antes era una advertencia ahora es una invitación: traída o
          comprada, si la sala elige tu ficha, queda aquí. */}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginHorizontal: 8, marginTop: 4 }}>
        <Icono sf="info.circle" respaldo="i" tam={15} color={colorSistema.texto3} />
        <Texto nivel={3} estilo={{ flex: 1, fontSize: 13 }}>
          ¿Traes tu propio medicamento? Te lo aplicamos en cualquier sucursal. Pide que lo anoten con tu DUI y también queda en tu historial.
        </Texto>
      </View>
    </Pantalla>
  );
}
