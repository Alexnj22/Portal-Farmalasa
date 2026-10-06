// Inyecciones: SÓLO las pendientes —las que ya pagaste y te faltan aplicar—.
// Las aplicadas son historia de la sala; al cliente le sirve saber qué le
// queda y dónde puede ir (en cualquier sala: el servidor no las ata a la sala
// donde pagó). Una mezcla se muestra como una sola aplicación con sus partes.
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../../../componentes/ui';
import { Entrada, NumeroAnimado } from '../../../componentes/animacion';
import { colorSistema } from '../../../componentes/sistema';
import { useSesion } from '../../../lib/sesion';
import { fecha } from '../../../lib/formato';
import { suave, useTema } from '../../../tema/tema';

/** Un anillo que se expande y se desvanece detrás del número: «tienes algo pendiente». */
function Anillo({ color }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.cubic) }), -1);
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

  const cargar = useCallback(async () => { setDatos(await pedir('inyecciones')); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;
  if (datos.pendiente) {
    return (
      <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="Disponible al completar tu ficha">Cuando completes tu registro en sala verás aquí tus inyecciones.</Vacio>
      </Pantalla>
    );
  }

  const pendientes = datos.disponibles ?? [];
  const verde = t.color.verde;

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
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
                  Pagada el {fecha(a.pagada_at)}{a.sala ? ` en ${a.sala}` : ''}
                </Texto>
              </View>
            </Tarjeta>
          </Entrada>
        );
      })}

      {pendientes.length ? (
        <Texto nivel={3} estilo={{ fontSize: 13, textAlign: 'center', marginTop: 4 }}>
          Si trajiste tu medicamento de otra farmacia, esa aplicación no aparece aquí.
        </Texto>
      ) : null}
    </Pantalla>
  );
}
