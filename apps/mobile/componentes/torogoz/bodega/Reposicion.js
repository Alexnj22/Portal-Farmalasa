// Reposición de Torogoz, NATIVO — `TabReposicion` del portal: qué comprar y a
// quién antes de que falte. El mínimo y el máximo salen de la velocidad de
// venta o se fijan a mano (quien administra, en la hoja `MinMax`). El pedido
// sugerido sale agrupado por el proveedor de la última compra, como CSV.
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { fetchReposicion, mensajeDeDistribucion } from '@nucleo/data/distribucion';
import { filasDeReposicion, pedidoSugeridoCsv, resumenDeReposicion } from '@nucleo/utils/distribucionBodega';
import { fechaNumerica } from '@nucleo/utils/fecha';
import { formatMoney, formatQty } from '@nucleo/utils/formatNumber';
import { compartirCsv } from '../../fiscal/csv';
import { FiltrosActivos, MenuDeFiltros } from '../../Filtros';
import { colorSistema } from '../../Formulario';
import { Aviso } from '../../formulario/Piezas';
import Kpi, { FilaDeKpis } from '../../inicio/Kpi';
import { MARCA } from '../../inicio/marca';
import { fallo } from '../../Progreso';
import MinMax from './MinMax';
import { Chapa, Ficha, PETROLEO, Vacio } from './piezas';

const PAGINA = 60;

export default function Reposicion({ puedeConfigurar, buscar }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [soloBajo, setSoloBajo] = useState('bajo');
  const [editando, setEditando] = useState(null);
  const [cuantos, setCuantos] = useState(PAGINA);

  const cargar = useCallback(async () => {
    setError('');
    try { setDatos(await fetchReposicion()); } catch (e) { setError(mensajeDeDistribucion(e)); setDatos((d) => d ?? { productos: [] }); }
  }, []);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const filas = useMemo(() => filasDeReposicion(datos, { soloBajo: soloBajo === 'bajo', buscar }), [datos, soloBajo, buscar]);
  const r = useMemo(() => resumenDeReposicion(datos), [datos]);
  const cargando = datos == null;

  const exportar = async () => {
    const a = pedidoSugeridoCsv(datos);
    try { await compartirCsv({ headers: a.headers, rows: a.rows, nombre: a.nombre.replace(/\.csv$/, ''), modulo: 'distribucion', detalle: { reporte: 'pedido-sugerido' } }); }
    catch { fallo('No se pudo armar el archivo', 'Intenta de nuevo.'); }
  };
  const grupos = [{ id: 'bajo', titulo: 'Productos', activa: soloBajo, porDefecto: 'bajo', onCambiar: (v) => { setCuantos(PAGINA); setSoloBajo(v); },
    opciones: [{ id: 'bajo', label: 'Sólo bajo el mínimo' }, { id: 'todos', label: 'Todos los productos' }] }];

  return (
    <View style={{ gap: 12 }}>
      <MenuDeFiltros grupos={grupos} extra={r.bajo ? { icono: 'square.and.arrow.up', etiqueta: 'Pedido sugerido (CSV)', onPress: exportar } : null} />
      <FiltrosActivos grupos={grupos} />
      {error ? <View style={{ marginHorizontal: 16 }}><Aviso tono="freno" texto={error} /></View> : null}
      <FilaDeKpis>
        <Kpi icono="TrendingDown" rotulo="Bajo el mínimo" color={MARCA.rojo} valor={cargando ? '…' : formatQty(r.bajo)} pide={r.bajo > 0}
          apoyo={`de ${formatQty(r.todos)} productos`} onPress={() => setSoloBajo((v) => (v === 'bajo' ? 'todos' : 'bajo'))} />
        <Kpi icono="ShoppingCart" rotulo="Compra sugerida" color={PETROLEO} valor={cargando ? '…' : formatMoney(r.costoSugerido)} apoyo="Al último costo, sin IVA" />
      </FilaDeKpis>
      <FilaDeKpis>
        <Kpi icono="CalendarClock" rotulo="Con lotes vencidos" color={MARCA.ambar} valor={cargando ? '…' : formatQty(r.vencidos)} apoyo="No cuentan como disponibles" />
        <Kpi icono="ReceiptText" rotulo="Pedido sugerido" color={MARCA.azulClaro} valor="CSV" apoyo={r.bajo ? 'Por proveedor · compartir' : 'Nada que pedir'}
          onPress={r.bajo ? exportar : undefined} />
      </FilaDeKpis>
      {datos?.config ? (
        <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>
          {`Automático: mínimo = ${datos.config.min_dias} días de venta, máximo = ${datos.config.max_dias} días (de los últimos 60). Lo reservado por ventas en curso no cuenta como disponible.`}
        </Text>
      ) : null}

      {cargando ? <ActivityIndicator style={{ marginTop: 16 }} /> : filas.length === 0 ? (
        buscar ? <Vacio titulo="Sin resultados" texto="Ningún producto coincide." />
          : <Vacio titulo={soloBajo === 'bajo' ? 'Nada bajo el mínimo' : 'Sin productos'} texto={soloBajo === 'bajo' ? 'Todo está sobre su mínimo.' : undefined} />
      ) : (
        <>
          {filas.slice(0, cuantos).map((p) => (
            <Ficha key={p.product_id} onPress={puedeConfigurar ? () => setEditando(p) : undefined}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colorSistema.texto, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{p.nombre}</Text>
                  <Text style={{ color: colorSistema.texto2, fontSize: 13 }} numberOfLines={1}>
                    {`${p.proveedor ?? 'Sin compras todavía'}${p.ultima_compra ? ` · última ${fechaNumerica(p.ultima_compra)}` : ''}`}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Chapa variante="neutral" texto={`Mín ${p.minimo} · Máx ${p.maximo}${p.manual ? ' · a mano' : ''}`} />
                    <Chapa variante="neutral" texto={`${formatQty(Number(p.velocidad))} / día`} />
                    {p.proximo_vence ? <Chapa variante="neutral" texto={`vence ${fechaNumerica(p.proximo_vence)}`} /> : null}
                    {p.vencido > 0 ? <Chapa variante="danger" texto={`${formatQty(p.vencido)} vencidas`} /> : null}
                    {p.reservado > 0 ? <Chapa variante="info" texto={`${formatQty(p.reservado)} reservadas`} /> : null}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2, minWidth: 82 }}>
                  <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>Disponible</Text>
                  <Text style={{ color: p.sugerido > 0 ? MARCA.rojo : colorSistema.texto, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{formatQty(p.disponible)}</Text>
                  {p.dias != null ? <Text style={{ color: colorSistema.texto2, fontSize: 12 }}>{`${p.dias} días`}</Text> : null}
                  {p.sugerido > 0 ? (
                    <Text style={{ color: PETROLEO, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 4 }}>
                      {`Comprar ${formatQty(p.sugerido)}${p.costo ? ` · ${formatMoney(p.sugerido * Number(p.costo))}` : ''}`}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Ficha>
          ))}
          {filas.length > cuantos ? (
            <Pressable onPress={() => setCuantos((n) => n + PAGINA)} style={{ alignSelf: 'center', minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: MARCA.azulClaro, fontSize: 16, fontWeight: '600' }}>{`Ver ${Math.min(PAGINA, filas.length - cuantos)} más`}</Text>
            </Pressable>
          ) : null}
          {puedeConfigurar ? <Text style={{ color: colorSistema.texto2, fontSize: 13, marginHorizontal: 20 }}>Toca un producto para fijar su mínimo y máximo.</Text> : null}
        </>
      )}
      {editando ? <MinMax producto={editando} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} /> : null}
    </View>
  );
}
