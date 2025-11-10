import os
import tempfile
import subprocess
from base64 import b64encode
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import requests

load_dotenv()

ONSHAPE_API_URL = os.getenv("ONSHAPE_API_URL", "https://cad.onshape.com/api/v12")
ONSHAPE_ACCESS_KEY = os.getenv("ONSHAPE_ACCESS_KEY")
ONSHAPE_SECRET_KEY = os.getenv("ONSHAPE_SECRET_KEY")

if not ONSHAPE_ACCESS_KEY or not ONSHAPE_SECRET_KEY:
    raise RuntimeError(
        "ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY must be set in env"
    )

auth_header = "Basic " + b64encode(
    f"{ONSHAPE_ACCESS_KEY}:{ONSHAPE_SECRET_KEY}".encode("utf-8")
).decode("utf-8")


class CreateFromOpenSCADRequest(BaseModel):
    openscad_code: str
    document_name: Optional[str] = None


class CreateFromOpenSCADResponse(BaseModel):
    success: bool
    docId: Optional[str] = None
    docName: Optional[str] = None
    url: Optional[str] = None
    message: Optional[str] = None
    error: Optional[str] = None


app = FastAPI()


def onshape_api_request(method: str, path: str, **kwargs):
    url = f"{ONSHAPE_API_URL}{path}"
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = auth_header
    headers.setdefault("Accept", "application/json")

    resp = requests.request(method, url, headers=headers, **kwargs)
    if not resp.ok:
        raise HTTPException(
            status_code=resp.status_code,
            detail=f"Onshape API error {resp.status_code}: {resp.text}",
        )
    if resp.text.strip():
        return resp.json()
    return {}


@app.post(
    "/create_from_openscad",
    response_model=CreateFromOpenSCADResponse,
)
def create_from_openscad(payload: CreateFromOpenSCADRequest):
    openscad_code = payload.openscad_code
    doc_name = payload.document_name or f"AI Model {__import__('datetime').datetime.utcnow().isoformat()}"

    print(f"Creating model from OpenSCAD code: {openscad_code} and document name: {doc_name}")

    if not openscad_code:
        raise HTTPException(status_code=400, detail="openscad_code is required")

    doc_id = None

    try:
        # Use temp files for .scad and .stl
        with tempfile.NamedTemporaryFile(suffix=".scad", delete=False) as scad_file:
            scad_path = scad_file.name
            scad_file.write(openscad_code.encode("utf-8"))

        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as stl_file:
            stl_path = stl_file.name

        # Run openscad to convert SCAD -> STL
        try:
            subprocess.run(
                ["openscad", "-o", stl_path, scad_path],
                check=True,
                capture_output=True,
                timeout=30,
            )
        except subprocess.CalledProcessError as e:
            raise HTTPException(
                status_code=500,
                detail=f"OpenSCAD error: {e.stderr.decode('utf-8', errors='ignore')}",
            )

        # Read STL content
        with open(stl_path, "rb") as f:
            stl_bytes = f.read()

        # Clean up temp files
        try:
            os.remove(scad_path)
            os.remove(stl_path)
        except OSError:
            pass

        # Create Onshape document
        doc = onshape_api_request(
            "POST",
            "/documents",
            json={"name": doc_name, "public": False},
        )
        doc_id = doc["id"]
        workspace_id = doc["defaultWorkspace"]["id"]

        # Upload STL as blob element
        file_name = "model.stl"
        files = {
            "file": (file_name, stl_bytes, "application/octet-stream"),
        }

        blob = onshape_api_request(
            "POST",
            f"/blobelements/d/{doc_id}/w/{workspace_id}?encodedFilename={requests.utils.quote(file_name)}",
            files=files,
        )

        # Import blob into Part Studio
        onshape_api_request(
            "POST",
            f"/partstudios/d/{doc_id}/w/{workspace_id}/import",
            json={
                "format": "STL",
                "blobElementId": blob["id"],
                "importIntoPartStudio": True,
                "createNewPartStudio": False,
            },
        )

        url = f"https://cad.onshape.com/documents/{doc_id}"
        message = (
            f"✅ Successfully created 3D model in Onshape!\n\n"
            f"Document: {doc_name}\nID: {doc_id}\n\n🔗 View your model: {url}"
        )

        return CreateFromOpenSCADResponse(
            success=True,
            docId=doc_id,
            docName=doc_name,
            url=url,
            message=message,
        )

    except Exception as e:
        # If doc was created but something else failed, report partial success
        if doc_id:
            url = f"https://cad.onshape.com/documents/{doc_id}"
            message = (
                f"⚠️ Model document created, but an error occurred.\n\n"
                f"Document: {doc_name}\nID: {doc_id}\n\n🔗 View: {url}\n\n"
                f"Error: {e}"
            )
            return CreateFromOpenSCADResponse(
                success=True,
                docId=doc_id,
                docName=doc_name,
                url=url,
                message=message,
            )

        return CreateFromOpenSCADResponse(
            success=False,
            error=str(e),
        )
