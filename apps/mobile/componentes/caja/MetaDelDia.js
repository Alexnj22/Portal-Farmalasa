// Cómo va la sala contra la meta de HOY — `MetaDelDia` del portal. La meta del
// día es la del mes repartida entre sus días (núcleo: `avanceDeMetaDelDia`).
// Sin `dash_meta_sala` no se pide; sin `dash_meta_sala_vista_completa` queda el
// porcentaje sin montos. Una meta que no se pudo leer no se dibuja: un 0% sobre
// una sala que vendió es peor que nada. La barra es azul mientras avanza y
// verde al llegar — a las 9 de la mañana el 15% es lo normal, no una alarma.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { fetchMetaSala } from '@nucleo/data/metas';
import { avanceDeMetaDelDia } from '@nucleo/utils/cajaDelDia';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { colorSistema } from '../Formulario';
import { MARCA } from '../inicio/marca';
import { Chip } from '../inicio/Widget';
import Vidrio from '../Vidrio';

export default function MetaDelDia({ sala }) {
  const { hasPermission } = useAuth();
  const puedeVer = hasPermission('dash_meta_sala');
  const conMontos = hasPermission('dash_meta_sala_vista_completa');
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!puedeVer || !sala) return undefined;
    let vivo = true;
    fetchMetaSala(sala)
      .then((row) => { if (vivo) setMeta({ sala, avance: avanceDeMetaDelDia(row) }); })
      .catch(() => { if (vivo) setMeta({ sala, avance: null }); });
    return () => { vivo = false; };
  }, [puedeVer, sala]);

  // Guardada con su sala: al cambiar de sala, la vieja no se pinta como nueva.
  const avance = meta?.sala === sala ? meta.avance : null;
  if (!avance) return null;
  const llego = avance.pct >= 100;
  const color = llego ? MARCA.verde : MARCA.azulClaro;

  return (
    <Vidrio radio={22}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Chip icono="Target" color={color} tamano={30} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto2, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Meta de hoy</Text>
            {conMontos ? (
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                {formatMoney(avance.vendido)}
                <Text style={{ color: colorSistema.texto2, fontWeight: '500' }}>{` de ${formatMoney(avance.meta)}`}</Text>
              </Text>
            ) : null}
          </View>
          <Text style={{ color: llego ? MARCA.verde : colorSistema.texto, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{`${avance.pct}%`}</Text>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.min(100, avance.pct) }}
          style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(127,127,127,0.22)', overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(100, avance.pct)}%`, height: '100%', borderRadius: 4, backgroundColor: color }} />
        </View>
      </View>
    </Vidrio>
  );
}
