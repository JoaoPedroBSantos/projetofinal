"""Ponto de entrada: `uvicorn main:app`."""

from app.main import create_app

app = create_app()
