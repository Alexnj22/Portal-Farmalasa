// Mis compras: las últimas 10, cada una como un recibo moderno — sucursal,
// fecha y hora, total grande, los puntos que dio (con el nivel que los
// multiplicó) y lo canjeado. Al tocarla se despliegan los productos. Las
// inyecciones se marcan: son las que aparecen en la pestaña Inyecciones.
//
// Sin animación de entrada ni de layout sobre el vidrio: el de iOS 26 no
// siempre se dibuja si nace dentro de una vista que se anima, y algunas
// tarjetas quedaban TRANSPARENTES (usuario, 2026-10-06).
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Vacio } from '../componentes/ui';
import { Tocable } from '../componentes/animacion';
import { colorSistema } from '../componentes/sistema';
import Icono from '../componentes/Icono';
import { useSesion } from '../lib/sesion';
import { dolares, entero, fecha } from '../lib/formato';
import { suave, useTema } from '../tema/tema';

const hora12 = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h ?? ''));
  if (!m) return '';
  const n = Number(m[1]);
  return `${n % 12 || 12}:${m[2]} ${n < 12 ? 'a. m.' : 'p. m.'}`;
};
const NIVEL = { plata: 'Plata', oro: 'Oro', platino: 'Platino' };
const tituloDe = (s) => String(s ?? '').toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, l) => a + l.toUpperCase());

export default function Compras() {
  const t = useTema();
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

  const total = datos.compras.reduce((s, c) => s + Number(c.total ?? 0), 0);
  const puntos = datos.compras.reduce((s, c) => s + Number(c.puntos ?? 0), 0);

  return (
    <Pantalla conPestanas={false} alRefrescar={refrescar} refrescando={refrescando}>
      {/* Resumen de lo que se ve abajo. */}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Resumen etiqueta={`En ${datos.compras.length} compras`} valor={dolares(total)} />
        <Resumen etiqueta="Puntos ganados" valor={`+${entero(puntos)}`} color={t.color.verdeTexto} />
      </View>
      {datos.compras.map((c) => (
        <Tocable key={c.id} etiqueta={`Compra en ${c.sala}, ${c.total} dólares`} alTocar={() => setAbierta(abierta === c.id ? null : c.id)}>
          <Compra compra={c} abierta={abierta === c.id} />
        </Tocable>
      ))}
    </Pantalla>
  );
}

function Resumen({ etiqueta, valor, color }) {
  return (
    <View style={{ flex: 1 }}>
      <Tarjeta estilo={{ gap: 2, paddingVertical: 14 }}>
        <Text style={{ fontSize: 12, fontWeight: '600', color: colorSistema.texto3 }}>{etiqueta}</Text>
        <Text style={{ fontSize: 22, fontWeight: '800', color: color ?? colorSistema.texto, fontVariant: ['tabular-nums'] }}>{valor}</Text>
      </Tarjeta>
    </View>
  );
}

function Compra({ compra: c, abierta }) {
  const t = useTema();
  const productos = c.productos ?? [];
  const inyecciones = productos.filter((p) => p.inyectable).length;
  return (
    <Tarjeta estilo={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
          backgroundColor: suave(t.color.verde, t.oscuro ? 0.24 : 0.16) }}>
          <Icono sf="bag.fill" respaldo="" tam={18} color={t.color.verdeTexto} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colorSistema.texto }} numberOfLines={1}>{c.sala}</Text>
          <Text style={{ fontSize: 13, color: colorSistema.texto2 }}>{fecha(c.fecha)} · {hora12(c.hora)}</Text>
        </View>
        <Text style={{ fontSize: 21, fontWeight: '800', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(c.total)}</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {c.puntos ? (
          <Chip sf="star.fill" color={t.color.verdeTexto} fondo={suave(t.color.verde, 0.18)}
            texto={`+${entero(c.puntos)} pts${NIVEL[c.nivel] ? ` · ${NIVEL[c.nivel]}` : ''}`} />
        ) : null}
        {c.canjeados ? <Chip sf="arrow.uturn.down" color={t.color.magentaTexto} fondo={suave(t.color.magenta, 0.14)} texto={`Canjeaste ${entero(c.canjeados)} pts`} /> : null}
        {inyecciones ? <Chip sf="syringe.fill" color={colorSistema.texto2} texto={inyecciones === 1 ? '1 inyección' : `${inyecciones} inyecciones`} /> : null}
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: colorSistema.texto3 }}>
          {productos.length} {productos.length === 1 ? 'producto' : 'productos'}
        </Text>
        <Icono sf={abierta ? 'chevron.up' : 'chevron.down'} respaldo="" tam={12} color={colorSistema.texto3} />
      </View>

      {abierta ? (
        <Animated.View entering={FadeIn.duration(180)} style={{ gap: 10, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
          {productos.map((p, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ minWidth: 30, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, alignItems: 'center',
                backgroundColor: t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colorSistema.texto2, fontVariant: ['tabular-nums'] }}>{Number(p.cantidad)}×</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 15, color: colorSistema.texto }} numberOfLines={2}>{tituloDe(p.descripcion)}</Text>
                {p.inyectable ? <Text style={{ fontSize: 12, fontWeight: '700', color: t.color.verdeTexto }}>Inyección</Text> : null}
              </View>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colorSistema.texto, fontVariant: ['tabular-nums'] }}>{dolares(p.total)}</Text>
            </View>
          ))}
          <Texto nivel={3} estilo={{ fontSize: 12 }}>Factura {c.correlativo}</Texto>
        </Animated.View>
      ) : null}
    </Tarjeta>
  );
}

function Chip({ sf, texto, color, fondo }) {
  const t = useTema();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
      backgroundColor: fondo ?? (t.oscuro ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') }}>
      <Icono sf={sf} respaldo="" tam={11} color={color} />
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 12, fontWeight: '700', color }}>{texto}</Text>
    </View>
  );
}
