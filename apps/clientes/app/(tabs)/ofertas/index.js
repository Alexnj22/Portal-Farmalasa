// Ofertas vigentes. Cada tarjeta abre su detalle en una hoja del sistema que
// se cierra deslizando hacia abajo. Las EXCLUSIVAS se anuncian a todos —es la invitación a unirse—
// pero su detalle sólo lo ve quien es socio del programa.
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Text, View } from 'react-native';
import { Cargando, Pantalla, PantallaLista, Tarjeta, Texto, Titulo, Vacio } from '../../../componentes/ui';
import { colorSistema } from '../../../componentes/sistema';
import { useTema } from '../../../tema/tema';
import { Entrada, Tocable } from '../../../componentes/animacion';
import TarjetaOferta from '../../../componentes/TarjetaOferta';
import { useOfertas } from '../../../lib/ofertas';
import Icono from '../../../componentes/Icono';
import { navegar } from '../../../lib/navegar';

export default function Ofertas({ invitacion = false }) {
  const t = useTema();
  const { datos, cargar } = useOfertas();
  const [refrescando, setRefrescando] = useState(false);
  // Las ofertas que ya hicieron su entrada (2026-10-15). La lista es virtual
  // (hasta 80 tarjetas con foto): una tarjeta que sale de la ventana se
  // desmonta, y al volver no debe repetir la animación como si llegara nueva.
  const yaEntraron = useRef(new Set());

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar({ forzar: true }); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Vacio titulo="No se pudo cargar" accion="Reintentar" alAccion={refrescar}>{datos.mensaje ?? 'Revisa tu conexión e intenta de nuevo.'}</Vacio></Pantalla>;

  // `sinVidrio` (2026-10-14, «las ofertas tardan en cargar»): un pie de
  // Liquid Glass por tarjeta, desplazándose, se recompone en cada cuadro — lo
  // mismo que se le quitó al Inicio. El relleno translúcido se ve igual.
  return (
    <PantallaLista alRefrescar={refrescar} refrescando={refrescando} sinVidrio
      datos={datos.ofertas} keyExtractor={(o) => String(o.id)} initialNumToRender={4}
      encabezado={(invitacion || datos.ofertas.length === 0) ? <>
      {invitacion ? (
        <Entrada indice={0}>
          <Tocable etiqueta="Unirme al programa" alTocar={() => navegar('/registro')}>
            <Tarjeta tono={t.color.verde} estilo={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icono sf="gift.fill" respaldo="🎁" tam={26} color={t.color.verdeTexto} />
              <View style={{ flex: 1, gap: 2 }}>
                <Titulo>Únete gratis</Titulo>
                <Texto nivel={2} estilo={{ fontSize: 14 }}>Acumula puntos en cada compra y desbloquea las ofertas exclusivas.</Texto>
              </View>
              <Icono sf="chevron.right" respaldo="›" tam={15} color={colorSistema.texto3} />
            </Tarjeta>
          </Tocable>
        </Entrada>
      ) : null}
      {datos.ofertas.length === 0 ? (
        <Vacio titulo="Pronto habrá ofertas" icono="tag.fill" respaldo="%">Cuando publiquemos una nueva aparece aquí.</Vacio>
      ) : null}
      </> : null}
      renderItem={({ item: o, index: i }) => (
        <FilaOferta oferta={o} indice={i + (invitacion ? 1 : 0)} destacada={i === 0} yaEntraron={yaEntraron.current} />
      )}
    />
  );
}

// Una oferta de la lista. Decide UNA vez, al montarse, si hace su entrada: una
// tarjeta que la lista vuelve a pintar sin desmontarla conserva lo que eligió
// (cambiar de Entrada a View la remontaría y recargaría su foto).
function FilaOferta({ oferta: o, indice, destacada, yaEntraron }) {
  const [animar] = useState(() => {
    const nueva = !yaEntraron.has(o.id);
    yaEntraron.add(o.id);
    return nueva;
  });
  const tarjeta = (
    // Abre el detalle como HOJA (ver app/oferta/[id].js: el zoom de la
    // tarjeta dejaba ver la lista detrás y se veía raro).
    <Tocable etiqueta={`Oferta: ${o.titulo}`} alTocar={() => navegar(`/oferta/${o.id}`)}>
      <TarjetaOferta oferta={o} destacada={destacada} />
    </Tocable>
  );
  return animar ? <Entrada indice={indice}>{tarjeta}</Entrada> : <View>{tarjeta}</View>;
}
