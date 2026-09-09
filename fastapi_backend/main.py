from fastapi import FastAPI, Request
from fastapi.responses import Response, StreamingResponse
import httpx

app = FastAPI(
    title="AI-Dinmagic FastAPI",
    version="1.0.0"
)

NODE_BACKEND = "http://127.0.0.1:3000"


@app.get("/")
async def root():
    return {
        "status": "running",
        "service": "AI-Dinmagic FastAPI",
        "proxy": "Node/Express :3000"
    }


@app.get("/health")
async def health():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{NODE_BACKEND}/api/debug/jobs")

        return {
            "status": "ok",
            "node_backend": r.status_code == 200
        }

    except Exception as e:
        return {
            "status": "ok",
            "node_backend": False,
            "error": str(e)
        }


@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
)
async def api_proxy(path: str, request: Request):
    target_url = f"{NODE_BACKEND}/api/{path}"

    body = await request.body()

    headers = dict(request.headers)

    # Remove headers that should not be forwarded unchanged
    headers.pop("host", None)
    headers.pop("content-length", None)

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=10.0,
            read=600.0,
            write=600.0,
            pool=10.0
        )
    ) as client:

        response = await client.request(
            method=request.method,
            url=target_url,
            content=body,
            headers=headers,
            params=request.query_params
        )

    excluded_headers = {
        "content-encoding",
        "transfer-encoding",
        "connection",
        "content-length"
    }

    response_headers = {
        k: v
        for k, v in response.headers.items()
        if k.lower() not in excluded_headers
    }

    return Response(
        content=response.content,
        status_code=response.status_code,
        headers=response_headers,
        media_type=response.headers.get("content-type")
    )
