// Cuándo una llamada saliente fuera de 2xx es un problema, y cuándo no.
//
// El 2026-08-24 el gate de eficiencia se puso rojo por DOS llamadas de 4.106 —un
// 401 `UNAUTHORIZED_INVALID_JWT_FORMAT` y un 400 `{"ok":false,"error":"Falta el
// envío."}`— afirmando que «el cron está fallando ANTES de ejecutar una línea».
// **Las 33 corridas de cron de esas dos ventanas terminaron `succeeded`, y en 24
// horas no falló ninguna.** El mensaje mandaba a redesplegar funciones que
// estaban bien.
//
// `net._http_response` guarda TODA salida de `pg_net`, no sólo la de los crons:
// una prueba desde el navegador, un barrido a mano o una función que validó su
// entrada y contestó 400 caen ahí igual — y ese 400 era literalmente eso.
//
// Esta prueba existe por la regla del repo: **antes de creerle un cero a un
// instrumento, fabricarle la regresión que debería cazar.** La regresión de acá
// —un cron que quedó con `verify_jwt` puesto— no se puede fabricar contra
// producción, así que la regla se probó afuera.

import { describe, it, expect } from 'vitest';
import { clasificarSalientes, TASA_NO_OK_MAX, cuentaComoCronRoto, TASA_CRON_ROJA } from '../../scripts/lib/salientes.mjs';

describe('la regresión que tiene que cazar', () => {
    it('un cron fallando CON llamadas fuera de 2xx es ROJO', () => {
        // Una función que quedó con el JWT puesto falla el 100% de las veces:
        // rebota antes de ejecutar una línea y su cron falla con ella.
        const r = clasificarSalientes({ noOk: 288, total: 4000, corridasFallidas: 288,
                                        desglose: '401×288' });
        expect(r.nivel).toBe('rojo');
        expect(r.mensaje).toContain('verify_jwt');
    });

    it('alcanza UNA corrida fallida para que sea rojo', () => {
        // Acá no se tolera una tasa: si un cron falló Y hubo un rebote, hay que
        // mirarlo. El techo por tasa es para el caso en que los crons sobreviven.
        expect(clasificarSalientes({ noOk: 1, total: 4000, corridasFallidas: 1 }).nivel).toBe('rojo');
    });
});

describe('lo que NO es un cron roto', () => {
    it('el caso real del 24-ago es un AVISO, no un rojo', () => {
        const r = clasificarSalientes({ noOk: 2, total: 4106, corridasFallidas: 0,
                                        desglose: 'sin respuesta×4 · 400×1 · 401×1' });
        expect(r.nivel).toBe('aviso');
        expect(r.mensaje).toContain('NINGUNA corrida de cron fallida');
        expect(r.mensaje).toContain('No es el JWT');
    });

    it('el aviso NO manda a redesplegar nada', () => {
        // Es la mitad que importa: la receta equivocada es peor que no dar
        // receta. Mandaba a revisar `verify_jwt` sobre funciones sanas.
        const r = clasificarSalientes({ noOk: 2, total: 4106, corridasFallidas: 0, desglose: '400×2' });
        expect(r.mensaje).not.toContain('verify_jwt');
    });

    it('el desglose siempre viaja: acotar el fallo no es dejar de mirar', () => {
        const r = clasificarSalientes({ noOk: 1, total: 4000, corridasFallidas: 0, desglose: '400×1' });
        expect(r.mensaje).toContain('400×1');
    });
});

describe('el techo por TASA, para cuando los crons sobreviven', () => {
    it('una inundación es roja aunque no falle ningún cron', () => {
        // Algo llama y rebota a un volumen que no se explica solo.
        const r = clasificarSalientes({ noOk: 500, total: 4000, corridasFallidas: 0, desglose: '400×500' });
        expect(r.nivel).toBe('rojo');
        expect(r.mensaje).toContain('algo que llama y rebota');
        expect(r.mensaje).not.toContain('verify_jwt');
    });

    it('el techo es el 1%, el mismo que las colgadas', () => {
        expect(TASA_NO_OK_MAX).toBe(0.01);
        // Justo por debajo: aviso. Justo por encima: rojo.
        expect(clasificarSalientes({ noOk: 40, total: 4000, corridasFallidas: 0 }).nivel).toBe('aviso');
        expect(clasificarSalientes({ noOk: 41, total: 4000, corridasFallidas: 0 }).nivel).toBe('rojo');
    });
});

describe('sin nada fuera de 2xx no hay nada que decir', () => {
    it('cero es silencio, no un aviso vacío', () => {
        expect(clasificarSalientes({ noOk: 0, total: 4000, corridasFallidas: 0 }))
            .toEqual({ nivel: 'nada', mensaje: null });
    });

    it('cero fuera de 2xx no se vuelve rojo aunque un cron haya fallado', () => {
        // Ese fallo tiene su propio chequeo, con su propia tasa: contarlo dos
        // veces por el mismo evento es lo que ya se corrigió con las colgadas.
        expect(clasificarSalientes({ noOk: 0, total: 4000, corridasFallidas: 5 }).nivel).toBe('nada');
    });

    it('sin argumentos no revienta', () => {
        expect(clasificarSalientes().nivel).toBe('nada');
        expect(clasificarSalientes({}).nivel).toBe('nada');
    });

    it('un total en cero no divide por cero', () => {
        // Pasa el día que la base acaba de purgar la ventana.
        expect(clasificarSalientes({ noOk: 1, total: 0, corridasFallidas: 0 }).nivel).toBe('aviso');
    });
});

/* ── Qué corridas fallidas cuentan como evidencia (2026-08-26) ───────────────
 *
 * El gate se puso rojo por dos 503 `SUPABASE_EDGE_RUNTIME_SERVICE_DEGRADED` y
 * cuatro tiempos de espera de DNS, escalados por 17 `job startup timeout`
 * repartidos entre seis crons —todos entre 0,19% y 0,94%—, que la sección de
 * arriba estaba imprimiendo como AVISO en la misma corrida.
 *
 * Los mismos tropiezos eran ruido tolerable en un lado y prueba de un cron roto
 * en el otro, y el mensaje mandaba a revisar `verify_jwt` sobre funciones sanas:
 * la misma receta equivocada que este módulo ya corrigió, un piso más arriba.
 */
describe('qué corridas fallidas cuentan como evidencia', () => {
    it('el caso real del 26-ago NO cuenta: 6 de 2839 es 0,21%', () => {
        expect(cuentaComoCronRoto({ fallidas: 6, corridas: 2839 })).toBe(0);
    });

    it('un cron con el JWT puesto SÍ cuenta: falla el 100%, no el 0,2%', () => {
        expect(cuentaComoCronRoto({ fallidas: 288, corridas: 288 })).toBe(288);
    });

    it('usa el MISMO 5% que la sección de crons, para no decir dos cosas', () => {
        expect(TASA_CRON_ROJA).toBe(0.05);
        expect(cuentaComoCronRoto({ fallidas: 5,  corridas: 100 })).toBe(0);   // 5%, justo abajo
        expect(cuentaComoCronRoto({ fallidas: 6,  corridas: 100 })).toBe(6);   // 6%, cruza
    });

    it('sin fallos no hay nada que contar', () => {
        expect(cuentaComoCronRoto({ fallidas: 0, corridas: 4000 })).toBe(0);
        expect(cuentaComoCronRoto()).toBe(0);
    });

    it('un fallo sin corridas registradas cuenta: no hay tasa que lo salve', () => {
        expect(cuentaComoCronRoto({ fallidas: 1, corridas: 0 })).toBe(1);
    });

    it('la cadena completa: tropiezos de plataforma quedan en AVISO, no en rojo', () => {
        // Es la regresión que motivó el cambio, extremo a extremo.
        const fallidas = cuentaComoCronRoto({ fallidas: 17, corridas: 6212 });
        const r = clasificarSalientes({ noOk: 6, total: 4496, corridasFallidas: fallidas,
                                        desglose: 'sin respuesta×4 · 503×2' });
        expect(fallidas).toBe(0);
        expect(r.nivel).toBe('aviso');
        expect(r.mensaje).not.toContain('verify_jwt');
    });
});
