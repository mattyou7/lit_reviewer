"""Evaluation hooks for the landscape extraction model.

Quality metrics should be computed against human-annotated gold JSON. Resource
metrics are collected separately so quality is never conflated with efficiency.
"""

def unsupported_claim_rate(predicted, gold):
    # Placeholder: implement evidence-span validation against source text.
    return None


def score_record(predicted, gold):
    return {
        "json_validity": True,
        "unsupported_claim_rate": unsupported_claim_rate(predicted, gold),
    }
