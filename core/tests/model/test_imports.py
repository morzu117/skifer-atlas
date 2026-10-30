import subprocess
import sys

CHECK = (
    "import sys, skifer_atlas.model, skifer_atlas.cli; "
    "print(sorted(m for m in ('pyspark', 'fastapi', 'uvicorn') if m in sys.modules))"
)


def test_model_does_not_import_spark_or_the_server():
    result = subprocess.run([sys.executable, "-c", CHECK], capture_output=True, text=True, check=True)
    assert result.stdout.strip() == "[]"
