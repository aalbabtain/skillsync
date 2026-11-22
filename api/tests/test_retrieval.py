from app.agents import cv_skills, retrieval


def item(name, lines=(), builds_on=None, id="s1"):
    return {"id": id, "name": name, "builds_on": builds_on, "evidence_lines": list(lines)}


def keywords(monkeypatch):
    monkeypatch.setattr(retrieval, "_use_embeddings", lambda: False)


def test_a_skills_own_notes_come_before_related_ones(monkeypatch):
    keywords(monkeypatch)
    found, mode = retrieval.retrieve([item("Docker", ["deploy with Docker Compose"], "FastAPI")])

    assert mode == retrieval.KEYWORDS
    assert [n["skill"] for n in found["s1"][:4]] == ["Docker"] * 4
    assert found["s1"][0]["id"] == "docker-03"  # the Compose note matches this posting best


def test_the_same_skill_ranks_differently_for_different_postings(monkeypatch):
    keywords(monkeypatch)
    found, _ = retrieval.retrieve([
        item("Kubernetes", ["rolling updates with no downtime"], id="a"),
        item("Kubernetes", ["config and secrets for services"], id="b"),
    ])

    assert found["a"][0]["id"] != found["b"][0]["id"]


def test_a_skill_with_no_library_notes_gets_none(monkeypatch):
    keywords(monkeypatch)
    found, _ = retrieval.retrieve([item("Figma")])
    assert found["s1"] == []


class FakeEmbeddings:
    """Vectors from a word list, so 'compose' queries point at the Compose note."""

    VOCAB = ["compose", "dockerfile", "multi", "overview", "rolling"]

    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def vector(self, text):
        text = text.lower()
        return [1.0 if word in text else 0.0 for word in self.VOCAB] + [0.01]

    def client(self, **kwargs):
        fake = self

        class Models:
            def embed_content(self, model, contents, config):
                fake.calls += 1
                if fake.fail:
                    raise RuntimeError("quota")
                values = [type("E", (), {"values": fake.vector(text)})() for text in contents]
                return type("R", (), {"embeddings": values})()

        return type("Client", (), {"models": Models()})()


def test_embeddings_rank_by_meaning_and_note_vectors_are_built_once(monkeypatch):
    fake = FakeEmbeddings()
    monkeypatch.setattr(retrieval, "_use_embeddings", lambda: True)
    monkeypatch.setattr(retrieval.genai, "Client", fake.client)
    monkeypatch.setattr(retrieval, "_note_vectors", {})

    found, mode = retrieval.retrieve([item("Docker", ["services wired together with compose"])])
    calls_after_first = fake.calls
    retrieval.retrieve([item("Docker", ["a small multi stage image"])])

    assert mode == retrieval.EMBEDDINGS
    assert found["s1"][0]["id"] == "docker-03"
    # Notes were embedded on the first plan only; the second plan embeds just its query.
    assert fake.calls == calls_after_first + 1


def test_a_failing_embedding_call_falls_back_to_keywords(monkeypatch):
    monkeypatch.setattr(retrieval, "_use_embeddings", lambda: True)
    monkeypatch.setattr(retrieval.genai, "Client", FakeEmbeddings(fail=True).client)
    monkeypatch.setattr(retrieval, "_note_vectors", {})

    found, mode = retrieval.retrieve([item("Docker")])

    assert mode == retrieval.KEYWORDS
    assert found["s1"]


def test_demo_mode_never_calls_the_embedding_service(monkeypatch):
    monkeypatch.setattr(cv_skills, "extractor_mode", lambda: cv_skills.MOCK)
    assert retrieval._use_embeddings() is False
