// Los bonos de promoción que esta sala paga — `BonosPorPagar` del portal, en
// LECTURA: a quién se le debe, de qué promoción y cuánto. Pagar uno saca
// efectivo del cajón con identificación de quien recibe, y por ahora se hace
// en el portal (se dice abajo). No dibuja nada si la sala no debe ninguno.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { fetchBonosProductoSala } from '@nucleo/data/bonosProducto';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { shortEmployeeName } from '@nucleo/utils/nameUtils';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { Aviso } from '../formulario/Piezas';
import { Pildora } from '../avisos/Piezas';
import { MARCA } from '../inicio/marca';
import { Chip } from '../inicio/Widget';
import Vidrio from '../Vidrio';

export default function BonosPorPagar({ sala, cajaAbierta, recarga = 0 }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sala) return undefined;
    let vivo = true;
    fetchBonosProductoSala(sala)
      .then((d) => { if (vivo) { setDatos({ sala, d }); setError(null); } })
      .catch((e) => { if (vivo) setError(mensajeAmigable(e, 'No se pudieron leer los bonos por pagar')); });
    return () => { vivo = false; };
  }, [sala, recarga]);

  if (error) return <Aviso tono="cuidado" texto={`No se pudieron leer los bonos de promoción por pagar: ${error}`} />;
  const d = datos?.sala === sala ? datos.d : null;
  const items = Array.isArray(d?.items) ? d.items : [];
  if (!items.length) return null;
  const total = items.reduce((a, i) => a + Number(i.monto || 0), 0);

  return (
    <Vidrio radio={22}>
      <View style={{ padding: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Chip icono="Gift" color={MARCA.violetaClaro} tamano={30} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }}>Bonos de promoción por pagar</Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
              {!d?.puedo_pagar ? 'Los paga la jefatura de la sala.'
                : !cajaAbierta ? 'Abre la caja para pagarlos: el efectivo sale del cajón.'
                  : 'Cada pago sale del cajón y quien recibe se identifica. Se paga desde el portal.'}
            </Text>
          </View>
          <Text style={{ color: colorSistema.texto, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(total)}</Text>
        </View>
        {items.map((it, i) => (
          <View key={it.item} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 9, borderTopWidth: i ? 0.5 : 0.5, borderTopColor: colorSistema.separador }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{it.tipo === 'bodega' ? 'Bodega' : shortEmployeeName(it)}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>{`${it.promocion || ''}${it.tipo === 'excedente' ? ' · excedente aprobado' : ''}`}</Text>
            </View>
            {it.estado === 'enviado' ? <Pildora texto="En la caja…" color={MARCA.ambar} /> : null}
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(it.monto)}</Text>
          </View>
        ))}
      </View>
    </Vidrio>
  );
}
