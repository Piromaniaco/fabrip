# Instagram Auditor

App de escritorio (PowerShell + WPF, **sin instalar nada**) para tu propia cuenta de Instagram:

1. **No me siguen de vuelta** – a quiénes sigues tú y no te siguen.
2. **Me siguen y no los sigo** – quiénes te siguen y tú no sigues.
3. **Posibles bloqueos** – detección *aproximada* de quién podría haberte bloqueado.

---

## Cómo usarla

1. Haz doble clic en **`Ejecutar App.bat`**.
2. Escribe tu **usuario** y tu **contraseña** y pulsa *Iniciar sesión*.
   - Si tienes verificación en dos pasos, te pedirá el código.
3. Pulsa **`Actualizar listas`** (tarda unos segundos según cuánta gente sigas).
4. Repesta las pestañas. Puedes **Exportar CSV** desde cada una.

### Alternativa: entrar con la cookie (más fiable)

Si Instagram te pide una verificación en el navegador o rechaza el login automático, usa la cookie:

1. Abre instagram.com en Chrome/Edge e inicia sesión.
2. `F12` → pestaña **Application** → **Cookies** → `https://www.instagram.com`.
3. Busca la cookie **`sessionid`**, copia su valor.
4. Pégalo en la casilla **Cookie sessionid** de la app y pulsa **Usar cookie**.

La cookie solo se usa en memoria; no se guarda en disco.

---

## Detección de bloqueos: qué es y qué no es

Instagram **no revela nunca** quién te bloquea. No existe ninguna API ni programa
(oficial o "crackeado") que lo diga, así que esta pestaña hace una **estimación**
con estas señales:

| Señal | Significado |
|---|---|
| El perfil dejó de ser accesible **y antes sí lo era** (snapshot guardado) | Posible bloqueo, cuenta borrada o cambio de nombre |
| El perfil existe pero **no aparece en el buscador** | Instagram suele ocultar así a quien te bloqueó (señal débil) |
| Dejó de aparecer en tu lista de seguidores | Unfollow **o** bloqueo |

- Ejecuta la app varias veces: guarda un snapshot en `%LOCALAPPDATA%\InstagramAuditor\`
  y al ejecutarla de nuevo detecta cambios.
- **No hagas cientos de comprobaciones seguidas**: Instagram puede limitar tu cuenta
  temporalmente (usa el límite de la combobox y espera entre tandas).

---

## Avisos

- **Tus credenciales no se guardan** (solo el nombre de usuario, para rellenarlo la
  próxima vez). Todo ocurre en tu PC.
- Usa una herramienta de terceros bajo tu responsabilidad: Meta no la respalda y el
  login automático puede provocar que Instagram pida confirmación (acaba esa
  verificación en el navegador y luego usa la cookie).
- Si Instagram devuelve *429* o "espera unos minutos", para un rato antes de reintentar.
- Para desinstalar: borra el script y la carpeta `%LOCALAPPDATA%\InstagramAuditor`.

---

## Archivos

| Archivo | Para qué |
|---|---|
| `Ejecutar App.bat` | Lanza la app (doble clic) |
| `InstagramAuditor.ps1` | El código de la app (PowerShell + WPF) |
| `LEEME.md` | Este documento |

> Si PowerShell bloquea el script, el `.bat` ya lo lanza con `-ExecutionPolicy Bypass`.

## Requisitos

- Windows 10/11 con PowerShell 5.1 (viene de serie).
- Conexión a internet.
