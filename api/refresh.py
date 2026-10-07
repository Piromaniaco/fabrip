# -*- coding: utf-8 -*-
"""GET /api/refresh -> limpia el cache y vuelve a pedir los videos."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib


class handler(_lib.BaseHandler):
    def do_GET(self):
        _lib.invalidate_cache()
        payload, cookies = _lib.api_videos(self)
        _lib.send_json(self, payload, cookies)
