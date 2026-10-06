// Ofertas vigentes. Cada tarjeta abre su detalle en una hoja del sistema que
// se cierra deslizando hacia abajo. Las EXCLUSIVAS se anuncian a todos —es la invitación a unirse—
// pero su detalle sólo lo ve quien es socio del programa.
import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Titulo, Vacio } from '../../../componentes/ui';
import { colorSistema } from '../../../componentes/sistema';
import { useTema } from '../../../tema/tema';
import { Entrada, Tocable } from '../../../componentes/animacion';
import TarjetaOferta from '../../../componentes/TarjetaOferta';
import { useOfertas } from '../../../lib/ofertas';

export default function Ofertas({ invitacion = false }) {
  const t = useTema();
  const { datos, cargar } = useOfertas();
  const [refrescando, setRefrescando] = useState(false);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar({ forzar: true }); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      {invitacion ? (
        <Entrada indice={0}>
          <Tocable etiqueta="Unirme al programa" alTocar={() => router.push('/registro')}>
            <Tarjeta tono={t.color.verde} estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 28 }}>🎁</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Titulo>Únete gratis</Titulo>
                <Texto nivel={2} estilo={{ fontSize: 14 }}>Acumula puntos en cada compra y desbloquea las ofertas exclusivas.</Texto>
              </View>
              <Text style={{ fontSize: 22, color: colorSistema.texto3 }}>›</Text>
            </Tarjeta>
          </Tocable>
        </Entrada>
      ) : null}
      {datos.ofertas.length === 0 ? (
        <Vacio titulo="Pronto habrá ofertas">Cuando publiquemos una nueva aparece aquí.</Vacio>
      ) : null}
      {datos.ofertas.map((o, i) => (
        <Entrada key={o.id} indice={i + (invitacion ? 1 : 0)}>
          {/* Abre el detalle como HOJA (ver app/oferta/[id].js: el zoom de la
              tarjeta dejaba ver la lista detrás y se veía raro). */}
          <Tocable etiqueta={`Oferta: ${o.titulo}`} alTocar={() => router.push(`/oferta/${o.id}`)}>
            <TarjetaOferta oferta={o} destacada={i === 0} />
          </Tocable>
        </Entrada>
      ))}
    </Pantalla>
  );
}
