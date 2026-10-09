// Llevar productos (el recorrido), NATIVO — el `RetiroModal` del portal: quien
// pasa por las salas escanea el ticket de cada bolsa que se lleva y responde
// por ella hasta dejarla en su destino.
//
//   · ESCANEAR un ticket la carga (`cargarBulto`); un ticket de pedido de
//     Bodega o una bolsa ya recibida no se cargan, y se dice por qué;
//   · la entrega la FIRMA con su carné quien la da, una vez por sala y en
//     cualquier orden (`firmarEntregaConCarne`) — no frena la carga;
//   · «Dejar aquí» muestra lo que llevas para la sala donde estás, «Aquí
//     quedan» lo que espera salir de ella, y «Encima tuyo» todo lo cargado,
//     con alarma a los `DIAS_PARA_ALARMA` días;
//   · «Soltar» devuelve una bolsa que no debías llevar;
//   · «Ticket» vuelve a imprimir el ticket de una bolsa que espera en la sala
//     (el mismo papel del portal, `ticketParaReimprimir`, a la caja de la sala).
//
// Los permisos los decide la base; la bitácora la escribe la capa de datos.
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useAuth } from '@nucleo/context/AuthContext';
import { cargarBulto, cerrarRetiro, DIAS_PARA_ALARMA, fetchPendientesEnSala, fetchRetiroAbierto, firmarEntregaConCarne, soltarBulto } from '@nucleo/data/retiros';
import { fetchTrasladoParaImprimir, fetchTrasladoPorCodigo } from '@nucleo/data/traslados';
import { ticketParaReimprimir } from '@nucleo/utils/imprimirTraslado';
import { buscadorDePersonas } from '@nucleo/utils/movimientoTexto';
import { imprimirEnLaSala } from '../componentes/imprimir';
import { mensajeAmigable } from '@nucleo/utils/errorMessages';
import { salaDelUsuario } from '@nucleo/utils/salaDelUsuario';
import { useStaffStore } from '@nucleo/store/staffStore';
import { BARRA_NATIVA } from '../componentes/PilaDePestana';
import { colorSistema } from '../componentes/Formulario';
import { Aviso, BotonGrande, Seccion } from '../componentes/formulario/Piezas';
import Escaner from '../componentes/Escaner';
import { MARCA } from '../componentes/inicio/marca';
import { fallo, listo } from '../componentes/Progreso';

const cuantos = (items) => { const n = Array.isArray(items) ? items.length : Number(items) || 0; return `${n} producto${n === 1 ? '' : 's'}`; };

function Bulto({ b, primero, onSoltar, onTicket }) {
  const tarde = Number(b.dias) >= DIAS_PARA_ALARMA;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: primero ? 0 : 0.5, borderTopColor: colorSistema.separador }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colorSistema.texto, fontSize: 15, fontWeight: '600' }}>{`${b.origen ?? '—'} → ${b.destino ?? '—'}`}</Text>
        <Text style={{ color: tarde ? MARCA.rojo : colorSistema.texto2, fontSize: 13 }}>
          {`${cuantos(b.items)}${b.entrego ? ` · te la dio ${b.entrego}` : ''}${b.falta_firma ? ' · falta firma' : ''}${b.dias ? ` · ${b.dias} día${Number(b.dias) === 1 ? '' : 's'}` : ''}`}
        </Text>
      </View>
      {onTicket && b.codigo ? (
        <Pressable hitSlop={8} onPress={onTicket} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.azulClaro, fontSize: 15 }}>Ticket</Text>
        </Pressable>
      ) : null}
      {onSoltar ? (
        <Pressable hitSlop={8} onPress={onSoltar} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={{ color: MARCA.rojo, fontSize: 15 }}>Soltar</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// Volver a imprimir el ticket de una bolsa que espera en la sala.
async function reimprimirTicket(b, sala) {
  const { fila } = await fetchTrasladoParaImprimir(b.request_id);
  if (!fila?.metadata) return { ok: false, detalle: 'No se pudo leer ese traslado.' };
  const st = useStaffStore.getState();
  const cache = fila.employee_id ? await st.resolverPersonasDeSolicitudes([fila.employee_id]) : {};
  const pide = fila.employee_id ? (buscadorDePersonas(st.employees)(fila.employee_id)?.name ?? cache?.[String(fila.employee_id)]?.name ?? null) : null;
  const papel = ticketParaReimprimir({ metadata: fila.metadata, pide, familia: fila.type === 'INVENTORY_TRANSFER_PUSH' ? 'envio' : 'solicitud' });
  if (!papel) return { ok: false, detalle: 'Ese traslado no tiene número: su ticket se confirma a mano.' };
  return imprimirEnLaSala(papel.ticket, sala, papel.titulo);
}

export default function Retiro() {
  const { user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  const miSala = salaDelUsuario(user);
  const [retiro, setRetiro] = useState({ retiro_id: null, bultos: [], sin_firma: [] });
  // La sala donde estás: la que dijo el último ticket escaneado, o la tuya.
  // Derivada, porque al abrir el usuario puede no haber cargado todavía.
  const [escaneada, setSalaActual] = useState(null);
  const salaActual = escaneada ?? (miSala ? { id: miSala, nombre: null } : null);
  const [pendientes, setPendientes] = useState([]);
  const [escaneando, setEscaneando] = useState(null);   // null | 'ticket' | 'carne'
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);
  const [recargando, setRecargando] = useState(false);

  const nombre = (id) => (sucursales || []).find((b) => String(b.id) === String(id))?.name ?? '';
  const recargar = useCallback(async (sala = salaActual?.id) => {
    const [{ retiro: r }, { pendientes: p }] = await Promise.all([fetchRetiroAbierto(), fetchPendientesEnSala(sala)]);
    setRetiro({ bultos: [], sin_firma: [], ...r });
    setPendientes(p || []);
  }, [salaActual?.id]);
  useEffect(() => { recargar(); }, [recargar]);

  const escanear = async (codigo) => {
    setError(null); setAviso(null);
    try {
      const { traslado } = await fetchTrasladoPorCodigo(codigo);
      if (!traslado?.id) {
        setError(traslado?.es_de_un_pedido ? 'Ese ticket es de un pedido de Bodega, no de un traslado entre salas.' : 'No encontramos ese ticket. Puede que el código no se haya leído bien.');
        return false;
      }
      if (traslado.ya_recibido) { setError(`Esa bolsa ya se recibió${traslado.recibio ? `, la recibió ${traslado.recibio}` : ''}.`); return false; }
      const r = await cargarBulto(traslado.id, null, { origen: traslado.origen ?? null, destino: traslado.destino ?? null, desde: 'app' });
      if (!r?.ok) { setError(r?.error ?? 'No se pudo cargar esa bolsa.'); return false; }
      setAviso(r.falta_firma ? `Cargada. Falta el carné de quien entrega en ${traslado.origen ?? 'esa sala'}.` : r.entrego ? `Cargada · te la entrega ${r.entrego}.` : 'Cargada.');
      const origenId = r.origen_branch_id ?? null;
      setSalaActual(origenId ? { id: origenId, nombre: traslado.origen } : null);
      await recargar(origenId);
      return false;   // el escáner sigue abierto: se cargan varias bolsas seguidas
    } catch (e) {
      setError(mensajeAmigable(e, 'No se pudo leer ese código.'));
      return false;
    }
  };

  const firmar = async (codigo) => {
    setError(null); setAviso(null);
    const r = await firmarEntregaConCarne(codigo, { retiroId: retiro?.retiro_id, desde: 'app' });
    if (!r?.ok) { setError(r?.error ?? 'No se pudo registrar la firma.'); return false; }
    const n = Number(r.firmadas ?? 0);
    setAviso(n > 0 ? `${r.quien} firmó la entrega de ${n} ${n === 1 ? 'bolsa' : 'bolsas'}.` : `${r.quien} queda como quien entrega lo que te lleves de su sala.`);
    setEscaneando(null);
    await recargar();
    return true;
  };

  const reimprimir = async (b) => {
    const r = await reimprimirTicket(b, salaActual?.id).catch((e) => ({ ok: false, detalle: mensajeAmigable(e) }));
    if (r?.ok) listo('Ticket enviado', r.detalle ?? 'Se mandó a la caja de la sala.'); else fallo('No se imprimió', r?.detalle ?? '');
  };
  const soltar = (b) => Alert.alert('¿Soltar esta bolsa?', `${b.origen} → ${b.destino}. Deja de estar a tu cargo.`, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Soltar', style: 'destructive', onPress: async () => {
      const r = await soltarBulto(b.request_id, { sala: salaActual?.nombre ?? null, desde: 'app' });
      if (!r?.ok) fallo('No se pudo soltar', r?.error); else { listo('Bolsa soltada', `${b.origen} → ${b.destino}`); recargar(); }
    } },
  ]);

  const bultos = retiro.bultos || [];
  const dejarAqui = salaActual ? bultos.filter((b) => String(b.branch_id_destino) === String(salaActual.id)) : [];
  const sinFirma = retiro.sin_firma || [];

  return (
    <>
      <Stack.Screen options={{ ...BARRA_NATIVA, title: 'Llevar productos', headerLargeTitle: true }} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={recargando} onRefresh={async () => { setRecargando(true); await recargar(); setRecargando(false); }} />}>
        {salaActual ? <Text style={{ color: colorSistema.texto2, fontSize: 15, marginHorizontal: 4 }}>{`Estás en ${salaActual.nombre || nombre(salaActual.id)}`}</Text> : null}
        <BotonGrande texto="Escanear el ticket de una bolsa" color={MARCA.azul} onPress={() => { setError(null); setEscaneando('ticket'); }} />
        {aviso ? <Aviso tono="nota" texto={aviso} /> : null}
        {error ? <Aviso tono="freno" texto={error} /> : null}

        {sinFirma.length ? (
          <Seccion titulo="Falta la firma de quien entrega">
            {sinFirma.map((s) => <Text key={s.branch_id} style={{ color: colorSistema.texto, fontSize: 15 }}>{`${s.sala} · ${s.bolsas} bolsa${Number(s.bolsas) === 1 ? '' : 's'}`}</Text>)}
            <BotonGrande texto="Firmar con el carné" borde color={MARCA.ambar} onPress={() => { setError(null); setEscaneando('carne'); }} />
          </Seccion>
        ) : null}

        {dejarAqui.length ? (
          <Seccion titulo={`Dejar en ${salaActual?.nombre || nombre(salaActual?.id)}`}>
            {dejarAqui.map((b, i) => <Bulto key={b.request_id} b={b} primero={!i} />)}
          </Seccion>
        ) : null}

        {pendientes.length ? (
          <Seccion titulo={`Aquí quedan ${pendientes.length} esperando salir`}>
            {pendientes.map((b, i) => <Bulto key={b.request_id ?? i} b={b} primero={!i} onTicket={() => reimprimir(b)} />)}
          </Seccion>
        ) : null}

        <Seccion titulo={`Encima tuyo · ${bultos.length}`}>
          {bultos.length ? bultos.map((b, i) => <Bulto key={b.request_id} b={b} primero={!i} onSoltar={() => soltar(b)} />)
            : <Text style={{ color: colorSistema.texto2, fontSize: 15 }}>No llevas ninguna bolsa.</Text>}
        </Seccion>

        {retiro.retiro_id && !bultos.length ? (
          <BotonGrande texto="Terminar el recorrido" borde onPress={async () => {
            const r = await cerrarRetiro({ retiroId: retiro.retiro_id, bultos: 0, desde: 'app' });
            if (!r?.ok) fallo('No se pudo cerrar', r?.error); else { listo('Recorrido cerrado', ''); recargar(); }
          }} />
        ) : null}
      </ScrollView>
      <Escaner visible={escaneando === 'ticket'} titulo="Cargar una bolsa" ayuda="Apunta al código del ticket pegado a la bolsa"
        onCodigo={escanear} onCerrar={() => setEscaneando(null)}
        pie={aviso || error ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{error || aviso}</Text> : null} />
      <Escaner visible={escaneando === 'carne'} titulo="Firma de quien entrega" ayuda="Apunta al código del carné"
        onCodigo={firmar} onCerrar={() => setEscaneando(null)}
        pie={error ? <Text style={{ color: '#fff', fontSize: 14, textAlign: 'center' }}>{error}</Text> : null} />
    </>
  );
}
