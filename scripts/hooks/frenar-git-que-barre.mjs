#!/usr/bin/env node
// Hook PreToolUse de Claude Code (2026-11-06): frena los comandos de git que
// barren el árbol de trabajo. Hay OTRAS sesiones editando este mismo árbol
// (CLAUDE.md, «hay OTRAS sesiones…»), y estos comandos se llevan su trabajo sin
// commitear sin dejar rastro. La regla estaba escrita; esto la hace cumplir.
//
// Sale con 2 (bloquea) y explica por qué; con 0 deja pasar.
let entrada = '';
process.stdin.on('data', (d) => { entrada += d; });
process.stdin.on('end', () => {
    let cmd = '';
    try { cmd = JSON.parse(entrada)?.tool_input?.command || ''; } catch { process.exit(0); }
    // Se mira cada comando de la línea por separado (`a && b; c | d`).
    // Sin el texto entre comillas: el mensaje de un commit puede decir «-a».
    const sinComillas = cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""').replace(/\$\(cat <<'?(\w+)'?[\s\S]*?\n\1\s*\)/g, '""');
    const partes = sinComillas.split(/&&|\|\||;|\n|\|/).map((p) => p.trim());
    const FRENOS = [
        [/^git\s+add\s+(-A|--all|\.)(\s|$)/, '`git add -A` / `git add .` se lleva archivos de otras sesiones. Usá paths explícitos.'],
        [/^git\s+commit\s+(.*\s)?-a(\s|$)|^git\s+commit\s+(.*\s)?--all(\s|$)|^git\s+commit\s+-[a-zA-Z]*a[a-zA-Z]*(\s|$)/, '`git commit -a` commitea lo de otras sesiones. Preparar con paths explícitos.'],
        [/^git\s+stash(?!\s+(list|show))(\s|$)/, '`git stash` (aun con pathspec) barre el árbol. Ver memoria «stash con pathspec barre igual».'],
        [/^git\s+reset\s+(.*\s)?--hard(\s|$)/, '`git reset --hard` borra trabajo sin commitear de otras sesiones. Para poner main al día: `npm run main:al-dia -- --aplicar`.'],
        [/^git\s+(checkout|restore)\s+(.*\s)?\.(\s|$)/, '`git checkout .` / `git restore .` descarta cambios ajenos. Nombrar los archivos.'],
        [/^git\s+clean\s/, '`git clean` borra archivos sin trackear de otras sesiones.'],
    ];
    for (const p of partes) {
        for (const [re, motivo] of FRENOS) {
            if (re.test(p)) {
                process.stderr.write(`Bloqueado por el hook del repo: ${motivo}\n(CLAUDE.md, «hay OTRAS sesiones trabajando en este mismo árbol».)\n`);
                process.exit(2);
            }
        }
    }
    process.exit(0);
});
