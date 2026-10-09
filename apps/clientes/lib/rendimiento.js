// Teléfonos antiguos (2026-10-09): los materiales de la tarjeta y del cupón son
// shaders que corren a 60 cuadros por segundo y siguen al giroscopio. En un
// teléfono viejo eso calienta y gasta batería. En «modo liviano» el material se
// dibuja UNA vez (queda quieto, igual de bonito) y no se lee el giroscopio:
// se ve lo mismo, sin animar. Lo decide el equipo, no la persona.
//
// Corte: año de clase de equipo anterior a 2018 (iPhone 8/X y anteriores; en
// Android, gama de esa época) o menos de 2.5 GB de memoria.
import * as Device from 'expo-device';

const anio = Device.deviceYearClass;
const memoria = Device.totalMemory;
export const LIVIANO = (anio != null && anio < 2018) || (memoria != null && memoria < 2.5e9);
