# -*- coding: utf-8 -*-
"""GET /api/portafolios -> videos de la carpeta de Google Drive (60 s de cache).

El listado sale del JSON que Drive embebe en la pagina de la carpeta, asi que
no hace falta API key ni credenciales: la carpeta solo tiene que ser publica.
Los bytes de video no pasan por aca: se sirven con el rewrite /drive/video/:id.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib


class handler(_lib.BaseHandler):
    def do_GET(self):
        # 60 s en el CDN: la carpeta se refleja en la pagina al minuto y el
        # listado no se vuelve a calcular en cada visita
        _lib.send_json(self, _lib.api_portafolios(), cache="public, max-age=60")
