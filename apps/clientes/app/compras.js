// Mis compras: cada venta con sus productos, los puntos que dio y lo que se
// canjeó en ella. Al tocar una compra se despliega con animación de layout
// (Reanimated), sin saltos. Las inyecciones se marcan: son las que después
// aparecen en la pestaña Inyecciones, y así se ve de dónde salió cada una.
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../componentes/ui';
import { Tocable } from '../componentes/animacion';
import { Pildora } from '../componentes/TarjetaOferta';
import { colorSistema } from '../componentes/sistema';
import { useSesion } from '../lib/sesion';
import { dolares, entero, fecha } from '../lib/formato';
import { useTema } from '../tema/tema';
import Icono from '../componentes/Icono';

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

  const cargar = useCallback(async () => { const r = await pedir('compras'); setDatos((ant) => (r?.ok || !ant?.ok ? r : ant)); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;
  if (datos.pendiente) {
    return <Pantalla conPestanas={false}><Vacio titulo="Todavía no hay compras">Cuando completes tu registro en sala verás aquí cada compra.</Vacio></Pantalla>;
  }
  if (!datos.compras.length) {
    return <Pantalla conPestanas={false}><Vacio titulo="Todavía no hay compras">Tus compras con tu DUI aparecen aquí.</Vacio></Pantalla>;
  }

  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      <Texto nivel={2} estilo={{ fontSize: 14, marginHorizontal: 4 }}>Tus últimas 5 compras.</Texto>
      {/* Sin animación de entrada ni de layout: el vidrio de iOS 26 no siempre
          se dibuja si nace dentro de una vista que se está animando, y algunas
          tarjetas quedaban TRANSPARENTES (usuario, 2026-10-06). Lo que se
          despliega aparece con un fundido, y eso sí no toca el vidrio. */}
      {datos.compras.map((c) => (
        <Tocable key={c.id} etiqueta={`Compra en ${c.sala}, ${c.total} dólares`} alTocar={() => setAbierta(abierta === c.id ? null : c.id)}>
          <Compra compra={c} abierta={abierta === c.id} />
        </Tocable>
      ))}
    </Pantalla>
  );
}

function Compra({ compra: c, abierta }) {
  const t = useTema();
  const inyecciones = (c.productos ?? []).filter((p) => p.inyectable).length;
  return (
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
          <Animated.View entering={FadeIn.duration(180)} style={{ gap: 8, marginTop: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            {(c.productos ?? []).map((p, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Text style={{ width: 28, fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{Number(p.cantidad)}×</Text>
                <Text style={{ flex: 1, fontSize: 15, color: colorSistema.texto }} numberOfLines={2}>{p.descripcion}</Text>
                {p.inyectable ? <Icono sf="syringe.fill" respaldo="" tam={13} color={t.color.verdeTexto} /> : null}
                <Text style={{ fontSize: 15, color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{dolares(p.total)}</Text>
              </View>
            ))}
            <Texto nivel={3} estilo={{ fontSize: 13 }}>Factura {c.correlativo}</Texto>
          </Animated.View>
        ) : (
          <Texto nivel={3} estilo={{ fontSize: 13 }}>
            {(c.productos ?? []).length} {(c.productos ?? []).length === 1 ? 'producto' : 'productos'} · toca para ver
          </Texto>
        )}
    </Tarjeta>
  );
}
