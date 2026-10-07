# -*- coding: utf-8 -*-
"""GET /api/videos -> videos recientes (cache de 5 min, token auto-renovado)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib


class handler(_lib.BaseHandler):
    def do_GET(self):
        payload, cookies = _lib.api_videos(self)
        _lib.send_json(self, payload, cookies)
