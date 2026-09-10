"""
backend/app/ai/policy_analyzer.py
Extracts text from policy PDFs and analyzes using Groq API
"""

import os
import json
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """
    Extract text from a PDF using PyMuPDF (fitz).
    Returns max 8000 characters of text.
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
            if len(text) >= 8000:
                break
        doc.close()
        return text[:8000].strip()

    except Exception as e:
        print(f"[PDF Extraction Error] {e}")
        return ""


def analyze_policy_text(text: str) -> dict:
    """
    Analyze extracted policy text using Groq.
    Returns structured policy analysis.
    """

    if not GROQ_API_KEY or not text:
        return _fallback_analysis()

    try:
        from groq import Groq

        client = Groq(api_key=GROQ_API_KEY)

        prompt = f"""You are an expert Indian insurance policy analyzer.

Analyze this insurance policy document text and respond ONLY with a valid JSON object.
No explanation, no markdown, just raw JSON.

Policy Text:
{text[:7000]}

JSON format:
{{
  "policy_summary": "2-3 sentence plain English summary of what this policy is",
  "what_is_covered": ["item1", "item2", "item3", "item4", "item5"],
  "what_is_NOT_covered": ["item1", "item2", "item3", "item4", "item5"],
  "hidden_benefits": ["benefit1", "benefit2", "benefit3"],
  "dangerous_clauses": ["clause1", "clause2", "clause3"],
  "overall_rating": 7.5
}}

Rules:
- policy_summary: simple language any Indian can understand
- what_is_covered: at least 5 specific items covered
- what_is_NOT_covered: at least 5 specific exclusions
- hidden_benefits: lesser-known benefits most people miss
- dangerous_clauses: clauses that could hurt the policyholder
- overall_rating: float from 1.0 to 10.0 based on how good this policy is for the customer"""

        response = client.chat.completions.create(
                model="openai/gpt-oss-120b",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1000,
            temperature=0.3
        )

        raw = response.choices[0].message.content.strip()

        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        raw = raw.strip()

        result = json.loads(raw)
        return result

    except Exception as e:
        print(f"[Policy Analyzer Error] {e}")
        return _fallback_analysis()


def _fallback_analysis() -> dict:
    return {
        "policy_summary": "This appears to be a standard Indian insurance policy. Upload your policy document for a detailed AI-powered analysis of your specific coverage.",
        "what_is_covered": [
            "Accidental damage",
            "Natural disasters (fire, flood, earthquake)",
            "Theft and burglary",
            "Third-party liability",
            "Emergency hospitalization"
        ],
        "what_is_NOT_covered": [
            "Pre-existing conditions (during waiting period)",
            "Wear and tear / depreciation",
            "Intentional damage",
            "War and nuclear perils",
            "Unlicensed driver claims (motor)"
        ],
        "hidden_benefits": [
            "No-claim bonus (NCB) discount on renewal",
            "Free annual health check-up",
            "Roadside assistance coverage"
        ],
        "dangerous_clauses": [
            "Sub-limits on room rent may reduce total claim payout",
            "Co-payment clause requires you to pay a portion of claim",
            "Waiting period for specific diseases"
        ],
        "overall_rating": 6.5
    }
