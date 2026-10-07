# VoiceClean

**Elimina el ruido de fondo de cualquier archivo de audio o video con IA, 100 % en tu equipo.**
Sin nube, sin registro, sin API keys, sin límites y sin marcas de agua.

```powershell
.\VoiceClean.exe        # abre la aplicación en tu navegador
```

Eso es todo: se abre `http://127.0.0.1:8910/`, arrastras el archivo y esperas. La interfaz tiene
tres pantallas (arrastrar → progreso → resultado) y no requiere ningún conocimiento técnico.

---

## Requisitos

| Requisito | Detalle |
|---|---|
| Sistema | Windows 10/11 (el `.exe` es un servidor estático local de 12 KB) |
| Navegador | Chrome o Edge 113+ (usa WebAssembly multihilo, WebCodecs y SharedArrayBuffer) |
| Disco | ~260 MB para la aplicación (`app\`, incluye los modelos de IA) |
| RAM | 4 GB recomendados; 16 GB si quieres además el modo GPU |
| Internet | **No hace falta**: todo (app + modelos) se sirve desde `127.0.0.1` |

---

## Uso

1. Doble clic a **`VoiceClean.exe`** (o `powershell -File setup.ps1 -Run`).
2. Se abre el navegador en `http://127.0.0.1:8910/`.
3. Arrastra tu archivo (o pulsa *Seleccionar archivo*).
4. Espera la barra de progreso: **Leyendo → Separando voz (Demucs) → Eliminando ruido (DeepFilterNet3) → Recomponiendo**.
5. Al terminar puedes alternar **Original / Voz limpia** sobre las dos ondas (el divisor es arrastrable)
   y pulsar **Descargar archivo limpio** en el mismo formato de origen.

La **primera carga** dura unos segundos extra porque se leen los modelos locales
(~165 MB desde tu propio disco). Después, el chip de la cabecera muestra
`IA lista · DeepFilterNet3 + Demucs·WASM`.

---

## Qué hace por dentro

```
archivo
  │
  ├─ audio ──────────────► WebAudio (decodifica a Float32)
  │                        └─ video: WebCodecs extrae la pista de audio (AAC)
  │
  ├─ 1) Demucs htdemucs-ft  (ONNX, --two-stems=vocals)
  │      separa «voz» del resto (música, viento, tráfico, TV…)
  │      44,1 kHz · overlap-add con ventana de transición
  │      + guardia: correlación voz original/separada → mezcla α si el tono se desvía
  │
  ├─ 2) DeepFilterNet3 (ONNX + glue WASM, attenLim = 60)
  │      quita el ruido residual (siseo, zumbido 50/120 Hz, elemental)
  │      48 kHz · vuelve a la tasa original
  │
  └─ 3) Recomposición
         WAV/MP3  → se reescriben directamente
         FLAC/OGG/… → FFmpeg (WASM)
         MP4/MOV  → FFmpeg `-c:v copy`  ← el video NO se recodifica (byte a byte)
```

* Todo corre en **Web Workers**: la página sigue viva y el progreso responde.
* Si un motor falla, hay respaldo automático: Demucs → *skip* con aviso,
  DeepFilterNet3 → **motor espectral** (STFT con umbral de puerta).
* Los modelos se cachean en el navegador: tras la primera vez, la reapertura es inmediata.

### Motor y rendimiento

| Ejecución | Cuándo | Notas |
|---|---|---|
| **WebAssembly (CPU)** | por defecto | Siempre disponible. RTF ≈ 0,2 (DeepFilterNet3) y ≈ 3,5 (Demucs) en un portátil modesto: un minuto de audio tarda ~3,5 min. |
| **WebGPU (GPU)** | equipos con **≥ 16 GB de RAM** y GPU compatible | Se intenta como *mejora* en segundo plano tras cargar en CPU. Si la GPU no responde (driver, VRAM), se descarta sola en ≤ 45 s y la app sigue en CPU. |

### Formatos

* **Entrada:** MP3 · WAV · M4A/AAC · FLAC · OGG/OPUS · WMA · AIFF · AMR · **MP4 · MOV · WEBM · MKV · AVI**
* **Salida:** el mismo formato de origen (el audio se recodifica al códec adecuado; el video se copia sin tocar).

---

## Privacidad

* El servidor sólo escucha en **`127.0.0.1`** (nada sale de tu equipo, no hay puertos abiertos a la red).
* No hay backend, telemetría, analíticas, cuentas ni claves de API.
* Cabeceras `COOP`/`COEP` habilitadas → `crossOriginIsolated` → WebAssembly multihilo.
* Caché `no-cache` en JS/HTML (las actualizaciones se ven al recargar) y `max-age=1 día` en modelos.

---

## Estructura del proyecto

```
VoiceClean.exe              servidor local (C#, .NET 4.x, compila con csc.exe)
build.ps1                   compila VoiceClean.exe
setup.ps1                   comprueba archivos + compila + (-Run) lanza
server\Program.cs           fuente del servidor (COOP/COEP + Range + MIME)
app\
  index.html                interfaz (3 vistas)
  test.html                 diagnóstico manual de motores   ← abrir tras cargar
  assets\css\app.css        diseño oscuro (#0A0A0F, acentos #7C3AED / #06B6D4)
  assets\js\
    util.js                 WorkerClient, utilidades, toast, formatos
    audio.js                decodificar, resamplear (OfflineAudioContext), WAV
    video.js                WebCodecs (AAC/ADTS), FFmpeg, MP3/LAME, orquestador de salida
    main.js                 orquestador, progreso, A/B, guardia de voz, descarga
    engines\                dfn3.js · demucs.js · spectral.js   (cargas perezosas)
    workers\                dfn3-worker · demucs-worker · ffmpeg-worker · mp3-worker · spectral-worker
  vendor\
    ort\                    onnxruntime-web 1.30 (JS + WASM multihilo)
    dfn3\                   glue oficial de DeepFilterNet3 (df_bg.wasm, 15,7 MB)
    ffmpeg\                 ffmpeg-core (JS + WASM 30,7 MB)
    lamejs\                 MP3 (LGPL)
  models\
    dfn3\DeepFilterNet3_onnx.tar.gz        7,6 MB
    htdemucs\htdemucs_ft_vocals_fp16.onnx  158 MB
    test\mnist-8.onnx                      sólo diagnóstico
tools\                      OnnxDump (inspector ONNX, C#)
```

---

## Compilar y verificar

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1        # comprueba los 24 archivos + compila si hace falta
powershell -ExecutionPolicy Bypass -File build.ps1        # sólo compilar VoiceClean.exe
powershell -ExecutionPolicy Bypass -File setup.ps1 -Run   # compilar si hace falta y abrir la app
```

`build.ps1` usa el `csc.exe` de .NET Framework (incluido en Windows): sin NuGet, sin Node, sin Python.

### Diagnóstico de motores

Abre `http://127.0.0.1:8910/test.html` y usa los botones (cada prueba indica `RESULTADO: OK`):

* **DeepFilterNet3** – barrido de `attenLim` (0 = passthrough exacto), NaN, longitud y reducción de ruido.
* **Demucs** – carga, RTF, correlación de voz, ruido/voz medidos.
* **Motor espectral** – respaldo si la IA no está disponible.
* **Prueba de calidad** – voz real (`test-assets/jfk.wav`) + ruido añadido, con VAD y métricas por regiones.
* **Salida** – WAV / MP3 (LAME) / FLAC (FFmpeg).
* **Diag. ORT** – matriz de *execution providers* (wasm/webgpu × hilos × nivel de optimización).

---

## Problemas conocidos

* **`std::bad_alloc` al crear la sesión de Demucs** → el nivel de optimización del grafo
  debe ser `disabled` (el modelo tiene 24.917 nodos; `basic/extended/all` desbordan la memoria del WASM).
  Ya está fijado en `workers/demucs-worker.js`.
* **La GPU se pierde (`DXGI_ERROR_DEVICE_HUNG`)** en algunos equipos → el worker impone
  tiempos máximos (creación 150 s, sonda 45 s) y cae solo a CPU. Sólo se intenta la GPU con ≥ 16 GB.
* **Archivos muy largos** → Demucs en CPU es lineal (RTF ≈ 3,5): 10 min de audio ≈ 35 min.
  Usa WebGPU si tu equipo lo permite o parte el archivo.
* **Mucha RAM en video 4K largos** → se vuelcan varias copias Float32 del audio; para clips
  de más de ~10 min conviene cerrar otras pestañas.

---

## Licencias de los componentes

| Componente | Licencia | Uso |
|---|---|---|
| [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) | MIT | post-filtrado de ruido |
| [Demucs](https://github.com/facebookresearch/demucs) (htdemucs-ft) | MIT | separación voz/fondo |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | MIT | inferencia ONNX |
| [FFmpeg](https://ffmpeg.org/) (WASM) | LGPL/GPL | contenedores y remultiplexado |
| [lamejs](https://github.com/zhuker/lamejs) | LGPL | codificación MP3 |
| WebCodecs / WebGPU / WebAssembly | API del navegador | AAC, GPU y cómputo |

Todo el procesamiento ocurre **en el navegador del usuario**; no se sube ningún archivo.
