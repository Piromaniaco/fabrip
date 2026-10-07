# Fabri Piro - Portafolio

Portafolio personal de **Fabri Piro** (Piromaniaco): editor de video especializado en estilos reel y clips, compositor musical y programador argentino.

## Que es este proyecto

Web estatica + funciones serverless en Vercel que muestra:

- **Portafolios** - videos alojados en Google Drive, via /api/portafolios
- **Mis Videos** - videos de TikTok sincronizados con la API oficial, via /api/videos
- **Contacto** - TikTok, Instagram, Facebook y Gmail
- **Sobre mi** - habilidades y presentacion

## Stack

| Capa | Tecnologia |
|---|---|
| Frontend | HTML + CSS + JavaScript vanilla |
| Backend | Vercel Functions (Python) |
| Hosting | Vercel |
| Fuentes | Google Fonts (Montserrat, Roboto) |
| Iconos | Font Awesome 6 (CDN) |

## Estructura

fabrip/
  index.html
  style.css
  script.js
  middleware.js
  vercel.json
  tiktok_config.example.json
  api/
    portafolios.py
    videos.py
    refresh.py
    status.py
    _lib.py
    auth/
      login.py
      callback.py

## Despliegue

Se despliega automaticamente en Vercel al hacer push a main.

## Contacto

- TikTok: https://tiktok.com/@piromanniaco
- Instagram: https://www.instagram.com/fabrip_ar/
- Facebook: https://www.facebook.com/share/1HzgddTLPz/
- Email: Pirovanifabricio@gmail.com

---

(c) 2026 Piromaniaco. Todos los derechos reservados.
