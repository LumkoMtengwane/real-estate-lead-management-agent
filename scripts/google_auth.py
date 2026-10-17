"""One-off: sign in to Google and save the refresh token into .env.

Run: python scripts/google_auth.py (needs: pip install google-auth-oauthlib)
Reads GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from .env, opens a browser sign-in,
writes GOOGLE_REFRESH_TOKEN back into .env. Never prints secrets.
"""
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

ENV = Path(__file__).resolve().parent.parent / ".env"  # the project .env

# Least privilege: read mail, save drafts, read free/busy. Nothing else.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/calendar.freebusy",
]


def read_env():
    values = {}
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, _, val = line.partition("=")
            values[key.strip()] = val.split("#")[0].strip()
    return values


def write_token(token):
    lines = ENV.read_text(encoding="utf-8").splitlines()
    out, done = [], False
    for line in lines:
        if line.startswith("GOOGLE_REFRESH_TOKEN="):
            line, done = f"GOOGLE_REFRESH_TOKEN={token}", True
        out.append(line)
    if not done:
        out.append(f"GOOGLE_REFRESH_TOKEN={token}")
    ENV.write_text("\n".join(out) + "\n", encoding="utf-8")


def main():
    env = read_env()
    if not env.get("GOOGLE_CLIENT_ID") or not env.get("GOOGLE_CLIENT_SECRET"):
        raise SystemExit("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.")
    config = {
        "installed": {
            "client_id": env["GOOGLE_CLIENT_ID"],
            "client_secret": env["GOOGLE_CLIENT_SECRET"],
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": ["http://localhost"],
        }
    }
    flow = InstalledAppFlow.from_client_config(config, SCOPES)
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")
    if not creds.refresh_token:
        raise SystemExit("No refresh token returned. Re-run and approve all prompts.")
    write_token(creds.refresh_token)
    print("Saved GOOGLE_REFRESH_TOKEN to .env")


if __name__ == "__main__":
    main()
