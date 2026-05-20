class PlaceDataMissingError(Exception):
    def __init__(self, place_id: str):
        self.place_id = place_id
        super().__init__(f"Place '{place_id}' not found in curated dataset")


class BudgetExceededError(Exception):
    def __init__(self, total: float, budget: float):
        self.total = total
        self.budget = budget
        super().__init__(f"Total cost {total:.2f} SGD exceeds budget {budget:.2f} SGD")
