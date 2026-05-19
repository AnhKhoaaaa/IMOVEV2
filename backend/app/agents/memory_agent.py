"""
Memory Agent — active only for logged-in users.
Learns from explicit ratings and implicit edit patterns.
"""

async def save_feedback(trip_id: str, user_id: str, rating: int, comment: str):
    # [CODE] Save rating + comment to trip_feedback table
    raise NotImplementedError

async def get_preferences(user_id: str) -> dict:
    # [CODE] Return user_preferences from Supabase
    raise NotImplementedError

async def update_implicit_preferences(trip_id: str, user_id: str):
    # [CODE] If user edited many bus legs → update prefer_mrt=True in user_preferences
    raise NotImplementedError
