# -*- coding: utf-8 -*-
"""GET /api/status -> estado de la configuracion y de la autorizacion."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _lib


class handler(_lib.BaseHandler):
    def do_GET(self):
        _lib.send_json(self, _lib.api_status(self))
