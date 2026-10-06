// La primera pantalla de quien no tiene sesión. Dice qué trae la app en tres
// renglones y las dos reglas del programa —las mismas del afiche de la
// vitrina: verde lo que se gana, magenta lo que se usa—.
import { Image, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSesion } from '../lib/sesion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Boton, Tarjeta, Texto } from '../componentes/ui';
import { suave, useTema } from '../tema/tema';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';

const QUE_TRAE = [
  { sf: 'star.fill', simbolo: '★', titulo: 'Tus puntos', detalle: 'Tu saldo en dólares y lo que vence.', tono: 'verde' },
  { sf: 'tag.fill', simbolo: '%', titulo: 'Ofertas', detalle: 'Descuentos de la semana, algunos sólo para socios.', tono: 'magenta' },
  { sf: 'syringe.fill', simbolo: '+', titulo: 'Tus inyecciones', detalle: 'Las que ya pagaste y te faltan aplicar.', tono: 'verde' },
];

export default function Bienvenida() {
  const t = useTema();
  const motivo = useSesion((s) => s.motivoCierre);
  const ins = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={{
        flexGrow: 1, padding: 24, paddingTop: ins.top + 40, paddingBottom: ins.bottom + 24,
        justifyContent: 'space-between', gap: 28,
        width: '100%', maxWidth: 520, alignSelf: 'center',
      }}
    >
      <View style={{ gap: 22 }}>
        <View style={{ alignItems: 'center', gap: 14 }}>
          <Image source={require('../assets/icono.png')} style={{ width: 84, height: 84, borderRadius: 20 }} />
          <Text style={{ fontSize: 32, fontWeight: '800', letterSpacing: -0.5, color: colorSistema.texto, textAlign: 'center' }}>
            Puntos Salud
          </Text>
          <Texto nivel={2} estilo={{ textAlign: 'center', fontSize: 16, lineHeight: 23, maxWidth: 300 }}>
            Cada compra suma. Míralo todo desde tu teléfono.
          </Texto>
        </View>

        <Tarjeta estilo={{ gap: 14, paddingVertical: 18 }}>
          {QUE_TRAE.map((f) => {
            const color = f.tono === 'verde' ? t.color.verde : t.color.magenta;
            const texto = f.tono === 'verde' ? t.color.verdeTexto : t.color.magentaTexto;
            return (
              <View key={f.titulo} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: suave(color, t.oscuro ? 0.28 : 0.16),
                }}>
                  <Icono sf={f.sf} respaldo={f.simbolo} tam={19} color={texto} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colorSistema.texto }}>{f.titulo}</Text>
                  <Texto nivel={2} estilo={{ fontSize: 14 }}>{f.detalle}</Texto>
                </View>
              </View>
            );
          })}
        </Tarjeta>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Regla color={t.color.verde} texto={t.color.verdeTexto} grande="$1" chico="de compra = 1 punto" />
          <Regla color={t.color.magenta} texto={t.color.magentaTexto} grande="100 pts" chico="= $1 de descuento" />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        {motivo === 'vencida' ? <Texto nivel={2} estilo={{ textAlign: 'center' }}>Tu sesión terminó. Vuelve a entrar para ver tus puntos.</Texto> : null}
        <Boton alTocar={() => router.push('/entrar')}>Ya soy cliente</Boton>
        <Boton tipo="secundario" alTocar={() => router.push('/registro')}>Quiero unirme</Boton>
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 28, marginTop: 4 }}>
          <Text onPress={() => router.push('/vitrina')} accessibilityRole="link"
            style={{ fontSize: 16, fontWeight: '700', color: t.color.magentaTexto, paddingVertical: 12 }}>Ver ofertas</Text>
          <Text onPress={() => router.push('/sucursales')} accessibilityRole="link"
            style={{ fontSize: 16, fontWeight: '700', color: t.color.magentaTexto, paddingVertical: 12 }}>Sucursales</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function Regla({ color, texto, grande, chico }) {
  const t = useTema();
  return (
    <View style={{
      flex: 1, borderRadius: t.radio.tarjeta, padding: 14, gap: 2,
      backgroundColor: suave(color, t.oscuro ? 0.2 : 0.12), borderWidth: 1, borderColor: suave(color, 0.3),
    }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: texto }}>{grande}</Text>
      <Text style={{ fontSize: 13, fontWeight: '600', color: texto }}>{chico}</Text>
    </View>
  );
}
