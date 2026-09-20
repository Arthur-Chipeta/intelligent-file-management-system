import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    """Validated data accepted when a user creates an account."""

    name: str = Field(min_length=2, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        name = " ".join(value.split())
        if len(name) < 2:
            raise ValueError("Name must contain at least 2 characters.")
        return name

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).lower()

    @field_validator("password")
    @classmethod
    def validate_password_strength(cls, value: str) -> str:
        has_uppercase = re.search(r"[A-Z]", value)
        has_lowercase = re.search(r"[a-z]", value)
        has_number = re.search(r"\d", value)

        if not (has_uppercase and has_lowercase and has_number):
            raise ValueError(
                "Password must include uppercase, lowercase, and numeric characters."
            )
        return value


class RegisteredUser(BaseModel):
    """Safe account data returned by the registration endpoint."""

    id: int
    name: str
    email: EmailStr

    model_config = ConfigDict(from_attributes=True)


class LoginRequest(BaseModel):
    """Credentials accepted when a user signs in."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).lower()


class TokenResponse(BaseModel):
    """Bearer token returned after successful authentication."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: RegisteredUser
