// El tema que elige la persona — los cuatro del portal (`ThemeToggle`:
// Estilo × Modo), traducidos al teléfono:
//   · Modo   — Sistema, Claro u Oscuro. Claro/Oscuro se fija con
//              `Appearance.setColorScheme`, que cambia TODA la app (los colores
//              del sistema, `useColorScheme` y `colorSistema` lo siguen solos).
//              «Sistema» es lo que hacía la app hasta ahora.
//   · Estilo — Vidrio (Liquid Glass) o Sólido: con Sólido, `Vidrio` pinta la
//              superficie opaca de las filas en vez del vidrio.
// Se guarda en el TELÉFONO, como en el portal («Se guarda para el teléfono. En
// la computadora puedes tener otro tema»).
import { Appearance } from 'react-native';
import { create } from 'zustand';
import { guardar, leer } from '../plataforma/almacen';

const CLAVE_MODO = 'app_tema_modo';
const CLAVE_ESTILO = 'app_tema_estilo';

export const MODOS = [{ id: 'sistema', label: 'Como el teléfono' }, { id: 'claro', label: 'Claro' }, { id: 'oscuro', label: 'Oscuro' }];
export const ESTILOS = [{ id: 'vidrio', label: 'Liquid Glass' }, { id: 'solido', label: 'Sólido' }];

const leerSeguro = (clave, valido, porDefecto) => {
  try { const v = leer(clave); return valido.some((x) => x.id === v) ? v : porDefecto; } catch { return porDefecto; }
};

function aplicarModo(modo) {
  const valor = modo === 'claro' ? 'light' : modo === 'oscuro' ? 'dark' : 'unspecified';
  try { Appearance.setColorScheme(valor); } catch {
    try { Appearance.setColorScheme(valor === 'unspecified' ? null : valor); } catch { /* sin soporte: sigue al sistema */ }
  }
}

export const usePreferenciaDeTema = create((set) => ({
  modo: leerSeguro(CLAVE_MODO, MODOS, 'sistema'),
  estilo: leerSeguro(CLAVE_ESTILO, ESTILOS, 'vidrio'),
  ponerModo: (modo) => {
    try { guardar(CLAVE_MODO, modo); } catch { /* sin almacén: vale hasta cerrar la app */ }
    aplicarModo(modo);
    set({ modo });
  },
  ponerEstilo: (estilo) => {
    try { guardar(CLAVE_ESTILO, estilo); } catch { /* ídem */ }
    set({ estilo });
  },
}));

/** Al arrancar: el modo guardado manda desde el primer dibujo. */
export function aplicarTemaGuardado() {
  const { modo } = usePreferenciaDeTema.getState();
  if (modo !== 'sistema') aplicarModo(modo);
}
