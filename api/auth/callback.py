# -*- coding: utf-8 -*-
"""GET /api/auth/callback -> recibe el codigo de TikTok y guarda los tokens."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import _lib


class handler(_lib.BaseHandler):
    def do_GET(self):
        location, cookies = _lib.oauth_callback(self)
        base = _lib.base_url(self)
        if location.startswith("/") and base:
            location = base + location
        _lib.redirect(self, location, cookies)
