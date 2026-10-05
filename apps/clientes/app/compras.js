// Mis compras: cada venta con sus productos, los puntos que dio y lo que se
// canjeó en ella. Al tocar una compra se despliega con animación de layout
// (Reanimated), sin saltos. Las inyecciones se marcan: son las que después
// aparecen en la pestaña Inyecciones, y así se ve de dónde salió cada una.
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../componentes/ui';
import { Entrada, Tocable } from '../componentes/animacion';
import { Pildora } from '../componentes/TarjetaOferta';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { dolares, entero, fecha } from '../lib/formato';
import { useTema } from '../tema/tema';

const hora12 = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? ''));
  if (!m) return '';
  const n = Number(m[1]);
  return `${n % 12 || 12}:${m[2]} ${n < 12 ? 'a. m.' : 'p. m.'}`;
};

export default function Compras() {
  const pedir = useSesion((s) => s.pedir);
  const [datos, setDatos] = useState(null);
  const [abierta, setAbierta] = useState(null);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => { setDatos(await pedir('compras')); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla conPestanas={false}><Aviso>{datos.mensaje}</Aviso></Pantalla>;
  if (datos.pendiente) {
    return <Pantalla conPestanas={false}><Vacio titulo="Todavía no hay compras">Cuando completes tu registro en sala verás aquí cada compra.</Vacio></Pantalla>;
  }
  if (!datos.compras.length) {
    return <Pantalla conPestanas={false}><Vacio titulo="Todavía no hay compras">Tus compras con tu DUI aparecen aquí.</Vacio></Pantalla>;
  }

  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      {datos.compras.map((c, i) => (
        <Entrada key={c.id} indice={i}>
          <Tocable alTocar={() => setAbierta(abierta === c.id ? null : c.id)}>
            <Compra compra={c} abierta={abierta === c.id} />
          </Tocable>
        </Entrada>
      ))}
    </Pantalla>
  );
}

function Compra({ compra: c, abierta }) {
  const t = useTema();
  const inyecciones = (c.productos ?? []).filter((p) => p.inyectable).length;
  return (
    <Animated.View layout={LinearTransition.springify().damping(20)}>
      <Tarjeta>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 17, fontWeight: '600', color: colorSistema.texto }}>{c.sala}</Text>
            <Texto nivel={2} estilo={{ fontSize: 14 }}>{fecha(c.fecha)} · {hora12(c.hora)}</Texto>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(c.total)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {c.puntos ? <Pildora color={t.color.verde} texto={`+${entero(c.puntos)} pts`} /> : null}
          {c.canjeados ? <Pildora color={t.color.magenta} texto={`Canjeaste ${entero(c.canjeados)} pts`} /> : null}
          {inyecciones ? <Pildora color={t.color.magenta} texto={inyecciones === 1 ? '1 inyección' : `${inyecciones} inyecciones`} /> : null}
        </View>
        {abierta ? (
          <View style={{ gap: 8, marginTop: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            {(c.productos ?? []).map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Text style={{ width: 28, fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{Number(p.cantidad)}×</Text>
                <Text style={{ flex: 1, fontSize: 15, color: colorSistema.texto }} numberOfLines={2}>{p.descripcion}</Text>
                {p.inyectable ? <Text style={{ fontSize: 13, fontWeight: '700', color: t.color.magentaTexto }}>Inyección</Text> : null}
                <Text style={{ fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{dolares(p.total)}</Text>
              </View>
            ))}
            <Texto nivel={3} estilo={{ fontSize: 13 }}>Factura {c.correlativo}</Texto>
          </View>
        ) : (
          <Texto nivel={3} estilo={{ fontSize: 13 }}>
            {(c.productos ?? []).length} {(c.productos ?? []).length === 1 ? 'producto' : 'productos'} · toca para ver
          </Texto>
        )}
      </Tarjeta>
    </Animated.View>
  );
}
