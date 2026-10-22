// Consumidor final después de las 6:00 p. m. — la gemela de
// `src/views/contabilidad/CofNocheSinEnvio.jsx` (2026-10-19).
//
// Decisión del usuario: todo COF emitido desde las 6:00 p. m. NO se envía a
// Hacienda, pero se lleva registro de cuántos son y cuánto suman. Es
// información del área administrativa, NO de contabilidad: `libros-iva` sólo la
// pide para los cuatro cargos de admin, y `get_cof_sin_envio_mh` contesta
// FORBIDDEN a cualquier otro. El CSV, documento por documento, es el mismo del
// portal (`csvCofNoche`, núcleo).
import { useState } from 'react';
import { Text, View } from 'react-native';
import { fetchCofSinEnvioMh } from '@nucleo/data/librosIva';
import { CSV_COF_NOCHE_HEADERS, csvCofNoche, fmtFecha } from '@nucleo/utils/libroIva';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { rango12 } from '@nucleo/utils/hora';
import { etiquetaMes } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { colorSistema } from '../Formulario';
import { BotonGrande, Seccion } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo } from '../Progreso';
import { compartirCsv } from './csv';

export default function CofNocheSinEnvio({ resumen, mes, desde, hasta, sala, sufijo }) {
  const [bajando, setBajando] = useState(false);
  const total = resumen?.total;
  const filas = resumen?.por_dia ?? [];
  if (!(total?.documentos > 0)) return null;

  const exportar = async () => {
    setBajando(true);
    try {
      const { data, error } = await fetchCofSinEnvioMh(desde, hasta, sala, true);
      if (error) throw new Error(error.message);
      await compartirCsv({
        headers: CSV_COF_NOCHE_HEADERS, rows: csvCofNoche(data?.detalle),
        nombre: `consumidor-final-despues-de-6pm_${sufijo}`, modulo: 'libros_iva', detalle: { mes, seccion: 'cof_noche' },
      });
    } catch (e) {
      fallo('No se pudo exportar', mensajeAmigable(e));
    } finally { setBajando(false); }
  };

  return (
    <View style={{ marginHorizontal: 16 }}>
      <Seccion titulo="Consumidor final después de las 6:00 p. m."
        pie="Desde el 19 de octubre de 2026, los consumidores finales emitidos de las 6:00 p. m. en adelante no se envían a Hacienda. Los que no tienen sello no entran al libro.">
        <View style={{ gap: 2 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(total.monto ?? 0)}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 13 }}>
            {`${total.documentos} documento${total.documentos === 1 ? '' : 's'} en ${etiquetaMes(mes)} · IVA ${formatMoney(total.iva ?? 0)}`}
            {total.sin_sello !== total.documentos ? ` · ${total.sin_sello} sin sello` : ''}
          </Text>
        </View>
        {filas.map((r) => (
          <View key={`${r.fecha}-${r.branch_id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 9, borderTopWidth: 0.5, borderTopColor: colorSistema.separador }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${fmtFecha(r.fecha)} · ${r.sucursal}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                {[rango12(r.primera, r.ultima), `${r.documentos} doc${r.documentos === 1 ? '' : 's'}`, `IVA ${formatMoney(r.iva)}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(r.monto)}</Text>
          </View>
        ))}
        <BotonGrande texto={bajando ? 'Preparando…' : 'Exportar CSV'} borde color={MARCA.azulClaro} deshabilitado={bajando} onPress={exportar} />
      </Seccion>
    </View>
  );
}
