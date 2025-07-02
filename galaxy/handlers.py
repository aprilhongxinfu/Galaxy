# galaxy/handlers.py
import os
import json
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web
import tornado.escape


class FinalFileHandler(APIHandler):
    def get(self):
        file_path = os.path.join(os.path.dirname(__file__), "data", "final_file.json")
        if not os.path.exists(file_path):
            self.set_status(404)
            self.finish(json.dumps({"error": "file not found"}))
            return
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.set_header("Content-Type", "application/json")
        self.finish(data)


class AnalyzeHandler(APIHandler):
    @web.authenticated
    def post(self):
        try:
            body = self.request.body.decode("utf-8")
            data = json.loads(body)
            print("🧾 Raw parsed JSON:", data)
        except Exception as e:
            self.set_status(400)
            self.finish(json.dumps({"error": f"Invalid JSON: {str(e)}"}))
            return

        selected_paths = data.get("paths", [])
        if not selected_paths:
            self.set_status(400)
            self.finish(json.dumps({"error": "Missing paths"}))
            return

        print("🔍 Received selected notebook paths:", selected_paths)

        file_path = os.path.join(os.path.dirname(__file__), "data", "final_file.json")
        if not os.path.exists(file_path):
            self.set_status(404)
            self.finish(json.dumps({"error": "file not found"}))
            return

        with open(file_path, "r", encoding="utf-8") as f:
            final_data = json.load(f)

        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps(final_data))


class AnalyzeHandlerNew(APIHandler):
    @web.authenticated
    def post(self):
        try:
            body = self.request.body.decode("utf-8")
            data = json.loads(body)
            print("🧾 Raw parsed JSON:", data)
            print("✅🔥 THIS IS ANALYZE NEW")
        except Exception as e:
            self.set_status(400)
            self.finish(json.dumps({"error": f"Invalid JSON: {str(e)}"}))
            return

        selected_paths = data.get("paths", [])
        if not selected_paths:
            self.set_status(400)
            self.finish(json.dumps({"error": "Missing paths"}))
            return

        print("🔍 Received selected notebook paths:", selected_paths)

        if selected_paths[0] == "test-notebooks/Home Credit":
            file_name = "35332_predicted.json"
        elif selected_paths[0] == "test-notebooks/M5 Forecasting":
            file_name = "18599_predicted.json"
        elif selected_paths[0] == "test-notebooks/American Express":
            file_name = "50160_predicted.json"
        else:
            file_name = "18599_predicted.json"
        file_path = os.path.join(os.path.dirname(__file__), "data", file_name)
        if not os.path.exists(file_path):
            self.set_status(404)
            self.finish(json.dumps({"error": "file not found"}))
            return

        with open(file_path, "r", encoding="utf-8") as f:
            final_data = json.load(f)

        self.set_header("Content-Type", "application/json")
        self.finish(json.dumps(final_data))


def setup_handlers(web_app):
    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, "galaxy", "final_file")
    analyze_route = url_path_join(base_url, "galaxy", "analyze")
    analyze_new_route = url_path_join(base_url, "galaxy", "analyzeNew")

    # handlers = [(final_file_route, FinalFileHandler), (analyze_route, AnalyzeHandler)]

    web_app.add_handlers(
        ".*$",
        [
            (route_pattern, FinalFileHandler),
            (analyze_route, AnalyzeHandler),
            (analyze_new_route, AnalyzeHandlerNew),
        ],
    )
