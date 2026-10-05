// Ofertas vigentes. Cada tarjeta abre su detalle con el ZOOM del sistema
// (iOS 18+): la tarjeta crece hasta ser la pantalla y se cierra deslizando
// hacia abajo. Las EXCLUSIVAS se anuncian a todos —es la invitación a unirse—
// pero su detalle sólo lo ve quien es socio del programa.
import { useCallback, useState } from 'react';
import { Link, useFocusEffect } from 'expo-router';
import { Aviso, Cargando, Pantalla, Vacio } from '../../../componentes/ui';
import { Entrada, Tocable } from '../../../componentes/animacion';
import TarjetaOferta from '../../../componentes/TarjetaOferta';
import { useOfertas } from '../../../lib/ofertas';

export default function Ofertas() {
  const { datos, cargar } = useOfertas();
  const [refrescando, setRefrescando] = useState(false);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar({ forzar: true }); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      {datos.ofertas.length === 0 ? (
        <Vacio titulo="Pronto habrá ofertas">Cuando publiquemos una nueva aparece aquí.</Vacio>
      ) : null}
      {datos.ofertas.map((o, i) => (
        <Entrada key={o.id} indice={i}>
          {/* `Link.AppleZoom` va directo dentro del Link y envuelve a lo que se
              toca: anidado más adentro, el zoom no se registraba o capturaba
              la tarjeta encogida por el toque. */}
          <Link href={`/oferta/${o.id}`} asChild>
            <Link.AppleZoom>
              <Tocable etiqueta={`Oferta: ${o.titulo}`}>
                <TarjetaOferta oferta={o} destacada={i === 0} />
              </Tocable>
            </Link.AppleZoom>
          </Link>
        </Entrada>
      ))}
    </Pantalla>
  );
}
