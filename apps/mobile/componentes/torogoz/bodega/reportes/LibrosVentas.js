// Libros de ventas de Torogoz, NATIVO — `LibrosVentas` del portal: los tres
// libros del mes (contribuyentes, consumidor final, anulados). Sólo lo SELLADO
// entra; lo que falta enviar se dice arriba para que nadie crea que el libro
// está completo. Los totales y el archivo salen del núcleo, con el mismo
// generador de los libros de las farmacias.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { fetchLibrosVentas } from '@nucleo/data/distribucionCompras';
import { mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { TIPO_DOCUMENTO } from '@nucleo/utils/distribucionComun';
import { LIBROS_VENTAS, archivoDeLibroDeVentas, totalesConsumidor, totalesContribuyente } from '@nucleo/utils/distribucionReportes';
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
import Segmentos from '../../../Segmentos';
import { Ficha, PETROLEO, Vacio } from '../piezas';
import { compartirArchivo } from './compartir';

const LIBROS = LIBROS_VENTAS.map((l) => ({ id: l.key, label: l.label }));

function Fila({ izquierda, abajo, derecha, rojo }) {
  return (
    <Ficha>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{izquierda}</Text>
          <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{abajo}</Text>
        </View>
        <Text style={{ color: rojo ? MARCA.rojo : colorSistema.texto, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{derecha}</Text>
      </View>
    </Ficha>
  );
}

export default function LibrosVentas({ buscar }) {
  const [mes, setMes] = useState(mesSV);
  const [libro, setLibro] = useState('contribuyente');
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try { const [desde, hasta] = rangoDelMes(mes); setDatos(await fetchLibrosVentas({ desde, hasta })); } catch (e) { setError(mensajeDeDistribucion(e)); } finally { setCargando(false); }
  }, [mes]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => {
    const q = String(buscar ?? '').trim();
    const base = datos?.[libro] ?? [];
    return !q ? base : base.filter((f) => tokenMatch(q, f.cliente, f.numero_control, f.numero_control_del, f.numero_control_al));
  }, [datos, libro, buscar]);
  const tc = useMemo(() => totalesContribuyente(datos?.contribuyente), [datos]);
  const tf = useMemo(() => totalesConsumidor(datos?.consumidor), [datos]);
  const sinArchivo = (datos?.[libro] ?? []).some((f) => f.sin_archivo);
  const hayFilas = !!datos?.[libro]?.length;
  const extra = hayFilas && !cargando
    ? { icono: 'square.and.arrow.up', etiqueta: 'Compartir CSV', onPress: () => compartirArchivo(archivoDeLibroDeVentas(libro, datos, mes), { reporte: `libro-${libro}`, mes }) }
    : null;

  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={[]} extra={extra} />
      <PasoDeMes mes={mes} onCambiar={setMes} />
      <View style={{ marginHorizontal: 16 }}><BotonPaquete mes={mes} /></View>
      <Segmentos opciones={LIBROS} activa={libro} onCambiar={setLibro} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      {libro === 'contribuyente' ? (
        <>
          <FilaDeKpis>
            <Kpi icono="Receipt" rotulo="Ventas gravadas" color={PETROLEO} valor={formatMoney(tc.gravadas)}
              apoyo={`${formatQty(tc.documentos)} Créditos Fiscales${tc.notas ? ` · ${formatQty(tc.notas)} notas restan` : ''}`} />
            <Kpi icono="Landmark" rotulo="Débito fiscal" color={MARCA.verde} valor={formatMoney(tc.debito)} apoyo="IVA 13 % neto de notas" />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="Percent" rotulo="IVA percibido" color={MARCA.ambar} valor={formatMoney(tc.percibido)} apoyo="Percepción 1 %" />
            <Kpi icono="Percent" rotulo="IVA retenido" color={MARCA.violetaClaro} valor={formatMoney(tc.retenido)} apoyo="Va en la declaración" />
          </FilaDeKpis>
        </>
      ) : libro === 'consumidor' ? (
        <>
          <FilaDeKpis>
            <Kpi icono="Receipt" rotulo="Ventas del mes" color={PETROLEO} valor={formatMoney(tf.total)} apoyo={`${formatQty(tf.documentos)} Facturas en ${formatQty(tf.dias)} días`} />
            <Kpi icono="Landmark" rotulo="IVA contenido" color={MARCA.verde} valor={formatMoney(tf.debito)} apoyo="Débito de consumidor final" />
          </FilaDeKpis>
          <FilaDeKpis>
            <Kpi icono="Receipt" rotulo="Exentas" color={MARCA.violetaClaro} valor={formatMoney(tf.exentas)} apoyo="Ventas exentas" />
          </FilaDeKpis>
        </>
      ) : (
        <FilaDeKpis>
          <Kpi icono="Ban" rotulo="Documentos anulados" color={MARCA.rojo} valor={formatQty(filas.length)} apoyo="Invalidados en el mes" />
        </FilaDeKpis>
      )}
      {!cargando && Number(datos?.sin_sello?.documentos) > 0 ? (
        <View style={{ marginHorizontal: 16 }}>
          <Aviso tono="cuidado" texto={`${formatQty(Number(datos.sin_sello.documentos))} documentos del mes (${formatMoney(Number(datos.sin_sello.total))}) todavía no tienen sello de Hacienda y no entran al libro. Envíalos desde Facturación antes de declarar.`} />
        </View>
      ) : null}
      {!cargando && sinArchivo ? <View style={{ marginHorizontal: 16 }}><Aviso texto="Algunas filas son datos de muestra sin su archivo: sus montos se derivaron del total." /></View> : null}

      {cargando ? <ActivityIndicator style={{ marginTop: 16 }} /> : filas.length === 0 ? (
        <Vacio titulo={libro === 'anulados' ? 'Sin anulados' : libro === 'consumidor' ? 'Sin ventas' : 'Sin documentos'}
          texto={libro === 'anulados' ? 'No se invalidó ningún documento este mes.' : libro === 'consumidor' ? 'No hay Facturas selladas este mes.' : 'No hay Créditos Fiscales sellados este mes.'} />
      ) : libro === 'contribuyente' ? filas.map((f) => (
        <Fila key={f.id} izquierda={f.cliente} rojo={f.tipo_dte === '05'}
          abajo={`${fechaNumerica(f.fecha)} · ${TIPO_DOCUMENTO[f.tipo_dte]?.corto ?? f.tipo_dte} · ${f.numero_control} · NRC ${f.nrc}\nGravado ${formatMoney(Number(f.ventas_gravadas))} · débito ${formatMoney(Number(f.debito_fiscal))}${Number(f.percibido) ? ` · percibido ${formatMoney(Number(f.percibido))}` : ''}`}
          derecha={`${f.tipo_dte === '05' ? '−' : ''}${formatMoney(Number(f.ventas_gravadas) + Number(f.ventas_exentas))}`} />
      )) : libro === 'consumidor' ? filas.map((f) => (
        <Fila key={f.fecha} izquierda={fechaNumerica(f.fecha)}
          abajo={`${formatQty(Number(f.documentos))} documentos\nDel ${f.numero_control_del}\nal ${f.numero_control_al}`} derecha={formatMoney(Number(f.total_diario))} />
      )) : filas.map((f) => (
        <Fila key={f.id} izquierda={f.cliente}
          abajo={`${TIPO_DOCUMENTO[f.tipo_dte]?.corto ?? f.tipo_dte} · ${f.numero_control}\nAnulado el ${fechaNumerica(f.anulado_el)}${f.motivo ? ` · ${f.motivo}` : ''}`}
          derecha={formatMoney(Number(f.total))} />
      ))}
    </View>
  );
}
