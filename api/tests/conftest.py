import os
import tempfile

# Must be set before app modules import the settings.
os.environ["POTHOLO_DATABASE_URL"] = f"sqlite:///{tempfile.mkdtemp()}/test.db"
