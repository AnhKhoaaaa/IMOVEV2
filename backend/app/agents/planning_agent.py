"""
Planning Agent — 75% code, 25% LLM.
LLM (Gemini) is called ONLY for edge cases not covered by rule-based logic.
"""

async def plan_trip(place_ids: list[str], num_days: int, budget_sgd: float,
                    optimize_order: bool, preferences: dict) -> dict:
    # [CODE] 1. Validate all place_ids exist in curated dataset
    # [CODE] 2. If optimize_order: greedy nearest-neighbor sort
    # [CODE] 3. Distribute places across days by dwell_time budget
    # [CODE] 4. For each leg: call onemap.get_route → time + cost
    # [CODE] 5. Check total cost <= budget_sgd
    # [CODE] 6. Check best_time conflicts → soft warnings
    # [LLM]  7. Call Gemini only if edge case not covered by rules above
    raise NotImplementedError
