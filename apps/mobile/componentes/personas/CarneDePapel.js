// «Imprimir carné del día» desde el teléfono — el `BotonCarneDePapel` del
// portal. Pregunta en qué sala sale (la lista se lee en el TOQUE: una caja se
// apaga en cualquier momento) y entrega con `entregarCarneDePapel`, la MISMA
// pieza del portal: emite el carné del día (el anterior deja de servir) y lo
// manda a la caja de esa sala.
//
// La diferencia con el portal: en el teléfono no hay «esta computadora». Sin
// una sala que reciba, no se emite nada.
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { useAuth } from '@nucleo/context/AuthContext';
import { useStaffStore } from '@nucleo/store/staffStore';
import { entregarCarneDePapel } from '@nucleo/utils/entregarCarneDePapel';
import { fetchSalasConCaja } from '@nucleo/data/impresion';
import { ordenDeSala } from '@nucleo/constants/erp';
import { BotonGrande } from '../formulario/Piezas';
import { MARCA } from '../inicio/marca';
import { fallo, listo, trabajando, cerrarProgreso } from '../Progreso';

function elegir(titulo, opciones) {
  return new Promise((resolver) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: titulo, options: [...opciones.map((o) => o.label), 'Cancelar'], cancelButtonIndex: opciones.length },
        (i) => resolver(i < opciones.length ? opciones[i] : null),
      );
    } else {
      Alert.alert(titulo, null, [...opciones.map((o) => ({ text: o.label, onPress: () => resolver(o) })), { text: 'Cancelar', style: 'cancel', onPress: () => resolver(null) }]);
    }
  });
}

export function useCarneDePapel() {
  const { user } = useAuth();
  const sucursales = useStaffStore((s) => s.branches);
  return async ({ employeeId, nombre, cargo = '', sala = '', motivo = null, alTerminar }) => {
    if (!employeeId) return;
    trabajando('Buscando las cajas…');
    const { salas, error } = await fetchSalasConCaja();
    cerrarProgreso();
    if (error) { fallo('No se pudo leer qué salas imprimen', 'Revisa la conexión y vuelve a intentar.'); return; }
    const nombreDe = new Map((sucursales || []).map((b) => [Number(b.id), b.name]));
    const opciones = [...(salas || [])].sort((a, b) => ordenDeSala(a.branch_id) - ordenDeSala(b.branch_id))
      .map((s) => ({ id: s.branch_id, nombre: nombreDe.get(Number(s.branch_id)) || `Sala ${s.branch_id}`, latiendo: s.latiendo }))
      .map((s) => ({ ...s, label: s.latiendo ? s.nombre : `${s.nombre} (su caja no responde)` }));
    if (!opciones.length) { fallo('Ninguna sala imprime ahora', 'No hay cajas que reciban documentos. Imprímelo desde una computadora.'); return; }
    const destino = await elegir(`Carné del día — ${nombre}. ¿En qué sala sale?`, opciones);
    if (!destino) return;
    Alert.alert('¿Imprimir el carné del día?', `Sale en la caja de ${destino.nombre} y vale hasta medianoche. Si ya tenía uno de hoy, ese deja de servir.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Imprimir', onPress: async () => {
        trabajando('Emitiendo el carné…');
        const r = await entregarCarneDePapel({
          employeeId, nombre, cargo, motivo,
          sala: sala || destino.nombre, salaId: destino.id, salaElegida: true, emitidoPor: user?.name || '',
        }).catch((e) => ({ ok: false, emitido: false, motivo: e?.message }));
        if (r.ok) listo('Carné del día', `Sale en la caja de ${destino.nombre} en unos segundos. Vale hasta medianoche.`);
        else if (r.emitido) fallo('Se emitió pero no salió papel', `${r.motivo || ''} Vuelve a imprimirlo: el de antes ya no sirve.`);
        else fallo('No se emitió el carné', r.motivo || 'Intenta de nuevo.');
        alTerminar?.(r);
      } },
    ]);
  };
}

export default function BotonCarneDePapel({ employeeId, nombre, cargo, sala, motivo, alTerminar, texto = 'Imprimir carné del día' }) {
  const imprimir = useCarneDePapel();
  return <BotonGrande texto={texto} borde color={MARCA.azulClaro} onPress={() => imprimir({ employeeId, nombre, cargo, sala, motivo, alTerminar })} />;
}
