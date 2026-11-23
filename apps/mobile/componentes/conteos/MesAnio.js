// «Vence» de un lote: MES y año, lo que trae el empaque. Sale como «AAAA-MM».
// iPhone: dos hojas seguidas del sistema (año, después mes). La de Android es
// `MesAnio.android.js`: ahí la segunda hoja encadenada no dejaba elegir el mes
// (Bodega, 2026-11-23).
import { ActionSheetIOS, Text } from 'react-native';
import { colorSistema } from '../Formulario';
import Tocable from '../Tocable';

export const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export default function MesAnio({ valor, onCambiar }) {
  const elegir = () => {
    const hoy = new Date().getFullYear();
    const anios = Array.from({ length: 9 }, (_, i) => String(hoy - 2 + i));
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Año de vencimiento', options: [...anios, 'Cancelar'], cancelButtonIndex: anios.length }, (i) => {
      if (i >= anios.length) return;
      ActionSheetIOS.showActionSheetWithOptions({ title: `Mes de ${anios[i]}`, options: [...MESES, 'Cancelar'], cancelButtonIndex: 12 }, (m) => {
        if (m < 12) onCambiar(`${anios[i]}-${String(m + 1).padStart(2, '0')}`);
      });
    });
  };
  const [a, m] = String(valor || '').split('-');
  return (
    <Tocable onPress={elegir} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 10 }}>
      <Text style={{ color: colorSistema.texto, fontSize: 16 }}>Vence</Text>
      <Text style={{ flex: 1, textAlign: 'right', color: valor ? colorSistema.acento : colorSistema.texto2, fontSize: 16 }}>
        {a && m ? `${MESES[Number(m) - 1]} ${a}` : 'Mes y año'}
      </Text>
      <Text style={{ color: colorSistema.texto2, fontSize: 18 }}>›</Text>
    </Tocable>
  );
}
