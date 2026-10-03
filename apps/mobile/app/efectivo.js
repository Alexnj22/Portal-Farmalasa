// Efectivo de la sala, NATIVO — lo que la sala necesita de «Mi caja» en el
// teléfono: cuánto hay en la caja, los cortes del día, SACAR DINERO y CERRAR EL
// DÍA. El estado sale de `caja_estado` (`estadoDeCaja`), el mismo del portal.
//
// Cerrar el día emite el Z y no se deshace, así que pasa por los TRES frenos
// del portal (`DialogoCerrar` de `MiCajaView`), en el mismo orden:
//   1. un corte sin resolver (ni confirmado ni descartado);
//   2. ningún corte confirmado hoy;
//   3. efectivo que entró desde el último conteo firmado (`falta_por_contar`)
//      — o que no se pudo medir, que también frena.
// El servidor los vuelve a aplicar (`hacer-corte-caja` / `operar-caja`).
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { cerrarElDia, estadoDeCaja } from '@nucleo/data/bolsas';
import { BRANCH_A_ERP, ERP_BODEGA, ordenDeSala } from '@nucleo/constants/erp';
import { formatMoney } from '@nucleo/utils/formatNumber';
import { hora12 } from '@nucleo/utils/hora';
import { hoySV } from '@nucleo/utils/fecha';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import { MenuDeFiltros } from '../componentes/Filtros';
import { Pildora } from '../componentes/avisos/Piezas';
import Vidrio from '../componentes/Vidrio';
import { MARCA } from '../componentes/inicio/marca';
import { Chip } from '../componentes/inicio/Widget';
import { fallo, listo, trabajando } from '../componentes/Progreso';

// Las otras tres pestañas de Efectivo del portal, para quien puede MIRAR la
// caja (`cortes_caja`): los cortes, los días con diferencia y los movimientos.
const SECCIONES = [
  { ruta: '/cortes', titulo: 'Cortes', icono: 'Calculator', color: MARCA.azul },
  { ruta: '/caja-diferencias', titulo: 'Diferencias', icono: 'HandCoins', color: MARCA.ambar },
  { ruta: '/caja-movimientos', titulo: 'Movimientos', icono: 'ArrowLeftRight', color: MARCA.violeta },
];
function Secciones() {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {SECCIONES.map((x) => (
        <Pressable key={x.ruta} style={({ pressed }) => ({ flex: 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
          onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push(x.ruta); }}>
          <Vidrio radio={18} interactivo>
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 12 }}>
              <Chip icono={x.icono} color={x.color} tamano={32} />
              <Text style={{ color: colorSistema.texto, fontSize: 13, fontWeight: '600' }}>{x.titulo}</Text>
            </View>
          </Vidrio>
        </Pressable>
      ))}
    </View>
  );
}

const ESTADO = { PENDIENTE: ['Por confirmar', MARCA.ambar], CONFIRMADO: ['Confirmado', MARCA.verde], DESCARTADO: ['Descartado', MARCA.rojo] };

export default function Efectivo() {
  const { user, hasPermission, getScope } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const puedeOperar = hasPermission('caja_vales', 'can_edit');
  const todas = getScope?.('caja_vales') === 'ALL';
  const miSala = String(salaDelUsuario(user) ?? '');
  const salas = (sucursales || []).filter((b) => BRANCH_A_ERP[Number(b.id)] != null && BRANCH_A_ERP[Number(b.id)] !== ERP_BODEGA)
    .sort((a, b) => ordenDeSala(a.id) - ordenDeSala(b.id));
  const [elegida, setElegida] = useState(null);
  const sala = todas ? (elegida ?? (salas.some((b) => String(b.id) === miSala) ? miSala : String(salas[0]?.id ?? ''))) : miSala;
  const nombre = salas.find((b) => String(b.id) === sala)?.name ?? '';
  const [estado, setEstado] = useState(undefined);
  const [recargando, setRecargando] = useState(false);

  const cargar = useCallback(async () => {
    if (!sala) { setEstado(null); return; }
    const e = await estadoDeCaja(sala);
    setEstado(e?.error ? { error: mensajeAmigable(e.error) } : e);
  }, [sala]);
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const cortes = estado?.cortes || [];
  const cortesC = cortes.filter((c) => c.tipo === 'C');
  const diaCerrado = cortes.some((c) => c.tipo === 'Z');
  const sinResolver = cortesC.filter((c) => c.estado === 'PENDIENTE');
  const sinCorte = !cortesC.some((c) => c.estado === 'CONFIRMADO');
  const falta = estado?.falta_por_contar ?? null;

  const cerrar = () => {
    if (sinResolver.length) {
      Alert.alert(sinResolver.length === 1 ? 'Falta resolver un corte' : 'Faltan cortes por resolver',
        `${sinResolver.length === 1 ? `El corte de las ${hora12(sinResolver[0].hora)} no está` : `Quedaron ${sinResolver.length} cortes sin`} confirmar ni descartar. Los cortes del día se suman entre sí: resuélvelo antes de cerrar — el cierre no se deshace.`,
        [{ text: 'Entendido', style: 'cancel' }, { text: 'Ver el corte', onPress: () => router.push({ pathname: '/corte/[id]', params: { id: String(sinResolver[0].id), fecha: hoySV() } }) }]);
      return;
    }
    if (sinCorte) {
      Alert.alert(cortesC.length ? 'El corte no está confirmado' : 'Falta el corte',
        cortesC.length ? 'Un corte descartado o sin revisar no cuenta como conteo del día. Confírmalo antes de cerrar — el cierre no se deshace.'
          : 'Si cierras ahora, el efectivo de toda la jornada queda sin contar ni una vez, y el cierre no se deshace. Haz el corte primero.',
        [{ text: 'Entendido' }]);
      return;
    }
    const noSePudo = falta && falta.medido === false;
    const pendiente = Number(falta?.falta);
    if (noSePudo || (Number.isFinite(pendiente) && pendiente >= 0.01)) {
      Alert.alert(noSePudo ? 'No se pudo revisar la caja' : 'Falta contar el efectivo',
        noSePudo ? 'No se pudo comprobar si quedó dinero sin contar. El día no se cierra sin saberlo: vuelve a intentarlo en un momento.'
          : `${falta?.desde ? `Desde el corte de las ${hora12(falta.desde)} entraron` : 'Hoy entraron'} ${formatMoney(pendiente)} que nadie ha contado. Si cierras ahora, ese dinero queda fuera de todo conteo. Haz el corte primero.`,
        [{ text: 'Entendido' }]);
      return;
    }
    Alert.alert(`¿Cerrar el día en ${nombre}?`, 'Se emite el cierre (Z) y la caja no vuelve a abrir hasta mañana. No se deshace.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar el día', style: 'destructive', onPress: async () => {
        trabajando('Cerrando el día…');
        const r = await cerrarElDia(sala);
        if (r?.error) fallo('No se pudo cerrar el día', mensajeAmigable(r.error));
        else if (r?.aviso) fallo('Quedó algo pendiente', r.aviso);
        else listo('El día quedó cerrado', nombre);
        cargar();
      } },
    ]);
  };

  const grupos = todas ? [{ id: 'sala', titulo: 'Sala', activa: sala, porDefecto: sala, onCambiar: setElegida, opciones: salas.map((b) => ({ id: String(b.id), label: b.name })) }] : [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Efectivo', headerLargeTitle: true }} />
      <MenuDeFiltros grupos={grupos} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await cargar(); setRecargando(false); }} />}>
        {hasPermission('cortes_caja', 'can_view') ? <Secciones /> : null}
        {!sala ? <Aviso tono="freno" texto="Tu usuario no tiene una sala con caja." /> : null}
        {estado?.error ? <Aviso tono="freno" texto={estado.error} /> : null}
        {nombre ? <Text style={{ color: colorSistema.texto, fontSize: 22, fontWeight: '700', marginHorizontal: 4 }}>{nombre}</Text> : null}

        <Vidrio radio={24}>
          <View style={{ padding: 18, gap: 6 }}>
            <Text style={{ color: MARCA.verde, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
              {estado?.efectivo != null ? formatMoney(estado.efectivo) : '—'}
            </Text>
            <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>en la caja</Text>
            <Pildora texto={diaCerrado ? 'Día cerrado' : 'Caja abierta'} color={diaCerrado ? MARCA.violeta : MARCA.verde} />
          </View>
        </Vidrio>

        {cortes.length ? (
          <Seccion titulo="Cortes de hoy">
            {cortes.map((c, i) => {
              const [rotulo, color] = c.tipo === 'Z' ? ['Cierre (Z)', MARCA.violeta] : (ESTADO[c.estado] ?? [c.estado, MARCA.azulClaro]);
              return (
                <Pressable key={c.id} disabled={c.tipo !== 'C'}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); router.push({ pathname: '/corte/[id]', params: { id: String(c.id), fecha: hoySV() } }); }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: i ? 0.5 : 0, borderTopColor: colorSistema.separador, opacity: pressed ? 0.6 : 1 })}>
                  <Text style={{ flex: 1, color: colorSistema.texto, fontSize: 15 }}>{hora12(c.hora)}</Text>
                  <Pildora texto={rotulo} color={color} />
                </Pressable>
              );
            })}
          </Seccion>
        ) : null}

        {puedeOperar && sala && !diaCerrado ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><BotonGrande texto="Meter dinero" color={MARCA.verde} onPress={() => router.push({ pathname: '/meter-dinero', params: { sala } })} /></View>
              <View style={{ flex: 1 }}><BotonGrande texto="Sacar dinero" color={MARCA.azul} onPress={() => router.push({ pathname: '/sacar-dinero', params: { sala } })} /></View>
            </View>
            <BotonGrande texto="Cerrar el día" borde color={MARCA.rojo} deshabilitado={!estado || !!estado.error} onPress={cerrar} />
          </View>
        ) : null}
        {!puedeOperar ? <Aviso tono="nota" texto="Tu cargo puede ver el efectivo pero no operarlo." /> : null}
      </ScrollView>
    </>
  );
}
