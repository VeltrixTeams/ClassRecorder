from fastapi import HTTPException


def api_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"error": {"code": code, "message": message}})


def not_found(what: str = "resource") -> HTTPException:
    return api_error(404, "not_found", f"{what} not found")
