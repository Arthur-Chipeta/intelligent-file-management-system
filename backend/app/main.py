from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def root():
    return {"message": "Intelligent File Management System API"}