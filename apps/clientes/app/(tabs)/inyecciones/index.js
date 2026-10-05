// Las inyecciones que la persona ya pagó y todavía no se aplicó: puede ir a
// cualquier sala (el servidor no las ata a la sala donde pagó). Abajo, las
// que ya se aplicó en el último año.
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Aviso, Cargando, Pantalla, Tarjeta, Texto, Titulo, Vacio } from '../../../componentes/ui';
import { useSesion } from '../../../lib/sesion';
import { fecha } from '../../../lib/formato';
import { useTema } from '../../../tema/tema';
import { Entrada, NumeroAnimado } from '../../../componentes/animacion';

const ml = (v) => (v != null ? ` · ${Number(v)} ml` : '');

export default function Inyecciones() {
  const t = useTema();
  const pedir = useSesion((s) => s.pedir);
  const [datos, setDatos] = useState(null);
  const [refrescando, setRefrescando] = useState(false);

  const cargar = useCallback(async () => { setDatos(await pedir('inyecciones')); }, [pedir]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  const refrescar = async () => { setRefrescando(true); await cargar(); setRefrescando(false); };

  if (!datos) return <Cargando />;
  if (!datos.ok) return <Pantalla alRefrescar={refrescar} refrescando={refrescando}><Aviso>{datos.mensaje}</Aviso></Pantalla>;
  if (datos.pendiente) {
    return (
      <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
        <Vacio titulo="Disponible al completar tu ficha">Cuando completes tu registro en sala verás aquí tus inyecciones.</Vacio>
      </Pantalla>
    );
  }

  const disponibles = datos.disponibles ?? [];
  const aplicadas = datos.aplicadas ?? [];

  return (
    <Pantalla alRefrescar={refrescar} refrescando={refrescando}>
      <Entrada indice={0}>
        <Tarjeta tono={t.color.verde}>
          <Texto nivel={2}>Aplicaciones disponibles</Texto>
          <NumeroAnimado valor={disponibles.length} formato="entero" estilo={{ fontSize: 44, fontWeight: '800', color: t.color.verdeTexto }} />
          <Texto nivel={3}>Ya están pagadas. Puedes aplicártelas en cualquiera de nuestras salas.</Texto>
        </Tarjeta>
      </Entrada>

      <Entrada indice={1}>
        {disponibles.length ? (
          <Tarjeta>
            <Titulo>Por aplicar</Titulo>
            {disponibles.map((a) => (
              <View key={a.id} style={{ paddingVertical: 6 }}>
                <Texto>{a.producto}{ml(a.dosis_ml)}</Texto>
                <Texto nivel={3}>Pagada el {fecha(a.pagada_at)}{a.sala ? ` en ${a.sala}` : ''}</Texto>
              </View>
            ))}
          </Tarjeta>
        ) : null}
      </Entrada>

      <Entrada indice={2}>
        <Tarjeta>
          <Titulo>Aplicadas</Titulo>
          {aplicadas.length === 0 ? <Texto nivel={2}>No hay aplicaciones en el último año.</Texto> : null}
          {aplicadas.map((a, i) => (
            <View key={`${a.aplicada_at}-${i}`} style={{ paddingVertical: 6 }}>
              <Texto>{a.producto}{ml(a.dosis_ml)}</Texto>
              <Texto nivel={3}>{fecha(a.aplicada_at)}{a.sala ? ` · ${a.sala}` : ''}</Texto>
            </View>
          ))}
        </Tarjeta>
  
      </Entrada>

      <Texto nivel={3}>Si trajiste tu medicamento de otra farmacia, esa aplicación no aparece aquí.</Texto>
    </Pantalla>
  );
}
