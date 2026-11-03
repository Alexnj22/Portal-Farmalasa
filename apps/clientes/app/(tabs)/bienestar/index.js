// Bienestar (2026-11-03, pedido del usuario): la frase del día en grande y la
// zona anti estrés — cuatro ejercicios cortos que no piden cuenta ni red y
// funcionan igual sin conexión. Nada de esto se guarda en el servidor.
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Pantalla, RADIO, Seccion, Tarjeta } from '../../../componentes/ui';
import { Entrada, Tocable } from '../../../componentes/animacion';
import FraseDelDia from '../../../componentes/FraseDelDia';
import Icono from '../../../componentes/Icono';
import { colorSistema } from '../../../componentes/sistema';
import { useTema } from '../../../tema/tema';
import { navegar } from '../../../lib/navegar';

const EJERCICIOS = [
  { ruta: '/respira', sf: 'wind', titulo: 'Respira', detalle: 'Un círculo que te guía. De 1 a 5 minutos.', tono: (t) => [t.acentos.azul.fuerte, t.acentos.violeta.fuerte] },
  { ruta: '/burbujas', sf: 'circle.grid.3x3.fill', titulo: 'Burbujas', detalle: 'Revienta el plástico y suelta la tensión.', tono: (t) => [t.color.magenta, t.acentos.violeta.fuerte] },
  { ruta: '/memoria', sf: 'square.grid.2x2.fill', titulo: 'Memoria', detalle: 'Encuentra las parejas y despeja la mente.', tono: (t) => [t.acentos.verde.fuerte, t.acentos.azul.fuerte] },
  { ruta: '/anclaje', sf: 'hand.raised.fill', titulo: '5 · 4 · 3 · 2 · 1', detalle: 'Vuelve al presente con tus cinco sentidos.', tono: (t) => [t.acentos.naranja.fuerte, t.color.magenta] },
];

export default function Bienestar() {
  const t = useTema();
  return (
    <Pantalla sinVidrio>
      <Entrada indice={0}>
        <FraseDelDia grande />
      </Entrada>

      <Entrada indice={1}>
        <Seccion estilo={{ marginTop: 6 }}>Zona anti estrés</Seccion>
      </Entrada>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {EJERCICIOS.map((e, i) => (
          <Entrada key={e.ruta} indice={2 + i} estilo={{ width: '47.5%', flexGrow: 1 }}>
            <Tocable etiqueta={`${e.titulo}. ${e.detalle}`} alTocar={() => navegar(e.ruta)}>
              <Tarjeta estilo={{ gap: 12, minHeight: 168 }}>
                <LinearGradient colors={e.tono(t)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{ width: 52, height: 52, borderRadius: RADIO.medio, alignItems: 'center', justifyContent: 'center' }}>
                  <Icono sf={e.sf} respaldo="" tam={24} color="#FFFFFF" />
                </LinearGradient>
                <View style={{ gap: 3 }}>
                  <Text style={{ fontSize: 17, fontWeight: '800', color: colorSistema.texto }}>{e.titulo}</Text>
                  <Text style={{ fontSize: 13, lineHeight: 18, color: colorSistema.texto2 }}>{e.detalle}</Text>
                </View>
              </Tarjeta>
            </Tocable>
          </Entrada>
        ))}
      </View>

      <Entrada indice={6}>
        <Tarjeta estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Icono sf="heart.text.square.fill" respaldo="♥" tam={22} color={t.color.magentaTexto} />
          <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, color: colorSistema.texto2 }}>
            Si el estrés o la tristeza no se te quitan, no estás solo: habla con tu médico. También puedes escribirnos por el chat.
          </Text>
        </Tarjeta>
      </Entrada>
    </Pantalla>
  );
}
