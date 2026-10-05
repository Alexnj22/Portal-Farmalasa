// Ofertas vigentes. Las EXCLUSIVAS se anuncian a todos —es la invitación a
// unirse— pero su detalle sólo lo ve quien es socio del programa.
import { useCallback, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Titulo, Vacio } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { fecha } from '../../../lib/formato';
import { suave, useTema } from '../../../tema/tema';

export default function Ofertas() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [datos, setDatos] = useState(null);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => { setDatos(await pedir('ofertas')); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      {datos.ofertas.length === 0 ? (
        <Vacio titulo="Pronto habrá ofertas">Cuando publiquemos una nueva aparece aquí.</Vacio>
      ) : null}
      {datos.ofertas.map((o) => (
        <Tarjeta key={o.id} estilo={{ padding: 0, overflow: 'hidden', gap: 0 }}>
          {o.imagen ? (
            <Image source={{ uri: o.imagen }} style={{ width: '100%', aspectRatio: 16 / 9, opacity: o.disponible ? 1 : 0.45 }} resizeMode="cover" />
          ) : null}
          <View style={{ padding: 16, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {o.etiqueta ? <Pildora color={t.color.magenta} texto={o.etiqueta} /> : null}
              {o.exclusiva ? <Pildora color={t.color.verde} texto="Exclusiva para socios" /> : null}
            </View>
            <Titulo>{o.titulo}</Titulo>
            {o.disponible ? (
              <>
                {o.descripcion ? <Texto>{o.descripcion}</Texto> : null}
                {o.condiciones ? <Texto nivel={3}>{o.condiciones}</Texto> : null}
              </>
            ) : (
              <Texto nivel={2}>Únete al programa de puntos para ver y usar esta oferta.</Texto>
            )}
            <Texto nivel={3}>
              Hasta el {fecha(o.fin)}{o.salas ? ` · Sólo en ${o.salas.join(', ')}` : ' · En todas las salas'}
            </Texto>
          </View>
        </Tarjeta>
      ))}
    </Pantalla>
  );
}

function Pildora({ color, texto }) {
  const t = useTema();
  return (
    <View style={{ backgroundColor: suave(color, t.oscuro ? 0.3 : 0.16), borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: color === t.color.verde ? t.color.verdeTexto : t.color.magentaTexto }}>{texto}</Text>
    </View>
  );
}
