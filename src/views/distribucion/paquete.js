import { paqueteDelMes } from '@nucleo/data/distribucionPaquete';

// El paquete del mes para el contador: qué entra y con qué nombre lo decide el
// núcleo (`paqueteDelMes`, el mismo que usa la app); acá sólo se comprime.
//
// `client-zip` va por `import()` (regla de librerías pesadas): sólo hace falta
// al apretar el botón.

let zipPromise = null;
function getZipLib() {
    if (!zipPromise) {
        zipPromise = import('client-zip').catch(err => { zipPromise = null; throw err; });
    }
    return zipPromise;
}

export async function armarPaqueteDelMes(mes) {
    const [{ downloadZip }, p] = await Promise.all([getZipLib(), paqueteDelMes(mes)]);
    if (!p) return null;
    const blob = await downloadZip(p.entradas.map(e => ({ name: e.name, input: e.texto }))).blob();
    return { blob, nombre: p.nombre, archivos: p.archivos, sinSello: p.sinSello };
}
