// Bienestar (2026-11-03, pedido del usuario): la frase del día en grande y la
// zona anti estrés — ejercicios cortos que no piden cuenta ni red y funcionan
// igual sin conexión. Nada de esto se guarda en el servidor.
//
// Cada juego es una tarjeta del color de su escena (las mismas de
// componentes/juegos/Escena), con el ícono grande de fondo: al entrar, el
// juego continúa el color de la tarjeta que se tocó. El destacado va arriba y
// a lo ancho: hoy es Botiquín (2026-11-04), el de unir piezas; la torre pasó a
// la lista.
//
// Usuario, 2026-11-04: «separa los juegos de los ejercicios de respiración,
// etc. que son para salud mental, relajación». Por eso son dos secciones: la
// de calma va primero —es la razón de ser de la pestaña— y los juegos después.
import { Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { Pantalla, Seccion, Tarjeta } from '../../../componentes/ui';
import { Entrada, Tocable } from '../../../componentes/animacion';
import FraseDelDia from '../../../componentes/FraseDelDia';
import Icono from '../../../componentes/Icono';
import { ESCENAS } from '../../../componentes/juegos/Escena';
import { colorSistema } from '../../../componentes/sistema';
import { useTema } from '../../../tema/tema';
import { navegar } from '../../../lib/navegar';

// Botiquín (2026-11-04): el de juntar al caer, con física. Reemplazó al de
// unir piezas en tablero, que tenía el mismo nombre y ruta.
const DESTACADO = { ruta: '/botiquin', sf: 'cross.case.fill', titulo: 'Botiquín', detalle: 'Suelta medicamentos: dos iguales se juntan y crecen. ¡Llega al sello Farmasalud!', escena: 'botiquin', nuevo: true };
// Salud mental y relajación: ejercicios guiados, sin puntaje.
const CALMA = [
  { ruta: '/respira', sf: 'wind', titulo: 'Respira', detalle: 'Tres técnicas guiadas con sonido.', escena: 'respira' },
  { ruta: '/anclaje', sf: 'hand.raised.fill', titulo: '5 · 4 · 3 · 2 · 1', detalle: 'Calma los nervios buscando cosas con tus sentidos.', escena: 'anclaje' },
  // 2026-11-10: «en bienestar, podemos agregar ruido blanco?»
  { ruta: '/ruido', sf: 'waveform', titulo: 'Sonidos', detalle: 'Lluvia, olas, fogata, noche… para dormir o concentrarte.', escena: 'ruido' },
];
const JUEGOS = [
  { ruta: '/torre', sf: 'square.stack.3d.up.fill', titulo: 'Torre', detalle: 'Suelta cada bloque justo encima y sube hasta las estrellas.', escena: 'torre' },
  { ruta: '/burbujas', sf: 'circle.grid.3x3.fill', titulo: 'Burbujas', detalle: 'Relax, o contrarreloj con niveles.', escena: 'burbujas' },
  { ruta: '/memoria', sf: 'square.grid.2x2.fill', titulo: 'Memoria', detalle: 'Encuentra las parejas en tres niveles.', escena: 'memoria' },
];

function Grilla({ lista, desde }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {lista.map((e, i) => (
        <Entrada key={e.ruta} indice={desde + i} estilo={{ width: '47.5%', flexGrow: 1 }}>
          <TarjetaJuego e={e} />
        </Entrada>
      ))}
    </View>
  );
}

function TarjetaJuego({ e, grande = false }) {
  const colores = ESCENAS[e.escena];
  return (
    <Tocable etiqueta={`${e.titulo}. ${e.detalle}`} alTocar={() => navegar(e.ruta)}>
      <LinearGradient colors={colores} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ borderRadius: 24, padding: 16, minHeight: grande ? 150 : 168, overflow: 'hidden', justifyContent: 'space-between', gap: 14 }}>
        {/* El ícono grande de fondo, cortado por la esquina. */}
        <View pointerEvents="none" style={{ position: 'absolute', right: grande ? 6 : -14, bottom: grande ? -18 : -22, opacity: 0.16 }}>
          <Icono sf={e.sf} respaldo="" tam={grande ? 140 : 110} color="#FFFFFF" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' }}>
            <Icono sf={e.sf} respaldo="" tam={22} color="#FFFFFF" />
          </View>
          {e.nuevo ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 4, minHeight: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: colores[0] }}>NUEVO</Text>
            </View>
          ) : null}
        </View>
        <View style={{ gap: 3, maxWidth: grande ? '72%' : undefined }}>
          <Text style={{ fontSize: grande ? 22 : 17, fontWeight: '800', color: '#FFFFFF' }}>{e.titulo}</Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.85)' }}>{e.detalle}</Text>
        </View>
      </LinearGradient>
    </Tocable>
  );
}

export default function Bienestar() {
  const t = useTema();
  // El contenido saltaba arriba y abajo en iPhone (2026-11-11, el usuario: «tomé
  // captura y se hizo para arriba la vista»). Es lo mismo que el Carrito: con
  // la barra transparente, el margen de arriba lo ponía el ajuste automático de
  // iOS, que llega a destiempo (al terminar de animar, al sacar una captura). Con
  // la altura de la barra como número, el margen es fijo. Va junto con
  // `disableAutomaticContentInsets` en la pestaña (app/(tabs)/_layout.js).
  const barra = useHeaderHeight();
  return (
    <Pantalla sinVidrio bajoBarra={barra}>
      <Entrada indice={0}>
        <FraseDelDia grande />
      </Entrada>

      <Entrada indice={1}>
        <Seccion estilo={{ marginTop: 6 }}>Relájate</Seccion>
        <Text style={{ fontSize: 14, lineHeight: 19, color: colorSistema.texto2, marginTop: 4, marginBottom: 6, marginLeft: 4 }}>
          Ejercicios guiados para bajar el estrés y la ansiedad.
        </Text>
      </Entrada>
      <Grilla lista={CALMA} desde={2} />

      <Entrada indice={5}>
        <Seccion estilo={{ marginTop: 6 }}>Juegos</Seccion>
      </Entrada>
      <Entrada indice={6}>
        <TarjetaJuego e={DESTACADO} grande />
      </Entrada>
      <Grilla lista={JUEGOS} desde={7} />

      <Entrada indice={10}>
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
