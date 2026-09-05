#!/usr/bin/env node
/**
 * ¿El lector de boletas saca el monto que dice el papel?
 *
 * Prueba de punta a punta contra comprobantes REALES ya subidos: baja las fotos
 * del bucket, las pasa por el MISMO camino que el navegador —`aBase64Reducido`
 * ejecutándose en un Chromium de verdad, con su canvas— y le pregunta a
 * `leer-boleta`. Después aplica la decisión que toma `leerBoleta`: reintento
 * girado sólo si el papel se desmiente, y sólo se acepta si la vuelta queda
 * confirmada.
 *
 *   node scripts/probar-lectura-de-boletas.mjs [cuántas]
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Nació el 2026-09-05, después de que una lectura pusiera **248.50** sobre una
 * boleta que dice **240.50** (el cero de estas impresoras lleva una barra
 * diagonal que a la resolución en que la foto viaja se confunde con un 8). El
 * arreglo tiene tres piezas —el cotejo del papel contra sí mismo, el reintento
 * girado y el campo que no se cierra sin confirmación— y ninguna se puede dar
 * por buena leyendo el código: hay que preguntarle al lector.
 *
 * ── Tres decisiones de medición que cambian el resultado ────────────────────
 *
 * 1. **La foto se reduce como en producción.** `aBase64Reducido` la baja a 1400
 *    px de lado largo antes de mandarla. Probar con el archivo del bucket tal
 *    cual es probar otra cosa: con más píxeles el lector acierta justo donde en
 *    producción falla. Medido: la misma boleta da 248.5 a 1400 px y 240.50 al
 *    doble.
 * 2. **El giro lo hace un navegador, no esta computadora.** Girar con una
 *    librería de imágenes probaría la librería. Lo que hay que probar es el
 *    `canvas` que corre en el teléfono de la sala, así que el módulo del repo se
 *    evalúa dentro de Chromium tal como está escrito.
 * 3. **La verdad es el monto GUARDADO del movimiento**, que es lo que una
 *    persona con el papel en la mano dio por bueno. No es una verdad perfecta
 *    —si el lector se equivocó y nadie lo notó, quedó guardado el error— pero es
 *    la única disponible, y para lo que sirve alcanza: detecta que algo cambió.
 *
 * ── Lo que NO prueba ────────────────────────────────────────────────────────
 *
 * `origenDelMonto`, que vive en `operar-caja` y marca la fila
 * (FOTO_CONFIRMADA / FOTO_SIN_CONFIRMAR / A_MANO). Acá se reproduce su regla
 * para poder mostrar la columna, pero probar la de verdad exigiría ANOTAR un
 * movimiento, o sea escribir en la caja de producción.
 *
 * Necesita `E2E_USER`/`E2E_PASSWORD` del `.env` (la cuenta QA de CI) y gasta
 * cuota del lector: una llamada por boleta, dos en las que el papel se
 * desmiente.
 *
 * ⚠️ Las fotos traen nombres, DUI y montos de clientes reales. Se descargan a
 * un directorio temporal y **el script las borra al terminar**, pase lo que
 * pase.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const CUANTAS = Number(process.argv[2]) || 15;
const RAIZ = path.resolve(import.meta.dirname, '..');
const { VITE_SUPABASE_URL: URL_SB, VITE_SUPABASE_ANON_KEY: ANON,
        E2E_USER, E2E_PASSWORD } = leerEnv();

function leerEnv() {
    const out = { ...process.env };
    for (const linea of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split('\n')) {
        const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) out[m[1]] = m[2].trim();
    }
    return out;
}

/* La cuenta QA entra por `<usuario>@farmalasa.app`: `E2E_USER` es un nombre de
 * usuario y no un correo, y `loginWithUsername` le pega ese dominio antes de
 * llamar a Auth. Con el usuario pelado, Auth contesta `invalid_credentials` y
 * parece que la contraseña está mal. */
async function entrar() {
    const sb = createClient(URL_SB, ANON);
    const { data, error } = await sb.auth.signInWithPassword({
        email: `${E2E_USER}@farmalasa.app`, password: E2E_PASSWORD,
    });
    if (error) throw new Error(`no se pudo entrar con la cuenta de QA: ${error.message}`);
    return { sb, token: data.session.access_token };
}

const marcaDeOrigen = (confianza, leido, guardado) => {
    if (leido == null) return 'A_MANO';
    if (Math.abs(Number(leido) - guardado) >= 0.005) return 'A_MANO';
    return confianza === 'CONFIRMADO' ? 'FOTO_CONFIRMADA' : 'FOTO_SIN_CONFIRMAR';
};

async function main() {
    const { sb, token } = await entrar();

    const { data: movs, error } = await sb
        .from('caja_movimientos_portal')
        .select('id, monto, numero_boleta, foto_url')
        .not('foto_url', 'is', null)
        .order('registrado_at', { ascending: false })
        .limit(CUANTAS);
    if (error) throw new Error(`leyendo los movimientos: ${error.message}`);
    if (!movs.length) throw new Error('no hay movimientos con foto para probar.');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boletas-'));
    const nav = await chromium.launch();
    try {
        const pag = await nav.newPage();
        await pag.goto('about:blank');
        // El módulo del repo, sin tocar: sólo se le quita el `export` para
        // poder evaluarlo suelto. Si alguien lo cambia, esto prueba el cambio.
        const fuente = fs.readFileSync(path.join(RAIZ, 'src/utils/fotoParaLeer.js'), 'utf8');
        await pag.evaluate(fuente.replace(/export function/g, 'window.aBase64Reducido = function'));

        const filas = [];
        for (const m of movs) {
            const ruta = m.foto_url.split('/payment-proofs/')[1];
            const res = await fetch(`${URL_SB}/storage/v1/object/payment-proofs/${ruta}`,
                { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
            if (!res.ok) { console.log(`  ${m.id}: no se pudo bajar la foto (${res.status})`); continue; }
            const archivo = path.join(tmp, `${m.id}.jpg`);
            fs.writeFileSync(archivo, Buffer.from(await res.arrayBuffer()));

            const aLeer = async (girar) => {
                const bytes = [...fs.readFileSync(archivo)];
                const b64 = await pag.evaluate(async ([b, g]) => {
                    const f = new File([new Uint8Array(b)], 'b.jpg', { type: 'image/jpeg' });
                    return window.aBase64Reducido(f, { girar: g });
                }, [bytes, girar]);
                const r = await fetch(`${URL_SB}/functions/v1/leer-boleta`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', apikey: ANON,
                               Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ imagenBase64: b64, mimeType: 'image/jpeg',
                        esperado: { entidad: null, numeroBoleta: null, monto: null } }),
                });
                return r.json();
            };

            let r = await aLeer(0);
            let llamadas = 1;
            let giro = false;
            if (r?.montoConfianza === 'CONTRADICHO') {
                const g = await aLeer(90);
                llamadas = 2;
                if (g?.montoConfianza === 'CONFIRMADO') { r = g; giro = true; }
            }
            const leido = r?.leido?.monto ?? null;
            const conf = r?.montoConfianza ?? null;
            const guardado = Number(m.monto);
            const ok = leido != null && Math.abs(Number(leido) - guardado) < 0.005;
            filas.push({ id: m.id, guardado, leido, conf, ok, giro,
                         campo: conf === 'CONFIRMADO' ? 'cerrado' : 'ABIERTO',
                         marca: marcaDeOrigen(conf, leido, guardado) });
            const f = filas.at(-1);
            console.log(`${ok ? '✓' : '✗'} ${String(m.id).padStart(5)}`
                + `  guardado ${guardado.toFixed(2).padStart(9)}`
                + `  leyó ${String(leido).padStart(9)}  ${String(conf).padEnd(12)}`
                + ` ${f.campo.padEnd(8)} ${f.marca.padEnd(19)}`
                + ` ${llamadas} llamada(s)${giro ? ' (girada)' : ''}`);
        }

        const malos = filas.filter((f) => !f.ok);
        console.log(`\n  ${filas.length - malos.length}/${filas.length} con el monto guardado`
            + `  ·  ${filas.filter((f) => f.campo === 'cerrado').length} cerrados`
            + `  ·  ${filas.filter((f) => f.campo === 'ABIERTO').length} abiertos y marcados`);
        if (malos.length) {
            console.log('\n  ✗ No coinciden — abrir la foto y mirar cuál de los dos tiene razón:');
            for (const f of malos) console.log(`      ${f.id}: leyó ${f.leido}, guardado ${f.guardado} (${f.conf})`);
        }
        // Que NO coincida no siempre es culpa del lector: pudo haberse anotado
        // mal a mano. Por eso el script no falla — informa, y quien mire decide.
        process.exitCode = 0;
    } finally {
        await nav.close();
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

main().catch((e) => { console.error(`\n  ✗ ${e.message}`); process.exitCode = 1; });
