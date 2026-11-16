from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.frontend import register_frontend


def build(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<!doctype html><title>SkillSync</title>", "utf-8")
    (tmp_path / "assets" / "app.js").write_text("console.log('ok')", "utf-8")
    (tmp_path.parent / "secret.txt").write_text("do not serve", "utf-8")

    app = FastAPI()

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    register_frontend(app, tmp_path)
    return TestClient(app)


def test_serves_the_index_at_the_root(tmp_path):
    response = build(tmp_path).get("/")

    assert response.status_code == 200
    assert "<title>SkillSync</title>" in response.text


def test_serves_built_assets(tmp_path):
    response = build(tmp_path).get("/assets/app.js")

    assert response.status_code == 200
    assert "console.log" in response.text


def test_unknown_page_paths_fall_back_to_the_index(tmp_path):
    response = build(tmp_path).get("/some/page")

    assert response.status_code == 200
    assert "<title>SkillSync</title>" in response.text


def test_api_routes_still_win_and_unknown_api_paths_are_404(tmp_path):
    client = build(tmp_path)

    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/nope").status_code == 404


def test_does_not_serve_files_outside_the_build(tmp_path):
    client = build(tmp_path)

    response = client.get("/..%2Fsecret.txt")

    assert "do not serve" not in response.text


def test_missing_directory_registers_nothing(tmp_path):
    app = FastAPI()
    register_frontend(app, tmp_path / "missing")

    assert TestClient(app).get("/").status_code == 404
