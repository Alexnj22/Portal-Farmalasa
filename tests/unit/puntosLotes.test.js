import { describe, it, expect } from 'vitest';
import {
    sumarMeses, venceEl, lotesConVencimiento, porVencimiento, vencidosAl,
    estaVencido, INICIO_PROGRAMA, MESES_DE_VIDA,
} from '../../supabase/functions/_shared/puntosLotes.ts';

// Lo que se ancla acá no es la aritmética: es que un punto NO se muera antes de
// tiempo. Cada caso de abajo es una forma conocida de que eso pase sin dar
// ningún error — y sin error, nadie lo reporta como defecto, lo reporta como
// «me desaparecieron los puntos».

describe('sumarMeses', () => {
    it('suma doce meses sin tocar el día', () => {
        expect(sumarMeses('2026-10-01', 12)).toBe('2027-10-01');
        expect(sumarMeses('2027-02-15', 12)).toBe('2028-02-15');
    });

    it('cruza el año por diciembre', () => {
        expect(sumarMeses('2026-12-31', 12)).toBe('2027-12-31');
        expect(sumarMeses('2026-12-01', 1)).toBe('2027-01-01');
    });

    // `new Date('2026-10-01')` se lee como UTC y en El Salvador vuelve como el
    // 30 de septiembre. Si la fecha de vencimiento retrocediera un día, los
    // puntos morirían una jornada antes y la pantalla lo mostraría convencida.
    it('no retrocede un día por leer la fecha como UTC', () => {
        for (const d of ['2026-10-01', '2027-01-01', '2027-03-01', '2027-07-01']) {
            expect(sumarMeses(d, 12).slice(8)).toBe(d.slice(8));
        }
    });

    // 29 de febrero + 12 meses cae en un día que no existe. Recortar al 28 es
    // adelantar el vencimiento un día; la alternativa (pasar al 1 de marzo) es
    // atrasarlo. Se elige el 28 porque es el último día del mismo mes: «vence
    // en febrero» sigue siendo cierto.
    it('recorta el 29 de febrero al 28', () => {
        expect(sumarMeses('2028-02-29', 12)).toBe('2029-02-28');
    });
});

describe('venceEl', () => {
    it('cuenta doce meses desde la compra cuando es posterior al arranque', () => {
        expect(venceEl('2027-03-10')).toBe('2028-03-10');
    });

    // La regla que hace que encender esto no le quite un punto a nadie: lo
    // ganado antes del arranque cuenta su año DESDE el arranque, no desde su
    // propia fecha. Sin esto, el día uno se evaporarían años de puntos de gente
    // a la que nunca se le avisó.
    it('lo viejo arranca el día que arranca el programa', () => {
        expect(venceEl('2024-01-15')).toBe(sumarMeses(INICIO_PROGRAMA, MESES_DE_VIDA));
        expect(venceEl('2026-09-30')).toBe(sumarMeses(INICIO_PROGRAMA, MESES_DE_VIDA));
    });

    it('el propio día del arranque también cuenta desde ahí', () => {
        expect(venceEl(INICIO_PROGRAMA)).toBe('2027-10-01');
    });

    it('ningún punto puede vencer antes del primer aniversario del arranque', () => {
        const piso = sumarMeses(INICIO_PROGRAMA, MESES_DE_VIDA);
        for (const d of ['2019-05-05', '2024-12-31', '2026-08-31', '2026-10-01']) {
            expect(venceEl(d) >= piso).toBe(true);
        }
    });
});

describe('lotesConVencimiento', () => {
    it('descarta los grupos que quedaron en cero', () => {
        const l = lotesConVencimiento([
            { fecha: '2027-01-10', quedan: 0 },
            { fecha: '2027-02-10', quedan: 150 },
        ]);
        expect(l).toHaveLength(1);
        expect(l[0]).toEqual({ fecha: '2027-02-10', puntos: 150, vence: '2028-02-10' });
    });

    it('acepta la fecha con hora pegada, como vuelve de la base', () => {
        const [l] = lotesConVencimiento([{ fecha: '2027-02-10 14:32:00', quedan: '150' }]);
        expect(l.fecha).toBe('2027-02-10');
        expect(l.vence).toBe('2028-02-10');
    });
});

// El caso que planteó el usuario: 200 en enero, canjea 100, 200 más en febrero.
// El gasto sale del grupo viejo —era el único que existía— así que al enero
// siguiente vencen 100, no 200, y quedan 200.
describe('el ejemplo de los 200 / 100 / 200', () => {
    // Lo que devolvería SQL_LOTES_VIVOS con gastado = 100.
    const filas = [
        { fecha: '2027-01-10', quedan: 100 },   // 200 ganados − 100 gastados
        { fecha: '2027-02-10', quedan: 200 },
    ];
    const lotes = lotesConVencimiento(filas);

    it('el saldo vivo son 300', () => {
        expect(lotes.reduce((s, l) => s + l.puntos, 0)).toBe(300);
    });

    it('al enero siguiente vencen 100 y sobreviven 200', () => {
        const vencidos = vencidosAl(lotes, '2028-01-11');
        expect(vencidos.reduce((s, l) => s + l.puntos, 0)).toBe(100);
        const vivos = lotes.filter((l) => !vencidos.includes(l));
        expect(vivos.reduce((s, l) => s + l.puntos, 0)).toBe(200);
    });

    it('el día ANTES no vence nada', () => {
        expect(vencidosAl(lotes, '2028-01-10')).toHaveLength(0);
    });
});

describe('porVencimiento', () => {
    it('junta los grupos que vencen el mismo día y los ordena', () => {
        const r = porVencimiento(lotesConVencimiento([
            { fecha: '2027-05-01', quedan: 30 },
            { fecha: '2027-03-01', quedan: 10 },
            { fecha: '2027-05-01', quedan: 25 },
        ]));
        expect(r).toEqual([
            { vence: '2028-03-01', puntos: 10 },
            { vence: '2028-05-01', puntos: 55 },
        ]);
    });

    // Todo lo anterior al arranque cae en UNA sola fecha: es lo que va a ver la
    // mayoría de la gente el primer año, y tiene que leerse como un solo bloque.
    it('todo lo viejo cae en la misma fecha', () => {
        const r = porVencimiento(lotesConVencimiento([
            { fecha: '2024-01-01', quedan: 500 },
            { fecha: '2025-06-15', quedan: 300 },
            { fecha: '2026-09-30', quedan: 200 },
        ]));
        expect(r).toEqual([{ vence: '2027-10-01', puntos: 1000 }]);
    });
});

// Restar meses es lo que usa el vencimiento para calcular su corte, y el `%` de
// JavaScript conserva el signo: sin el doble módulo, «hoy menos doce meses»
// devolvía un mes negativo. El corte habría quedado en una fecha imposible y la
// consulta no habría traído a nadie — un cero que se lee igual que «no vence
// nada», que es justo el resultado que nadie iría a revisar.
describe('sumarMeses con meses negativos', () => {
    it('resta doce meses y cae en el mismo día del año anterior', () => {
        expect(sumarMeses('2027-10-01', -12)).toBe('2026-10-01');
        expect(sumarMeses('2026-08-31', -12)).toBe('2025-08-31');
    });

    it('cruza el año hacia atrás', () => {
        expect(sumarMeses('2027-01-15', -1)).toBe('2026-12-15');
        expect(sumarMeses('2027-03-10', -14)).toBe('2026-01-10');
    });

    it('nunca devuelve un mes fuera de 1..12', () => {
        for (let i = 0; i <= 36; i++) {
            const mes = Number(sumarMeses('2027-06-15', -i).slice(5, 7));
            expect(mes).toBeGreaterThanOrEqual(1);
            expect(mes).toBeLessThanOrEqual(12);
        }
    });
});

// El borde de un día, que estuvo escrito de dos formas a la vez: `vencidosAl`
// lo trataba como el último día bueno y el trabajo mensual como el primero
// malo. La estricta era la que iba a correr contra la gente — a todos se les
// habrían muerto los puntos un día antes de lo que decía su pantalla, sin un
// error de por medio y sin nadie a quien reclamarle.
describe('el día del vencimiento todavía sirve', () => {
    const lote = { fecha: '2027-01-10', puntos: 100, vence: '2028-01-10' };

    it('el día ANTERIOR no está vencido', () => {
        expect(estaVencido(lote, '2028-01-09')).toBe(false);
    });

    it('el DÍA de vencimiento no está vencido — ese día todavía sirve', () => {
        expect(estaVencido(lote, '2028-01-10')).toBe(false);
    });

    it('el día SIGUIENTE sí', () => {
        expect(estaVencido(lote, '2028-01-11')).toBe(true);
    });

    // Los 1,431,997 puntos que hoy tiene la gente vencen todos el mismo día.
    // Un día de corrimiento acá son 10,508 personas con un reclamo legítimo.
    it('lo heredado sirve todo el 1 de octubre de 2027', () => {
        const [viejo] = lotesConVencimiento([{ fecha: '2024-03-01', quedan: 500 }]);
        expect(viejo.vence).toBe('2027-10-01');
        expect(estaVencido(viejo, '2027-09-30')).toBe(false);
        expect(estaVencido(viejo, '2027-10-01')).toBe(false);
        expect(estaVencido(viejo, '2027-10-02')).toBe(true);
    });

    it('`vencidosAl` usa la misma definición', () => {
        expect(vencidosAl([lote], '2028-01-10')).toHaveLength(0);
        expect(vencidosAl([lote], '2028-01-11')).toHaveLength(1);
    });
});
