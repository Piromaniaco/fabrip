# Mis Videos (portafolio) con videos de TikTok (API oficial)

La sección **Mis Videos** (entre la descripción y **Conéctame**) muestra tus videos
de TikTok en un carrusel horizontal: la tarjeta del centro queda **enfocada** y las
de los bordes se **retrasan y desenfocan** (efecto de profundidad). Los videos se
cargan desde la **API oficial de TikTok (Display API)** y se refrescan solos cada
5 minutos.

La página es HTML estático, así que la API necesita un backend propio:
`server.py` (solo librería estándar de Python, sin instalar nada).

---

## 1. Crear la app en TikTok

1. Entrá a <https://developers.tiktok.com/> con tu cuenta y creá una app
   (**My Apps → Create an app**).
2. En **Add product** activá **Login Kit** y **Display API**.
3. En los permisos (**Scopes**) marcá:
   - `user.info.basic`
   - `video.list`  ← es el que trae tus videos
4. Copiá el **Client Key** y el **Client Secret**.

## 2. Configurar la redirect URI

La app exige declarar exactamente la URI de retorno:

| Escenario | URI |
|---|---|
| Desarrollo en esta PC | `http://localhost:8734/auth/callback` |
| Si TikTok no acepta `http://` | usá un túnel con HTTPS: `ngrok http 8734` o `cloudflared tunnel --url http://localhost:8734`, y registrá la URL que te dé + `/auth/callback` |
| Sitio publicado | `https://tudominio.com/auth/callback` |

> TikTok suele exigir `https://`. Si en modo sandbox te rechaza `localhost`,
> la opción más rápida es el túnel (`ngrok`), que te da un HTTPS temporal.

## 3. Llenar `tiktok_config.json`

Copia el ejemplo y pegá tus datos:

```powershell
Copy-Item tiktok_config.example.json tiktok_config.json
notepad tiktok_config.json
```

```json
{
  "client_key": "XXXXXXXX",
  "client_secret": "XXXXXXXX",
  "redirect_uri": "http://localhost:8734/auth/callback"
}
```

`tiktok_config.json` y `tiktok_tokens.json` **nunca se sirven al navegador**.

## 4. Arrancar el servidor

En lugar del `python -m http.server 8734` de antes, ahora:

```powershell
python server.py
```

(o doble clic en **Iniciar Portafolio.bat**). Abrí <http://localhost:8734>.

## 5. Conectar tu cuenta

Si todo está bien configurado, la sección **Mis Videos** muestra el botón
**“Conectar mi TikTok”** → te lleva al login de TikTok → aceptás los permisos →
volvés a la página y los videos aparecen.

Los tokens se guardan en `tiktok_tokens.json` y el servidor los renueva
solos (el access token dura 24 h).

---

## Cómo funciona

| Archivo | Rol |
|---|---|
| `server.py` | Sirve la landing + OAuth + `/api/videos` (cache 5 min, token auto-renovado) |
| `tiktok_config.json` | Tus credenciales (no se sube a Git) |
| `tiktok_tokens.json` | Tokens que crea el servidor (no se sube a Git) |
| `index.html` | Sección `#portafolio` (carrusel + panel de estado) |
| `style.css` | Carrusel con `perspective`, `translateZ`, `rotateY` y `blur` por distancia |
| `script.js` | Pide `/api/videos`, arma las tarjetas y calcula la profundidad en cada frame |

Endpoints:

- `GET /api/status` → `{ configured, authorized, count, … }`
- `GET /api/videos` → `{ ok, videos:[{id,title,cover,embed,url,duration,views,likes}], updated_at }`
- `GET /api/refresh` → ignora el cache y vuelve a consultar TikTok (botón ⟳)
- `GET /auth/login` → arranca el OAuth
- `GET /auth/callback` → recibe el código y guarda los tokens
- `GET /api/portafolios` → `{ ok, videos:[{id,name,size,mime,video,thumb}] }`
  (carpeta de Google Drive, cache 60 s)
- `GET /drive/video/<id>` → proxy del video de Drive conservando `Range`
- `GET /drive/thumb/<id>` → miniatura `s640` de Drive (la imagen de cada tarjeta)

## Límites

- TikTok solo entrega videos **públicos** de la cuenta conectada (máx. 30 por consulta).
- La sincronización es por cache de 5 minutos para no gastar la cuota de la API;
  además se refresca al tocar el botón ⟳ o cada vez que abrís la página con
  la pestaña visible.
- Para cambiar el embed oficial por el reproductor clásico, en `script.js`
  reemplazá `https://www.tiktok.com/embed/v2/` por el valor de `embed_link`.

## Portafolios (Google Drive)

La sección **Portafolios** (entre la portada y **Mis Videos**) muestra los
videos de una carpeta pública de Google Drive en una tira que avanza de
izquierda a derecha en bucle:

    https://drive.google.com/drive/folders/1Lz70RyHCrOL43buC4mfrubPutl7TGpzP

- **Listado** — `GET /api/portafolios` lee el JSON que Drive embebe en la
  página de la carpeta (`_DRIVE_ivd`): **no hace falta API key ni
  credenciales**, sólo que la carpeta sea pública. Cache de 60 s y el front lo
  vuelve a consultar cada minuto mientras la tira está a la vista, así que si
  agregás o sacás un video de la carpeta, la página lo refleja sola.
- **Reproducción** — los bytes salen por `/drive/video/<id>`: en Vercel es un
  rewrite en el borde y en local un proxy de `server.py`. Es obligatorio:
  Drive contesta **403** a cualquier petición con `Sec-Fetch-Site:
  cross-site`, que es exactamente lo que manda un `<video>` apuntando a otro
  dominio (probado: `Format error` en el navegador).
- **`confirm=t`** — los archivos de más de 100 MB caen en el *"Virus scan
  warning"* de Drive; ese parámetro lo salta.
- **Sin `Referer`** — `index.html` declara `<meta name="referrer"
  content="no-referrer">`. Si el header llega a Google (Vercel lo reenvía),
  el aviso de virus vuelve a aparecer: era lo que rompía el video de 129 MB.
- **Miniaturas** — `/drive/thumb/<id>` (`lh3.googleusercontent.com/d/<id>=s640`)
  para la miniatura de cada tarjeta. La tarjeta es un `<img decoding="async">` y
  **no** un `<video>`: en un celular, elementos de video quietos dentro de la
  tira en movimiento se ven como parpadeo, y así la tira queda sin capas de
  medios.
- **Peso** — las tarjetas **no bajan ni un byte de video**: sólo la miniatura;
  los bytes salen recién al tocar una tarjeta (visor, `preload="none"`). La tira
  deja de animarse si no está a la vista y **también mientras cargan las
  miniaturas** (clase `.is-loading`, con tope de 6 s): redibujar imágenes que
  llegan dentro de la tira en movimiento se ve como tirones. Avance de ~42 px/s
  y el sonido se prende con el clic que abre el visor (los navegadores no
  dejan autoplay con audio).
- **Visor** — al hacer clic la tarjeta crece hasta el centro (FLIP de 0,45 s)
  y arranca **desde el segundo 0 con sonido**. Mientras carga se ve el
  **primer cuadro (`poster`) + spinner** (nunca pantalla negra ni el video
  dibujado a media carga): el `<video>` recién aparece cuando tiene su
  primer cuadro **y** terminó la animación de apertura. El `will-change` se
  pone sólo durante la animación y se libera al terminar, así el video queda
  nítido; el fondo es un degradado opaco (**sin `backdrop-filter`**, que es
  lo que más artefactos producía al encogerse la tarjeta) y la página se
  congela **devolviendo el scroll a su lugar** en vez de bloquear `overflow`
  (bloquear la barra corre la página en navegadores con scrollbar clásica).
  Se cierra con la X, el fondo o Escape; al cerrar se suelta el buffer
  (`removeAttribute('src') + load()`).
- **Celular (sin glitches mientras carga)** — tres medidas, ninguna toca la
  resolución de nada:
  1. **Con el visor abierto se congela todo lo decorativo**
     (`body.is-modal-open * { animation-play-state: paused }`, con el spinner
     del visor y la intro fuera de la pausa): mientras el navegador descarga y
     decodifica el video, la suma de capas animadas + la carga tira cuadros en
     un celular y se ve como parpadeo. El scroll ya está bloqueado y el fondo
     asoma 3% por debajo del velo, así que la pausa es invisible.
  2. **El blur de extremos en móvil es un velo, no un `backdrop-filter`**
     (`@media (max-width: 768px), (pointer: coarse)`): el filtro relee y
     difumina toda la pantalla en cada cuadro porque siempre hay algo
     moviéndose abajo (balanceo del fondo, deriva de la tira). El velo usa la
     **misma máscara y la misma `--edge-op`**: desaparece igual en los
     extremos (encabezado y pie se ven nítidos) con costo cero de GPU.
  3. **La tira no redibuja mientras cargan las miniaturas** (punto *Peso*
     arriba) y la sombra del visor es más corta en móvil (se redibuja en cada
     cuadro del FLIP).
- **Cuota de Drive** — Google limita las descargas públicas y, cuando se
  pasa, devuelve una **página HTML** en vez del video: el navegador la
  recibe como `200 text/html` y tira `MEDIA_ERR_SRC_NOT_SUPPORTED` (pantalla
  rota). Se detecta porque el fallo es intermitente (un request pasa y los
  siguientes no). El visor lo maneja: **reintento automático a los 2,5 s**
  con un sello de tiempo en la URL (para esquivar una respuesta mala
  guardada en el CDN) y, si vuelve a fallar, aviso **"No se pudo cargar el
  video"** con botón **Reintentar** en vez del spinner eterno. Para bajar el
  consumo se usa `preload="none"` (sólo se descarga si se reproduce) y el
  buffer se corta al cerrar. Si llegara a agotarse seguido, la solución
  definitiva es una API key de Google Cloud o alojar los videos en otro lado.
- **Para cambiar la carpeta** — `DRIVE_FOLDER` en `api/_lib.py` (lo comparten
  `server.py` y las funciones de Vercel). Los archivos que no son `video/*`
  se ignoran.

## Despliegue en Vercel (online)

La landing se sirve como sitio estático y el backend corre como **funciones
Python de Vercel** en `/api` (mismos nombres de ruta que en local):

| Ruta en Vercel | Archivo |
|---|---|
| `GET /api/status` | `api/status.py` |
| `GET /api/videos` | `api/videos.py` |
| `GET /api/refresh` | `api/refresh.py` |
| `GET /api/portafolios` | `api/portafolios.py` |
| `GET /auth/login` | `api/auth/login.py` (via rewrite en `vercel.json`) |
| `GET /auth/callback` | `api/auth/callback.py` |
| `GET /drive/video/:id` | rewrite en `vercel.json` → Google Drive (borde) |
| `GET /drive/thumb/:id` | rewrite en `vercel.json` → miniaturas de Drive |

`api/_lib.py` concentra toda la lógica (config, tokens, OAuth, videos y el
listado de la carpeta de Drive, que es el que usa también `server.py`).

### Subir

```bash
vercel login                       # una sola vez
vercel --prod                      # genera el dominio <proyecto>.vercel.app
```

`vercel.json` agrega los rewrites de `/auth/*` **y** los de `/drive/*` (video y
miniatura de Google Drive). Lo que se sube está controlado por `.vercelignore`:
**no se suben** `tiktok_config.json`, `tiktok_tokens.json`, `server.py`,
manuales, scripts ni los proyectos ajenos que viven en la misma carpeta.

### Diferencias con la versión local

Vercel no tiene disco persistente ni un proceso único, así que:

| | local (`python server.py`) | Vercel |
|---|---|---|
| configuración | `tiktok_config.json` | **variables de entorno** |
| tokens | `tiktok_tokens.json` | **cookies HttpOnly** del navegador |
| cache de 5 min | en memoria | en memoria (mejor esfuerzo por instancia) |
| `redirect_uri` | `http://localhost:8734/auth/callback` | `https://<proyecto>.vercel.app/api/auth/callback` |

### Variables de entorno (Settings → Environment Variables)

| Variable | Valor |
|---|---|
| `TIKTOK_CLIENT_KEY` | el *Client Key* de tu app de TikTok |
| `TIKTOK_CLIENT_SECRET` | el *Client Secret* |
| `TIKTOK_REDIRECT_URI` | opcional: si no se setea se deriva del propio request |

En developers.tiktok.com registrá como redirect URI exactamente
`https://<proyecto>.vercel.app/api/auth/callback` (https y sin barra final).
Hasta que no estén las dos variables, la sección **Mis Videos** muestra
*«Videos sin configurar»*, igual que en local.
