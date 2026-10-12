import * as Haptics from 'expo-haptics';
import { FilterChip, Host, LazyRow, Text as TextoCompose } from '@expo/ui/jetpack-compose';
import { colorSistema } from '../Formulario';

// En Android: las fichas de filtro de Material 3 (FilterChip de Compose) en
// una fila que se desplaza, con la ✓ del sistema en la elegida.
export default function FichasAndroid({ opciones, activa, onCambiar }) {
  return (
    <Host matchContents={{ vertical: true }} style={{ alignSelf: 'stretch' }}>
      <LazyRow horizontalArrangement={{ spacedBy: 8 }} contentPadding={{ start: 16, end: 16 }}>
        {opciones.map((o) => (
          <FilterChip key={o.id} selected={o.id === activa}
            onClick={() => { if (o.id !== activa) { Haptics.selectionAsync().catch(() => {}); onCambiar(o.id); } }}
            colors={{ selectedContainerColor: 'rgba(0,82,204,0.16)', labelColor: colorSistema.texto, selectedLabelColor: colorSistema.texto,
              selectedLeadingIconColor: colorSistema.texto }}>
            <FilterChip.Label><TextoCompose>{o.label}</TextoCompose></FilterChip.Label>
          </FilterChip>
        ))}
      </LazyRow>
    </Host>
  );
}

