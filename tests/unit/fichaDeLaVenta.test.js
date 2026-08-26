import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parsearFicha } from '../../supabase/functions/_shared/erp-dte.ts';

// Lo que decide este código es si una solicitud aprobada se aplica sobre una
// venta real o sobre un formulario vacío.
//
// **Las dos páginas son capturas de producción del 2026-08-26.** No están
// escritas a mano a propósito: el defecto que originó la prueba no se ve en un
// HTML inventado, porque depende de cómo se dibuja ESA pantalla cuando la venta
// no carga.
//
// El caso real: a `0000065840_COF` (Salud 2) se le aprobó un cambio de tarjeta
// a efectivo. La página volvió SIN cliente, SIN vendedor y sin total —o sea,
// sin la venta— pero el combo de forma de pago no vuelve vacío: vuelve en su
// valor por defecto, que es «Efectivo». Como el cambio pedido era justamente a
// efectivo, la comprobación posterior lo dio por aplicado. La venta nunca
// cambió y nadie vio un error.
const leer = (n) => fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/erp', n), 'utf8');

describe('la ficha de una venta, leída de la pantalla del sistema', () => {
    it('una venta que NO cargó se distingue de una que sí — aunque diga «Efectivo»', () => {
        const f = parsearFicha(leer('reimprimir-venta-sin-datos.html'));
        // Esto es lo que engaña: hay forma de pago aunque no haya venta.
        expect(f.credito).toBe('0');
        // Y esto es lo que la delata.
        expect(f.cliente).toBeNull();
        expect(f.vendedor).toBeNull();
    });

    it('CLIENTES VARIOS se lee: su valor es -1, no un número a secas', () => {
        const f = parsearFicha(leer('reimprimir-venta-cargada.html'));
        expect(f.cliente).toBe('-1');
        expect(f.clienteNombre).toBe('CLIENTES VARIOS');
        expect(f.vendedor).toBe('142');
    });

    // Leerlo mal no era cosmético: el cambio de forma de pago manda cliente y
    // pago JUNTOS, así que un cliente que no se pudo leer viajaba como cadena
    // vacía — y eso no dice «no lo toques», dice «dejala sin cliente».
    it('el vendedor en blanco es null, no cadena vacía', () => {
        const f = parsearFicha(leer('reimprimir-venta-sin-datos.html'));
        expect(f.vendedor).not.toBe('');
        expect(f.vendedor).toBeNull();
    });
});
