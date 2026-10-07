// Libro de compras de Torogoz, NATIVO — `LibroCompras` del portal: las compras
// recibidas del mes. Las que son Factura o Sujeto excluido se listan pero no
// entran al libro (no dan crédito fiscal). El archivo sale con el generador de
// 23 columnas del libro de las farmacias (núcleo).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchLibroCompras } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { TIPOS_COMPRA } from '@nucleo/utils/distribucionCompras';
import { archivoDeLibroDeCompras, totalesDelLibro } from '@nucleo/utils/distribucionReportes';
import { fechaNumerica, mesSV, rangoDelMes } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { tokenMatch } from '@nucleo/utils/searchUtils';
import { MenuDeFiltros } from '../../../Filtros';
import { colorSistema } from '../../../Formulario';
import { Aviso } from '../../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../../inicio/Kpi';
import { MARCA } from '../../../inicio/marca';
import PasoDeMes from '../../../PasoDeMes';
import BotonPaquete from './Paquete';
import { Chapa, Ficha, PETROLEO, Vacio } from '../piezas';
import { compartirArchivo } from './compartir';

const rotuloTipo = (t) => TIPOS_COMPRA.find((x) => x.value === t)?.label ?? t;

export default function LibroCompras({ buscar }) {
  const [mes, setMes] = useState(mesSV);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try { const [desde, hasta] = rangoDelMes(mes); setFilas(await fetchLibroCompras({ desde, hasta })); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setCargando(false); }
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const t = useMemo(() => totalesDelLibro(filas), [filas]);
  const visibles = useMemo(() => {
    const q = String(buscar ?? '').trim();
    return filas.filter((f) => !q || tokenMatch(q, f.proveedor, f.numero, f.nit));
  }, [filas, buscar]);
  const fuera = filas.filter((f) => !f.en_libro).length;
  const extra = !cargando && t.documentos
    ? { icono: 'square.and.arrow.up', etiqueta: 'Compartir CSV', onPress: () => compartirArchivo(archivoDeLibroDeCompras(filas, mes), { reporte: 'libro-compras', mes }) }
    : null;

  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={[]} extra={extra} />
      <PasoDeMes mes={mes} onCambiar={setMes} />
      <View style={{ marginHorizontal: 16 }}><BotonPaquete mes={mes} /></View>
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="BookOpen" rotulo="Compras gravadas" color={PETROLEO} valor={formatMoney(t.gravada)} apoyo={`${formatQty(t.documentos)} Créditos Fiscales`} />
        <Kpi icono="Landmark" rotulo="Crédito fiscal" color={MARCA.verde} valor={formatMoney(t.iva)} apoyo="IVA acreditable del mes" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="Percent" rotulo="Percepción" color={MARCA.ambar} valor={formatMoney(t.percepcion)} apoyo="Nos percibieron" />
        <Kpi icono="Receipt" rotulo="Total" color={MARCA.violetaClaro} valor={formatMoney(t.total)} apoyo="De lo que entra al libro" />
      </FilaDeKpis>
      {!cargando && fuera > 0 ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso texto={`${fuera} compra${fuera === 1 ? '' : 's'} con Factura o Sujeto excluido se listan abajo pero no entran al libro: no dan crédito fiscal.`} />
        </View>
      ) : null}
      {cargando ? <ActivityIndicator style={{ marginTop: 16 }} /> : visibles.length === 0 ? (
        buscar ? <Vacio titulo="Sin resultados" texto="Ninguna compra coincide con la búsqueda." /> : <Vacio titulo="Sin compras" texto="No se recibió ninguna compra en este mes." />
      ) : visibles.map((f) => (
        <Ficha key={f.id}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{f.proveedor}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${fechaNumerica(f.fecha)} · ${rotuloTipo(f.tipo_doc)} · ${f.numero}${f.nit ? ` · NIT ${f.nit}` : ''}`}</Text>
              <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>
                {`Gravado ${formatMoney(Number(f.gravada))} · crédito ${formatMoney(Number(f.iva))}${Number(f.percepcion) ? ` · percepción ${formatMoney(Number(f.percepcion))}` : ''}`}
              </Text>
              {!f.en_libro ? <Chapa variante="neutral" texto="Fuera del libro" /> : null}
            </View>
            <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatMoney(Number(f.total))}</Text>
          </View>
        </Ficha>
      ))}
    </View>
  );
}
