"""
backend/app/ai/vision.py
Analyzes damage images using Google Gemini API (google-genai library)
"""

import os
import json
import warnings
warnings.filterwarnings("ignore")

from dotenv import load_dotenv
load_dotenv()


def analyze_damage_image(image_bytes: bytes) -> dict:
    api_key = os.getenv("GOOGLE_AI_API_KEY", "").strip()

    if not api_key:
        print("[Vision AI] No API key found, using fallback")
        return _fallback_response()

    try:
        from google import genai
        from google.genai import types

        print("[Vision AI] Connecting to Gemini...")
        client = genai.Client(api_key=api_key)

        prompt = """You are an insurance damage assessment AI for an Indian insurance platform.
Analyze this damage image and respond ONLY with a valid JSON object.
No explanation, no markdown, just raw JSON.

JSON format:
{
  "claim_type": "car" or "house" or "health" or "business",
  "damage_severity": "minor" or "moderate" or "severe" or "total_loss",
  "estimated_amount": "rupees X to Y",
  "affected_parts": ["part1", "part2", "part3"],
  "documentation_needed": ["doc1", "doc2", "doc3"],
  "rejection_risks": ["risk1", "risk2"]
}

Rules:
- estimated_amount must use realistic Indian Rupee amounts
- affected_parts: list the specific damaged areas visible
- documentation_needed: list documents required to file this claim in India
- rejection_risks: list reasons this claim might be rejected
"""

        if image_bytes[:3] == b'\xff\xd8\xff':
            mime_type = "image/jpeg"
        elif image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
            mime_type = "image/png"
        elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
            mime_type = "image/webp"
        else:
            mime_type = "image/jpeg"

        print(f"[Vision AI] Sending image ({mime_type}) to Gemini 2.0 Flash...")

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                prompt
            ]
        )

        print("[Vision AI] Response received, parsing...")
        raw = response.text.strip()
        print(f"[Vision AI] Raw response: {raw[:200]}")

        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        result = json.loads(raw)
        print("[Vision AI] Successfully parsed JSON")
        return result

    except Exception as e:
        print(f"[Vision AI Error] {type(e).__name__}: {e}")
        return _fallback_response()


def _fallback_response() -> dict:
    return {
        "claim_type": "car",
        "damage_severity": "moderate",
        "estimated_amount": "25000 to 75000",
        "affected_parts": ["Front bumper", "Hood", "Headlights"],
        "documentation_needed": [
            "FIR copy",
            "RC book",
            "Driving license",
            "Insurance policy document",
            "Repair estimate from garage"
        ],
        "rejection_risks": [
            "Driving under influence",
            "Policy lapse at time of incident"
        ]
    }