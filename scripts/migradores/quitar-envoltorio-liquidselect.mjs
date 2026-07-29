#!/usr/bin/env node
/**
 * Quita el `<div className={`rounded-2xl h-[40px] ${inputHoverClass} …`}>` que
 * envolvía a LiquidSelect en los formularios, y traslada su estado de error a
 * la prop `invalid` del propio canónico.
 *
 * Por qué existía y por qué se va: ese div mide 40px de alto y 10px de radio,
 * mientras el control real mide 46px (min-h max(40px,--tap-min) + borde) y 8px
 * de radio. El envoltorio pintaba además su propio fondo (`!bg-danger/10`), que
 * asomaba alrededor del select blanco — se veía "cortado". Medido en el navegador
 * antes de tocar nada.
 *
 * Regla del migrador: si un envoltorio no calza EXACTO con el patrón esperado
 * (una sola condición ternaria de error, un único LiquidSelect dentro), no se
 * toca y se reporta. Es preferible migrar 33 y revisar 2 a mano que romper uno
 * en silencio.
 */
import fs from 'node:fs';

const ARCHIVOS = process.argv.slice(2);
if (!ARCHIVOS.length) { console.error('uso: node quitar-envoltorio-liquidselect.mjs <archivos…>'); process.exit(1); }

// <div className={`rounded-2xl h-[40px] ${inputHoverClass}<opcional ${cond ? '…' : ''}>`}>
const ABRE = /^(\s*)<div className=\{`rounded-2xl h-\[40px\] \$\{inputHoverClass\}(.*?)`\}>\s*$/;

let migrados = 0, saltados = 0;
const informe = [];

for (const ruta of ARCHIVOS) {
    const lineas = fs.readFileSync(ruta, 'utf8').split('\n');
    const salida = [];
    for (let i = 0; i < lineas.length; i++) {
        const m = lineas[i].match(ABRE);
        if (!m) { salida.push(lineas[i]); continue; }

        const [, sangria, resto] = m;
        // Buscar el </div> de cierre al mismo nivel de sangría
        let fin = -1;
        for (let j = i + 1; j < Math.min(i + 14, lineas.length); j++) {
            if (lineas[j] === `${sangria}</div>`) { fin = j; break; }
        }
        const cuerpo = fin > 0 ? lineas.slice(i + 1, fin) : [];
        const unSoloSelect = cuerpo.filter(l => l.includes('<LiquidSelect')).length === 1;

        if (fin < 0 || !unSoloSelect) {
            informe.push(`  SALTADO ${ruta}:${i + 1} — ${fin < 0 ? 'sin cierre claro' : 'no hay exactamente un LiquidSelect'}`);
            saltados++; salida.push(lineas[i]); continue;
        }

        // La condición de error del envoltorio → prop invalid
        // resto ej.: " ${!formData.gender ? '!border-danger !bg-danger/10' : ''}"
        let invalid = null;
        const cond = resto.match(/\$\{(.+?)\s*\?\s*'!border-danger[^']*'\s*:\s*''\}/);
        if (cond) invalid = cond[1].trim();
        else if (resto.trim() !== '') {
            informe.push(`  SALTADO ${ruta}:${i + 1} — clases extra no reconocidas: ${resto.trim()}`);
            saltados++; salida.push(lineas[i]); continue;
        }

        // Reescribir el cuerpo: quitar un nivel de sangría y añadir invalid
        const desangrado = cuerpo.map(l => (l.startsWith('    ') ? l.slice(4) : l));
        if (invalid) {
            const idx = desangrado.findIndex(l => l.includes('<LiquidSelect'));
            desangrado[idx] = desangrado[idx].replace('<LiquidSelect', `<LiquidSelect invalid={${invalid}}`);
        }
        salida.push(...desangrado);
        i = fin;             // saltar el </div> de cierre
        migrados++;
    }
    fs.writeFileSync(ruta, salida.join('\n'));
}

console.log(`envoltorios quitados: ${migrados} · saltados: ${saltados}`);
if (informe.length) console.log(informe.join('\n'));
