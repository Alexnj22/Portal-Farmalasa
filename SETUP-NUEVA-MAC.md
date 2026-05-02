# Setup en nueva Mac

## 1. Requisitos previos

```bash
# Instalar Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Instalar Node.js
brew install node

# Instalar Claude Code
npm install -g @anthropic-ai/claude-code
```

## 2. Clonar el proyecto

```bash
git clone https://github.com/Alexnj22/Portal-Farmalasa.git
cd Portal-Farmalasa
npm install
```

## 3. Restaurar la memoria de Claude (contexto del proyecto)

La memoria está incluida en el repo en `.claude/memory/`. Solo hay que copiarla a donde Claude la espera:

```bash
# Desde la raíz del proyecto:
mkdir -p ~/.claude/projects/-Users-alex-Documents-staff-manager/memory
cp .claude/memory/*.md ~/.claude/projects/-Users-alex-Documents-staff-manager/memory/
```

Esto restaura todo el contexto: arquitectura, preferencias, historial de decisiones. Claude arrancará con el estado completo del proyecto sin necesidad de explicarle nada.

> **Nota:** Si la nueva Mac tiene un usuario diferente al de la Mac vieja, la ruta cambia.  
> El patrón es: `~/.claude/projects/<ruta-del-proyecto-con-guiones>/memory/`  
> Ejemplo con usuario `pedro` y proyecto en `/Users/pedro/Documents/staff-manager`:  
> `~/.claude/projects/-Users-pedro-Documents-staff-manager/memory/`

## 4. Variables de entorno

Crear el archivo `.env` en la raíz del proyecto con:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

(Copiar los valores desde la Mac vieja o desde el dashboard de Supabase → Settings → API.)

## 5. Levantar el proyecto

```bash
npm run dev
```

## 6. Abrir Claude Code

```bash
claude
```

Claude leerá la memoria automáticamente y tendrá el contexto completo del proyecto.

---

## Verificar que todo funciona

- [ ] `npm run dev` levanta sin errores
- [ ] El portal abre en `http://localhost:5173`
- [ ] Claude Code responde con contexto del proyecto al preguntar algo específico

---

## Mantener la memoria sincronizada

Cada vez que Claude actualice su memoria, copiar los archivos actualizados al repo para que queden en git:

```bash
cp ~/.claude/projects/-Users-alex-Documents-staff-manager/memory/*.md .claude/memory/
git add .claude/memory/
git commit -m "chore: sync claude memory"
git push
```
