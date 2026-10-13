// Teléfonos antiguos (2026-10-09): los materiales de la tarjeta y del cupón son
// shaders que corren a 60 cuadros por segundo y siguen al giroscopio. En un
// teléfono viejo eso calienta y gasta batería. En «modo liviano» el material se
// dibuja UNA vez (queda quieto, igual de bonito) y no se lee el giroscopio:
// se ve lo mismo, sin animar. Lo decide el equipo, no la persona.
//
// Corte: año de clase de equipo anterior a 2018 (iPhone 8/X y anteriores; en
// Android, gama de esa época) o menos de 2.5 GB de memoria.
//
// Android (2026-10-13, «en Android es lenta»): el corte es más alto. A igual
// memoria, la GPU de un Android de gama media rinde bastante menos que la de
// un iPhone, y los teléfonos de las salas son en su mayoría de gama media —
// 3 y 4 GB—. Ahí un shader a pantalla de tarjeta, 60 veces por segundo, es lo
// que se sentía como «lenta». Con menos de 6 GB, o de antes de 2020, va el
// modo liviano: los materiales se ven igual, quietos.
import { Platform } from 'react-native';
import * as Device from 'expo-device';

export const ANDROID = Platform.OS === 'android';

const anio = Device.deviceYearClass;
const memoria = Device.totalMemory;
const CORTE = ANDROID ? { anio: 2020, memoria: 6e9 } : { anio: 2018, memoria: 2.5e9 };
export const LIVIANO = (anio != null && anio < CORTE.anio) || (memoria != null && memoria < CORTE.memoria);
