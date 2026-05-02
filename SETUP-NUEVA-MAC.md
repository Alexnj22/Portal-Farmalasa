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

## 3. Trasladar la memoria de Claude

En la **Mac vieja**, copiar la carpeta de memoria:

```bash
tar -czf ~/Desktop/claude-memory.tar.gz ~/.claude/
```

Pasar `claude-memory.tar.gz` a la nueva Mac (AirDrop, USB, iCloud, etc.) y restaurar:

```bash
tar -xzf ~/Desktop/claude-memory.tar.gz -C ~/
```

Esto restaura todo el contexto: arquitectura del proyecto, preferencias, historial de decisiones.

## 4. Variables de entorno

Crear el archivo `.env` en la raíz del proyecto con:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

(Copiar los valores desde la Mac vieja o desde el dashboard de Supabase.)

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
