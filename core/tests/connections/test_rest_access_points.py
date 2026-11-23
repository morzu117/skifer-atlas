"""Points d'accès REST : contrat du plan 0036, ADR 0050 à 0054."""

from urllib.parse import urlunsplit

import pytest
import yaml

from skifer_atlas import connections
from skifer_atlas.connectors.access_points import parse_access_points
from skifer_atlas.connectors.rest_access_points import RestAccessPoint, parse_rest_access_points
from skifer_atlas.governance.model import Governance, initial_governance
from skifer_atlas.repo.git import RepoError
from skifer_atlas.workspaces import Workspace, add_workspace, repo_dir


def point(**changes):
    return {"id": "api-exemple", "platform": "rest", "host": "api.exemple.test",
            "owner": "exemple.owner", "key_in": "query", "key_name": "apikey", **changes}


def example_url(path=""):
    # ADR 0053 : adresses constituées à l'exécution, aucune URL complète dans les fixtures.
    return urlunsplit(("https", "api.exemple.test", path, "", ""))


def test_rest_file_schema():
    import yaml

    registry, issues = parse_rest_access_points(yaml.safe_dump(
        {"schema_version": 1, "access_points": [point()]}), None)
    assert registry.get("api-exemple").platform == "rest"
    assert [i.code for i in issues] == ["rest_no_budget"]
    for raw in ({"schema_version": 2}, {"other": []},
                {"access_points": [point(other=None)]},
                {"access_points": [{k: v for k, v in point().items() if k != "platform"}]}):
        registry, issues = parse_rest_access_points(yaml.safe_dump(raw), None)
        assert registry is None and issues


@pytest.fixture
def space(tmp_path, monkeypatch):
    monkeypatch.setenv("ATLAS_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ATLAS_VAULT", "memory")
    add_workspace(Workspace(id="exemple", name="Exemple"))
    root = repo_dir("exemple")
    root.mkdir(parents=True)
    governance = initial_governance("exemple.owner", "Exemple")
    governance.allowed_platforms = ["rest", "databricks"]
    (root / "governance.yaml").write_text(yaml.safe_dump(governance.model_dump()),
                                         encoding="utf-8")
    return root


def write_points(root, points):
    (root / "rest_access_points.yaml").write_text(yaml.safe_dump(
        {"schema_version": 1, "access_points": points}), encoding="utf-8")


def legacy(root):
    raw = {"access_points": [{"id": "sql-exemple", "platform": "databricks",
                             "host": example_url(), "owner": "exemple.owner",
                             "warehouse_id": "abc"}]}
    text = yaml.safe_dump(raw)
    (root / "access_points.yaml").write_text(text, encoding="utf-8")
    return text


@pytest.mark.parametrize("host", [example_url(), "api.exemple.test/v1",
    "api.exemple.test:1234", "u@api.exemple.test", "API.exemple.test", "192.0.2.1", "api",
    "api.exemple.test#x", "localhost:80", "localhost", "127.0.0.1"])
def test_rest_host_validation(host):
    with pytest.raises(ValueError):
        RestAccessPoint(**point(host=host))


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_rest_loopback_port_required(host):
    with pytest.raises(ValueError, match="Port de boucle locale requis, entre 1024 et 65535"):
        RestAccessPoint(**point(host=host))


def test_rest_loopback_http_with_port():
    for host in ("127.0.0.1:1234", "localhost:65535"):
        p = RestAccessPoint(**point(host=host, http_path="/v1/"))
        assert p.call_url("/list") == "http://" + host + "/v1/list"
    assert RestAccessPoint(**point()).call_url("/list").startswith("https:")
    for path in ("//other", "/../x", "/x?q=y"):
        with pytest.raises(ValueError):
            RestAccessPoint(**point(http_path=path))


@pytest.mark.parametrize("field", ["warehouse_id", "oauth_client_id", "oauth_redirect_port",
                                 "warehouse", "role", "auth", "account", "schema"])
def test_rest_closed_model_refuses_sql_fields(field):
    with pytest.raises(ValueError):
        RestAccessPoint(**point(**{field: None}))


def test_legacy_model_refuses_rest_fields_and_platform():
    for extra in ({"platform": "rest"}, {"key_in": "query"}, {"key_name": "apikey"},
                  {"key_prefix": None}, {"calls_per_minute": 2}, {"bytes_per_day": 1}):
        found, issues = parse_access_points(yaml.safe_dump({"access_points": [{
            "id": "sql-exemple", "platform": "databricks", "host": example_url(),
            "warehouse_id": "abc", "owner": "exemple.owner", **extra}]}), None)
        assert found is None and issues


def test_rest_key_mode_required():
    for name in ("key_in", "key_name"):
        with pytest.raises(ValueError):
            RestAccessPoint(**{k: v for k, v in point().items() if k != name})
    for changes in ({"key_name": "bad-name"}, {"key_in": "header", "key_name": "bad_name"},
                    {"key_prefix": "Bearer "}, {"key_in": "other"}):
        with pytest.raises(ValueError):
            RestAccessPoint(**point(**changes))
    assert RestAccessPoint(**point(key_in="header", key_prefix="Bearer ")).auth_mode == "apikey"


def test_rest_budget_bounds():
    for field, maximum in (("calls_per_minute", 10000), ("bytes_per_day", 10**13)):
        for value in (1, maximum):
            assert getattr(RestAccessPoint(**point(**{field: value})), field) == value
        for value in (0, maximum + 1, True, "1"):
            with pytest.raises(ValueError):
                RestAccessPoint(**point(**{field: value}))


def test_rest_without_budget_warns():
    _, issues = parse_rest_access_points(yaml.safe_dump({"access_points": [point()]}), None)
    assert [(i.code, i.severity) for i in issues] == [("rest_no_budget", "warning")]


def test_old_atlas_reads_unchanged_access_points_with_rest_file(space):
    text = legacy(space)
    write_points(space, [point()])
    found, issues = parse_access_points(text, None)
    assert found.schema_version == 1 and not issues
    assert (space / "access_points.yaml").read_text(encoding="utf-8") == text


def test_platform_enums_consistent():
    from skifer_atlas.governance.model import ACCESS_POINT_PLATFORMS
    from skifer_atlas.model.nodes import PLATFORMS, Source

    assert "rest" not in PLATFORMS and set(PLATFORMS) < set(ACCESS_POINT_PLATFORMS)
    with pytest.raises(ValueError):
        Source(id="n01", type="source", platform="rest", table="a.b", columns=[])


def test_allowed_platforms_accepts_rest():
    assert Governance(allowed_platforms=["rest"]).allowed_platforms == ["rest"]
    assert Governance(allowed_platforms=["duckdb"]).allowed_platforms == ["duckdb"]


def test_rest_point_needs_allowed_platform(space):
    found, issues = parse_rest_access_points(yaml.safe_dump({"access_points": [point()]}),
                                            Governance())
    assert found is None and "platform_not_allowed" in {i.code for i in issues}
    write_points(space, [point()])
    (space / "governance.yaml").write_text("allowed_platforms: []\n", encoding="utf-8")
    with pytest.raises(RepoError, match="autorisée"):
        connections.access_point("exemple", "api-exemple")


def test_connections_read_both_files(space):
    legacy(space)
    write_points(space, [point()])
    assert [p.id for p in connections.registry("exemple").access_points] == [
        "sql-exemple", "api-exemple"]
    assert connections.access_point("exemple", "api-exemple").platform == "rest"
    assert {p["access_point"] for p in connections.list_connections("exemple")} == {
        "sql-exemple", "api-exemple"}


def test_missing_rest_file_is_empty(space):
    legacy(space)
    assert len(connections.registry("exemple").access_points) == 1
    assert connections.registry("exemple").diagnostics == []


@pytest.mark.parametrize("content", [b"[broken", bytes([255])])
def test_invalid_rest_file_preserves_legacy_points(space, content):
    legacy(space)
    (space / "rest_access_points.yaml").write_bytes(content)
    reg = connections.registry("exemple")
    assert [p.id for p in reg.access_points] == ["sql-exemple"]
    assert reg.diagnostics[0]["code"] == "invalid_rest_access_points"
    assert reg.diagnostics[0]["issues"][0]["code"] == "invalid_yaml"
    assert connections.access_point("exemple", "sql-exemple").platform == "databricks"
    with pytest.raises(RepoError) as caught:
        connections.access_point("exemple", "api-exemple")
    assert caught.value.code == "not_found"


def test_duplicate_ids_across_files(space):
    legacy(space)
    write_points(space, [point(id="sql-exemple")])
    reg = connections.registry("exemple")
    assert len(reg.access_points) == 1 and reg.get("sql-exemple").platform == "databricks"
    assert reg.diagnostics[0]["issues"][0]["code"] == "duplicate_access_point"


def test_duplicate_rest_ids(space):
    write_points(space, [point(), point()])
    assert not connections.registry("exemple").access_points
    assert connections.registry("exemple").diagnostics[0]["issues"][0]["code"] == (
        "duplicate_access_point")


def test_rest_codeowners_same_referents():
    from skifer_atlas.governance.codeowners import generate
    from skifer_atlas.governance.model import initial_governance

    text = generate(initial_governance("exemple.owner", "Exemple"), [])
    assert "/rest_access_points.yaml @exemple.owner\n" in text
    assert "/access_points.yaml @exemple.owner\n" in text


def test_rest_file_not_proposable():
    from skifer_atlas.proposals.create import SHARED_FILES

    assert "rest_access_points.yaml" not in SHARED_FILES
    assert "rest_datasets.yaml" not in SHARED_FILES


def test_rest_marker_declared(pytestconfig):
    assert any(m.startswith("rest:") for m in pytestconfig.getini("markers"))


def test_new_codes_have_http_status():
    from skifer_atlas.api.app import ERROR_STATUS
    from skifer_atlas.connectors.rest_errors import REST_ERRORS

    assert all(ERROR_STATUS[c] == status for c, (status, _) in REST_ERRORS.items())


def test_no_secret_in_rest_files():
    import re
    from pathlib import Path

    core = Path(__file__).parents[2]
    files = list((core / "src").rglob("rest*.py")) + list((core / "tests/fixtures/rest").rglob("*.yaml"))
    for path in files:
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"[?&](?:apikey|api_key)=[^&\s'\"]+", text), path
        assert not re.search(r"https?://[A-Za-z0-9]", text), path
        assert not re.search(r"\b[A-Za-z0-9_-]{48,}\b", text), path
